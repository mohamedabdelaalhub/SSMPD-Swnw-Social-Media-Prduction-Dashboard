-- إدارة المخزون والمشتريات والصرف والجرد لمركز Swnw
-- شغّلي هذا الملف مرة واحدة في Supabase > SQL Editor بعد مراجعة التغيير.

create extension if not exists pgcrypto;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null check (length(trim(name)) between 2 and 180),
  category text not null default 'عام',
  base_unit text not null default 'وحدة',
  units_per_pack numeric(14,3) not null default 1 check (units_per_pack > 0),
  minimum_quantity numeric(14,3) not null default 0 check (minimum_quantity >= 0),
  markup_percent numeric(8,3) not null default 0 check (markup_percent between 0 and 1000),
  current_sale_price numeric(14,2) not null default 0 check (current_sale_price >= 0),
  active boolean not null default true,
  created_by uuid not null default public.my_admin_id() references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('purchase','issue')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','partial','completed','cancelled')),
  requester_id uuid not null references public.admins(id),
  reviewer_id uuid references public.admins(id),
  note text not null default '',
  review_note text not null default '',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.inventory_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.inventory_requests(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,3) not null check (quantity > 0),
  package_cost numeric(14,2) not null default 0 check (package_cost >= 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  fulfilled_quantity numeric(14,3) not null default 0 check (fulfilled_quantity >= 0),
  unique(request_id,item_id)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  movement_type text not null check (movement_type in ('receipt','issue','sale','count_adjustment','return','opening_balance')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  unit_sale_price numeric(14,2) not null default 0 check (unit_sale_price >= 0),
  margin_percent numeric(8,3) not null default 0,
  profit_amount numeric(14,2) not null default 0,
  reference_type text not null default '',
  reference_id uuid,
  patient_invoice_ref text not null default '',
  payment_method text not null default '',
  note text not null default '',
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  previous_price numeric(14,2) not null,
  new_price numeric(14,2) not null,
  previous_markup numeric(8,3) not null,
  new_markup numeric(8,3) not null,
  changed_by uuid not null references public.admins(id),
  changed_at timestamptz not null default now()
);

create table if not exists public.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open' check (status in ('open','submitted','approved','cancelled')),
  assigned_to uuid not null references public.admins(id),
  created_by uuid not null references public.admins(id),
  due_at timestamptz,
  submitted_at timestamptz,
  approved_by uuid references public.admins(id),
  approved_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_count_sessions(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id),
  system_quantity numeric(14,3) not null default 0,
  counted_quantity numeric(14,3),
  note text not null default '',
  unique(session_id,item_id)
);

create table if not exists public.inventory_count_schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  cadence_days integer not null check (cadence_days between 1 and 366),
  assigned_to uuid not null references public.admins(id),
  next_due_at timestamptz not null,
  active boolean not null default true,
  created_by uuid not null references public.admins(id),
  last_session_id uuid references public.inventory_count_sessions(id),
  project_id uuid references public.task_projects(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id),
  alert_type text not null check (alert_type in ('low_stock','repeat_request','fast_depletion','late_count')),
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists inventory_movements_item_time_idx on public.inventory_movements(item_id,created_at desc);
create index if not exists inventory_requests_status_idx on public.inventory_requests(status,requested_at desc);
create index if not exists inventory_count_assignee_idx on public.inventory_count_sessions(assigned_to,status,due_at);
create index if not exists inventory_alerts_open_idx on public.inventory_alerts(resolved_at,created_at desc);

create or replace function public.inventory_is_manager()
returns boolean language sql stable security definer set search_path=public as $$
  select public.has_role('super_admin') or public.has_role('general_manager');
$$;

create or replace function public.inventory_can_view()
returns boolean language sql stable security definer set search_path=public as $$
  select public.inventory_is_manager()
    or (public.has_role('accountant') or public.has_role('financial_manager'))
       and exists(select 1 from public.admin_module_permissions p where p.admin_id=public.my_admin_id() and p.module_key='inventory' and p.can_view)
    or public.has_role('nursing') or public.has_role('reception') or public.has_role('sono_doctor');
