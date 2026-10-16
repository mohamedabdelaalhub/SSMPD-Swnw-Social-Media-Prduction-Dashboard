-- مشروع إنتاج المحتوى فقط. ملف تفعيل مجمّع، يُشغّل بالكامل مرة واحدة.
-- يحافظ على البيانات والأرصدة ولا يمنح الموظفين صلاحيات تلقائية.

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


-- الرئيسية الشخصية: مصادر البيانات الحالية وصلاحياتها، دون نسخ المهام أو المحتوى.
begin;
create table if not exists public.personal_notice_reads (
 admin_id uuid not null references public.admins(id) on delete cascade,
 notice_key text not null check(length(notice_key) between 1 and 220),
 read_at timestamptz not null default now(), primary key(admin_id,notice_key)
);
alter table public.personal_notice_reads enable row level security;
drop policy if exists personal_notice_reads_own on public.personal_notice_reads;
create policy personal_notice_reads_own on public.personal_notice_reads for select to authenticated
 using(admin_id=public.my_admin_id() and exists(select 1 from public.admins where id=public.my_admin_id() and active));
grant select on public.personal_notice_reads to authenticated;

create or replace function public.personal_home_module_allowed(p_module text,p_action text)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
 if to_regprocedure('public.finance_module_allowed(text,text)') is not null then return public.finance_module_allowed(p_module,p_action); end if;
 return not ((public.has_role('accountant') or public.has_role('financial_manager')) and not (public.has_role('super_admin') or public.has_role('general_manager')));
end $$;
create or replace function public.personal_home_tasks_allowed()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admins where id=public.my_admin_id() and active)
 and public.personal_home_module_allowed('tasks','view');
$$;
create or replace function public.personal_home_content()
returns table(id uuid,title text,stage text,bucket text,changed_at timestamptz)
language sql stable security definer set search_path=public as $$
 select c.id,c.title,c.stage,
 case when c.stage in ('initial_approval','final_approval') and (public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin')) then 'approval'
 when c.stage='needs_revision' then 'revision' when c.stage='in_design' then 'design'
 when c.stage in ('ready_to_publish','scheduled') then 'publish' else 'progress' end,
 coalesce(c.updated_at,c.created_at)
 from public.content_items c where exists(select 1 from public.admins where id=public.my_admin_id() and active)
 and c.stage<>'published' and (
 public.has_role('general_manager') or public.has_role('super_admin')
 or (public.has_role('approver') and c.stage in ('initial_approval','final_approval','ready_to_publish','scheduled'))
 or (public.has_role('designer') and c.assigned_designer=public.my_admin_id() and c.stage in ('in_design','needs_revision','final_approval'))
 or (public.has_role('page_manager') and (c.created_by=public.my_admin_id() or c.stage in ('ready_to_publish','scheduled'))));
$$;
create or replace function public.personal_home_supplies()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:='[]';
begin
 if to_regprocedure('public.inventory_supply_can_read(uuid)') is null then return result; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc),'[]') into result from (
 select r.id,r.requester_id,concat_ws(' / ',b.name,l.name) location_name,a.name requester_name,r.status,
 r.supply_received_at,coalesce(r.completed_at,r.reviewed_at,r.requested_at) at,
 public.inventory_supply_can_manage(r.supply_location_id) can_manage
 from public.inventory_requests r join public.inventory_locations l on l.id=r.supply_location_id
 left join public.inventory_branches b on b.id=l.branch_id join public.admins a on a.id=r.requester_id
 where r.staff_supply and public.inventory_supply_can_read(r.id)
 and ((r.status='pending' and public.inventory_supply_can_manage(r.supply_location_id))
 or (r.requester_id=public.my_admin_id() and r.status='completed' and r.supply_received_at is null)
 or (r.requester_id=public.my_admin_id() and r.status='rejected' and r.reviewed_at>now()-interval '14 days'))
 order by r.requested_at desc limit 100) x;
 return result;
end $$;

