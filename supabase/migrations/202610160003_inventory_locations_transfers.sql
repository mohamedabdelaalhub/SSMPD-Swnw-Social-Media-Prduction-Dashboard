-- الفروع والمخازن والتحويل بموافقتين والاستيراد والجرد الشهري.
-- شغّل بعد ملفات المخزن والتشغيلات. لا يستورد ملفات المستخدم تلقائياً.
begin;
do $$ begin
 if to_regclass('public.inventory_lots') is null then raise exception 'شغّل تحديث التشغيلات والموردين أولاً'; end if;
end $$;

create table if not exists public.inventory_branches (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 2 and 120),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.inventory_locations (
 id uuid primary key default gen_random_uuid(), branch_id uuid references public.inventory_branches(id),
 name text not null check(length(trim(name)) between 2 and 120), kind text not null check(kind in ('central','substore')),
 active boolean not null default true, created_at timestamptz not null default now(),
 check ((kind='central' and branch_id is null) or (kind='substore' and branch_id is not null))
);
create unique index if not exists inventory_one_central on public.inventory_locations(kind) where kind='central';
create unique index if not exists inventory_location_name on public.inventory_locations(branch_id,name) where branch_id is not null;
insert into public.inventory_locations(id,name,kind) values('00000000-0000-4000-8000-000000000001','المخزن الرئيسي المركزي','central') on conflict do nothing;
insert into public.inventory_branches(id,name) values('00000000-0000-4000-8000-000000000002','الفرع الحالي') on conflict do nothing;
insert into public.inventory_locations(branch_id,name,kind)
 select '00000000-0000-4000-8000-000000000002',n,'substore' from unnest(array['التمريض','الثلاجة']) n on conflict do nothing;
create table if not exists public.inventory_location_staff (
 location_id uuid not null references public.inventory_locations(id), admin_id uuid not null references public.admins(id),
 responsibility text not null check(responsibility in ('senior_nursing','storekeeper','manager','receiver','counter')),
 primary key(location_id,admin_id,responsibility)
);
alter table public.inventory_movements add column if not exists location_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.inventory_locations(id);
alter table public.inventory_movements add column if not exists occurred_at timestamptz not null default now();
-- ترحيل التاريخ مرة واحدة فقط بدلاً من إعادة تأريخ الحركات عند إعادة التفعيل.
do $$ begin
 if not exists(select 1 from pg_constraint where conname='inventory_occurred_migrated') then
  update public.inventory_movements set occurred_at=created_at;
  alter table public.inventory_movements add constraint inventory_occurred_migrated check(occurred_at is not null);
 end if;
end $$;
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check(movement_type in ('receipt','issue','sale','count_adjustment','return','opening_balance','waste','expired','transfer_out','transfer_in'));
create index if not exists inventory_location_movement_idx on public.inventory_movements(location_id,item_id,occurred_at);
alter table public.inventory_count_sessions add column if not exists location_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.inventory_locations(id);
alter table public.inventory_count_sessions add column if not exists starts_at timestamptz not null default now();
alter table public.inventory_count_lines add column if not exists lot_id uuid references public.inventory_lots(id);
alter table public.inventory_count_lines drop constraint if exists inventory_count_lines_session_id_item_id_key;
create unique index if not exists inventory_count_lot_unique on public.inventory_count_lines(session_id,item_id,coalesce(lot_id,'00000000-0000-0000-0000-000000000000'));
alter table public.inventory_count_schedules add column if not exists location_id uuid not null default '00000000-0000-4000-8000-000000000001' references public.inventory_locations(id);
alter table public.inventory_count_schedules add column if not exists calendar_monthly boolean not null default false;
alter table public.inventory_count_schedules add column if not exists due_days integer not null default 7 check(due_days between 1 and 31);
create unique index if not exists inventory_monthly_location_unique on public.inventory_count_schedules(location_id) where active and calendar_monthly;

create table if not exists public.inventory_transfers (
 id uuid primary key default gen_random_uuid(), source_id uuid not null references public.inventory_locations(id),
 destination_id uuid not null references public.inventory_locations(id), requested_by uuid not null references public.admins(id),
 receiver_id uuid not null references public.admins(id), status text not null default 'pending' check(status in ('pending','approved','rejected','in_transit','received','discrepancy')),
 storekeeper_by uuid references public.admins(id), manager_by uuid references public.admins(id),
 storekeeper_at timestamptz, manager_at timestamptz, dispatched_by uuid references public.admins(id), dispatched_at timestamptz,
 received_by uuid references public.admins(id), received_at timestamptz, note text not null default '', created_at timestamptz not null default now(),
 check(source_id<>destination_id),check(storekeeper_by is null or manager_by is null or storekeeper_by<>manager_by)
);
create table if not exists public.inventory_transfer_lines (
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null references public.inventory_transfers(id),
 item_id uuid not null references public.inventory_items(id), quantity numeric(14,3) not null check(quantity>0),
 unique(transfer_id,item_id)
);
create table if not exists public.inventory_transfer_allocations (
 id uuid primary key default gen_random_uuid(), line_id uuid not null references public.inventory_transfer_lines(id),
 lot_id uuid references public.inventory_lots(id), quantity numeric(14,3) not null check(quantity>0),
 received_quantity numeric(14,3) check(received_quantity>=0 and received_quantity<=quantity), unit_cost numeric not null check(unit_cost>=0)
);
create table if not exists public.inventory_import_batches (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.inventory_locations(id),
 mode text not null check(mode in ('opening','count')), as_of timestamptz not null,
 fingerprint text not null, filename text not null default '', payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_by uuid not null references public.admins(id), created_at timestamptz not null default now(),
 approved_by uuid references public.admins(id), approved_at timestamptz,
 unique(location_id,mode,as_of,fingerprint)
);
create table if not exists public.inventory_opening_markers (
 location_id uuid not null references public.inventory_locations(id), item_id uuid not null references public.inventory_items(id),
 batch_id uuid references public.inventory_import_batches(id), primary key(location_id,item_id)
);
create table if not exists public.inventory_audit_events (
 id bigint generated always as identity primary key, entity_id uuid not null, kind text not null,
 actor_id uuid not null references public.admins(id), detail text not null default '', created_at timestamptz not null default now()
);

create or replace function public.inventory_location_can(p_location uuid,p_action text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admins a where a.id=public.my_admin_id() and a.active)
 and exists(select 1 from public.inventory_locations l where l.id=p_location and l.active)
 and case when p_action='storekeeper' then exists(select 1 from public.inventory_location_staff where location_id=p_location and admin_id=public.my_admin_id() and responsibility='storekeeper')
 when public.inventory_is_manager() then p_action in ('view','manage','request','receive','count','manager')
 else exists(select 1 from public.inventory_location_staff s where s.location_id=p_location and s.admin_id=public.my_admin_id() and
  case p_action when 'view' then true when 'manage' then s.responsibility in ('storekeeper','manager')
   when 'request' then s.responsibility='senior_nursing' when 'receive' then s.responsibility in ('receiver','senior_nursing','storekeeper')
   when 'count' then s.responsibility in ('counter','senior_nursing','storekeeper','manager')
   when 'manager' then s.responsibility='manager' else false end) end;
$$;
create or replace function public.inventory_location_balance(p_location uuid,p_item uuid,p_lot uuid default null,p_all_lots boolean default true)
returns numeric language sql stable security definer set search_path=public as $$
 select coalesce(sum(quantity_delta),0) from public.inventory_movements where location_id=p_location and item_id=p_item and (p_all_lots or lot_id is not distinct from p_lot);
