-- طلبات الموظفين تستخدم طلبات المخزن وسجل حركاته الحاليين. لا تمنح صلاحيات تلقائيًا.
begin;
create table if not exists public.inventory_supply_access (
 admin_id uuid not null references public.admins(id), location_id uuid not null references public.inventory_locations(id),
 granted_by uuid not null references public.admins(id), created_at timestamptz not null default now(),
 primary key(admin_id,location_id)
);
alter table public.inventory_requests add column if not exists staff_supply boolean not null default false;
alter table public.inventory_requests add column if not exists supply_location_id uuid references public.inventory_locations(id);
alter table public.inventory_requests add column if not exists supply_token uuid;
alter table public.inventory_requests add column if not exists supply_dispatched_by uuid references public.admins(id);
alter table public.inventory_requests add column if not exists supply_received_at timestamptz;
create unique index if not exists inventory_supply_token_unique on public.inventory_requests(requester_id,supply_token) where supply_token is not null;
create index if not exists inventory_supply_queue on public.inventory_requests(supply_location_id,status,requested_at desc) where staff_supply;

create or replace function public.inventory_supply_can_request(p_location uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admins a join public.inventory_supply_access x on x.admin_id=a.id
 join public.inventory_locations l on l.id=x.location_id where a.id=public.my_admin_id() and a.active and l.active and l.id=p_location);
$$;
create or replace function public.inventory_supply_can_manage(p_location uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.inventory_location_can(p_location,'storekeeper') or public.inventory_location_can(p_location,'manage');
$$;
create or replace function public.inventory_supply_can_read(p_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.inventory_requests r join public.admins a on a.id=public.my_admin_id() and a.active
 where r.id=p_id and r.staff_supply and (r.requester_id=a.id or public.inventory_supply_can_manage(r.supply_location_id)));
$$;
create or replace function public.inventory_supply_my_access()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.inventory_locations l where public.inventory_supply_can_request(l.id) or public.inventory_supply_can_manage(l.id))
 or exists(select 1 from public.inventory_requests r join public.admins a on a.id=r.requester_id and a.active where r.staff_supply and r.requester_id=public.my_admin_id());
$$;
alter table public.inventory_supply_access enable row level security;
drop policy if exists inventory_supply_access_read on public.inventory_supply_access;
create policy inventory_supply_access_read on public.inventory_supply_access for select to authenticated
 using(public.has_role('super_admin') or admin_id=public.my_admin_id());
grant select on public.inventory_supply_access to authenticated;
-- الدور وحده لا يمنح وصول المخزن القديم لحساب الطلبات المبسط.
create or replace function public.inventory_can_view()
returns boolean language sql stable security definer set search_path=public as $$ select public.inventory_my_access(); $$;
-- صلاحية الطلب لا تتيح قراءة جدول الأصناف الذي يحتوي على أسعار وهوامش الربح.
drop policy if exists inventory_items_workspace_scope on public.inventory_items;
create policy inventory_items_workspace_scope on public.inventory_items as restrictive for select to authenticated using(public.inventory_my_access());
drop policy if exists inventory_supply_request_scope on public.inventory_requests;
create policy inventory_supply_request_scope on public.inventory_requests as restrictive for select to authenticated
 using(not staff_supply or public.inventory_supply_can_read(id));
drop policy if exists inventory_supply_request_read on public.inventory_requests;
create policy inventory_supply_request_read on public.inventory_requests for select to authenticated using(public.inventory_supply_can_read(id));
drop policy if exists inventory_supply_lines_scope on public.inventory_request_lines;
create policy inventory_supply_lines_scope on public.inventory_request_lines as restrictive for select to authenticated
 using(exists(select 1 from public.inventory_requests r where r.id=request_id and (not r.staff_supply or public.inventory_supply_can_read(r.id))));
drop policy if exists inventory_supply_lines_read on public.inventory_request_lines;
create policy inventory_supply_lines_read on public.inventory_request_lines for select to authenticated using(public.inventory_supply_can_read(request_id));

create or replace function public.inventory_supply_permissions(p_admin uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.has_role('super_admin') then raise exception 'للسوبر أدمن فقط'; end if;
 return jsonb_build_object('locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',concat_ws(' / ',b.name,l.name),'enabled',exists(select 1 from public.inventory_supply_access x where x.admin_id=p_admin and x.location_id=l.id)) order by l.name),'[]') from public.inventory_locations l left join public.inventory_branches b on b.id=l.branch_id where l.active));