create or replace function public.personal_home_inbox()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me uuid:=public.my_admin_id(); tasks jsonb:='[]'; contents jsonb; supplies jsonb; notices jsonb; unread integer;
begin
 if not exists(select 1 from public.admins where id=me and active) then raise exception 'سجّل الدخول'; end if;
 if public.personal_home_tasks_allowed() then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into tasks from (
   select 'task:'||n.id::text key,'task' type,n.task_id id,n.created_at at,
   case when n.kind='assigned' then 'تم تعيين مهمة جديدة لك: '||t.title||'. برجاء البدء في التنفيذ في أقرب وقت.' else n.message end message,
   n.read_at is not null native_read
   from public.task_notifications n join public.tasks t on t.id=n.task_id join public.task_projects p on p.id=t.project_id
   where p.archived_at is null and n.recipient_id=me and public.task_can_access(n.task_id)
   order by n.created_at desc limit 40) x;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into contents from (
 select 'content:'||id::text||':'||stage||':'||extract(epoch from changed_at)::text key,'content' type,id,changed_at at,
 case bucket when 'approval' then 'مادة في انتظار اعتمادك: ' when 'revision' then 'مادة مطلوب تعديلها: ' when 'design' then 'مادة في انتظار التصميم: ' else 'مادة جاهزة للنشر: ' end||title message,false native_read
 from public.personal_home_content() where bucket in ('approval','revision','design','publish') order by changed_at desc limit 100) x;
 select coalesce(jsonb_agg(jsonb_build_object('key','supply:'||(r->>'id')||':'||(r->>'status')||':'||(r->>'at'),
 'type','supply','id',r->>'id','at',r->>'at','message',case when r->>'status'='pending' then 'طلب مستلزمات بانتظار الصرف — '||(r->>'requester_name') when r->>'status'='rejected' then 'تم رفض طلب المستلزمات؛ راجع ملاحظة المسؤول' else 'تم صرف مستلزماتك — برجاء تأكيد الاستلام' end,'native_read',false)),'[]')
 into supplies from jsonb_array_elements(public.personal_home_supplies()) r;
 with all_items as (select value n from jsonb_array_elements(tasks||contents||supplies)),
 marked as (select n||jsonb_build_object('read',coalesce((n->>'native_read')::boolean,false) or exists(select 1 from public.personal_notice_reads r where r.admin_id=me and r.notice_key=n->>'key')) n from all_items),
 latest as (select n from marked order by (n->>'at')::timestamptz desc limit 80)
 select coalesce(jsonb_agg(n order by (n->>'at')::timestamptz desc),'[]'),count(*) filter(where not (n->>'read')::boolean) into notices,unread from latest;
 return jsonb_build_object('notices',notices,'unread',unread,'limited',jsonb_array_length(tasks||contents||supplies)>80,'generated_at',now());
end $$;
create or replace function public.personal_home_read(p_keys text[])
returns void language plpgsql security definer set search_path=public as $$
declare me uuid:=public.my_admin_id(); k text; inbox jsonb;
begin
 if not exists(select 1 from public.admins where id=me and active) then raise exception 'سجّل الدخول'; end if;
 if coalesce(cardinality(p_keys),0)>80 then raise exception 'حد القراءة 80 إشعارًا'; end if;
 inbox:=public.personal_home_inbox();
 foreach k in array coalesce(p_keys,array[]::text[]) loop
  if exists(select 1 from jsonb_array_elements(inbox->'notices') n where n->>'key'=k) then
   insert into public.personal_notice_reads(admin_id,notice_key) values(me,k) on conflict do nothing;
   if k like 'task:%' then update public.task_notifications set read_at=coalesce(read_at,now()) where recipient_id=me and id=(substring(k from 6))::uuid; end if;
  end if;
 end loop;
end $$;

create or replace function public.personal_home_snapshot()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare me uuid:=public.my_admin_id(); task_part jsonb:='null'; content_part jsonb; supply_part jsonb; a public.admins%rowtype;
begin
 select * into a from public.admins where id=me and active;
 if not found then raise exception 'سجّل الدخول'; end if;
 if public.personal_home_tasks_allowed() then
  with visible as materialized (select t.* from public.task_list_visible() t join public.task_projects p on p.id=t.project_id where p.archived_at is null),
  own_tasks as (select * from visible where assignee_id=me or not can_manage),
  review_tasks as (select * from visible where status='review' and can_manage and public.personal_home_module_allowed('tasks','update')),
  team_tasks as (select * from visible where can_manage)
  select jsonb_build_object('open',(select count(*) from own_tasks where status<>'done'),
   'late',(select count(*) from own_tasks where status<>'done' and due_at<now()),
   'review',(select count(*) from review_tasks),'team_open',(select count(*) from team_tasks where status<>'done'),
   'team_late',(select count(*) from team_tasks where status<>'done' and due_at<now()),
   'blocked',(select count(*) from visible where status='blocked'),
   'mine',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,status,priority,due_at,project_title,return_note from own_tasks where status<>'done' order by case when status='revision' then 0 else 1 end,due_at nulls last limit 8) x),
   'reviews',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,assignee_name,due_at from review_tasks order by due_at nulls last limit 8) x),
   'team',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,status,assignee_name,due_at from team_tasks where status<>'done' order by due_at nulls last limit 8) x)) into task_part;
 end if;
 with c as materialized(select * from public.personal_home_content())
 select jsonb_build_object('approval',(select count(*) from c where bucket='approval'),
 'design',(select count(*) from c where bucket='design'),'revision',(select count(*) from c where bucket='revision'),'publish',(select count(*) from c where bucket='publish'),
 'items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from c order by case bucket when 'approval' then 0 when 'revision' then 1 else 2 end,changed_at desc limit 12) x)) into content_part;
 supply_part:=public.personal_home_supplies();
 return jsonb_build_object('name',a.name,'generated_at',now(),'tasks',task_part,'content',content_part,'supplies',supply_part,
 'inventory_enabled',to_regprocedure('public.inventory_supply_can_read(uuid)') is not null);
end $$;

do $$ declare f record; begin
 for f in select oid::regprocedure sig,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'personal_home_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.proname in ('personal_home_snapshot','personal_home_inbox','personal_home_read') then execute format('grant execute on function %s to authenticated',f.sig); end if;
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='task_notifications') then
 alter publication supabase_realtime add table public.task_notifications;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