$$;
create or replace function public.inventory_my_access()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.inventory_locations l where public.inventory_location_can(l.id,'view'));
$$;
create or replace function public.inventory_location_cost(p_location uuid,p_item uuid,p_lot uuid default null,p_all_lots boolean default true)
returns numeric language sql stable security definer set search_path=public as $$
 select greatest(0,coalesce(sum(quantity_delta*unit_cost)/nullif(sum(quantity_delta),0),0)) from public.inventory_movements where location_id=p_location and item_id=p_item and (p_all_lots or lot_id is not distinct from p_lot);
$$;
create or replace function public.inventory_transfer_can_view(p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.inventory_transfers t where t.id=p_id and
 (public.inventory_location_can(t.source_id,'view') or public.inventory_location_can(t.destination_id,'view')));
$$;
-- كل البيانات الجديدة للقراءة فقط من العميل. الكتابة تمر بالدوال التي تفحص الصلاحيات.
do $$ declare t text; begin
 foreach t in array array['inventory_branches','inventory_locations','inventory_location_staff','inventory_transfers','inventory_transfer_lines','inventory_transfer_allocations','inventory_import_batches','inventory_opening_markers','inventory_audit_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
drop policy if exists inventory_branch_select on public.inventory_branches;
create policy inventory_branch_select on public.inventory_branches for select to authenticated using(public.inventory_is_manager() or exists(select 1 from public.inventory_locations l where l.branch_id=inventory_branches.id and public.inventory_location_can(l.id,'view')));
drop policy if exists inventory_location_select on public.inventory_locations;
create policy inventory_location_select on public.inventory_locations for select to authenticated using(public.inventory_location_can(id,'view'));
drop policy if exists inventory_staff_select on public.inventory_location_staff;
create policy inventory_staff_select on public.inventory_location_staff for select to authenticated using(admin_id=public.my_admin_id() or public.inventory_is_manager());
drop policy if exists inventory_transfer_select on public.inventory_transfers;
create policy inventory_transfer_select on public.inventory_transfers for select to authenticated using(public.inventory_transfer_can_view(id));
drop policy if exists inventory_transfer_line_select on public.inventory_transfer_lines;
create policy inventory_transfer_line_select on public.inventory_transfer_lines for select to authenticated using(public.inventory_transfer_can_view(transfer_id));
drop policy if exists inventory_transfer_allocation_select on public.inventory_transfer_allocations;
create policy inventory_transfer_allocation_select on public.inventory_transfer_allocations for select to authenticated using(exists(select 1 from public.inventory_transfer_lines l where l.id=line_id and public.inventory_transfer_can_view(l.transfer_id)));
drop policy if exists inventory_import_select on public.inventory_import_batches;
create policy inventory_import_select on public.inventory_import_batches for select to authenticated using(public.inventory_location_can(location_id,'manage') or created_by=public.my_admin_id());
drop policy if exists inventory_opening_select on public.inventory_opening_markers;
create policy inventory_opening_select on public.inventory_opening_markers for select to authenticated using(public.inventory_location_can(location_id,'manage'));
drop policy if exists inventory_audit_select on public.inventory_audit_events;
create policy inventory_audit_select on public.inventory_audit_events for select to authenticated using(public.inventory_is_manager() or public.inventory_transfer_can_view(entity_id) or exists(select 1 from public.inventory_import_batches b where b.id=entity_id and public.inventory_location_can(b.location_id,'manage')));

create or replace function public.inventory_save_structure(p_name text,p_branch uuid default null,p_copy_branch uuid default null,p_new_branch boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not public.inventory_is_manager() or public.my_admin_id() is null then raise exception 'غير مسموح بإدارة الفروع'; end if;
 if p_new_branch then
  insert into public.inventory_branches(name) values(trim(p_name)) returning id into v_id;
  if p_copy_branch is not null then
   insert into public.inventory_locations(branch_id,name,kind) select v_id,name,'substore' from public.inventory_locations where branch_id=p_copy_branch and active;
  else
   insert into public.inventory_locations(branch_id,name,kind) select v_id,n,'substore' from unnest(array['التمريض','الثلاجة']) n;
  end if;
 else
  insert into public.inventory_locations(branch_id,name,kind) values(p_branch,trim(p_name),'substore') returning id into v_id;
 end if;
 return v_id;
end $$;
create or replace function public.inventory_assign_location(p_location uuid,p_admin uuid,p_responsibility text,p_enabled boolean default true)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.inventory_is_manager() or public.my_admin_id() is null then raise exception 'غير مسموح بتعديل المسؤوليات'; end if;
 if not exists(select 1 from public.admins where id=p_admin and active) then raise exception 'المستخدم غير نشط'; end if;
 if p_enabled then insert into public.inventory_location_staff values(p_location,p_admin,p_responsibility) on conflict do nothing;
 else delete from public.inventory_location_staff where location_id=p_location and admin_id=p_admin and responsibility=p_responsibility; end if;
end $$;
create or replace function public.inventory_save_catalog(p_location uuid,p_action text,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=nullif(p_payload->>'p_id','')::uuid; old public.inventory_items%rowtype;
begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بإدارة الأصناف والموردين'; end if;
 if p_action='track' then
  v_id:=(p_payload->>'p_item_id')::uuid;
  update public.inventory_items set track_lots=(p_payload->>'p_track')::boolean,updated_at=now() where id=v_id;
  if not found then raise exception 'الصنف غير موجود'; end if;
 elsif p_action='supplier' then
  if v_id is null then insert into public.inventory_suppliers(name,phone,notes,active,created_by)
   values(trim(p_payload->>'p_name'),coalesce(p_payload->>'p_phone',''),coalesce(p_payload->>'p_notes',''),coalesce((p_payload->>'p_active')::boolean,true),public.my_admin_id()) returning id into v_id;
  else update public.inventory_suppliers set name=trim(p_payload->>'p_name'),phone=coalesce(p_payload->>'p_phone',''),notes=coalesce(p_payload->>'p_notes',''),active=coalesce((p_payload->>'p_active')::boolean,true) where id=v_id;
   if not found then raise exception 'المورد غير موجود'; end if;
  end if;
 elsif p_action='item' then
  if v_id is null then insert into public.inventory_items(sku,name,category,base_unit,units_per_pack,minimum_quantity,markup_percent,current_sale_price,created_by)
   values(nullif(trim(p_payload->>'p_sku'),''),trim(p_payload->>'p_name'),coalesce(nullif(trim(p_payload->>'p_category'),''),'عام'),coalesce(nullif(trim(p_payload->>'p_base_unit'),''),'وحدة'),(p_payload->>'p_units_per_pack')::numeric,(p_payload->>'p_minimum')::numeric,(p_payload->>'p_markup')::numeric,(p_payload->>'p_sale_price')::numeric,public.my_admin_id()) returning id into v_id;
  else
   select * into old from public.inventory_items where id=v_id for update;
   if not found then raise exception 'الصنف غير موجود'; end if;
   if old.base_unit<>trim(p_payload->>'p_base_unit') and exists(select 1 from public.inventory_movements where item_id=v_id) then raise exception 'لا تغيّر وحدة الصرف بعد تسجيل حركات؛ استخدم معامل تحويل للعبوة'; end if;
   update public.inventory_items set sku=nullif(trim(p_payload->>'p_sku'),''),name=trim(p_payload->>'p_name'),category=coalesce(nullif(trim(p_payload->>'p_category'),''),'عام'),base_unit=coalesce(nullif(trim(p_payload->>'p_base_unit'),''),'وحدة'),units_per_pack=(p_payload->>'p_units_per_pack')::numeric,minimum_quantity=(p_payload->>'p_minimum')::numeric,markup_percent=(p_payload->>'p_markup')::numeric,current_sale_price=(p_payload->>'p_sale_price')::numeric,updated_at=now() where id=v_id;
   if old.current_sale_price<>(p_payload->>'p_sale_price')::numeric or old.markup_percent<>(p_payload->>'p_markup')::numeric then
    insert into public.inventory_price_history(item_id,previous_price,new_price,previous_markup,new_markup,changed_by) values(v_id,old.current_sale_price,(p_payload->>'p_sale_price')::numeric,old.markup_percent,(p_payload->>'p_markup')::numeric,public.my_admin_id());
   end if;
  end if;
 else raise exception 'إجراء غير معروف'; end if;
 return v_id;
end $$;

create or replace function public.inventory_create_transfer(p_source uuid,p_destination uuid,p_receiver uuid,p_lines jsonb,p_note text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; r jsonb;
begin
 if not (public.inventory_location_can(p_source,'request') or public.inventory_location_can(p_destination,'request')) then raise exception 'إنشاء التحويل لسينيور التمريض والإدارة'; end if;
 if (select count(*) from public.inventory_locations where id in (p_source,p_destination) and active)<>2 then raise exception 'المصدر والوجهة يجب أن يكونا مخزنين نشطين مختلفين'; end if;
 if not exists(select 1 from public.admins a join public.inventory_location_staff s on s.admin_id=a.id where a.id=p_receiver and a.active and s.location_id=p_destination and s.responsibility in ('receiver','senior_nursing','storekeeper')) then raise exception 'عيّن مستلماً للمخزن الوجهة أولاً'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'أضف الأصناف والكميات'; end if;
 insert into public.inventory_transfers(source_id,destination_id,requested_by,receiver_id,note) values(p_source,p_destination,public.my_admin_id(),p_receiver,coalesce(p_note,'')) returning id into v_id;
 for r in select * from jsonb_array_elements(p_lines) loop
  if (r->>'quantity')::numeric is null or (r->>'quantity')::numeric<=0 then raise exception 'الكمية مطلوبة'; end if;
  insert into public.inventory_transfer_lines(transfer_id,item_id,quantity) values(v_id,(r->>'item_id')::uuid,(r->>'quantity')::numeric);
 end loop;
 insert into public.inventory_audit_events(entity_id,kind,actor_id) values(v_id,'transfer_requested',public.my_admin_id());
 return v_id;
end $$;
create or replace function public.inventory_review_transfer(p_id uuid,p_lane text,p_approve boolean,p_note text default '')
returns void language plpgsql security definer set search_path=public as $$
declare t public.inventory_transfers%rowtype; me uuid:=public.my_admin_id();
begin
 select * into t from public.inventory_transfers where id=p_id for update;
 if not found or t.status<>'pending' or p_lane is null or p_lane not in ('storekeeper','manager') or p_approve is null then raise exception 'الطلب غير قابل للمراجعة'; end if;
 if p_lane='storekeeper' and not public.inventory_location_can(t.source_id,'storekeeper') then raise exception 'موافقة مسؤول مخزن المصدر مطلوبة'; end if;
 if p_lane='manager' and not (public.inventory_location_can(t.source_id,'manager') or public.inventory_location_can(t.destination_id,'manager')) then raise exception 'موافقة المدير مطلوبة'; end if;
 if (p_lane='storekeeper' and (t.storekeeper_by is not null or t.manager_by=me)) or (p_lane='manager' and (t.manager_by is not null or t.storekeeper_by=me)) then raise exception 'الموافقتان تحتاجان شخصين مختلفين'; end if;
 if not p_approve then
  if length(trim(coalesce(p_note,'')))<2 then raise exception 'اكتب سبب الرفض'; end if;
  update public.inventory_transfers set status='rejected' where id=p_id;
 elsif p_lane='storekeeper' then update public.inventory_transfers set storekeeper_by=me,storekeeper_at=now() where id=p_id;
 else update public.inventory_transfers set manager_by=me,manager_at=now() where id=p_id; end if;
 update public.inventory_transfers set status='approved' where id=p_id and status='pending' and storekeeper_by is not null and manager_by is not null;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_id,p_lane||case when p_approve then '_approved' else '_rejected' end,me,coalesce(p_note,''));
end $$;

-- المخصصات من رصيد المكان فقط. لا يُستخدم الرصيد الإجمالي لتغطية عجز مخزن آخر.
create or replace function public.inventory_allocate_at(p_location uuid,p_item uuid,p_quantity numeric,p_include_expired boolean default false,p_lot uuid default null)
returns table(lot_id uuid,qty numeric,unit_cost numeric) language plpgsql security definer set search_path=public as $$
declare r record; v_left numeric:=p_quantity; v_take numeric;
begin
 if p_quantity is null or p_quantity<=0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
 perform 1 from public.inventory_items where id=p_item and active for update;
 if not found then raise exception 'الصنف غير موجود'; end if;
 for r in select m.lot_id lid,sum(m.quantity_delta) remaining,
  greatest(0,sum(m.quantity_delta*m.unit_cost)/nullif(sum(m.quantity_delta),0)) cost
  from public.inventory_movements m left join public.inventory_lots l on l.id=m.lot_id
  where m.location_id=p_location and m.item_id=p_item and (p_lot is null or m.lot_id=p_lot)
   and (p_include_expired or l.expiry_date is null or l.expiry_date>=current_date)
  group by m.lot_id,l.expiry_date having sum(m.quantity_delta)>0 order by l.expiry_date nulls last,m.lot_id loop
  exit when v_left<=0; v_take:=least(r.remaining,v_left);
  lot_id:=r.lid;qty:=v_take;unit_cost:=coalesce(r.cost,0);return next;v_left:=v_left-v_take;
 end loop;
 if v_left>0 then raise exception 'الرصيد المتاح في المخزن لا يكفي أو التشغيلات منتهية'; end if;
end $$;
create or replace function public.inventory_dispatch_transfer(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.inventory_transfers%rowtype; r record; a record;
begin
 select * into t from public.inventory_transfers where id=p_id for update;
 if not found or t.status<>'approved' or t.storekeeper_by is null or t.manager_by is null then raise exception 'يجب اكتمال الموافقتين قبل الصرف'; end if;
 if not public.inventory_location_can(t.source_id,'storekeeper') then raise exception 'الصرف لمسؤول المخزن'; end if;
 for r in select * from public.inventory_transfer_lines where transfer_id=p_id order by item_id loop
  for a in select * from public.inventory_allocate_at(t.source_id,r.item_id,r.quantity) loop
   insert into public.inventory_transfer_allocations(line_id,lot_id,quantity,unit_cost) values(r.id,a.lot_id,a.qty,a.unit_cost);
   insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,created_by)
    values(r.item_id,t.source_id,a.lot_id,'transfer_out',-a.qty,a.unit_cost,'transfer',p_id,public.my_admin_id());
  end loop;
 end loop;
 update public.inventory_transfers set status='in_transit',dispatched_by=public.my_admin_id(),dispatched_at=now() where id=p_id;
 insert into public.inventory_audit_events(entity_id,kind,actor_id) values(p_id,'transfer_dispatched',public.my_admin_id());
end $$;
create or replace function public.inventory_receive_transfer(p_id uuid,p_lines jsonb,p_note text default '')
returns void language plpgsql security definer set search_path=public as $$
declare t public.inventory_transfers%rowtype; r record; q numeric; mismatch boolean:=false;
begin
 select * into t from public.inventory_transfers where id=p_id for update;
 if not found or t.status<>'in_transit' then raise exception 'التحويل غير متاح للاستلام'; end if;
 if t.receiver_id<>public.my_admin_id() or not public.inventory_location_can(t.destination_id,'receive') then raise exception 'تأكيد الاستلام للمستلم المحدد'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<>(select count(*) from public.inventory_transfer_allocations a join public.inventory_transfer_lines l on l.id=a.line_id where l.transfer_id=p_id) or (select count(distinct x->>'allocation_id') from jsonb_array_elements(p_lines) x)<>jsonb_array_length(p_lines) then raise exception 'أدخل كل كميات التشغيلات المستلمة دون تكرار'; end if;
 for r in select a.*,l.item_id from public.inventory_transfer_allocations a join public.inventory_transfer_lines l on l.id=a.line_id where l.transfer_id=p_id order by l.item_id,a.id loop
  select (x->>'quantity')::numeric into q from jsonb_array_elements(p_lines) x where (x->>'allocation_id')::uuid=r.id;
  if q is null or q<0 or q>r.quantity then raise exception 'كمية استلام غير صحيحة'; end if;
  perform 1 from public.inventory_items where id=r.item_id for update;
  update public.inventory_transfer_allocations set received_quantity=q where id=r.id;
  if q>0 then insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,created_by,note)
   values(r.item_id,t.destination_id,r.lot_id,'transfer_in',q,r.unit_cost,'transfer',p_id,public.my_admin_id(),coalesce(p_note,'')); end if;
  mismatch:=mismatch or q<>r.quantity;
 end loop;
 if mismatch and length(trim(coalesce(p_note,'')))<2 then raise exception 'اكتب ملاحظة لفروق الاستلام'; end if;
 update public.inventory_transfers set status=case when mismatch then 'discrepancy' else 'received' end,received_by=public.my_admin_id(),received_at=now() where id=p_id;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_id,'transfer_received',public.my_admin_id(),coalesce(p_note,''));
end $$;

-- رصيد افتتاحي أو جرد مستورد في مسودة واحدة. لا يتغير الرصيد قبل الاعتماد.
create or replace function public.inventory_stage_import(p_location uuid,p_mode text,p_as_of timestamptz,p_filename text,p_rows jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; r jsonb; v_fingerprint text;
begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح باستيراد هذا المخزن'; end if;
 if p_mode not in ('opening','count') or p_as_of is null or p_as_of>now() or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'راجع نوع الإدخال والتاريخ والصفوف'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  if length(trim(coalesce(r->>'name','')))<2 or (r->>'quantity')::numeric is null or (r->>'quantity')::numeric<0 or coalesce((r->>'factor')::numeric,0)<=0 or nullif(trim(r->>'unit'),'') is null then raise exception 'راجع الاسم والكمية والوحدة ومعامل التحويل'; end if;
  if nullif(r->>'item_id','') is null and coalesce((r->>'create_new')::boolean,false)=false then raise exception 'طابق الصنف أو أكد إنشاء صنف جديد'; end if;
 end loop;
 select md5(coalesce(jsonb_agg(x order by x::text),'[]'::jsonb)::text) into v_fingerprint from jsonb_array_elements(p_rows) x;
 insert into public.inventory_import_batches(location_id,mode,as_of,fingerprint,filename,payload,created_by)
 values(p_location,p_mode,p_as_of,v_fingerprint,coalesce(p_filename,''),p_rows,public.my_admin_id()) returning id into v_id;
 insert into public.inventory_audit_events(entity_id,kind,actor_id) values(v_id,'import_staged',public.my_admin_id());
 return v_id;
exception when unique_violation then raise exception 'هذه البيانات سبق رفعها لنفس المخزن والتاريخ';
end $$;
create or replace function public.inventory_approve_import(p_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare b public.inventory_import_batches%rowtype; r jsonb; i public.inventory_items%rowtype; iid uuid; lid uuid; qty numeric; cost numeric; delta numeric; expected numeric; seen text[]:='{}'; rowkey text; new_items jsonb:='{}';
begin
 select * into b from public.inventory_import_batches where id=p_id for update;
 if not found or b.status<>'pending' or p_approve is null then raise exception 'المسودة سبق اعتمادها أو رفضها'; end if;
 if not public.inventory_location_can(b.location_id,'manager') then raise exception 'اعتماد الاستيراد للمدير'; end if;
 if not p_approve then update public.inventory_import_batches set status='rejected',approved_by=public.my_admin_id(),approved_at=now() where id=p_id; return; end if;
 -- تسلسل كل عمليات اعتماد الجرد والافتتاح لنفس المخزن.
 perform pg_advisory_xact_lock(hashtext(b.location_id::text));
 for r in select * from jsonb_array_elements(b.payload) order by coalesce(value->>'item_id',value->>'name') loop
  iid:=nullif(r->>'item_id','')::uuid;
  if iid is null then
   iid:=nullif(new_items->>lower(trim(r->>'name')),'')::uuid;
   if iid is null then
    perform pg_advisory_xact_lock(hashtext('inventory-name:'||lower(trim(r->>'name'))));
    if exists(select 1 from public.inventory_items where lower(trim(name))=lower(trim(r->>'name'))) then raise exception 'يوجد صنف بالاسم نفسه؛ ارجع للمطابقة بدلاً من إنشاء نسخة'; end if;
    insert into public.inventory_items(name,base_unit,units_per_pack,category,created_by,track_lots)
     values(trim(r->>'name'),trim(r->>'unit'),coalesce((r->>'factor')::numeric,1),coalesce(nullif(r->>'category',''),'عام'),public.my_admin_id(),coalesce((r->>'track_lots')::boolean,false)) returning id into iid;
    new_items:=new_items||jsonb_build_object(lower(trim(r->>'name')),iid);
   end if;
  end if;
  select * into i from public.inventory_items where id=iid and active for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  rowkey:=iid::text||'|'||coalesce(nullif(r->>'lot_id',''),coalesce(r->>'lot_number','')||'|'||coalesce(r->>'expiry_date',''));
  if rowkey=any(seen) then raise exception 'نفس الصنف والتشغيلة مكرران داخل الملف'; end if;seen:=array_append(seen,rowkey);
  qty:=(r->>'quantity')::numeric*(r->>'factor')::numeric;
  cost:=nullif(r->>'unit_cost','')::numeric;
  if qty>0 and (cost is null or cost<0) then raise exception 'استكمل تكلفة الوحدة قبل الاعتماد'; end if;
  if i.base_unit<>trim(r->>'unit') then raise exception 'وحدة الصرف لا تطابق الصنف'; end if;
  lid:=nullif(r->>'lot_id','')::uuid;
  if lid is not null and not exists(select 1 from public.inventory_lots where id=lid and item_id=iid) then raise exception 'التشغيلة لا تخص الصنف'; end if;
  if qty>0 and i.track_lots and (nullif(r->>'lot_number','') is null or nullif(r->>'expiry_date','') is null) and lid is null then raise exception 'استكمل الصلاحية ورقم التشغيلة'; end if;
  if b.mode='opening' then
   if exists(select 1 from public.inventory_movements where item_id=iid and location_id=b.location_id and reference_id is distinct from b.id) or exists(select 1 from public.inventory_opening_markers where item_id=iid and location_id=b.location_id and batch_id is distinct from b.id) then raise exception 'لهذا الصنف حركات أو رصيد افتتاحي؛ استخدم الجرد'; end if;
   insert into public.inventory_opening_markers values(b.location_id,iid,b.id) on conflict do nothing;
   delta:=qty;
  else
   -- الجرد المستورد لصنف له تشغيلات يجب تحديد التشغيلة الموجودة؛ لا نضيف مخزوناً مجهولاً على رصيد تشغيلات.
   if lid is null and exists(select 1 from public.inventory_movements where location_id=b.location_id and item_id=iid and lot_id is not null) then raise exception 'حدد التشغيلة الموجودة لهذا الجرد'; end if;
   select coalesce(sum(quantity_delta),0) into expected from public.inventory_movements where location_id=b.location_id and item_id=iid and occurred_at<=b.as_of and lot_id is not distinct from lid;
   delta:=qty-expected;
  end if;
  if delta>0 and lid is null and (i.track_lots or nullif(r->>'lot_number','') is not null or nullif(r->>'expiry_date','') is not null) then
   insert into public.inventory_lots(item_id,lot_number,expiry_date,received_quantity,unit_cost,created_by,received_at)
    values(iid,coalesce(r->>'lot_number',''),nullif(r->>'expiry_date','')::date,delta,coalesce(cost,0),public.my_admin_id(),b.as_of) returning id into lid;
  end if;
  if public.inventory_location_balance(b.location_id,iid,lid,b.mode='opening')+delta<0 then raise exception 'التسوية ستسبب رصيداً سالباً؛ راجع الحركات اللاحقة'; end if;
  if delta<>0 then insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by,occurred_at)
   values(iid,b.location_id,lid,case when b.mode='opening' then 'opening_balance' else 'count_adjustment' end,delta,coalesce(cost,0),'import',b.id,b.filename,public.my_admin_id(),b.as_of); end if;
 end loop;
 update public.inventory_import_batches set status='approved',approved_by=public.my_admin_id(),approved_at=now() where id=b.id;
 insert into public.inventory_audit_events(entity_id,kind,actor_id) values(b.id,'import_approved',public.my_admin_id());
end $$;
create or replace function public.inventory_revise_import(p_previous uuid,p_location uuid,p_mode text,p_as_of timestamptz,p_filename text,p_rows jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare b public.inventory_import_batches%rowtype; newid uuid;
begin
 select * into b from public.inventory_import_batches where id=p_previous for update;
 if not found or b.status<>'pending' or b.location_id<>p_location or not public.inventory_location_can(p_location,'manage') then raise exception 'المسودة غير متاحة للتعديل'; end if;
 newid:=public.inventory_stage_import(p_location,p_mode,p_as_of,p_filename,p_rows);
 update public.inventory_import_batches set status='rejected' where id=p_previous;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_previous,'replaced_by_revision',public.my_admin_id(),newid::text);
 return newid;
end $$;

-- الاستهلاك/البيع/الهالك من مكان محدد مع حفظ التشغيلة والتكلفة وقت الحركة.
create or replace function public.inventory_consume_at(p_location uuid,p_item uuid,p_quantity numeric,p_kind text,p_note text default '',p_invoice text default '',p_payment text default '',p_lot uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare i public.inventory_items%rowtype; a record; v_id uuid;
begin
 if not public.inventory_location_can(p_location,'receive') and not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بالصرف من هذا المخزن'; end if;
 if p_kind not in ('issue','sale','waste','expired') then raise exception 'نوع حركة غير صحيح'; end if;
 if p_kind in ('waste','expired') and (not public.inventory_location_can(p_location,'manage') or length(trim(coalesce(p_note,'')))<2) then raise exception 'الهالك يحتاج مسؤولاً وسبباً'; end if;
 select * into i from public.inventory_items where id=p_item and active for update;
 for a in select * from public.inventory_allocate_at(p_location,p_item,p_quantity,p_kind in ('waste','expired'),p_lot) loop
  insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,profit_amount,patient_invoice_ref,payment_method,note,created_by)
   values(p_item,p_location,a.lot_id,p_kind,-a.qty,a.unit_cost,case when p_kind='sale' then i.current_sale_price else 0 end,i.markup_percent,
   case when p_kind='sale' then round((i.current_sale_price-a.unit_cost)*a.qty,2) when p_kind in ('waste','expired') then -round(a.unit_cost*a.qty,2) else 0 end,
   coalesce(p_invoice,''),coalesce(p_payment,''),coalesce(p_note,''),public.my_admin_id()) returning id into v_id;
 end loop;
 return v_id;
end $$;

-- التوريد إلى المركزي فقط، ويحافظ على التشغيلات والأسعار وسجل تغيرها.
create or replace function public.inventory_receive_request(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare req public.inventory_requests%rowtype; r jsonb; ln public.inventory_request_lines%rowtype; i public.inventory_items%rowtype; q numeric; cost numeric; price numeric; lid uuid;
begin
 if not public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') then raise exception 'التوريد لمسؤول المخزن الرئيسي'; end if;
 select * into req from public.inventory_requests where id=p_id for update;
 if not found or req.request_type<>'purchase' or req.status not in ('approved','partial') then raise exception 'طلب التوريد يحتاج موافقة'; end if;
 if jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'أدخل الكميات'; end if;
 for r in select * from jsonb_array_elements(p_lines) order by value->>'item_id' loop
  select * into ln from public.inventory_request_lines where request_id=p_id and item_id=(r->>'item_id')::uuid for update;
  if not found then raise exception 'صنف خارج الطلب'; end if;
  q:=(r->>'quantity')::numeric;
  if q is null or q<=0 or ln.received_quantity+q>ln.quantity then raise exception 'الكمية تتجاوز المتبقي'; end if;
  select * into i from public.inventory_items where id=ln.item_id for update;
  cost:=coalesce((r->>'package_cost')::numeric,ln.package_cost)/i.units_per_pack;
  if cost is null or cost<0 then raise exception 'راجع تكلفة العبوة'; end if;
  if i.track_lots and (nullif(r->>'expiry_date','') is null or nullif(r->>'lot_number','') is null) then raise exception 'رقم التشغيلة والصلاحية مطلوبان'; end if;
  lid:=null;
  if i.track_lots or nullif(r->>'lot_number','') is not null or nullif(r->>'expiry_date','') is not null then
   insert into public.inventory_lots(item_id,lot_number,expiry_date,received_quantity,unit_cost,supplier_name,created_by)
    values(i.id,coalesce(r->>'lot_number',''),nullif(r->>'expiry_date','')::date,q,cost,req.supplier_name,public.my_admin_id()) returning id into lid;
  end if;
  price:=round(cost*(1+i.markup_percent/100),2);
  if price<>i.current_sale_price then insert into public.inventory_price_history(item_id,previous_price,new_price,previous_markup,new_markup,changed_by) values(i.id,i.current_sale_price,price,i.markup_percent,i.markup_percent,public.my_admin_id()); end if;
  update public.inventory_items set current_sale_price=price,updated_at=now() where id=i.id;
  insert into public.inventory_movements(item_id,lot_id,movement_type,quantity_delta,unit_cost,unit_sale_price,margin_percent,reference_type,reference_id,note,created_by)
   values(i.id,lid,'receipt',q,cost,price,i.markup_percent,'purchase',p_id,coalesce(p_note,''),public.my_admin_id());
  update public.inventory_request_lines set received_quantity=received_quantity+q where id=ln.id;
 end loop;
 update public.inventory_requests set status=case when exists(select 1 from public.inventory_request_lines where request_id=p_id and received_quantity<quantity) then 'partial' else 'completed' end,completed_at=now() where id=p_id;
end $$;
-- إغلاق مسارات الصرف القديمة التي كانت تعتمد على الرصيد المجمع.
create or replace function public.inventory_record_sale(p_item_id uuid,p_quantity numeric,p_patient_invoice_ref text,p_payment_method text,p_note text)
returns uuid language sql security definer set search_path=public as $$
 select public.inventory_consume_at('00000000-0000-4000-8000-000000000001',p_item_id,p_quantity,'sale',p_note,p_patient_invoice_ref,p_payment_method);
$$;
create or replace function public.inventory_write_off(p_item_id uuid,p_quantity numeric,p_kind text,p_lot_id uuid,p_note text)
returns void language plpgsql security definer set search_path=public as $$ begin
 perform public.inventory_consume_at('00000000-0000-4000-8000-000000000001',p_item_id,p_quantity,p_kind,p_note,'','',p_lot_id);
end $$;
create or replace function public.inventory_fulfill_issue(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare req public.inventory_requests%rowtype; r jsonb; ln public.inventory_request_lines%rowtype; q numeric;
begin
 if not public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') then raise exception 'الصرف من المركزي لمسؤول المخزن'; end if;
 select * into req from public.inventory_requests where id=p_id for update;
 if not found or req.request_type<>'issue' or req.status not in ('approved','partial') then raise exception 'طلب الصرف غير معتمد'; end if;
 if jsonb_array_length(coalesce(p_lines,'[]'))=0 then raise exception 'أدخل الكميات'; end if;
 for r in select * from jsonb_array_elements(p_lines) order by value->>'item_id' loop
  select * into ln from public.inventory_request_lines where request_id=p_id and item_id=(r->>'item_id')::uuid for update;
  if not found then raise exception 'صنف خارج الطلب'; end if;
  q:=(r->>'quantity')::numeric;
  if q is null or q<=0 or ln.fulfilled_quantity+q>ln.quantity then raise exception 'الكمية تتجاوز المتبقي'; end if;
  perform public.inventory_consume_at('00000000-0000-4000-8000-000000000001',ln.item_id,q,'issue','صرف استهلاك لطلب '||p_id::text||' '||coalesce(p_note,''));
  update public.inventory_request_lines set fulfilled_quantity=fulfilled_quantity+q where id=ln.id;
 end loop;
 update public.inventory_requests set status=case when exists(select 1 from public.inventory_request_lines where request_id=p_id and fulfilled_quantity<quantity) then 'partial' else 'completed' end,completed_at=now() where id=p_id;
end $$;

-- الجرد يستخدم بنود التشغيلات، ولا يحوّل الخانة الفارغة إلى صفر.
create or replace function public.inventory_open_count_at(p_location uuid,p_title text,p_assigned_to uuid,p_starts_at timestamptz,p_due_at timestamptz,p_note text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_project uuid; v_task uuid;
begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بطلب الجرد'; end if;
 if p_starts_at is null or p_due_at is null or p_due_at<=p_starts_at or length(trim(p_title))<2 then raise exception 'حدد اسم الجرد وبداية ونهاية الفترة'; end if;
 if not exists(select 1 from public.admins a join public.inventory_location_staff s on s.admin_id=a.id where a.id=p_assigned_to and a.active and s.location_id=p_location) then raise exception 'عيّن مسؤول الجرد على المخزن أولاً'; end if;
 insert into public.inventory_count_sessions(location_id,title,assigned_to,created_by,starts_at,due_at,note) values(p_location,trim(p_title),p_assigned_to,public.my_admin_id(),p_starts_at,p_due_at,coalesce(p_note,'')) returning id into v_id;
 insert into public.inventory_count_lines(session_id,item_id,lot_id,system_quantity)
 select v_id,m.item_id,m.lot_id,sum(m.quantity_delta) from public.inventory_movements m where m.location_id=p_location group by m.item_id,m.lot_id having sum(m.quantity_delta)>0;
 -- الأصناف ذات رصيد صفر والتي سُجلت في المكان تبقى قابلة للعد.
 insert into public.inventory_count_lines(session_id,item_id,system_quantity)
 select v_id,i.id,0 from public.inventory_items i where i.active and not exists(select 1 from public.inventory_count_lines l where l.session_id=v_id and l.item_id=i.id)
  and (exists(select 1 from public.inventory_movements m where m.item_id=i.id and m.location_id=p_location) or exists(select 1 from public.inventory_opening_markers o where o.item_id=i.id and o.location_id=p_location));
 insert into public.task_projects(title,description,created_by,manager_id) values('جرد — '||trim(p_title),'طلب جرد خلال فترة',public.my_admin_id(),public.my_admin_id()) returning id into v_project;
 insert into public.task_project_members(project_id,admin_id,role_name) values(v_project,public.my_admin_id(),'manager'),(v_project,p_assigned_to,'contributor') on conflict(project_id,admin_id) do nothing;
 insert into public.tasks(project_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at)
  values(v_project,p_title,'إدخال العدد الفعلي لكل بند','تسليم الجرد للمراجعة',p_assigned_to,public.my_admin_id(),'todo','high',p_due_at) returning id into v_task;
 update public.inventory_count_sessions set task_id=v_task where id=v_id;
 insert into public.task_notifications(recipient_id,task_id,kind,message) values(p_assigned_to,v_task,'assigned','طلب جرد: '||p_title);
 return v_id;
end $$;
create or replace function public.inventory_prepare_count(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.inventory_count_sessions%rowtype;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not public.inventory_location_can(s.location_id,'view') or s.status<>'open' or now()<s.starts_at or (s.assigned_to<>public.my_admin_id() and not public.inventory_location_can(s.location_id,'manage')) then raise exception 'الجرد غير متاح أو لم يبدأ'; end if;
 insert into public.inventory_count_lines(session_id,item_id,lot_id,system_quantity)
  select s.id,m.item_id,m.lot_id,sum(m.quantity_delta) from public.inventory_movements m where m.location_id=s.location_id group by m.item_id,m.lot_id having sum(m.quantity_delta)>0 on conflict do nothing;
end $$;
create or replace function public.inventory_save_count_draft(p_session_id uuid,p_lines jsonb,p_submit boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare s public.inventory_count_sessions%rowtype; r jsonb; l public.inventory_count_lines%rowtype; q numeric;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or not public.inventory_location_can(s.location_id,'view') or s.status<>'open' or now()<s.starts_at or (s.assigned_to<>public.my_admin_id() and not public.inventory_location_can(s.location_id,'manage')) then raise exception 'الجرد غير متاح لهذا المستخدم أو لم يبدأ'; end if;
 for r in select * from jsonb_array_elements(coalesce(p_lines,'[]')) order by value->>'line_id' loop
  q:=nullif(r->>'counted_quantity','')::numeric;
  if q is not null and q<0 then raise exception 'الكمية لا تقبل السالب'; end if;
  select * into l from public.inventory_count_lines where id=(r->>'line_id')::uuid and session_id=s.id for update;
  if not found then raise exception 'بند خارج جلسة الجرد'; end if;
  perform 1 from public.inventory_items where id=l.item_id for update;
  -- إعادة فتح المسودة دون تعديل الكمية لا يعيد توقيت العد أو رصيد المقارنة.
  if l.counted_quantity is distinct from q then update public.inventory_count_lines set counted_quantity=q,counted_at=case when q is null then null else clock_timestamp() end,
   system_quantity=public.inventory_location_balance(s.location_id,l.item_id,l.lot_id,false),note=coalesce(r->>'note','') where id=l.id;
  else update public.inventory_count_lines set note=coalesce(r->>'note','') where id=l.id; end if;
 end loop;
 if p_submit then
  if exists(select 1 from public.inventory_movements m where m.location_id=s.location_id and not exists(select 1 from public.inventory_count_lines cl where cl.session_id=s.id and cl.item_id=m.item_id and cl.lot_id is not distinct from m.lot_id) group by m.item_id,m.lot_id having sum(m.quantity_delta)>0) then raise exception 'دخلت أصناف أو تشغيلات جديدة؛ أعد فتح إدخال الجرد لاستكمالها'; end if;
  if not exists(select 1 from public.inventory_count_lines where session_id=s.id) or exists(select 1 from public.inventory_count_lines where session_id=s.id and counted_quantity is null) then raise exception 'استكمل كل الأصناف؛ الخانة الفارغة ليست صفراً'; end if;
  update public.inventory_count_sessions set status='submitted',submitted_at=now() where id=s.id;
  if s.task_id is not null then
   insert into public.task_updates(task_id,author_id,body,status_from,status_to) select id,public.my_admin_id(),'تسليم الجرد للمراجعة',status,'review' from public.tasks where id=s.task_id;
   update public.tasks set status='review',updated_at=now() where id=s.task_id;
   insert into public.task_notifications(recipient_id,task_id,kind,message)
    select p.manager_id,s.task_id,'review','الجرد جاهز للمراجعة' from public.tasks t join public.task_projects p on p.id=t.project_id where t.id=s.task_id;
  end if;
 end if;
end $$;
create or replace function public.inventory_approve_count(p_session_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.inventory_count_sessions%rowtype; l record; d numeric;
begin
 select * into s from public.inventory_count_sessions where id=p_session_id for update;
 if not found or s.status<>'submitted' or not public.inventory_location_can(s.location_id,'manager') then raise exception 'اعتماد الجرد للمدير بعد تسليمه'; end if;
 for l in select * from public.inventory_count_lines where session_id=s.id order by item_id,id loop
  perform 1 from public.inventory_items where id=l.item_id for update;
  if l.counted_quantity is null then raise exception 'الجرد غير مكتمل'; end if;
  d:=l.counted_quantity-l.system_quantity;
  if public.inventory_location_balance(s.location_id,l.item_id,l.lot_id,false)+d<0 then raise exception 'الفروق مع الحركات اللاحقة ستسبب رصيداً سالباً'; end if;
  if d<>0 then insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,note,created_by)
   values(l.item_id,s.location_id,l.lot_id,'count_adjustment',d,public.inventory_location_cost(s.location_id,l.item_id,l.lot_id,false),'count',s.id,'اعتماد فرق الجرد',public.my_admin_id()); end if;
 end loop;
 update public.inventory_count_sessions set status='approved',approved_by=public.my_admin_id(),approved_at=now() where id=s.id;
 if s.task_id is not null then
  update public.tasks set status='done',completed_at=now(),updated_at=now() where id=s.task_id;
  insert into public.task_updates(task_id,author_id,body,status_from,status_to) values(s.task_id,public.my_admin_id(),'اعتماد الجرد','review','done');
 end if;
 insert into public.inventory_audit_events(entity_id,kind,actor_id) values(s.id,'count_approved',public.my_admin_id());
end $$;

create or replace function public.inventory_monthly_schedule(p_location uuid,p_assigned_to uuid,p_first_start timestamptz,p_due_days integer default 7)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_project uuid;
begin
 if not public.inventory_location_can(p_location,'manage') then raise exception 'غير مسموح بجدولة الجرد'; end if;
 if p_first_start is null or p_due_days not between 1 and 31 or not exists(select 1 from public.admins a join public.inventory_location_staff s on s.admin_id=a.id where a.id=p_assigned_to and a.active and s.location_id=p_location) then raise exception 'حدد المسؤول وأول موعد ومدة الجرد'; end if;
 select id,project_id into v_id,v_project from public.inventory_count_schedules where location_id=p_location and active and calendar_monthly for update;
 if v_id is null then
  insert into public.task_projects(title,description,created_by,manager_id) select 'الجرد الشهري — '||name,'جرد المخزن شهرياً',public.my_admin_id(),public.my_admin_id() from public.inventory_locations where id=p_location returning id into v_project;
  insert into public.inventory_count_schedules(location_id,title,cadence_days,calendar_monthly,due_days,assigned_to,next_due_at,created_by,project_id)
   values(p_location,'الجرد الشهري',30,true,p_due_days,p_assigned_to,p_first_start,public.my_admin_id(),v_project) returning id into v_id;
 else update public.inventory_count_schedules set assigned_to=p_assigned_to,next_due_at=p_first_start,due_days=p_due_days where id=v_id; end if;
 insert into public.task_project_members(project_id,admin_id,role_name) values(v_project,public.my_admin_id(),'manager'),(v_project,p_assigned_to,'contributor') on conflict(project_id,admin_id) do nothing;
 return v_id;
end $$;
-- استبدال المولد فقط مع الحفاظ على نفس الصيانة والـcron الموجودين.
create or replace function public.inventory_generate_due_counts()
returns integer language plpgsql security definer set search_path=public as $$
declare s record; v_id uuid; tid uuid; v_next timestamptz; n integer:=0;
begin
 for s in select * from public.inventory_count_schedules where active and next_due_at<=now() order by next_due_at for update skip locked loop
  if not exists(select 1 from public.admins where id=s.assigned_to and active) then continue; end if;
  -- لا ننشئ نسخاً متراكمة إن كان جرد المكان ما زال مفتوحاً.
  if exists(select 1 from public.inventory_count_sessions where location_id=s.location_id and status in ('open','submitted')) then continue; end if;
  insert into public.inventory_count_sessions(location_id,title,assigned_to,created_by,starts_at,due_at,note)
   values(s.location_id,s.title,s.assigned_to,s.created_by,s.next_due_at,greatest(now(),s.next_due_at)+make_interval(days=>s.due_days),'جرد دوري') returning id into v_id;
  insert into public.inventory_count_lines(session_id,item_id,lot_id,system_quantity)
   select v_id,item_id,lot_id,sum(quantity_delta) from public.inventory_movements where location_id=s.location_id group by item_id,lot_id having sum(quantity_delta)>0;
  insert into public.inventory_count_lines(session_id,item_id,system_quantity)
   select v_id,i.id,0 from public.inventory_items i where i.active and not exists(select 1 from public.inventory_count_lines cl where cl.session_id=v_id and cl.item_id=i.id)
    and (exists(select 1 from public.inventory_movements m where m.location_id=s.location_id and m.item_id=i.id) or exists(select 1 from public.inventory_opening_markers o where o.location_id=s.location_id and o.item_id=i.id));
  if s.project_id is not null then
   insert into public.tasks(project_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at)
    values(s.project_id,s.title,'تسجيل العدد الفعلي في المخزن','تسليم الجرد للمراجعة',s.assigned_to,s.created_by,'todo','high',greatest(now(),s.next_due_at)+make_interval(days=>s.due_days)) returning id into tid;
   update public.inventory_count_sessions set task_id=tid where id=v_id;
   insert into public.task_notifications(recipient_id,task_id,kind,message) values(s.assigned_to,tid,'assigned','موعد الجرد الشهري');
  end if;
  v_next:=s.next_due_at;
  loop
   v_next:=case when s.calendar_monthly then v_next+interval '1 month' else v_next+make_interval(days=>s.cadence_days) end;
   exit when v_next>now();
  end loop;
  update public.inventory_count_schedules set next_due_at=v_next,last_session_id=v_id where id=s.id;
  n:=n+1;
 end loop;
 return n;
end $$;

-- واجهة موحدة تعيد نفس الحقول القديمة مضافاً إليها المواقع والتحويلات.
create or replace function public.inventory_workspace_snapshot(p_location uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_loc uuid:=p_location; me uuid:=public.my_admin_id(); v jsonb; can_manage boolean;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجّل الدخول'; end if;
 if v_loc is null then select id into v_loc from public.inventory_locations where public.inventory_location_can(id,'view') order by kind,name limit 1; end if;
 if v_loc is null or not public.inventory_location_can(v_loc,'view') then raise exception 'لم تُحدد مسؤوليات مخازن لهذا الحساب'; end if;
 can_manage:=public.inventory_location_can(v_loc,'manage');
 v:=jsonb_build_object('workspace_version',2,'location_id',v_loc,'me',me,'can_manage',can_manage,'can_setup',public.inventory_is_manager(),
  'can_request',public.inventory_location_can(v_loc,'request'),'can_receive',public.inventory_location_can(v_loc,'receive'),'can_approve',public.inventory_location_can(v_loc,'manager'));
 v:=v||jsonb_build_object('locations',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('branch_name',b.name,'can_view',public.inventory_location_can(l.id,'view'),'can_storekeeper',public.inventory_location_can(l.id,'storekeeper'),'can_manager',public.inventory_location_can(l.id,'manager')) order by l.kind,l.name),'[]') from public.inventory_locations l left join public.inventory_branches b on b.id=l.branch_id where l.active and (public.inventory_location_can(l.id,'view') or public.inventory_location_can(v_loc,'request'))),
 'branches',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.inventory_branches b where b.active and (public.inventory_is_manager() or exists(select 1 from public.inventory_locations l where l.branch_id=b.id and public.inventory_location_can(l.id,'view')))),
 'staff',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('name',a.name)),'[]') from public.inventory_location_staff s join public.admins a on a.id=s.admin_id where a.active and (public.inventory_is_manager() or public.inventory_location_can(s.location_id,'view') or public.inventory_location_can(v_loc,'request'))));
 v:=v||jsonb_build_object('balances',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select location_id,item_id,sum(quantity_delta) quantity from public.inventory_movements where public.inventory_location_can(location_id,'view') group by location_id,item_id) x),
 'transit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select l.item_id,sum(a.quantity-coalesce(a.received_quantity,0)) quantity from public.inventory_transfer_allocations a join public.inventory_transfer_lines l on l.id=a.line_id join public.inventory_transfers t on t.id=l.transfer_id where t.status in ('in_transit','discrepancy') and public.inventory_transfer_can_view(t.id) group by l.item_id) x));
 v:=v||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('on_hand',public.inventory_location_balance(v_loc,i.id),'available',public.inventory_location_balance(v_loc,i.id)-coalesce((select sum(m.quantity_delta) from public.inventory_movements m join public.inventory_lots l on l.id=m.lot_id where m.location_id=v_loc and m.item_id=i.id and l.expiry_date<current_date),0),'current_average_cost',case when can_manage then public.inventory_location_cost(v_loc,i.id) else null end) order by i.name),'[]') from public.inventory_items i where i.active),
 'lots',(select coalesce(jsonb_agg((to_jsonb(l)-'unit_cost')||jsonb_build_object('unit_cost',case when can_manage then l.unit_cost else null end,'remaining',public.inventory_location_balance(v_loc,l.item_id,l.id,false))),'[]') from public.inventory_lots l where public.inventory_location_balance(v_loc,l.item_id,l.id,false)>0),
 'suppliers',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.inventory_suppliers s where can_manage));
 v:=v||jsonb_build_object('movements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (select m.*,i.name item_name,a.name actor_name,lt.lot_number,lt.expiry_date from public.inventory_movements m join public.inventory_items i on i.id=m.item_id join public.admins a on a.id=m.created_by left join public.inventory_lots lt on lt.id=m.lot_id where m.location_id=v_loc and (can_manage or m.created_by=me) order by m.created_at desc limit 500) x),
 'requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.*,a.name requester_name,(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('item_name',i.name,'track_lots',i.track_lots)),'[]') from public.inventory_request_lines l join public.inventory_items i on i.id=l.item_id where l.request_id=r.id) lines from public.inventory_requests r join public.admins a on a.id=r.requester_id where (can_manage or r.requester_id=me) order by r.requested_at desc limit 250) x),
 'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select s.*,a.name assignee_name,(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'item_id',l.item_id,'item_name',i.name,'lot_id',l.lot_id,'lot_number',lt.lot_number,'system_quantity',case when can_manage then l.system_quantity else null end,'counted_quantity',l.counted_quantity,'note',l.note) order by i.name),'[]') from public.inventory_count_lines l join public.inventory_items i on i.id=l.item_id left join public.inventory_lots lt on lt.id=l.lot_id where l.session_id=s.id) lines from public.inventory_count_sessions s join public.admins a on a.id=s.assigned_to where s.location_id=v_loc and (can_manage or s.assigned_to=me) order by s.created_at desc limit 150) x),
 'schedules',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('assignee_name',a.name)),'[]') from public.inventory_count_schedules s join public.admins a on a.id=s.assigned_to where s.location_id=v_loc and s.active and (can_manage or s.assigned_to=me)),
 'alerts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.inventory_alerts a where a.resolved_at is null and can_manage and v_loc='00000000-0000-4000-8000-000000000001'));
 v:=v||jsonb_build_object('transfers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select t.*,src.name source_name,dst.name destination_name,
  public.inventory_location_can(t.source_id,'storekeeper') can_storekeeper,(public.inventory_location_can(t.source_id,'manager') or public.inventory_location_can(t.destination_id,'manager')) can_manager,
  (select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('item_name',i.name,'allocations',(select coalesce(jsonb_agg((to_jsonb(a)-'unit_cost')||jsonb_build_object('unit_cost',case when can_manage then a.unit_cost else null end,'lot_number',lt.lot_number)),'[]') from public.inventory_transfer_allocations a left join public.inventory_lots lt on lt.id=a.lot_id where a.line_id=l.id))),'[]') from public.inventory_transfer_lines l join public.inventory_items i on i.id=l.item_id where l.transfer_id=t.id) lines
 from public.inventory_transfers t join public.inventory_locations src on src.id=t.source_id join public.inventory_locations dst on dst.id=t.destination_id where (t.source_id=v_loc or t.destination_id=v_loc) and public.inventory_transfer_can_view(t.id) order by t.created_at desc limit 250) x),
 'imports',(select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc),'[]') from public.inventory_import_batches b where b.location_id=v_loc and (can_manage or b.created_by=me)),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select e.*,a.name actor_name from public.inventory_audit_events e join public.admins a on a.id=e.actor_id where public.inventory_transfer_can_view(e.entity_id) order by e.created_at desc limit 500) x));
 return v;