$$;

create or replace function public.inventory_can_manage()
returns boolean language sql stable security definer set search_path=public as $$
  select public.inventory_is_manager()
    or (public.has_role('accountant') or public.has_role('financial_manager'))
       and exists(select 1 from public.admin_module_permissions p where p.admin_id=public.my_admin_id() and p.module_key='inventory' and p.can_view and p.can_update);
$$;

create or replace function public.inventory_on_hand(p_item_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(quantity_delta),0) from public.inventory_movements where item_id=p_item_id;
$$;

alter table public.inventory_items enable row level security;
alter table public.inventory_requests enable row level security;
alter table public.inventory_request_lines enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_price_history enable row level security;
alter table public.inventory_count_sessions enable row level security;
alter table public.inventory_count_lines enable row level security;
alter table public.inventory_count_schedules enable row level security;
alter table public.inventory_alerts enable row level security;

drop policy if exists inventory_items_read on public.inventory_items;
create policy inventory_items_read on public.inventory_items for select to authenticated using (public.inventory_can_view());
drop policy if exists inventory_items_manage on public.inventory_items;
create policy inventory_items_manage on public.inventory_items for all to authenticated using (public.inventory_can_manage()) with check (public.inventory_can_manage());
drop policy if exists inventory_requests_read on public.inventory_requests;
create policy inventory_requests_read on public.inventory_requests for select to authenticated using (public.inventory_can_manage() or requester_id=public.my_admin_id());
drop policy if exists inventory_request_lines_read on public.inventory_request_lines;
create policy inventory_request_lines_read on public.inventory_request_lines for select to authenticated using (exists(select 1 from public.inventory_requests r where r.id=request_id and (public.inventory_can_manage() or r.requester_id=public.my_admin_id())));
drop policy if exists inventory_movements_read on public.inventory_movements;
create policy inventory_movements_read on public.inventory_movements for select to authenticated using (public.inventory_can_manage());
drop policy if exists inventory_price_history_read on public.inventory_price_history;
create policy inventory_price_history_read on public.inventory_price_history for select to authenticated using (public.inventory_can_manage());
drop policy if exists inventory_count_read on public.inventory_count_sessions;
create policy inventory_count_read on public.inventory_count_sessions for select to authenticated using (public.inventory_can_manage() or assigned_to=public.my_admin_id());
drop policy if exists inventory_count_lines_read on public.inventory_count_lines;
create policy inventory_count_lines_read on public.inventory_count_lines for select to authenticated using (exists(select 1 from public.inventory_count_sessions s where s.id=session_id and (public.inventory_can_manage() or s.assigned_to=public.my_admin_id())));
drop policy if exists inventory_count_schedule_manage on public.inventory_count_schedules;
create policy inventory_count_schedule_manage on public.inventory_count_schedules for all to authenticated using (public.inventory_can_manage()) with check (public.inventory_can_manage());
drop policy if exists inventory_alerts_read on public.inventory_alerts;
create policy inventory_alerts_read on public.inventory_alerts for select to authenticated using (public.inventory_can_manage());

grant select on public.inventory_items,public.inventory_requests,public.inventory_request_lines,public.inventory_movements,public.inventory_price_history,public.inventory_count_sessions,public.inventory_count_lines,public.inventory_count_schedules,public.inventory_alerts to authenticated;