end $$;
create or replace function public.inventory_supply_set_permissions(p_admin uuid,p_locations uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.has_role('super_admin') then raise exception 'للسوبر أدمن فقط'; end if;
 perform 1 from public.admins where id=p_admin for update;
 if not found then raise exception 'الحساب غير موجود'; end if;
 if exists(select 1 from unnest(p_locations) x where not exists(select 1 from public.inventory_locations l where l.id=x and l.active)) then raise exception 'مخزن غير متاح'; end if;
 delete from public.inventory_supply_access where admin_id=p_admin;
 insert into public.inventory_supply_access(admin_id,location_id,granted_by)
 select p_admin,x,public.my_admin_id() from (select distinct unnest(p_locations) x) q;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_admin,'supply_permissions',public.my_admin_id(),coalesce(array_to_string(p_locations,','),''));
end $$;

create or replace function public.inventory_supply_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me uuid:=public.my_admin_id();
begin
 if not public.inventory_supply_my_access() then raise exception 'لم تُفعّل صلاحية طلب المستلزمات لهذا الحساب'; end if;
 return jsonb_build_object('me',me,'locations',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',concat_ws(' / ',b.name,l.name),'can_request',public.inventory_supply_can_request(l.id),'can_manage',public.inventory_supply_can_manage(l.id)) order by l.name),'[]') from public.inventory_locations l left join public.inventory_branches b on b.id=l.branch_id where l.active and (public.inventory_supply_can_request(l.id) or public.inventory_supply_can_manage(l.id))),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'unit',i.base_unit) order by i.name),'[]') from public.inventory_items i where i.active),
 'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc),'[]') from (
 select r.id,r.requester_id,a.name requester_name,r.supply_location_id,concat_ws(' / ',b.name,l.name) location_name,r.note,r.review_note,r.status,r.requested_at,r.completed_at,r.supply_received_at,
 public.inventory_supply_can_manage(r.supply_location_id) can_manage,
 (select coalesce(jsonb_agg(jsonb_build_object('item_id',ln.item_id,'name',i.name,'unit',i.base_unit,'quantity',ln.quantity,'fulfilled_quantity',ln.fulfilled_quantity) order by i.name),'[]') from public.inventory_request_lines ln join public.inventory_items i on i.id=ln.item_id where ln.request_id=r.id) lines,
 (select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'at',e.created_at,'actor',ac.name,'detail',e.detail) order by e.id),'[]') from public.inventory_audit_events e join public.admins ac on ac.id=e.actor_id where e.entity_id=r.id and e.kind in ('supply_requested','supply_rejected','supply_dispatched','supply_received')) events
 from public.inventory_requests r join public.admins a on a.id=r.requester_id join public.inventory_locations l on l.id=r.supply_location_id left join public.inventory_branches b on b.id=l.branch_id
 where r.staff_supply and public.inventory_supply_can_read(r.id) order by r.requested_at desc limit 250) x));
end $$;