end $$;

-- منع تجاوز النطاق من الجداول القديمة أو نافذة قديمة مفتوحة قبل التحديث.
drop policy if exists inventory_location_movement_scope on public.inventory_movements;
create policy inventory_location_movement_scope on public.inventory_movements as restrictive for select to authenticated using(public.inventory_location_can(location_id,'view'));
drop policy if exists inventory_location_count_scope on public.inventory_count_sessions;
create policy inventory_location_count_scope on public.inventory_count_sessions as restrictive for select to authenticated using(public.inventory_location_can(location_id,'view'));
-- الواجهات القديمة للجرد تُغلق لأن بنودها لا تحتوي على هوية التشغيلة والمكان.
create or replace function public.inventory_open_count(p_title text,p_assigned_to uuid,p_due_at timestamptz,p_note text)
returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'حدّث الصفحة واستخدم طلب الجرد حسب المخزن'; end $$;
create or replace function public.inventory_submit_count(p_session_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$ begin raise exception 'حدّث الصفحة لتسجيل الجرد حسب المخزن والتشغيلة'; end $$;
create or replace function public.inventory_set_opening_balance(p_item_id uuid,p_quantity numeric,p_unit_cost numeric,p_note text)
returns void language plpgsql security definer set search_path=public as $$ begin raise exception 'استخدم إدخال الرصيد الافتتاحي للمخزن مع المراجعة والاعتماد'; end $$;
create or replace function public.inventory_save_count_schedule(p_id uuid,p_title text,p_cadence_days integer,p_assigned_to uuid,p_next_due_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$ begin raise exception 'استخدم إعداد الجرد الشهري للمخزن المحدد'; end $$;
create or replace function public.inventory_snapshot()
returns jsonb language sql stable security definer set search_path=public as $$ select public.inventory_workspace_snapshot(null); $$;
-- دوال المساعدة غير قابلة للاستدعاء كـRPC. منح دوال الواجهة فقط.
do $$ declare r record; begin
 for r in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in
 ('inventory_my_access','inventory_location_can','inventory_location_balance','inventory_location_cost','inventory_transfer_can_view','inventory_allocate_at','inventory_save_structure','inventory_assign_location','inventory_save_catalog','inventory_create_transfer','inventory_review_transfer','inventory_dispatch_transfer','inventory_receive_transfer','inventory_stage_import','inventory_revise_import','inventory_approve_import','inventory_consume_at','inventory_open_count_at','inventory_prepare_count','inventory_save_count_draft','inventory_monthly_schedule','inventory_workspace_snapshot') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.sig);
  if r.sig::text !~ 'inventory_(allocate_at|location_balance|location_cost)' then execute format('grant execute on function %s to authenticated',r.sig); end if;
 end loop;
end $$;
-- مساعدات التشغيلات القديمة لا تُستخدم من العميل مباشرة.
revoke all on function public.inventory_allocate(uuid,numeric),public.inventory_lot_remaining(uuid),public.inventory_available(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