create or replace function public.inventory_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_me uuid:=public.my_admin_id(); v_items jsonb; v_requests jsonb; v_moves jsonb; v_counts jsonb; v_alerts jsonb; v_schedules jsonb; v_mgr boolean:=public.inventory_can_manage();
begin
  if not public.inventory_can_view() then raise exception 'Not allowed to view inventory'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') into v_items from (
    select i.*,public.inventory_on_hand(i.id) on_hand from public.inventory_items i where i.active
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]') into v_requests from (
    select r.id,r.request_type,r.status,r.requester_id,a.name requester_name,r.note,r.review_note,r.requested_at,
      coalesce(jsonb_agg(jsonb_build_object('item_id',l.item_id,'item_name',i.name,'quantity',l.quantity,'package_cost',l.package_cost,'received_quantity',l.received_quantity,'fulfilled_quantity',l.fulfilled_quantity)) filter(where l.id is not null),'[]') lines
    from public.inventory_requests r join public.admins a on a.id=r.requester_id left join public.inventory_request_lines l on l.request_id=r.id left join public.inventory_items i on i.id=l.item_id
    where v_mgr or r.requester_id=v_me group by r.id,a.name order by r.requested_at desc limit 250
  ) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into v_moves from (
    select m.*,i.name item_name,a.name actor_name from public.inventory_movements m join public.inventory_items i on i.id=m.item_id join public.admins a on a.id=m.created_by order by m.created_at desc limit 500
  ) x where v_mgr;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') into v_counts from (
    select s.*,a.name assignee_name,coalesce(jsonb_agg(jsonb_build_object('item_id',l.item_id,'item_name',i.name,'system_quantity',l.system_quantity,'counted_quantity',l.counted_quantity,'note',l.note)) filter(where l.id is not null),'[]') lines
    from public.inventory_count_sessions s join public.admins a on a.id=s.assigned_to left join public.inventory_count_lines l on l.session_id=s.id left join public.inventory_items i on i.id=l.item_id
    where v_mgr or s.assigned_to=v_me group by s.id,a.name order by s.created_at desc limit 150
  ) x;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') into v_alerts from public.inventory_alerts a where a.resolved_at is null and v_mgr;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'cadence_days',s.cadence_days,'assigned_to',s.assigned_to,'assignee_name',coalesce(nullif(a.name,''),a.email),'next_due_at',s.next_due_at) order by s.next_due_at),'[]') into v_schedules
    from public.inventory_count_schedules s join public.admins a on a.id=s.assigned_to where s.active and (v_mgr or s.assigned_to=v_me);
  return jsonb_build_object('items',v_items,'requests',v_requests,'movements',v_moves,'counts',v_counts,'alerts',v_alerts,'schedules',v_schedules,'can_manage',v_mgr,'me',v_me);
end $$;