create or replace function public.inventory_supply_create(p_location uuid,p_lines jsonb,p_note text,p_token uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid; ln jsonb; item uuid; qty numeric;
begin
 if not public.inventory_supply_can_request(p_location) then raise exception 'غير مسموح بطلب مستلزمات من هذا المخزن'; end if;
 if p_token is null or length(trim(coalesce(p_note,''))) not between 2 and 500 then raise exception 'اكتب الغرض من الطلب'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'أضف من 1 إلى 30 صنفًا'; end if;
 -- قفل الحساب يمنع إنشاء الطلب نفسه مرتين حتى عند وصول طلبين متزامنين.
 perform 1 from public.admins where id=public.my_admin_id() for update;
 select id into rid from public.inventory_requests where requester_id=public.my_admin_id() and supply_token=p_token;
 if found then return rid; end if;
 insert into public.inventory_requests(request_type,requester_id,note,staff_supply,supply_location_id,supply_token)
 values('issue',public.my_admin_id(),trim(p_note),true,p_location,p_token) returning id into rid;
 for ln in select * from jsonb_array_elements(p_lines) loop
  item:=(ln->>'item_id')::uuid; qty:=(ln->>'quantity')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>1000000 or not exists(select 1 from public.inventory_items where id=item and active) then raise exception 'راجع الصنف والكمية'; end if;
  insert into public.inventory_request_lines(request_id,item_id,quantity) values(rid,item,qty);
 end loop;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(rid,'supply_requested',public.my_admin_id(),'إنشاء طلب مستلزمات');
 return rid;
end $$;
create or replace function public.inventory_supply_process(p_id uuid,p_action text,p_note text default '')
returns void language plpgsql security definer set search_path=public as $$
declare r public.inventory_requests%rowtype; ln record;
begin
 select * into r from public.inventory_requests where id=p_id and staff_supply for update;
 if not found or not public.inventory_supply_can_manage(r.supply_location_id) then raise exception 'غير مسموح بمعالجة الطلب'; end if;
 if p_action='dispatch' and r.status='completed' then return; end if;
 if p_action='reject' and r.status='rejected' then return; end if;
 if r.status<>'pending' then raise exception 'سبق معالجة الطلب'; end if;
 if p_action='reject' then
  if length(trim(coalesce(p_note,''))) not between 2 and 500 then raise exception 'اكتب سبب الرفض'; end if;
  update public.inventory_requests set status='rejected',reviewer_id=public.my_admin_id(),review_note=trim(p_note),reviewed_at=now() where id=p_id;
 elsif p_action='dispatch' then
  for ln in select * from public.inventory_request_lines where request_id=p_id order by item_id loop
   perform public.inventory_consume_at(r.supply_location_id,ln.item_id,ln.quantity,'issue','طلب مستلزمات '||p_id::text||' — '||r.note);
   update public.inventory_request_lines set fulfilled_quantity=quantity where id=ln.id;
  end loop;
  update public.inventory_requests set status='completed',reviewer_id=public.my_admin_id(),reviewed_at=now(),completed_at=now(),supply_dispatched_by=public.my_admin_id() where id=p_id;
 else raise exception 'إجراء غير صحيح'; end if;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_id,case when p_action='dispatch' then 'supply_dispatched' else 'supply_rejected' end,public.my_admin_id(),case when p_action='dispatch' then 'تم صرف وتسليم كامل الكمية' else trim(p_note) end);
end $$;
create or replace function public.inventory_supply_confirm(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.inventory_requests%rowtype;
begin
 if not exists(select 1 from public.admins where id=public.my_admin_id() and active) then raise exception 'سجّل الدخول'; end if;
 select * into r from public.inventory_requests where id=p_id and staff_supply for update;
 if not found or r.requester_id<>public.my_admin_id() or r.status<>'completed' then raise exception 'غير مسموح بتأكيد الاستلام'; end if;
 if r.supply_received_at is not null then return; end if;
 update public.inventory_requests set supply_received_at=now() where id=p_id;
 insert into public.inventory_audit_events(entity_id,kind,actor_id,detail) values(p_id,'supply_received',public.my_admin_id(),'أكد الموظف استلام الكمية كاملة');
end $$;

-- لا تسمح لنوافذ الطلبات القديمة بمعالجة طلب الموظف أو الخصم من المركزي خطأً.
do $$ begin
 if to_regprocedure('public.inventory_review_request_legacy_supply(uuid,boolean,text)') is null then
  alter function public.inventory_review_request(uuid,boolean,text) rename to inventory_review_request_legacy_supply;
 end if;
 if to_regprocedure('public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text)') is null then
  alter function public.inventory_fulfill_issue(uuid,jsonb,text) rename to inventory_fulfill_issue_legacy_supply;
 end if;
end $$;
create or replace function public.inventory_review_request(p_id uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.inventory_requests where id=p_id and staff_supply;
 if found then raise exception 'استخدم شاشة طلبات الموظفين'; end if;
 perform public.inventory_review_request_legacy_supply(p_id,p_approve,p_note);
end $$;
create or replace function public.inventory_fulfill_issue(p_id uuid,p_lines jsonb,p_note text)
returns void language plpgsql security definer set search_path=public as $$ begin
 perform 1 from public.inventory_requests where id=p_id and staff_supply;
 if found then raise exception 'استخدم شاشة طلبات الموظفين'; end if;
 perform public.inventory_fulfill_issue_legacy_supply(p_id,p_lines,p_note);
end $$;
revoke all on function public.inventory_review_request_legacy_supply(uuid,boolean,text),public.inventory_fulfill_issue_legacy_supply(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.inventory_review_request(uuid,boolean,text),public.inventory_fulfill_issue(uuid,jsonb,text) from public,anon;
grant execute on function public.inventory_review_request(uuid,boolean,text),public.inventory_fulfill_issue(uuid,jsonb,text) to authenticated;
do $$ declare fn record; begin
 for fn in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'inventory_supply_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.sig);
  execute format('grant execute on function %s to authenticated',fn.sig);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
