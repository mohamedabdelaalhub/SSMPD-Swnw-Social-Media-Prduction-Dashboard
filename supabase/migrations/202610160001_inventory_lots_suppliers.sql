-- المخزن: تشغيلات + تاريخ صلاحية (FEFO) + هالك + موردين + تنبيهات الصلاحية.
-- مُطبَّق فعلياً على القاعدة الحية على دفعات؛ هذا الملف توثيق قابل للإعادة (idempotent).

alter table public.inventory_items add column if not exists track_lots boolean not null default false;

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 160),
  phone text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  lot_number text not null default '',
  expiry_date date,
  received_quantity numeric not null check (received_quantity > 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  supplier_name text not null default '',
  received_at timestamptz not null default now(),
  created_by uuid references public.admins(id)
);
create index if not exists inventory_lots_item_idx on public.inventory_lots(item_id, expiry_date);

alter table public.inventory_movements add column if not exists lot_id uuid references public.inventory_lots(id);
create index if not exists inventory_movements_lot_idx on public.inventory_movements(lot_id) where lot_id is not null;
alter table public.inventory_alerts add column if not exists lot_id uuid references public.inventory_lots(id);

alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('receipt','issue','sale','count_adjustment','return','opening_balance','waste','expired'));
alter table public.inventory_alerts drop constraint if exists inventory_alerts_alert_type_check;
alter table public.inventory_alerts add constraint inventory_alerts_alert_type_check
  check (alert_type in ('low_stock','repeat_request','fast_depletion','late_count','near_expiry','expired_stock'));

alter table public.inventory_suppliers enable row level security;
alter table public.inventory_lots enable row level security;
drop policy if exists inventory_suppliers_read on public.inventory_suppliers;
create policy inventory_suppliers_read on public.inventory_suppliers for select using (public.inventory_can_manage());
drop policy if exists inventory_lots_read on public.inventory_lots;
create policy inventory_lots_read on public.inventory_lots for select using (public.inventory_can_view());

create or replace function public.inventory_lot_remaining(p_lot uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantity_delta), 0) from public.inventory_movements where lot_id = p_lot;
$$;

create or replace function public.inventory_available(p_item uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select public.inventory_on_hand(p_item) - coalesce((
    select sum(public.inventory_lot_remaining(l.id)) from public.inventory_lots l
    where l.item_id = p_item and l.expiry_date is not null and l.expiry_date < current_date
      and public.inventory_lot_remaining(l.id) > 0), 0);
$$;

-- FEFO: الأقرب انتهاءً أولاً، والمنتهي يُستبعد؛ أي كمية بدون تشغيلة تخرج lot_id = null.
create or replace function public.inventory_allocate(p_item uuid, p_qty numeric)
returns table(lot_id uuid, qty numeric) language plpgsql security definer set search_path = public as $$
declare r record; v_left numeric := p_qty; v_take numeric;
begin
  for r in select l.id as lid, public.inventory_lot_remaining(l.id) as remaining
             from public.inventory_lots l
            where l.item_id = p_item and (l.expiry_date is null or l.expiry_date >= current_date)
            order by l.expiry_date nulls last, l.received_at, l.id loop
    exit when v_left <= 0;
    continue when r.remaining <= 0;
    v_take := least(r.remaining, v_left);
    lot_id := r.lid; qty := v_take; return next;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then lot_id := null; qty := v_left; return next; end if;
end $$;

create or replace function public.inventory_save_supplier(p_id uuid, p_name text, p_phone text, p_notes text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to manage suppliers'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'اسم المورد مطلوب'; end if;
  if p_id is null then
    insert into public.inventory_suppliers(name, phone, notes, active, created_by)
      values (trim(p_name), coalesce(p_phone, ''), coalesce(p_notes, ''), coalesce(p_active, true), public.my_admin_id()) returning id into v_id;
  else
    update public.inventory_suppliers set name = trim(p_name), phone = coalesce(p_phone, ''), notes = coalesce(p_notes, ''), active = coalesce(p_active, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Supplier not found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.inventory_set_track_lots(p_item_id uuid, p_track boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to manage inventory'; end if;
  update public.inventory_items set track_lots = coalesce(p_track,false), updated_at = now() where id = p_item_id;
  if not found then raise exception 'Item not found'; end if;
end $$;

create or replace function public.inventory_write_off(p_item_id uuid, p_quantity numeric, p_kind text, p_lot_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cost numeric; a record; v_lot public.inventory_lots%rowtype;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to write off stock'; end if;
  if p_kind not in ('waste', 'expired') then raise exception 'Invalid write-off kind'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if length(trim(coalesce(p_note, ''))) < 2 then raise exception 'اكتب سبب الهالك'; end if;
  perform 1 from public.inventory_items where id = p_item_id and active for update;
  if not found then raise exception 'Item not found'; end if;
  if public.inventory_on_hand(p_item_id) < p_quantity then raise exception 'Insufficient stock'; end if;
  v_cost := public.inventory_average_cost(p_item_id);
  if p_lot_id is not null then
    select * into v_lot from public.inventory_lots where id = p_lot_id and item_id = p_item_id;
    if not found then raise exception 'Lot not found'; end if;
    if public.inventory_lot_remaining(p_lot_id) < p_quantity then raise exception 'Lot quantity is lower than requested'; end if;
    insert into public.inventory_movements(item_id, movement_type, quantity_delta, unit_cost, profit_amount, lot_id, note, created_by)
      values (p_item_id, p_kind, -p_quantity, v_cost, -round(v_cost * p_quantity, 2), p_lot_id, trim(p_note), public.my_admin_id());
  else
    for a in select * from public.inventory_allocate(p_item_id, p_quantity) loop
      insert into public.inventory_movements(item_id, movement_type, quantity_delta, unit_cost, profit_amount, lot_id, note, created_by)
        values (p_item_id, p_kind, -a.qty, v_cost, -round(v_cost * a.qty, 2), a.lot_id, trim(p_note), public.my_admin_id());
    end loop;
  end if;
end $$;

-- ملاحظة: inventory_receive_request / inventory_record_sale / inventory_fulfill_issue /
-- inventory_refresh_alerts / inventory_snapshot مُحدَّثة في القاعدة الحية (تشغيلات + FEFO + تنبيهات الصلاحية + lots/suppliers في الـsnapshot)؛
-- انظر تعريفاتها الحالية بـ pg_get_functiondef.

revoke all on function public.inventory_set_track_lots(uuid,boolean), public.inventory_write_off(uuid,numeric,text,uuid,text), public.inventory_save_supplier(uuid,text,text,text,boolean) from public, anon;
grant execute on function public.inventory_set_track_lots(uuid,boolean), public.inventory_write_off(uuid,numeric,text,uuid,text), public.inventory_save_supplier(uuid,text,text,text,boolean) to authenticated;