create or replace function public.inventory_save_item(p_id uuid,p_sku text,p_name text,p_category text,p_base_unit text,p_units_per_pack numeric,p_minimum numeric,p_markup numeric,p_sale_price numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_old public.inventory_items%rowtype; v_price numeric;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to manage inventory'; end if;
  if p_units_per_pack<=0 or p_minimum<0 or p_markup<0 or p_sale_price<0 then raise exception 'Invalid quantity or price'; end if;
  if p_id is null then
    insert into public.inventory_items(sku,name,category,base_unit,units_per_pack,minimum_quantity,markup_percent,current_sale_price)
      values(nullif(trim(p_sku),''),trim(p_name),coalesce(nullif(trim(p_category),''),'عام'),coalesce(nullif(trim(p_base_unit),''),'وحدة'),p_units_per_pack,p_minimum,p_markup,p_sale_price) returning id into v_id;
  else
    select * into v_old from public.inventory_items where id=p_id for update;
    if not found then raise exception 'Item not found'; end if;
    update public.inventory_items set sku=nullif(trim(p_sku),''),name=trim(p_name),category=coalesce(nullif(trim(p_category),''),'عام'),base_unit=coalesce(nullif(trim(p_base_unit),''),'وحدة'),units_per_pack=p_units_per_pack,minimum_quantity=p_minimum,markup_percent=p_markup,current_sale_price=p_sale_price,updated_at=now() where id=p_id returning id into v_id;
    if v_old.current_sale_price<>p_sale_price or v_old.markup_percent<>p_markup then
      insert into public.inventory_price_history(item_id,previous_price,new_price,previous_markup,new_markup,changed_by)
        values(v_id,v_old.current_sale_price,p_sale_price,v_old.markup_percent,p_markup,public.my_admin_id());
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.inventory_create_request(p_type text,p_note text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_line jsonb; v_item uuid; v_qty numeric; v_cost numeric;
begin
  if not public.inventory_can_view() then raise exception 'Not allowed to request inventory'; end if;
  if p_type not in ('purchase','issue') or jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'Choose at least one item'; end if;
  insert into public.inventory_requests(request_type,requester_id,note) values(p_type,public.my_admin_id(),coalesce(p_note,'')) returning id into v_id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item:=(v_line->>'item_id')::uuid; v_qty:=(v_line->>'quantity')::numeric; v_cost:=coalesce((v_line->>'package_cost')::numeric,0);
    if v_qty<=0 or v_cost<0 or not exists(select 1 from public.inventory_items where id=v_item and active) then raise exception 'Invalid request line'; end if;
    insert into public.inventory_request_lines(request_id,item_id,quantity,package_cost) values(v_id,v_item,v_qty,v_cost);
  end loop;
  return v_id;
end $$;

create or replace function public.inventory_set_opening_balance(p_item_id uuid,p_quantity numeric,p_unit_cost numeric,p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to set opening balance'; end if;
  if p_quantity<0 or p_unit_cost<0 then raise exception 'Invalid opening balance'; end if;
  if exists(select 1 from public.inventory_movements where item_id=p_item_id) then raise exception 'Opening balance can only be set once, before the first stock movement'; end if;
  if p_quantity>0 then
    insert into public.inventory_movements(item_id,movement_type,quantity_delta,unit_cost,note,created_by)
      values(p_item_id,'opening_balance',p_quantity,p_unit_cost,coalesce(p_note,''),public.my_admin_id());
  end if;
end $$;

create or replace function public.inventory_review_request(p_id uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to review inventory requests'; end if;
  update public.inventory_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewer_id=public.my_admin_id(),review_note=coalesce(p_note,''),reviewed_at=now()
  where id=p_id and status='pending';
  if not found then raise exception 'Request is no longer pending'; end if;
end $$;

create or replace function public.inventory_receive_request(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare v_req public.inventory_requests%rowtype; v_line jsonb; v_l public.inventory_request_lines%rowtype; v_qty numeric; v_cost numeric; v_item public.inventory_items%rowtype; v_unit_cost numeric; v_price numeric;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to receive stock'; end if;
  select * into v_req from public.inventory_requests where id=p_id for update;
  if not found or v_req.request_type<>'purchase' or v_req.status not in ('approved','partial') then raise exception 'Purchase request must be approved first'; end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    select * into v_l from public.inventory_request_lines where request_id=p_id and item_id=(v_line->>'item_id')::uuid for update;
    if not found then raise exception 'Unknown request item'; end if;
    v_qty:=(v_line->>'quantity')::numeric;
    if v_qty<=0 or v_l.received_quantity+v_qty>v_l.quantity then raise exception 'Received quantity exceeds the approved order'; end if;
    select * into v_item from public.inventory_items where id=v_l.item_id for update;
    v_cost:=coalesce((v_line->>'package_cost')::numeric,v_l.package_cost);
    v_unit_cost:=v_cost/greatest(v_item.units_per_pack,1);
    v_price:=round(v_unit_cost*(1+v_item.markup_percent/100),2);
    update public.inventory_request_lines set received_quantity=received_quantity+v_qty where id=v_l.id;
    update public.inventory_items set current_sale_price=v_price,updated_at=now() where id=v_item.id;
    insert into public.inventory_movements(item_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,reference_type,reference_id,note,created_by)
      values(v_item.id,'receipt',v_qty,v_unit_cost,v_price,v_item.markup_percent,'purchase',p_id,coalesce(p_note,''),public.my_admin_id());
  end loop;
  update public.inventory_requests set status=case when exists(select 1 from public.inventory_request_lines where request_id=p_id and received_quantity<quantity) then 'partial' else 'completed' end,completed_at=case when not exists(select 1 from public.inventory_request_lines where request_id=p_id and received_quantity<quantity) then now() else null end where id=p_id;
end $$;

create or replace function public.inventory_fulfill_issue(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare v_req public.inventory_requests%rowtype; v_line jsonb; v_l public.inventory_request_lines%rowtype; v_qty numeric; v_on_hand numeric; v_cost numeric; v_price numeric; v_margin numeric;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to issue inventory'; end if;
  select * into v_req from public.inventory_requests where id=p_id for update;
  if not found or v_req.request_type<>'issue' or v_req.status not in ('approved','partial') then raise exception 'Issue request must be approved first'; end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    select * into v_l from public.inventory_request_lines where request_id=p_id and item_id=(v_line->>'item_id')::uuid for update;
    if not found then raise exception 'Unknown request item'; end if;
    v_qty:=(v_line->>'quantity')::numeric;
    if v_qty<=0 or v_l.fulfilled_quantity+v_qty>v_l.quantity then raise exception 'Issued quantity exceeds the approved request'; end if;
    v_on_hand:=public.inventory_on_hand(v_l.item_id); if v_on_hand<v_qty then raise exception 'Insufficient stock'; end if;
    select coalesce(sum(quantity_delta*unit_cost)/nullif(sum(quantity_delta),0),0) into v_cost from public.inventory_movements where item_id=v_l.item_id and movement_type='receipt';
    select current_sale_price,markup_percent into v_price,v_margin from public.inventory_items where id=v_l.item_id;
    update public.inventory_request_lines set fulfilled_quantity=fulfilled_quantity+v_qty where id=v_l.id;
    insert into public.inventory_movements(item_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,profit_amount,reference_type,reference_id,note,created_by)
      values(v_l.item_id,'issue',-v_qty,v_cost,v_price,v_margin,round((v_price-v_cost)*v_qty,2),'issue',p_id,coalesce(p_note,''),public.my_admin_id());
  end loop;
  update public.inventory_requests set status=case when exists(select 1 from public.inventory_request_lines where request_id=p_id and fulfilled_quantity<quantity) then 'partial' else 'completed' end,completed_at=case when not exists(select 1 from public.inventory_request_lines where request_id=p_id and fulfilled_quantity<quantity) then now() else null end where id=p_id;
end $$;

create or replace function public.inventory_record_sale(p_item_id uuid,p_quantity numeric,p_patient_invoice_ref text,p_payment_method text,p_note text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items%rowtype; v_cost numeric; v_profit numeric; v_id uuid;
begin
  if not public.inventory_can_view() then raise exception 'Not allowed to record inventory sales'; end if;
  if p_quantity<=0 then raise exception 'Quantity must be positive'; end if;
  select * into v_item from public.inventory_items where id=p_item_id and active for update;
  if not found or public.inventory_on_hand(p_item_id)<p_quantity then raise exception 'Item not found or insufficient stock'; end if;
  select coalesce(sum(quantity_delta*unit_cost)/nullif(sum(quantity_delta),0),0) into v_cost from public.inventory_movements where item_id=p_item_id and movement_type='receipt';
  v_profit:=round((v_item.current_sale_price-v_cost)*p_quantity,2);
  insert into public.inventory_movements(item_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,profit_amount,patient_invoice_ref,payment_method,note,created_by)
    values(p_item_id,'sale',-p_quantity,v_cost,v_item.current_sale_price,v_item.markup_percent,v_profit,coalesce(p_patient_invoice_ref,''),coalesce(p_payment_method,''),coalesce(p_note,''),public.my_admin_id()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.inventory_open_count(p_title text,p_assigned_to uuid,p_due_at timestamptz,p_note text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to start counts'; end if;
  if not exists(select 1 from public.admins where id=p_assigned_to and active) then raise exception 'Assignee is not active'; end if;
  insert into public.inventory_count_sessions(title,assigned_to,created_by,due_at,note) values(trim(p_title),p_assigned_to,public.my_admin_id(),p_due_at,coalesce(p_note,'')) returning id into v_id;
  insert into public.inventory_count_lines(session_id,item_id,system_quantity)
    select v_id,i.id,public.inventory_on_hand(i.id) from public.inventory_items i where i.active;
  return v_id;
end $$;

create or replace function public.inventory_submit_count(p_session_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_s public.inventory_count_sessions%rowtype; v_line jsonb; v_qty numeric;
begin
  select * into v_s from public.inventory_count_sessions where id=p_session_id for update;
  if not found or (v_s.assigned_to<>public.my_admin_id() and not public.inventory_can_manage()) then raise exception 'Not allowed to submit this count'; end if;
  if v_s.status<>'open' then raise exception 'Count is not open'; end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines,'[]')) loop
    v_qty:=(v_line->>'counted_quantity')::numeric;
    if v_qty<0 then raise exception 'Count cannot be negative'; end if;
    update public.inventory_count_lines set counted_quantity=v_qty,note=coalesce(v_line->>'note','') where session_id=p_session_id and item_id=(v_line->>'item_id')::uuid;
  end loop;
  if exists(select 1 from public.inventory_count_lines where session_id=p_session_id and counted_quantity is null) then raise exception 'Enter a count for every item'; end if;
  update public.inventory_count_sessions set status='submitted',submitted_at=now() where id=p_session_id;
end $$;

create or replace function public.inventory_approve_count(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_s public.inventory_count_sessions%rowtype; v_l public.inventory_count_lines%rowtype; v_delta numeric; v_cost numeric;
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to approve counts'; end if;
  select * into v_s from public.inventory_count_sessions where id=p_session_id for update;
  if not found or v_s.status<>'submitted' then raise exception 'Count must be submitted first'; end if;
  for v_l in select * from public.inventory_count_lines where session_id=p_session_id loop
    v_delta:=v_l.counted_quantity-public.inventory_on_hand(v_l.item_id);
    if v_delta<>0 then
      select coalesce(sum(quantity_delta*unit_cost)/nullif(sum(quantity_delta),0),0) into v_cost from public.inventory_movements where item_id=v_l.item_id and movement_type='receipt';
      insert into public.inventory_movements(item_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
        values(v_l.item_id,'count_adjustment',v_delta,v_cost,'count',p_session_id,'تسوية نتيجة الجرد',public.my_admin_id());
    end if;
  end loop;
  update public.inventory_count_sessions set status='approved',approved_by=public.my_admin_id(),approved_at=now() where id=p_session_id;
end $$;

create or replace function public.inventory_save_count_schedule(p_id uuid,p_title text,p_cadence_days integer,p_assigned_to uuid,p_next_due_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_project_id uuid; v_manager uuid:=public.my_admin_id();
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed to manage schedules'; end if;
  if p_cadence_days not between 1 and 366 or not exists(select 1 from public.admins where id=p_assigned_to and active) then raise exception 'Invalid schedule'; end if;
  if p_id is null then
    insert into public.task_projects(title,description,created_by,manager_id) values('جرد المخازن: '||trim(p_title),'مشروع تلقائي لمهام الجرد الدوري',v_manager,v_manager) returning id into v_project_id;
    insert into public.task_project_members(project_id,admin_id,role_name) values(v_project_id,v_manager,'manager') on conflict(project_id,admin_id) do nothing;
    insert into public.task_project_members(project_id,admin_id,role_name) values(v_project_id,p_assigned_to,'contributor') on conflict(project_id,admin_id) do nothing;
    insert into public.inventory_count_schedules(title,cadence_days,assigned_to,next_due_at,created_by,project_id) values(trim(p_title),p_cadence_days,p_assigned_to,p_next_due_at,v_manager,v_project_id) returning id into v_id;
  else
    update public.inventory_count_schedules set title=trim(p_title),cadence_days=p_cadence_days,assigned_to=p_assigned_to,next_due_at=p_next_due_at where id=p_id returning id,project_id into v_id,v_project_id;
    insert into public.task_project_members(project_id,admin_id,role_name) values(v_project_id,p_assigned_to,'contributor') on conflict(project_id,admin_id) do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.inventory_generate_due_counts()
returns integer language plpgsql security definer set search_path=public as $$
declare s record; v_id uuid; v_task_id uuid; v_n integer:=0;
begin
  for s in select * from public.inventory_count_schedules where active and next_due_at<=now() for update skip locked loop
    insert into public.inventory_count_sessions(title,assigned_to,created_by,due_at,note)
      values(s.title,s.assigned_to,s.created_by,s.next_due_at,'تم إنشاؤه تلقائيًا من جدول الجرد') returning id into v_id;
    insert into public.inventory_count_lines(session_id,item_id,system_quantity) select v_id,i.id,public.inventory_on_hand(i.id) from public.inventory_items i where i.active;
    insert into public.tasks(project_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at)
      values(s.project_id,'تنفيذ جرد: '||s.title,'إجراء جرد فعلي للأصناف وتسجيل الكميات من تاب المخزن','إكمال الجرد المخصص في تاب المخزن',s.assigned_to,s.created_by,'todo','high',s.next_due_at) returning id into v_task_id;
    insert into public.task_notifications(recipient_id,task_id,kind,message)
      values(s.assigned_to,v_task_id,'assigned','تم إسناد جرد دوري جديد: '||s.title);
    update public.inventory_count_schedules set last_session_id=v_id,next_due_at=now()+make_interval(days=>s.cadence_days) where id=s.id;
    insert into public.inventory_alerts(item_id,alert_type,message) select i.id,'late_count','بدأ موعد الجرد الدوري: '||s.title from public.inventory_items i where i.active limit 1;
    v_n:=v_n+1;
  end loop;
  return v_n;
end $$;

create or replace function public.inventory_refresh_alerts()
returns integer language plpgsql security definer set search_path=public as $$
declare i record; v_n integer:=0;
begin
  for i in select id,name,minimum_quantity from public.inventory_items where active loop
    if public.inventory_on_hand(i.id)<=i.minimum_quantity then
      insert into public.inventory_alerts(item_id,alert_type,message) select i.id,'low_stock','المخزون وصل للحد الأدنى: '||i.name where not exists(select 1 from public.inventory_alerts a where a.item_id=i.id and a.alert_type='low_stock' and a.resolved_at is null);
      v_n:=v_n+1;
    end if;
    if (select count(*) from public.inventory_requests r join public.inventory_request_lines l on l.request_id=r.id where l.item_id=i.id and r.request_type='purchase' and r.requested_at>now()-interval '14 days')>=3 then
      insert into public.inventory_alerts(item_id,alert_type,message) select i.id,'repeat_request','تكررت طلبات الصنف خلال آخر 14 يومًا: '||i.name where not exists(select 1 from public.inventory_alerts a where a.item_id=i.id and a.alert_type='repeat_request' and a.resolved_at is null);
      v_n:=v_n+1;
    end if;
    if public.inventory_on_hand(i.id)>0 and (select coalesce(sum(-m.quantity_delta),0) from public.inventory_movements m where m.item_id=i.id and m.quantity_delta<0 and m.created_at>now()-interval '14 days')/14.0>0 then
      if public.inventory_on_hand(i.id)/((select coalesce(sum(-m.quantity_delta),0) from public.inventory_movements m where m.item_id=i.id and m.quantity_delta<0 and m.created_at>now()-interval '14 days')/14.0)<7 then
        insert into public.inventory_alerts(item_id,alert_type,message) select i.id,'fast_depletion','معدل السحب الحالي قد ينفد خلال أقل من أسبوع: '||i.name where not exists(select 1 from public.inventory_alerts a where a.item_id=i.id and a.alert_type='fast_depletion' and a.resolved_at is null);
      end if;
    end if;
    if public.inventory_on_hand(i.id)>i.minimum_quantity then update public.inventory_alerts set resolved_at=now() where item_id=i.id and alert_type='low_stock' and resolved_at is null; end if;
  end loop;
  return v_n;
end $$;

create or replace function public.inventory_maintenance()
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.inventory_refresh_alerts();
  perform public.inventory_generate_due_counts();
end $$;

create or replace function public.inventory_resolve_alert(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.inventory_can_manage() then raise exception 'Not allowed'; end if;
  update public.inventory_alerts set resolved_at=now() where id=p_id and resolved_at is null;
end $$;

revoke all on function public.inventory_is_manager() from public;
revoke all on function public.inventory_can_view() from public;
revoke all on function public.inventory_can_manage() from public;
revoke all on function public.inventory_on_hand(uuid) from public;
revoke all on function public.inventory_snapshot() from public;
revoke all on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public;
revoke all on function public.inventory_create_request(text,text,jsonb) from public;
revoke all on function public.inventory_set_opening_balance(uuid,numeric,numeric,text) from public;
revoke all on function public.inventory_review_request(uuid,boolean,text) from public;
revoke all on function public.inventory_receive_request(uuid,jsonb,text) from public;
revoke all on function public.inventory_fulfill_issue(uuid,jsonb,text) from public;
revoke all on function public.inventory_record_sale(uuid,numeric,text,text,text) from public;
revoke all on function public.inventory_open_count(text,uuid,timestamptz,text) from public;
revoke all on function public.inventory_submit_count(uuid,jsonb) from public;
revoke all on function public.inventory_approve_count(uuid) from public;
revoke all on function public.inventory_save_count_schedule(uuid,text,integer,uuid,timestamptz) from public;
revoke all on function public.inventory_generate_due_counts() from public;
revoke all on function public.inventory_refresh_alerts() from public;
revoke all on function public.inventory_maintenance() from public;
revoke all on function public.inventory_resolve_alert(uuid) from public;
grant execute on function public.inventory_snapshot() to authenticated;
grant execute on function public.inventory_save_item(uuid,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
grant execute on function public.inventory_create_request(text,text,jsonb) to authenticated;
grant execute on function public.inventory_set_opening_balance(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.inventory_review_request(uuid,boolean,text) to authenticated;
grant execute on function public.inventory_receive_request(uuid,jsonb,text) to authenticated;
grant execute on function public.inventory_fulfill_issue(uuid,jsonb,text) to authenticated;
grant execute on function public.inventory_record_sale(uuid,numeric,text,text,text) to authenticated;
grant execute on function public.inventory_open_count(text,uuid,timestamptz,text) to authenticated;
grant execute on function public.inventory_submit_count(uuid,jsonb) to authenticated;
grant execute on function public.inventory_approve_count(uuid) to authenticated;
grant execute on function public.inventory_save_count_schedule(uuid,text,integer,uuid,timestamptz) to authenticated;
grant execute on function public.inventory_resolve_alert(uuid) to authenticated;

-- محاولة تشغيل تنبيهات المخزون وإنشاء الجرد الدوري كل ساعة عند توفر pg_cron.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('swnw-inventory-maintenance','0 * * * *','select public.inventory_maintenance();');
  end if;
exception when others then raise notice 'Could not schedule inventory maintenance; functions can be run manually: %',sqlerrm;
end $$;

