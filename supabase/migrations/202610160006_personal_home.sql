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
   from public.task_notifications n join public.tasks t on t.id=n.task_id
   where n.recipient_id=me and public.task_can_access(n.task_id)
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
  with visible as materialized (select * from public.task_list_visible()),
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
