-- Task status «ملغاة» (cancelled) — owner request «ضيف حالة إلغاء للمهام» (2026-11-11).
-- A cancelled task is neither done nor late and is not counted anywhere (owner: «نشيل المهام الملغاة من العدد»): it
-- leaves every open/overdue/due-soon count, totals, Sia/Claude follow-ups, KPIs, reports and project progress, but stays
-- reachable in task lists through the «ملغاة» filter (no kanban column: «نخفي عمود ملغاة»). Only project managers / super admin /
-- content managers can cancel (with a reason) or reopen (back to «لم تبدأ»). Built from the LIVE definitions
-- (2026-11-12); the generated block below only changes "open = status <> 'done'" into
-- "open = status not in ('done','cancelled')" (+ cancelled tasks excluded from project progress and employee cohorts).

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status = any (array['todo','in_progress','review','revision','done','blocked','cancelled']));

-- ---------- cancel / reopen ----------
create or replace function public.task_can_cancel(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_admin_id() is not null
     and (public.task_can_manage_project(p_project_id) or public.is_super() or public.can_manage_all_content());
$$;

create or replace function public.task_cancel(p_task_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_actor uuid := public.my_admin_id(); v_reason text := trim(coalesce(p_reason, '')); v_linked boolean := false;
begin
  if v_actor is null then raise exception 'سجّل الدخول الأول'; end if;
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'المهمة مش موجودة'; end if;
  if not public.task_can_cancel(v_task.project_id) then raise exception 'إلغاء المهمة لمدير المشروع بس'; end if;
  if v_task.status = 'done' then raise exception 'المهمة اتعتمدت خلاص ومينفعش تتلغي'; end if;
  if v_task.status = 'cancelled' then raise exception 'المهمة ملغاة بالفعل'; end if;
  if length(v_reason) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
  if to_regclass('clinic_reception.tasks') is not null then
    execute 'select exists (select 1 from clinic_reception.tasks where external_task_id = $1)' into v_linked using p_task_id;
    if v_linked then raise exception 'المهمة مرتبطة بمتابعة استقبال؛ اقفلها من شاشة الاستقبال'; end if;
  end if;
  -- the task and its open stages
  insert into public.task_updates(task_id, author_id, body, status_from, status_to)
    select t.id, v_actor, left('إلغاء المهمة: ' || v_reason, 5000), t.status, 'cancelled'
      from public.tasks t
     where (t.id = p_task_id or t.parent_task_id = p_task_id) and t.status not in ('done','cancelled');
  update public.tasks set status = 'cancelled', return_note = null, completed_at = null, updated_at = now()
   where (id = p_task_id or parent_task_id = p_task_id) and status not in ('done','cancelled');
  update public.task_notifications set read_at = now()
   where task_id in (select id from public.tasks where id = p_task_id or parent_task_id = p_task_id) and read_at is null and kind in ('overdue','due_soon');
  insert into public.task_notifications(recipient_id, task_id, kind, message)
    select v_task.assignee_id, p_task_id, 'status', 'تم إلغاء المهمة: ' || v_task.title
     where v_task.assignee_id is not null and v_task.assignee_id <> v_actor
    on conflict do nothing;
end $$;

create or replace function public.task_reopen(p_task_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_actor uuid := public.my_admin_id();
begin
  if v_actor is null then raise exception 'سجّل الدخول الأول'; end if;
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'المهمة مش موجودة'; end if;
  if not public.task_can_cancel(v_task.project_id) then raise exception 'إعادة فتح المهمة لمدير المشروع بس'; end if;
  if v_task.status <> 'cancelled' then raise exception 'المهمة مش ملغاة'; end if;
  update public.tasks set status = 'todo', updated_at = now() where id = p_task_id;
  insert into public.task_updates(task_id, author_id, body, status_from, status_to)
    values (p_task_id, v_actor, left('إعادة فتح المهمة' || coalesce(': ' || nullif(trim(p_note), ''), ''), 5000), 'cancelled', 'todo');
  insert into public.task_notifications(recipient_id, task_id, kind, message)
    select v_task.assignee_id, p_task_id, 'status', 'المهمة اتفتحت تاني: ' || v_task.title
     where v_task.assignee_id is not null and v_task.assignee_id <> v_actor
    on conflict do nothing;
end $$;

revoke all on function public.task_can_cancel(uuid) from public, anon;
revoke all on function public.task_cancel(uuid, text) from public, anon;
revoke all on function public.task_reopen(uuid, text) from public, anon;
grant execute on function public.task_can_cancel(uuid) to authenticated, service_role;
grant execute on function public.task_cancel(uuid, text) to authenticated, service_role;
grant execute on function public.task_reopen(uuid, text) to authenticated, service_role;

-- task_set_status: employees keep in_progress/review/blocked; 'cancelled' goes through task_cancel (managers only).
create or replace function public.task_set_status(p_task_id uuid, p_status text, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_task public.tasks%rowtype; v_actor uuid:=public.my_admin_id();
begin
  if p_status = 'cancelled' then perform public.task_cancel(p_task_id, p_note); return; end if;
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.assignee_id<>v_actor then
    raise exception 'Only the assignee can update this task';
  end if;
  if v_task.status = 'cancelled' then raise exception 'المهمة ملغاة — اطلب من مدير المشروع يفتحها تاني'; end if;
  if p_status not in ('in_progress','review','blocked') then raise exception 'Invalid employee status'; end if;
  if length(trim(coalesce(p_note,'')))=0 then raise exception 'Write a short work update first'; end if;
  update public.tasks set status=p_status, return_note=null, updated_at=now() where id=p_task_id;
  insert into public.task_updates(task_id,author_id,body,status_from,status_to)
    values(p_task_id,v_actor,trim(p_note),v_task.status,p_status);
  insert into public.task_notifications(recipient_id,task_id,kind,message)
    select recipients.admin_id,p_task_id,case when p_status='review' then 'review' else 'status' end,
           case when p_status='review' then 'المهمة جاهزة للمراجعة: ' else 'تم تحديث حالة المهمة: ' end||v_task.title
    from (
      select p.manager_id as admin_id from public.task_projects p where p.id=v_task.project_id
      union
      select m.admin_id from public.task_project_members m where m.project_id=v_task.project_id and m.role_name='manager'
    ) recipients where recipients.admin_id<>v_actor
    on conflict do nothing;
end $function$;

-- Claude: a cancelled task is closed like a done one; Claude never cancels or reopens.
CREATE OR REPLACE FUNCTION public.claude_task_update(p_task_id uuid, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_expected_output text DEFAULT NULL::text, p_assignee_id uuid DEFAULT NULL::uuid, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c'; t public.tasks%rowtype;
begin
  if public.my_admin_id() is distinct from claude then raise exception 'الدالة دي لحساب Claude Creative بس'; end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then raise exception 'المهمة مش موجودة'; end if;
  if not public.task_can_manage_project(t.project_id) then raise exception 'Claude مش مدير في المشروع ده'; end if;
  if t.status in ('done','cancelled') then raise exception 'المهمة مقفولة'; end if;
  if t.recurrence_id is not null then raise exception 'مهمة متكررة — تتعدّل من الداشبورد'; end if;
  if p_assignee_id is not null and p_assignee_id is distinct from t.assignee_id
     and not public.claude_assignee_ok(t.project_id, p_assignee_id) then
    raise exception 'الشخص ده مش عضو في المشروع — ضيفه من الداشبورد الأول';
  end if;
  perform public.claude_cap_use('tasks_edit', jsonb_build_object('task', p_task_id));
  perform public.task_update_details(p_task_id,
    coalesce(p_title, t.title), coalesce(p_description, t.description), coalesce(p_expected_output, t.expected_output),
    coalesce(p_assignee_id, t.assignee_id), coalesce(p_due_at, t.due_at), coalesce(p_priority, t.priority),
    false, 1, 'day', null, false);
end $function$;

CREATE OR REPLACE FUNCTION public.claude_task_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  if public.my_admin_id() is distinct from claude then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'Claude لا يحذف مهام — الحذف من الداشبورد بس'; end if;
  if new.project_id is distinct from old.project_id then raise exception 'Claude لا ينقل مهام بين المشاريع'; end if;
  if new.status = 'done' and old.status is distinct from 'done' then
    raise exception 'Claude لا يعتمد ولا يقفل مهام — الاعتماد ليك أو لمدير المشروع من البشر';
  end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    raise exception 'Claude لا يلغي مهام — الإلغاء لمدير المشروع من البشر';
  end if;
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    raise exception 'Claude لا يعيد فتح مهام ملغاة';
  end if;
  if new.status = 'revision' and old.status = 'review' then
    perform public.claude_cap_use('tasks_return', jsonb_build_object('task', new.id));
  end if;
  return new;
end $function$;

-- ---------- generated from live definitions: cancelled = closed (not open, not late) ----------
CREATE OR REPLACE FUNCTION public.administrative_assistant_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case when public.business_manager() then jsonb_build_object(
    'config',(select to_jsonb(c) from public.administrative_assistant_config c where id=1),
    'counts',jsonb_build_object(
      'pending',(select count(*) from public.administrative_assistant_requests where status in ('pending','reviewing')),
      'waiting_owner',(select count(*) from public.administrative_assistant_requests where status='waiting_owner'),
      'urgent',(select count(*) from public.administrative_assistant_requests where priority in ('urgent','critical') and status not in ('closed','executed','rejected'))
    ),
    'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select * from public.administrative_assistant_requests where status not in ('closed','executed','rejected') order by created_at desc limit 50) x),
    'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb) from public.administrative_assistant_rules r where active),
    'claude_pending',(select count(*) from public.claude_task_requests where status in ('pending','processing')),
    'task_overdue',(select count(*) from public.tasks where status not in ('done','cancelled','approved','completed') and due_at is not null and due_at < now()),
    'payroll_attention',(select count(*) from jsonb_array_elements(public.administrative_assistant_payroll_audit(date_trunc('month',current_date)::date)) e where coalesce((e->>'requires_owner_review')::boolean,false)),
    'payroll_pending',(select count(*) from clinic_finance.business_requests where kind='payroll' and status='pending' and coalesce(nullif(payload->>'month','')::date,date_trunc('month',created_at)::date)=date_trunc('month',current_date)::date),
    'task_review_last',coalesce(
      (select detail from public.administrative_assistant_audit where event_type='task_review_run' and (coalesce((detail->>'approved')::int,0)+coalesce((detail->>'returned')::int,0)+coalesce((detail->>'needs_owner')::int,0)+coalesce((detail->>'overdue_nudged')::int,0))>0 order by at desc limit 1),
      (select detail from public.administrative_assistant_audit where event_type='task_review_run' order by at desc limit 1)
    )
  ) else jsonb_build_object('error','forbidden') end;
$function$;

CREATE OR REPLACE FUNCTION public.business_owner_snapshot(p_period text DEFAULT 'week'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare from_ts timestamptz; result jsonb;
begin
 if not public.business_manager() then raise exception 'Management access required'; end if;
 from_ts:=case p_period when 'today' then date_trunc('day',now()) when 'month' then date_trunc('month',now()) else date_trunc('week',now()) end;
 select jsonb_build_object(
 'period',p_period,'from',from_ts,'generated_at',now(),
 'tasks',jsonb_build_object('completed',(select count(*) from public.tasks where completed_at>=from_ts),'overdue',(select count(*) from public.tasks where status not in ('done','cancelled','review') and due_at<now()),'review',(select count(*) from public.tasks where status='review'),'revision',(select count(*) from public.tasks where status='revision'),'blocked',(select count(*) from public.tasks where status='blocked')),
 'projects',coalesce((select jsonb_agg(x order by (x->>'progress')::numeric asc) from (select jsonb_build_object('id',p.id,'title',p.title,'total',count(t.id),'done',count(t.id) filter(where t.status='done'),'overdue',count(t.id) filter(where t.status not in ('done','cancelled','review') and t.due_at<now()),'progress',case when count(t.id)=0 then 0 else round(100.0*count(t.id) filter(where t.status='done')/count(t.id),1) end) x from public.task_projects p left join public.tasks t on t.project_id=p.id and t.status<>'cancelled' where p.archived_at is null group by p.id,p.title order by p.updated_at desc limit 12) s),'[]'::jsonb),
 'knowledge',jsonb_build_object('new',(select count(*) from public.business_knowledge_items where created_at>=from_ts),'waiting_review',(select count(*) from public.business_knowledge_items where status in ('draft','ai_extracted','employee_confirmed')),'validated',(select count(*) from public.business_knowledge_items where status='validated_by_data'),'review_due',(select count(*) from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and review_after is not null and review_after<=now()),'recent',coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at desc) from (select id,knowledge_type,memory_layer,title,statement,status,confidence,brand,specialty,service,audience,source_task_id,source_author_id,review_after,expires_at,created_at from public.business_knowledge_items where created_at>=from_ts order by created_at desc limit 20) k),'[]'::jsonb)),
 'recommendations',jsonb_build_object('pending',(select count(*) from public.business_recommendations where status in ('proposed','approved')),'measuring',(select count(*) from public.business_recommendations where status in ('converted_to_task','measuring')),'items',coalesce((select jsonb_agg(to_jsonb(r) order by case r.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,r.created_at desc) from (select id,title,rationale,recommendation_type,priority,status,expected_metric,task_id,measure_after,created_at from public.business_recommendations where status not in ('rejected','closed') order by created_at desc limit 20) r),'[]'::jsonb)),
 'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_at desc) from (select id,title,decision,reason,scope,status,expected_metric,review_on,result_summary,learning,decided_at from public.business_decisions where status<>'superseded' order by decided_at desc limit 20) d),'[]'::jsonb),
 'operations',jsonb_build_object('open_issues',(select count(*) from public.operational_issues where status<>'resolved'),'repeated',(select count(*) from public.operational_issues where status<>'resolved' and appearance_count>=3),'items',coalesce((select jsonb_agg(to_jsonb(o) order by o.appearance_count desc,o.last_period desc) from (select id,title,status,appearance_count,last_period from public.operational_issues where status<>'resolved' order by appearance_count desc,last_period desc limit 10) o),'[]'::jsonb)),
 'leads',jsonb_build_object('total',(select count(*) from public.leads where received_at>=from_ts),'booked',(select count(*) from public.leads where received_at>=from_ts and (booking_date is not null or booking_reference is not null)),'conversion',coalesce((select round(100.0*count(*) filter(where booking_date is not null or booking_reference is not null)/nullif(count(*),0),1) from public.leads where received_at>=from_ts),0)),
 'ads',jsonb_build_object('basis','Meta lifetime performance; use as direction, not a period ROAS claim','spend',(select coalesce(sum(p.spend),0) from public.meta_ad_performance_lifetime p),'results',(select coalesce(sum(p.results),0) from public.meta_ad_performance_lifetime p),'leads',(select coalesce(sum(p.leads),0) from public.meta_ad_performance_lifetime p),'booked_attributed',(select count(*) from public.vw_lead_meta_attribution where received_at>=from_ts and current_status is not null and matched_meta_ad_id is not null and lead_id in (select id from public.leads where booking_date is not null or booking_reference is not null)),'revenue_attribution_ready',false),
 'team_impact',coalesce((select jsonb_agg(to_jsonb(x) order by x.validated_knowledge desc,x.completed_tasks desc) from (select a.id,a.name,count(distinct t.id) filter(where t.completed_at>=from_ts) completed_tasks,count(distinct k.id) filter(where k.status in ('manager_approved','validated_by_data') and k.created_at>=from_ts) approved_knowledge,count(distinct k.id) filter(where k.status='validated_by_data' and k.created_at>=from_ts) validated_knowledge,count(distinct br.id) filter(where br.task_id is not null and br.created_at>=from_ts) adopted_recommendations,count(distinct bm.id) filter(where bm.verdict in ('improved','resolved','learned') and bm.measured_at>=from_ts) positive_measured_outcomes from public.admins a left join public.tasks t on t.assignee_id=a.id left join public.business_knowledge_items k on k.source_author_id=a.id left join public.business_recommendations br on br.proposed_by=a.id left join public.business_measurements bm on bm.task_id=t.id where a.active=true group by a.id,a.name) x),'[]'::jsonb),
 'alerts',coalesce((select jsonb_agg(v) from (
   select jsonb_build_object('severity','high','kind','task','title','مهام متأخرة','detail',count(*)||' مهمة متأخرة تحتاج تحديد سبب أو إعادة ترتيب.') v from public.tasks where status not in ('done','cancelled','review') and due_at<now() having count(*)>0
   union all select jsonb_build_object('severity','high','kind','operations','title','مشكلات متكررة','detail',count(*)||' مشكلة ظهرت في 3 فترات أو أكثر ولم تغلق بعد.') from public.operational_issues where status<>'resolved' and appearance_count>=3 having count(*)>0
   union all select jsonb_build_object('severity','medium','kind','knowledge','title','معرفة تحتاج مراجعة','detail',count(*)||' معلومة معتمدة وصلت لموعد إعادة التحقق.') from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and review_after is not null and review_after<=now() having count(*)>0
   union all select jsonb_build_object('severity','medium','kind','decision','title','قرارات حان قياسها','detail',count(*)||' قرار وصل لتاريخ المراجعة بدون نتيجة نهائية.') from public.business_decisions where status='active' and review_on is not null and review_on<=current_date having count(*)>0
 ) a(v)),'[]'::jsonb)
 ) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.claude_daily_brief_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  projects uuid[];
  r jsonb := '{}'::jsonb;
  v jsonb;
begin
  select coalesce(array_agg(p.id), '{}') into projects from public.task_projects p
   where p.archived_at is null and (p.manager_id = claude
     or exists (select 1 from public.task_project_members m where m.project_id = p.id and m.admin_id = claude and m.role_name = 'manager'));

  select jsonb_build_object(
    'projects_managed', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title)), '[]') from public.task_projects p where p.id = any(projects)),
    'overdue', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, t.status, t.due_at, greatest(0, floor(extract(epoch from (now() - t.due_at)) / 86400))::int as days_late
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status not in ('done','cancelled') and t.due_at is not null and t.due_at < now()
         order by t.due_at limit 15) x),
    'waiting_review', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 3600)::int as waiting_hours
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'review' and t.assignee_id is distinct from claude
         order by t.updated_at limit 20) x),
    'my_tasks_waiting_review', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status = 'review' and t.assignee_id = claude),
    'blocked', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 86400)::int as days
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'blocked' order by t.updated_at limit 10) x),
    'stale_revision', (select coalesce(jsonb_agg(x), '[]') from (
        select t.id, left(t.title, 90) as title, a.name as assignee, round(extract(epoch from (now() - t.updated_at)) / 86400)::int as days
          from public.tasks t left join public.admins a on a.id = t.assignee_id
         where t.project_id = any(projects) and t.status = 'revision' and t.updated_at < now() - interval '3 days' order by t.updated_at limit 10) x),
    'due_next_48h', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status not in ('done','cancelled') and t.due_at >= now() and t.due_at < now() + interval '48 hours'),
    'not_started', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status = 'todo' and t.created_at < now() - interval '2 days'),
    'open_total', (select count(*) from public.tasks t where t.project_id = any(projects) and t.status not in ('done','cancelled'))
  ) into v;
  r := r || jsonb_build_object('tasks', v);

  select jsonb_build_object(
    'waiting_approval_48h', (select coalesce(jsonb_agg(x), '[]') from (
        select c.id, left(c.title, 80) as title, c.brand, c.stage, round(extract(epoch from (now() - c.updated_at)) / 3600)::int as hours
          from public.content_items c where c.stage in ('initial_approval', 'final_approval') and c.updated_at < now() - interval '48 hours'
         order by c.updated_at limit 15) x),
    'needs_revision', (select count(*) from public.content_items c where c.stage = 'needs_revision'),
    'needs_revision_over_24h', (select count(*) from public.content_items c where c.stage = 'needs_revision' and c.updated_at < now() - interval '24 hours'),
    'scheduled_next_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select c.brand, c.content_format, count(*) as n from public.content_items c
         where c.stage = 'scheduled' and c.scheduled_publish_at >= now() and c.scheduled_publish_at < now() + interval '24 hours' group by 1, 2) x),
    'meta_failed_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, j.status, left(coalesce(j.error_message, ''), 140) as error, left(coalesce(c.title, ''), 70) as title, j.updated_at
          from public.meta_publish_jobs j left join public.content_items c on c.id = j.content_id
         where j.status not in ('pending', 'processing', 'published', 'cancelled') and j.updated_at > now() - interval '24 hours'
         order by j.updated_at desc limit 10) x),
    'meta_stuck_processing', (select count(*) from public.meta_publish_jobs j where j.status = 'processing' and coalesce(j.last_attempt_at, j.updated_at) < now() - interval '2 hours'),
    'tiktok_failed_24h', (select coalesce(jsonb_agg(x), '[]') from (
        select j.id, j.brand, j.status, left(coalesce(j.error_message, ''), 140) as error, j.updated_at
          from public.tiktok_publish_jobs j where j.status in ('failed', 'partial') and j.updated_at > now() - interval '24 hours' order by j.updated_at desc limit 10) x)
  ) into v;
  r := r || jsonb_build_object('content', v);

  select coalesce(jsonb_object_agg(brand, jsonb_build_object(
      'posts_7d', posts, 'posts_prev', posts_prev, 'reach_7d', reach, 'reach_prev', reach_prev,
      'interactions_7d', inter, 'interactions_prev', inter_prev,
      'reach_drop_over_30pct', (reach_prev > 0 and reach < reach_prev * 0.7))), '{}'::jsonb) into v
  from (
    select pi.brand,
      count(*) filter (where pi.published_at >= now() - interval '7 days') as posts,
      count(*) filter (where pi.published_at < now() - interval '7 days') as posts_prev,
      coalesce(sum(coalesce(pi.fb_reach, 0) + coalesce(pi.ig_reach, 0)) filter (where pi.published_at >= now() - interval '7 days'), 0) as reach,
      coalesce(sum(coalesce(pi.fb_reach, 0) + coalesce(pi.ig_reach, 0)) filter (where pi.published_at < now() - interval '7 days'), 0) as reach_prev,
      coalesce(sum(coalesce(pi.fb_reactions, 0) + coalesce(pi.fb_comments, 0) + coalesce(pi.fb_shares, 0) + coalesce(pi.ig_interactions, 0)) filter (where pi.published_at >= now() - interval '7 days'), 0) as inter,
      coalesce(sum(coalesce(pi.fb_reactions, 0) + coalesce(pi.fb_comments, 0) + coalesce(pi.fb_shares, 0) + coalesce(pi.ig_interactions, 0)) filter (where pi.published_at < now() - interval '7 days'), 0) as inter_prev
    from public.post_insights pi where pi.published_at >= now() - interval '14 days' group by pi.brand) z;
  r := r || jsonb_build_object('performance', v);

  select jsonb_build_object(
    'comments_24h_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select sc.status, count(*) as n from public.social_comments sc where sc.updated_at > now() - interval '24 hours' group by 1) x),
    'comments_failed', (select count(*) from public.social_comments sc where sc.status = 'failed'),
    'comments_waiting', (select count(*) from public.social_comments sc where sc.status in ('new', 'drafted')),
    'comments_alerts_open', (select count(*) from public.social_comments sc where sc.alert and sc.alert_resolved_at is null),
    'comments_alert_samples', (select coalesce(jsonb_agg(x), '[]') from (
        select sc.id, sc.brand, sc.category, left(sc.message, 160) as message, sc.commented_at from public.social_comments sc
         where sc.alert and sc.alert_resolved_at is null order by sc.commented_at desc nulls last limit 5) x),
    'messages_new', (select count(*) from public.social_messages sm where sm.status = 'new'),
    'messages_alerts_open', (select count(*) from public.social_messages sm where sm.alert and sm.alert_resolved_at is null),
    'approved_templates_active', (select count(*) from public.social_reply_templates where active),
    'autopilot', (select value from public.social_settings where key = 'autopilot')
  ) into v;
  r := r || jsonb_build_object('audience', v);

  select jsonb_build_object(
    'plans_pending_approval', (select count(*) from public.media_buyer_plans where status = 'pending_approval'),
    'plans_live_or_approved', (select count(*) from public.media_buyer_plans where status in ('approved', 'executing', 'live')),
    'actions_proposed', (select count(*) from public.media_buyer_actions where status = 'proposed'),
    'limits_configured', (select count(*) from public.ads_spend_limits where active),
    'limits', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.ads_limits_status() s)
  ) into v;
  r := r || jsonb_build_object('ads', v);

  select jsonb_build_object(
    'pending_requests', (select count(*) from public.claude_task_requests where status in ('pending', 'working')),
    'capabilities', (select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'label', k.label, 'enabled', k.enabled, 'daily_limit', k.daily_limit,
        'used_today', (select count(*) from public.claude_action_log l where l.action = k.key and (l.at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date))), '[]')
      from public.claude_capabilities k)
  ) into v;
  r := r || jsonb_build_object('claude', v);

  return r || jsonb_build_object('generated_at_cairo', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'));
end $function$;

CREATE OR REPLACE FUNCTION public.digital_team_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sia uuid;
  v_claude uuid;
  v_sia_metrics jsonb;
  v_claude_metrics jsonb;
  v_hapi_metrics jsonb;
  v_members jsonb;
begin
  if not public.business_manager() then
    raise exception 'غير مصرح' using errcode='42501';
  end if;

  select admin_id into v_sia from public.digital_team_members where code='sia' and active;
  select admin_id into v_claude from public.digital_team_members where code='claude_creative' and active;

  select jsonb_build_object(
    'period_days',30,
    'reviewed',count(*) filter(where event_type='task_review_action'),
    'approved',count(*) filter(where event_type='task_review_action' and detail->>'action'='approved'),
    'returned',count(*) filter(where event_type='task_review_action' and detail->>'action'='returned'),
    'needs_owner',count(*) filter(where event_type='task_review_action' and detail->>'action'='needs_owner'),
    'overdue_nudges',count(*) filter(where event_type='task_overdue_nudge'),
    'last_activity',max(at),
    'open_owner_requests',(select count(*) from public.administrative_assistant_requests where status='waiting_owner'),
    'assigned_tasks_open',(select count(*) from public.tasks where assignee_id=v_sia and status not in ('done','cancelled')),
    'assigned_tasks_done_30d',(select count(*) from public.tasks where assignee_id=v_sia and status='done' and completed_at>=now()-interval '30 days')
  ) into v_sia_metrics
  from public.administrative_assistant_audit
  where actor_type='assistant'
    and at>=now()-interval '30 days'
    and event_type in ('task_review_action','task_overdue_nudge','task_review_run');

  select jsonb_build_object(
    'period_days',30,
    'primary_role',a.role,
    'roles',jsonb_build_array(a.role) || coalesce((select jsonb_agg(e.role order by e.role) from public.admin_extra_roles e where e.admin_id=a.id),'[]'::jsonb),
    'capabilities',coalesce((select jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'enabled',c.enabled,'daily_limit',c.daily_limit) order by c.key) from public.claude_capabilities c),'[]'::jsonb),
    'enabled_capabilities',(select count(*) from public.claude_capabilities c where c.enabled),
    'actions_30d',(select count(*) from public.claude_action_log l where l.at>=now()-interval '30 days'),
    'last_activity',(select max(l.at) from public.claude_action_log l),
    'task_requests_30d',(select count(*) from public.claude_task_requests r where r.created_at>=now()-interval '30 days'),
    'task_requests_pending',(select count(*) from public.claude_task_requests r where r.status in ('pending','processing')),
    'design_requests_30d',(select count(*) from public.claude_design_requests r where r.created_at>=now()-interval '30 days'),
    'design_requests_pending',(select count(*) from public.claude_design_requests r where r.status in ('pending','processing')),
    'assigned_tasks_open',(select count(*) from public.tasks t where t.assignee_id=a.id and t.status not in ('done','cancelled')),
    'assigned_tasks_done_30d',(select count(*) from public.tasks t where t.assignee_id=a.id and t.status='done' and t.completed_at>=now()-interval '30 days'),
    'account_preserved',true
  ) into v_claude_metrics
  from public.admins a where a.id=v_claude;

  begin
    v_hapi_metrics:=coalesce(public.clinic_reception_agent_health(),'{}'::jsonb) || jsonb_build_object('identity','external_agent');
  exception when others then
    v_hapi_metrics:=jsonb_build_object('identity','external_agent','health_available',false);
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'code',m.code,
      'display_name',m.display_name,
      'title_ar',m.title_ar,
      'member_kind',m.member_kind,
      'admin_id',m.admin_id,
      'agent_key',m.agent_key,
      'reports_to_code',m.reports_to_code,
      'authority_note',m.authority_note,
      'active',m.active,
      'metadata',m.metadata,
      'admin',case when a.id is null then null else jsonb_build_object(
        'id',a.id,'role',a.role,'active',a.active,'is_system_identity',a.is_system_identity
      ) end,
      'metrics',case m.code when 'sia' then v_sia_metrics when 'claude_creative' then v_claude_metrics when 'hapi' then v_hapi_metrics else '{}'::jsonb end
    ) order by case m.code when 'sia' then 1 when 'hapi' then 2 when 'claude_creative' then 3 else 9 end,m.display_name
  ),'[]'::jsonb)
  into v_members
  from public.digital_team_members m
  left join public.admins a on a.id=m.admin_id
  where m.active;

  return jsonb_build_object(
    'generated_at',now(),
    'members',v_members,
    'principles',jsonb_build_object(
      'claude_existing_account_preserved',true,
      'digital_staff_excluded_from_hr',true,
      'authority_is_explicit',true
    )
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.employee_task_performance(p_period text DEFAULT 'month'::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_admin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=public.my_admin_id(); subject uuid:=coalesce(p_admin,actor); today date:=(now() at time zone 'Africa/Cairo')::date; first_day date; last_day date; lo timestamptz; hi timestamptz; result jsonb;
begin
 if auth.uid() is null or actor is null or not public.finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام' using errcode='42501';end if;
 if subject<>actor and not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'يمكنك متابعة إنجاز مهامك فقط' using errcode='42501';end if;
 if not exists(select 1 from public.admins where id=subject and active) then raise exception 'حساب الموظف غير متاح';end if;
 case p_period
 when 'day' then first_day:=today;last_day:=today;
 when 'week' then first_day:=today-6;last_day:=today;
 when 'month' then first_day:=date_trunc('month',today)::date;last_day:=today;
 when 'all' then first_day:=null;last_day:=today;
 when 'custom' then
  if p_from is null or p_to is null or p_from>p_to or p_to>today then raise exception 'اختر فترة تنتهي اليوم أو قبله';end if;
  first_day:=p_from;last_day:=p_to;
 else raise exception 'فترة غير صالحة';end case;
 lo:=coalesce(first_day::timestamp at time zone 'Africa/Cairo','-infinity'::timestamptz);
 hi:=least(now(),(last_day+1)::timestamp at time zone 'Africa/Cairo');
 with source as materialized (
  select t.*,p.archived_at from public.tasks t join public.task_projects p on p.id=t.project_id
  where t.assignee_id=subject and t.status<>'cancelled' and (p.archived_at is null or t.status='done')
   and not exists(select 1 from public.tasks child where child.parent_task_id=t.id)
 ), cohort as materialized (
  select * from source t where t.created_at<=hi and (
   (t.due_at>=lo and t.due_at<=hi)
   or (t.status='done' and t.completed_at>=lo and t.completed_at<=hi)
   or (t.status='review' and t.latest_submitted_at>=lo and t.latest_submitted_at<=hi)
   or (last_day=today and t.due_at<lo and t.status not in ('done','cancelled'))
  )
 ), counts as (
  select count(*) n,count(*) filter(where status='done') done,count(*) filter(where status='review') review,
   count(*) filter(where status not in ('done','cancelled','review') and due_at<hi) late,
   count(*) filter(where status='revision') revision,count(*) filter(where status='blocked') blocked,
   count(*) filter(where due_at<lo and status not in ('done','cancelled')) carryover,
   count(*) filter(where status in ('done','review') and first_submitted_at is not null and first_submission_due_at is not null) timed,
   count(*) filter(where status in ('done','review') and first_submitted_at<=first_submission_due_at) on_time
  from cohort
 ), actions as (
  select t.*,case when status='blocked' then 'اطلب مساعدة وحدد العائق داخل المهمة'
    when status='revision' then 'راجع ملاحظة المدير وعدّل المطلوب ثم سلّم للمراجعة'
    when status='review' then 'بانتظار اعتماد المدير، لا تحتاج إعادة تسليم'
    when due_at is null then 'اتفق مع المسؤول على موعد تسليم وسجّله في المهمة'
    when status='todo' then 'افتح المطلوب وابدأ ثم سجّل تقدمك'
    else 'أكمل المطلوب وأرفق النتيجة ثم سلّم للمراجعة' end action,
   case when status='blocked' then 0 when status='revision' then 1 when due_at<now() and status<>'review' then 2 when status='review' then 5 when due_at is null then 4 else 3 end rank
  from source t where t.archived_at is null and t.status not in ('done','cancelled')
   and (t.id in(select id from cohort) or (last_day=today and (t.due_at is null or t.due_at<now()+interval '7 days')))
 )
 select jsonb_build_object('period',p_period,'from',first_day,'to',last_day,'generated_at',now(),'admin_id',subject,
  'sample',n,'score',case when n>=3 then round((done*100.0+review*75.0)/n) else null end,
  'done',done,'review',review,'late',late,'revision',revision,'blocked',blocked,'carryover',carryover,'timed',timed,'on_time',on_time,
  'undated',(select count(*) from source where due_at is null and status not in ('done','cancelled','review')),
  'actions_total',(select count(*) from actions),
  'actions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',left(title,180),'status',status,'due_at',due_at,'action',action,'return_note',left(return_note,500)) order by rank,due_at nulls last,id) from (select * from actions order by rank,due_at nulls last,id limit 8) a),'[]'::jsonb),
  'completed_in_period',(select count(*) from source where status='done' and completed_at>=lo and completed_at<=hi)
 ) into result from counts;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.operations_content_brief(p_brand text, p_specialty text DEFAULT ''::text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select coalesce(string_agg('تكليف معتمد: '||a.title||E'\nالمطلوب: '||a.brief||E'\nالمخرج: '||a.expected_output||E'\nخبرة التنفيذ السابقة (أحكام الإدارة وليست إثبات سببية): '||coalesce((select string_agg(o.verdict||': '||o.explanation,' / ') from operational_outcomes o where o.action_id=a.id),'لم يقس الأثر بعد'),E'\n\n'),'')
 from (select x.* from operational_actions x join tasks t on t.id=x.task_id where x.kind='content' and x.active and x.brand=p_brand and (x.specialty='' or x.specialty=coalesce(p_specialty,''))
 and public.my_admin_id() is not null and public.task_can_access(x.task_id) and t.status not in ('done','cancelled') order by x.approved_at desc limit 5) a;
$function$;

CREATE OR REPLACE FUNCTION public.operations_create_action(p_issue_id uuid, p_project_id uuid, p_title text, p_brief text, p_output text, p_assignee uuid, p_due timestamp with time zone, p_measure_after date, p_kind text, p_brand text, p_specialty text, p_steps jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare issue public.operational_issues%rowtype;tid uuid;aid uuid;child uuid;st jsonb;prior_due timestamptz;step_due timestamptz;step_owner uuid;
begin
 if not public.operations_manager() or not public.task_can_manage_project(p_project_id) then raise exception 'غير مسموح باعتماد التكليف';end if;
 select * into issue from public.operational_issues where id=p_issue_id for update;
 if not found or issue.status='resolved' then raise exception 'اختر مشكلة مفتوحة';end if;
 if length(trim(p_title)) not between 2 and 180 or length(trim(p_brief)) not between 2 and 4000 or length(trim(p_output)) not between 2 and 2000 or p_due is null or p_due<=now() or p_measure_after<p_due::date or p_measure_after is null then raise exception 'أكمل التكليف والموعد وموعد قياس النتيجة';end if;
 if p_kind not in ('operations','content','finance','inventory','followup') or p_brand not in ('sono','dr_dina') then raise exception 'نوع التكليف غير صالح';end if;
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 12 then raise exception 'أضف من مرحلة إلى 12 مرحلة';end if;
 if exists(select 1 from public.operational_actions a join public.tasks t on t.id=a.task_id where a.issue_id=p_issue_id and a.active and (t.status not in ('done','cancelled') or not exists(select 1 from public.operational_outcomes o where o.action_id=a.id)) and lower(trim(a.title))=lower(trim(p_title))) then raise exception 'التكليف موجود أو ينتظر قياس الأثر؛ تابع تقدمه بدل تكراره';end if;
 tid:=public.task_create(p_project_id,null,trim(p_title),p_brief,p_output,p_assignee,p_due,case when issue.severity in ('critical','high') or issue.appearance_count>=3 then 'high' else 'normal' end);
 insert into public.operational_actions(issue_id,report_id,task_id,title,kind,brand,specialty,brief,expected_output,assignee_id,approved_by,measure_after)
 values(p_issue_id,issue.latest_report_id,tid,trim(p_title),p_kind,p_brand,left(coalesce(p_specialty,''),120),p_brief,p_output,p_assignee,public.my_admin_id(),p_measure_after) returning id into aid;
 prior_due:=now();
 for st in select value from jsonb_array_elements(p_steps) loop
  step_due:=(st->>'due_at')::timestamptz;step_owner:=coalesce(nullif(st->>'assignee_id','')::uuid,p_assignee);
  if step_due is null or step_due<prior_due or step_due>p_due or length(trim(coalesce(st->>'title',''))) not between 2 and 180 or length(trim(coalesce(st->>'output',''))) not between 2 and 2000 then raise exception 'حدد نتيجة وموعدًا لكل مرحلة بترتيب المراحل وداخل موعد المهمة';end if;
  child:=public.task_create(p_project_id,tid,st->>'title',p_brief,st->>'output',step_owner,step_due,'normal');prior_due:=step_due;
 end loop;
 return aid;
end $function$;

CREATE OR REPLACE FUNCTION public.operations_home_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b jsonb;mine_late integer;team_late integer;
begin
 b:=public.personal_home_snapshot();
 if b->'tasks' is not null and b->'tasks'<>'null'::jsonb then
  select count(*) filter(where (t.assignee_id=public.my_admin_id() or not t.can_manage)),count(*) filter(where t.can_manage)
  into mine_late,team_late from public.task_list_visible() t join public.task_projects p on p.id=t.project_id
  where p.archived_at is null and t.status not in ('done','cancelled','review') and t.due_at<now();
  b:=jsonb_set(jsonb_set(b,'{tasks,late}',to_jsonb(mine_late)),'{tasks,team_late}',to_jsonb(team_late));
 end if;return b;
end $function$;

CREATE OR REPLACE FUNCTION public.operations_task_timing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
 if tg_op='INSERT' then
  new.original_due_at:=new.due_at;new.first_submitted_at:=null;new.first_submission_due_at:=null;new.latest_submitted_at:=null;new.work_started_at:=null;
 else
  if new.status='done' and old.status not in ('done','cancelled') and exists(select 1 from public.operational_actions where task_id=old.id) and exists(select 1 from public.tasks where parent_task_id=old.id and status not in ('done','cancelled')) then raise exception 'اعتمد كل مراحل المهمة قبل اعتماد اكتمالها';end if;
  new.original_due_at:=coalesce(old.original_due_at,old.due_at);
  new.first_submitted_at:=old.first_submitted_at;new.first_submission_due_at:=old.first_submission_due_at;new.latest_submitted_at:=old.latest_submitted_at;new.work_started_at:=old.work_started_at;
  if new.status='in_progress' and old.status is distinct from new.status then new.work_started_at:=coalesce(old.work_started_at,now());end if;
  if new.status='review' and old.status is distinct from new.status then new.first_submitted_at:=coalesce(old.first_submitted_at,now());new.first_submission_due_at:=case when old.first_submitted_at is null then old.due_at else old.first_submission_due_at end;new.latest_submitted_at:=now();end if;
  if old.status is distinct from new.status or old.due_at is distinct from new.due_at or old.assignee_id is distinct from new.assignee_id then
   insert into public.operational_task_events(task_id,actor_id,from_status,to_status,old_due_at,new_due_at,old_assignee_id,new_assignee_id) values(old.id,public.my_admin_id(),old.status,new.status,old.due_at,new.due_at,old.assignee_id,new.assignee_id);
  end if;
 end if;return new;
end $function$;

CREATE OR REPLACE FUNCTION public.personal_home_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid:=public.my_admin_id(); task_part jsonb:='null'; content_part jsonb; supply_part jsonb; a public.admins%rowtype;
begin
 select * into a from public.admins where id=me and active;
 if not found then raise exception 'سجّل الدخول'; end if;
 if public.personal_home_tasks_allowed() then
  with visible as materialized (select t.* from public.task_list_visible() t join public.task_projects p on p.id=t.project_id where p.archived_at is null),
  own_tasks as (select * from visible where assignee_id=me or not can_manage),
  review_tasks as (select * from visible where status='review' and can_manage and public.personal_home_module_allowed('tasks','update')),
  team_tasks as (select * from visible where can_manage)
  select jsonb_build_object('open',(select count(*) from own_tasks where status not in ('done','cancelled')),
   'late',(select count(*) from own_tasks where status not in ('done','cancelled') and due_at<now()),
   'review',(select count(*) from review_tasks),'team_open',(select count(*) from team_tasks where status not in ('done','cancelled')),
   'team_late',(select count(*) from team_tasks where status not in ('done','cancelled') and due_at<now()),
   'blocked',(select count(*) from visible where status='blocked'),
   'mine',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,status,priority,due_at,project_title,return_note from own_tasks where status not in ('done','cancelled') order by case when status='revision' then 0 else 1 end,due_at nulls last limit 8) x),
   'reviews',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,assignee_name,due_at from review_tasks order by due_at nulls last limit 8) x),
   'team',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,title,status,assignee_name,due_at from team_tasks where status not in ('done','cancelled') order by due_at nulls last limit 8) x)) into task_part;
 end if;
 with c as materialized(select * from public.personal_home_content())
 select jsonb_build_object('approval',(select count(*) from c where bucket='approval'),
 'design',(select count(*) from c where bucket='design'),'revision',(select count(*) from c where bucket='revision'),'publish',(select count(*) from c where bucket='publish'),
 'items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from c order by case bucket when 'approval' then 0 when 'revision' then 1 else 2 end,changed_at desc limit 12) x)) into content_part;
 supply_part:=public.personal_home_supplies();
 return jsonb_build_object('name',a.name,'generated_at',now(),'tasks',task_part,'content',content_part,'supplies',supply_part,
 'inventory_enabled',to_regprocedure('public.inventory_supply_can_read(uuid)') is not null);
end $function$;

CREATE OR REPLACE FUNCTION public.staff_comprehensive_performance(p_from timestamp with time zone, p_to timestamp with time zone, p_admin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private', 'clinic_people'
AS $function$
declare
  actor uuid:=public.my_admin_id(); subject uuid:=coalesce(p_admin,public.my_admin_id());
  v_name text;v_primary_role text;v_days numeric;
  v_roles jsonb:='[]'::jsonb;v_role_breakdown jsonb:='[]'::jsonb;v_role_score numeric;
  v_att_total int:=0;v_att_present int:=0;v_att_late int:=0;v_att_absent int:=0;v_att_early int:=0;v_att_missing_out int:=0;v_att_score numeric;
  v_task_sample int:=0;v_task_timed int:=0;v_task_ontime numeric:=0;v_task_weight numeric:=0;v_task_score numeric;v_overdue int:=0;
  v_task_quality_sample int:=0;v_task_quality_score numeric;v_revisions int:=0;
  v_reg_count int:=0;v_issue_weight numeric:=0;v_data_score numeric;v_open_issues int:=0;
  v_clinical_sample int:=0;v_clinical_complete int:=0;v_clinical_score numeric;
  v_quality_score numeric;v_quality_sample int:=0;v_quality_sum numeric:=0;v_quality_weight numeric:=0;
  v_patient_sample int:=0;v_patient_score numeric;v_patient_negative int:=0;v_patient_open int:=0;
  v_dims jsonb:='[]'::jsonb;v_sum numeric:=0;v_w numeric:=0;v_dim_count int:=0;v_total_sample int:=0;v_score numeric;v_band text;v_conf text;v_provisional boolean;
  v_issues jsonb:='[]'::jsonb;v_feedback jsonb:='[]'::jsonb;v_steps jsonb:='[]'::jsonb;
begin
  if actor is null or subject is null then raise exception 'سجل الدخول' using errcode='42501';end if;
  if p_to is null or p_from is null or p_to<=p_from or p_to-p_from>interval '370 days' then raise exception 'فترة الأداء غير صالحة';end if;
  if subject<>actor and not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'يمكنك متابعة أدائك فقط' using errcode='42501';end if;
  select name,role into v_name,v_primary_role from public.admins where id=subject and active;
  if v_name is null then raise exception 'الموظف غير متاح';end if;
  v_days:=greatest(1,extract(epoch from(p_to-p_from))/86400.0);

  with assigned as (
    select v_primary_role role union select e.role from public.admin_extra_roles e where e.admin_id=subject
  ), custom as (select role,allocation_pct from public.performance_role_allocations where admin_id=subject),
  chosen as (
    select a.role,case when exists(select 1 from custom) then coalesce(c.allocation_pct,0) else 100.0/nullif(count(*) over(),0) end allocation_pct
    from assigned a left join custom c using(role)
  )
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'allocation_pct',round(allocation_pct,1)) order by allocation_pct desc,role),'[]'::jsonb)
  into v_roles from chosen where allocation_pct>0;

  select count(*)::int,
         count(*) filter(where a.actual_start is not null)::int,
         count(*) filter(where a.actual_start is null)::int,
         count(*) filter(where a.actual_start is not null and a.scheduled_start is not null and a.actual_start>a.scheduled_start+interval '10 minutes')::int,
         count(*) filter(where a.actual_end is not null and a.scheduled_end is not null and a.actual_end<a.scheduled_end-interval '15 minutes')::int,
         count(*) filter(where a.actual_start is not null and a.actual_end is null)::int
  into v_att_total,v_att_present,v_att_absent,v_att_late,v_att_early,v_att_missing_out
  from clinic_people.attendance a join clinic_people.people p on p.id=a.person_id
  where p.admin_id=subject and p.status<>'ended' and a.status='approved'
    and a.day >= (p_from at time zone 'Africa/Cairo')::date and a.day <= (p_to at time zone 'Africa/Cairo')::date
    and not exists(select 1 from clinic_people.requests q where q.person_id=p.id and q.status='approved' and q.kind='leave' and a.day between q.from_date and q.to_date);
  if v_att_total>=3 then
    v_att_score:=greatest(0,least(100,100-(60.0*v_att_absent/v_att_total)-(20.0*v_att_late/v_att_total)-(10.0*v_att_early/v_att_total)-(10.0*v_att_missing_out/v_att_total)));
  end if;

  with base as (
    select t.*,case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end::numeric wt
    from public.tasks t where t.assignee_id=subject and t.status<>'cancelled' and not exists(select 1 from public.tasks c where c.parent_task_id=t.id)
      and t.first_submitted_at>=p_from and t.first_submitted_at<p_to
  )
  select count(*)::int,count(*) filter(where first_submission_due_at is not null)::int,
         coalesce(sum(wt) filter(where first_submission_due_at is not null),0),
         coalesce(sum(wt) filter(where first_submission_due_at is not null and first_submitted_at<=first_submission_due_at),0),
         count(*) filter(where exists(select 1 from public.task_updates u where u.task_id=base.id and u.status_from='review' and u.status_to='revision' and u.created_at>=base.first_submitted_at))::int
  into v_task_sample,v_task_timed,v_task_weight,v_task_ontime,v_revisions from base;
  if v_task_timed>=2 and v_task_weight>0 then v_task_score:=least(100,100*v_task_ontime/v_task_weight);end if;
  if v_task_sample>=2 then
    with base as (
      select t.id,case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end::numeric wt,t.first_submitted_at
      from public.tasks t where t.assignee_id=subject and t.status<>'cancelled' and not exists(select 1 from public.tasks c where c.parent_task_id=t.id)
        and t.first_submitted_at>=p_from and t.first_submitted_at<p_to
    )
    select count(*)::int,100*coalesce(sum(wt) filter(where not exists(select 1 from public.task_updates u where u.task_id=base.id and u.status_from='review' and u.status_to='revision' and u.created_at>=base.first_submitted_at)),0)/nullif(sum(wt),0)
    into v_task_quality_sample,v_task_quality_score from base;
  end if;
  if p_to>=now()-interval '1 day' then
    select count(*)::int into v_overdue from public.tasks t where t.assignee_id=subject and t.status not in ('done','cancelled','review') and t.due_at<now()
      and not exists(select 1 from public.tasks c where c.parent_task_id=t.id);
  end if;

  select count(*)::int into v_reg_count from public.patients p where p.created_by=subject and p.created_at>=p_from and p.created_at<p_to;
  select coalesce(sum((case e.severity when 'critical' then 2 when 'high' then 1.25 when 'medium' then 1 when 'low' then .5 else .25 end)*
    (case e.status when 'dismissed' then 0 when 'fixed_by_employee' then case when e.fixed_at<=e.due_at then .1 else .35 end when 'fixed_by_other' then .75 else 1 end)),0),
    count(*) filter(where e.status in ('open','confirmed'))::int
  into v_issue_weight,v_open_issues
  from public.performance_evidence e join public.patients p on p.id::text=e.source_id
  where e.admin_id=subject and e.source_type='patient' and e.affects_score and p.created_at>=p_from and p.created_at<p_to;
  if v_reg_count>=3 then v_data_score:=greatest(0,least(100,100-(100*v_issue_weight/nullif(v_reg_count*3.0,0))));end if;

  if performance_private.admin_has_role(subject,'nursing') then
    select count(*)::int,count(*) filter(where
      ((case when nullif(trim(coalesce(v.blood_pressure,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.pulse,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.oxygen_percent,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.weight,'')),'') is not null then 1 else 0 end))>=2)::int
    into v_clinical_sample,v_clinical_complete from public.patient_visits v where v.created_by=subject and v.created_at>=p_from and v.created_at<p_to and v.encounter_type in('checkup','follow_up','emergency','session','home_visit');
    if v_clinical_sample>=3 then v_clinical_score:=100.0*v_clinical_complete/v_clinical_sample;end if;
  end if;

  if v_data_score is not null then v_quality_sum:=v_quality_sum+v_data_score*45;v_quality_weight:=v_quality_weight+45;v_quality_sample:=v_quality_sample+v_reg_count;end if;
  if v_task_quality_score is not null then v_quality_sum:=v_quality_sum+v_task_quality_score*30;v_quality_weight:=v_quality_weight+30;v_quality_sample:=v_quality_sample+v_task_quality_sample;end if;
  if v_clinical_score is not null then v_quality_sum:=v_quality_sum+v_clinical_score*25;v_quality_weight:=v_quality_weight+25;v_quality_sample:=v_quality_sample+v_clinical_sample;end if;
  if v_quality_weight>0 then v_quality_score:=v_quality_sum/v_quality_weight;end if;

  with assigned as (
    select v_primary_role role union select e.role from public.admin_extra_roles e where e.admin_id=subject
  ), custom as (select role,allocation_pct from public.performance_role_allocations where admin_id=subject),
  role_alloc as (
    select a.role,case when exists(select 1 from custom) then coalesce(c.allocation_pct,0) else 100.0/nullif(count(*) over(),0) end allocation_pct
    from assigned a left join custom c using(role)
  ),
  ci as (
    select c.id,c.created_by,c.assigned_designer,c.created_at,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='initial_approval') t_init,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='in_design') t_design,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='final_approval') t_final,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='ready_to_publish') t_ready,
      exists(select 1 from public.activity_log al where al.content_id=c.id and al.to_stage='needs_revision') had_rev
    from public.content_items c
  ),
  decisions as (
    select a.actor_id,a.created_at,a.from_stage,a.action,a.created_at-lag(a.created_at) over(partition by a.content_id order by a.created_at) gap from public.activity_log a
  ),
  perf as (
    select c.created_by,cp.published_at,cp.engagement::numeric/nullif(avg(cp.engagement) over(partition by cp.brand),0) ratio
    from public.content_performance(120) cp join public.content_items c on c.id=cp.content_id
  ),
  fc as (
    select distinct on(l.id) l.id,l.received_at,s.changed_by,s.changed_at from public.leads l join public.lead_status_log s on s.lead_id=l.id and s.changed_at>=l.received_at
    where l.received_at>=p_from and l.received_at<p_to and s.changed_by=subject order by l.id,s.changed_at
  ),
  review_pairs as (
    select d.author_id,extract(epoch from(d.created_at-s.created_at))/3600.0 hours
    from public.task_updates s join lateral(
      select x.author_id,x.created_at from public.task_updates x where x.task_id=s.task_id and x.created_at>s.created_at and x.status_from='review' and x.status_to in('done','revision') order by x.created_at limit 1
    ) d on true where s.status_to='review' and s.created_at>=p_from and s.created_at<p_to and d.author_id=subject
  ),
  m(k,val,n) as (
    select 'content_created',count(*)::numeric,count(*)::int from ci where created_by=subject and created_at>=p_from and created_at<p_to
    union all select 'first_pass_rate',100*avg((not had_rev)::int),count(*)::int from ci where created_by=subject and created_at>=p_from and created_at<p_to and t_ready is not null
    union all select 'idea_to_approval_hours',avg(extract(epoch from(t_ready-t_init))/3600),count(*)::int from ci where created_by=subject and t_init>=p_from and t_init<p_to and t_ready>=t_init
    union all select 'post_engagement_ratio',avg(ratio),count(*)::int from perf where created_by=subject and published_at>=p_from and published_at<p_to and ratio is not null
    union all select 'designs_delivered',count(*)::numeric,count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to
    union all select 'design_turnaround_hours',avg(extract(epoch from(t_final-t_design))/3600),count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to and t_design is not null and t_final>=t_design
    union all select 'design_first_pass_rate',100*avg((not had_rev)::int),count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to
    union all select 'approval_response_hours',avg(extract(epoch from gap)/3600),count(*)::int from decisions where actor_id=subject and gap is not null and created_at>=p_from and created_at<p_to and from_stage in('initial_approval','final_approval') and (action in('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%')
    union all select 'approvals_done',count(*)::numeric,count(*)::int from decisions where actor_id=subject and created_at>=p_from and created_at<p_to and from_stage in('initial_approval','final_approval') and (action in('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%')
    union all select 'task_review_response_hours',avg(hours),count(*)::int from review_pairs
    union all select 'lead_attempts',count(*)::numeric,count(*)::int from public.lead_attempts where employee_id=subject and attempt_date>=p_from and attempt_date<p_to
    union all select 'lead_first_contact_minutes',avg(extract(epoch from(changed_at-received_at))/60),count(*)::int from fc
    union all select 'bookings_made',count(*)::numeric,count(*)::int from public.leads where booked_by=subject and booking_date>=p_from::date and booking_date<p_to::date
  ),
  scored as (
    select ra.role,ra.allocation_pct,d.kpi,d.label_ar,d.unit,d.direction,d.min_sample,m.val,m.n,
      round(t.target*case when d.scales then v_days/30 else 1 end,1) target,t.weight,
      case when m.val is null or coalesce(m.n,0)<d.min_sample then null
           when d.direction='higher' then least(100,100*m.val/nullif(t.target*case when d.scales then v_days/30 else 1 end,0))
           else case when m.val<=t.target then 100 else least(100,100*t.target/nullif(m.val,0)) end end kscore
    from role_alloc ra join public.kpi_targets t on t.role=ra.role join public.kpi_defs d on d.kpi=t.kpi left join m on m.k=d.kpi
    where ra.allocation_pct>0 and d.kpi not in('tasks_on_time_rate','tasks_overdue_now')
  ), per_role as (
    select role,allocation_pct,case when count(kscore)>0 then sum(kscore*weight)/nullif(sum(weight) filter(where kscore is not null),0) end role_score,
      coalesce(jsonb_agg(jsonb_build_object('kpi',kpi,'label',label_ar,'unit',unit,'value',round(val,2),'sample',coalesce(n,0),'target',target,'score',case when kscore is null then null else round(kscore,1) end) order by kpi) filter(where val is not null or coalesce(n,0)>0),'[]'::jsonb) metrics
    from scored group by role,allocation_pct
  )
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'allocation_pct',round(allocation_pct,1),'score',case when role_score is null then null else round(role_score,1) end,'metrics',metrics) order by allocation_pct desc,role),'[]'::jsonb),
    sum(role_score*allocation_pct) filter(where role_score is not null)/nullif(sum(allocation_pct) filter(where role_score is not null),0)
  into v_role_breakdown,v_role_score from per_role;

  with scores as (
    select ((r.ratings->>0)::numeric) val from public.patient_experience_ratings r join public.patients p on p.id=r.patient_id
    where r.source='patient_portal' and r.created_at>=p_from and r.created_at<p_to and p.created_by=subject
      and p.created_at::date between r.visit_date-2 and r.visit_date+2
      and (performance_private.admin_has_role(subject,'reception') or performance_private.admin_has_role(subject,'customer_service'))
    union all
    select (((r.ratings->>1)::numeric+(r.ratings->>2)::numeric+(r.ratings->>3)::numeric)/3.0) val
    from public.patient_experience_ratings r join public.patient_visits v on v.id=r.patient_visit_id
    where r.source='patient_portal' and r.created_at>=p_from and r.created_at<p_to and v.created_by=subject
      and ((performance_private.admin_has_role(subject,'nursing') and v.encounter_type in('lab','radiology')) or (performance_private.admin_has_role(subject,'psychology_specialist') and v.encounter_type='session'))
  ) select count(*)::int,20*avg(val) into v_patient_sample,v_patient_score from scores;
  select count(*) filter(where sentiment='negative' and status='confirmed')::int,count(*) filter(where sentiment='negative' and status='open')::int
  into v_patient_negative,v_patient_open from public.patient_feedback_signals where admin_id=subject and detected_at>=p_from and detected_at<p_to;
  if v_patient_score is not null and v_patient_sample>=5 then v_patient_score:=greatest(0,v_patient_score-least(20,v_patient_negative*5));end if;

  if v_att_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','attendance','label','الحضور والانضباط','weight',15,'score',round(v_att_score,1),'sample',v_att_total,'counted',true,'details',jsonb_build_object('shifts',v_att_total,'present',v_att_present,'late',v_att_late,'absent',v_att_absent,'early_leave',v_att_early,'missing_checkout',v_att_missing_out)));
    v_sum:=v_sum+v_att_score*15;v_w:=v_w+15;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_att_total;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','attendance','label','الحضور والانضباط','weight',15,'score',null,'sample',v_att_total,'counted',false));end if;
  if v_task_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','tasks','label','الالتزام بتنفيذ المهام','weight',20,'score',round(v_task_score,1),'sample',v_task_timed,'counted',true,'details',jsonb_build_object('submitted',v_task_sample,'timed',v_task_timed,'overdue_now',v_overdue)));
    v_sum:=v_sum+v_task_score*20;v_w:=v_w+20;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_task_timed;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','tasks','label','الالتزام بتنفيذ المهام','weight',20,'score',null,'sample',v_task_timed,'counted',false,'details',jsonb_build_object('overdue_now',v_overdue)));end if;
  if v_quality_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','quality','label','جودة ودقة العمل','weight',25,'score',round(v_quality_score,1),'sample',v_quality_sample,'counted',true,'details',jsonb_build_object('registration_score',case when v_data_score is null then null else round(v_data_score,1) end,'registrations',v_reg_count,'open_data_issues',v_open_issues,'task_first_pass_score',case when v_task_quality_score is null then null else round(v_task_quality_score,1) end,'task_revisions',v_revisions,'clinical_documentation_score',case when v_clinical_score is null then null else round(v_clinical_score,1) end,'clinical_records',v_clinical_sample)));
    v_sum:=v_sum+v_quality_score*25;v_w:=v_w+25;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_quality_sample;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','quality','label','جودة ودقة العمل','weight',25,'score',null,'sample',v_quality_sample,'counted',false));end if;
  if v_role_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','role_results','label','نتائج الدور الوظيفي','weight',30,'score',round(v_role_score,1),'sample',jsonb_array_length(v_role_breakdown),'counted',true,'details',v_role_breakdown));
    v_sum:=v_sum+v_role_score*30;v_w:=v_w+30;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+jsonb_array_length(v_role_breakdown);
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','role_results','label','نتائج الدور الوظيفي','weight',30,'score',null,'sample',0,'counted',false,'details',v_role_breakdown));end if;
  if v_patient_score is not null and v_patient_sample>=5 then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','patient_experience','label','تجربة المريض','weight',10,'score',round(v_patient_score,1),'sample',v_patient_sample,'counted',true,'details',jsonb_build_object('ratings',v_patient_sample,'confirmed_negative_comments',v_patient_negative,'open_comments',v_patient_open)));
    v_sum:=v_sum+v_patient_score*10;v_w:=v_w+10;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_patient_sample;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','patient_experience','label','تجربة المريض','weight',10,'score',case when v_patient_score is null then null else round(v_patient_score,1) end,'sample',v_patient_sample,'counted',false,'details',jsonb_build_object('minimum_sample',5,'open_comments',v_patient_open)));end if;

  if v_w>0 then v_score:=round(v_sum/v_w,1);end if;
  v_provisional:=v_score is null or v_dim_count<3 or v_total_sample<8;
  v_conf:=case when v_dim_count>=4 and v_total_sample>=20 then 'مرتفعة' when v_dim_count>=3 and v_total_sample>=8 then 'متوسطة' else 'منخفضة' end;
  v_band:=case when v_provisional then 'نتيجة مبدئية' when v_score<60 then 'سيئ' when v_score<75 then 'مقبول' when v_score<85 then 'جيد' else 'ممتاز' end;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'metric',metric,'severity',severity,'status',status,'affects_score',affects_score,'title',title,'detail',detail,'suggested_action',suggested_action,'evidence',evidence,'source_type',source_type,'source_id',source_id,'detected_at',detected_at,'due_at',due_at) order by case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,detected_at desc),'[]'::jsonb)
  into v_issues from (select * from public.performance_evidence where admin_id=subject and status in('open','confirmed') order by detected_at desc limit 30)e;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'theme',s.theme,'team',s.team,'sentiment',s.sentiment,'severity',s.severity,'confidence',s.confidence,'status',s.status,'detected_at',s.detected_at,'visit_id',s.patient_visit_id) order by s.detected_at desc),'[]'::jsonb)
  into v_feedback from (select * from public.patient_feedback_signals where admin_id=subject and sentiment='negative' and status in('open','confirmed') order by detected_at desc limit 20)s;

  if v_open_issues>0 then v_steps:=v_steps||jsonb_build_array('صحح '||v_open_issues||' مشكلة بيانات مفتوحة؛ التصحيح المبكر يحسن جودة التسجيل.');end if;
  if v_att_score is not null and v_att_score<75 then v_steps:=v_steps||jsonb_build_array('راجع مواعيد الحضور والانصراف وقلل التأخير والخروج المبكر خلال الفترة القادمة.');end if;
  if v_task_score is not null and v_task_score<75 then v_steps:=v_steps||jsonb_build_array('ابدأ بالمهام ذات الموعد الأقرب وسلّم للمراجعة قبل موعد الاستحقاق.');end if;
  if v_task_quality_score is not null and v_task_quality_score<75 then v_steps:=v_steps||jsonb_build_array('راجع المطلوب قبل التسليم لتقليل رجوع المهام للتعديل وتحسين الاعتماد من أول مرة.');end if;
  if v_clinical_score is not null and v_clinical_score<75 then v_steps:=v_steps||jsonb_build_array('أكمل بيانات القياسات الطبية الأساسية قبل إنهاء إدخال الزيارة.');end if;
  if v_role_score is not null and v_role_score<75 then v_steps:=v_steps||jsonb_build_array('ركز على أضعف مؤشر في دورك الوظيفي وراجع مستهدفه داخل تفاصيل الأداء.');end if;
  if v_patient_score is not null and v_patient_sample>=5 and v_patient_score<75 then v_steps:=v_steps||jsonb_build_array('راجع ملاحظات تجربة المرضى المتكررة وركز على وضوح التواصل وجودة الخدمة.');end if;
  if jsonb_array_length(v_steps)=0 and v_score is not null then v_steps:=jsonb_build_array('حافظ على مستوى الأداء الحالي وراقب الاتجاه مقارنة بالفترة السابقة.');end if;

  return jsonb_build_object('admin_id',subject,'name',v_name,'primary_role',v_primary_role,'roles',v_roles,'role_breakdown',v_role_breakdown,
    'from',p_from,'to',p_to,'score',v_score,'band',v_band,'provisional',v_provisional,'confidence',v_conf,'dimensions',v_dims,
    'issues',v_issues,'feedback',v_feedback,'improvement_steps',v_steps,'sample_total',v_total_sample,
    'method','تقييم ومتابعة وتوجيه فقط — لا يرتبط بالخصم أو الرواتب');
end $function$;

CREATE OR REPLACE FUNCTION public.staff_kpis(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(admin_id uuid, admin_name text, admin_role text, kpi text, value numeric, sample integer, target numeric, weight numeric, score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_days numeric;
begin
  if public.my_role() not in ('super_admin','general_manager') then raise exception 'غير مصرح'; end if;
  v_days := greatest(1, extract(epoch from (p_to - p_from)) / 86400.0);
  return query
  with ci as (
    select c.id, c.created_by, c.assigned_designer, c.created_at,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='initial_approval') as t_init,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='in_design') as t_design,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='final_approval') as t_final,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='ready_to_publish') as t_ready,
      exists(select 1 from public.activity_log a where a.content_id = c.id and a.to_stage = 'needs_revision') as had_rev
    from public.content_items c
  ),
  decisions as (
    select a.actor_id, a.created_at, a.from_stage, a.action,
           a.created_at - lag(a.created_at) over (partition by a.content_id order by a.created_at) as gap
    from public.activity_log a
  ),
  perf as (
    select c.created_by, cp.published_at,
           cp.engagement::numeric / nullif(avg(cp.engagement) over (partition by cp.brand), 0) as ratio
    from public.content_performance(120) cp join public.content_items c on c.id = cp.content_id
  ),
  fc as (
    select distinct on (l.id) l.id, l.received_at, s.changed_by, s.changed_at
    from public.leads l join public.lead_status_log s on s.lead_id = l.id and s.changed_at >= l.received_at
    where l.received_at >= p_from and l.received_at < p_to and s.changed_by is not null
    order by l.id, s.changed_at
  ),
  m(who, k, val, n) as (
    select created_by, 'content_created', count(*)::numeric, count(*)::int from ci where created_at >= p_from and created_at < p_to and created_by is not null group by created_by
    union all select created_by, 'first_pass_rate', 100*avg((not had_rev)::int), count(*)::int from ci where created_at >= p_from and created_at < p_to and t_ready is not null and created_by is not null group by created_by
    union all select created_by, 'idea_to_approval_hours', avg(extract(epoch from (t_ready - t_init))/3600), count(*)::int from ci where t_init >= p_from and t_init < p_to and t_ready >= t_init and created_by is not null group by created_by
    union all select created_by, 'post_engagement_ratio', avg(ratio), count(*)::int from perf where published_at >= p_from and published_at < p_to and ratio is not null and created_by is not null group by created_by
    union all select assigned_designer, 'designs_delivered', count(*)::numeric, count(*)::int from ci where t_final >= p_from and t_final < p_to and assigned_designer is not null group by assigned_designer
    union all select assigned_designer, 'design_turnaround_hours', avg(extract(epoch from (t_final - t_design))/3600), count(*)::int from ci where t_final >= p_from and t_final < p_to and t_design is not null and t_final >= t_design and assigned_designer is not null group by assigned_designer
    union all select assigned_designer, 'design_first_pass_rate', 100*avg((not had_rev)::int), count(*)::int from ci where t_final >= p_from and t_final < p_to and assigned_designer is not null group by assigned_designer
    union all select actor_id, 'approval_response_hours', avg(extract(epoch from gap)/3600), count(*)::int from decisions where gap is not null and created_at >= p_from and created_at < p_to and from_stage in ('initial_approval','final_approval') and (action in ('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%') and actor_id is not null group by actor_id
    union all select actor_id, 'approvals_done', count(*)::numeric, count(*)::int from decisions where created_at >= p_from and created_at < p_to and from_stage in ('initial_approval','final_approval') and (action in ('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%') and actor_id is not null group by actor_id
    union all select employee_id, 'lead_attempts', count(*)::numeric, count(*)::int from public.lead_attempts where attempt_date >= p_from and attempt_date < p_to and employee_id is not null group by employee_id
    union all select changed_by, 'lead_first_contact_minutes', avg(extract(epoch from (changed_at - received_at))/60), count(*)::int from fc group by changed_by
    union all select booked_by, 'bookings_made', count(*)::numeric, count(*)::int from public.leads where booked_by is not null and booking_date >= p_from::date and booking_date < p_to::date group by booked_by
    union all select assignee_id, 'tasks_on_time_rate', 100*avg((completed_at <= due_at)::int), count(*)::int from public.tasks where status = 'done' and completed_at >= p_from and completed_at < p_to and due_at is not null group by assignee_id
    union all select assignee_id, 'tasks_overdue_now', (count(*) filter (where due_at < now()))::numeric, count(*)::int from public.tasks where status not in ('done','cancelled') and assignee_id is not null group by assignee_id
  )
  select a.id, a.name, a.role, d.kpi, mm.val, coalesce(mm.n, 0),
         round(t.target * case when d.scales then v_days/30 else 1 end, 1), t.weight,
         case when mm.val is null or coalesce(mm.n, 0) < d.min_sample then null
              when d.direction = 'higher' then least(100, round(100 * mm.val / nullif(t.target * case when d.scales then v_days/30 else 1 end, 0), 1))
              else case when mm.val <= t.target then 100 else least(100, round(100 * t.target / nullif(mm.val, 0), 1)) end end
    from public.admins a
    join public.kpi_targets t on t.role = a.role
    join public.kpi_defs d on d.kpi = t.kpi
    left join m mm on mm.who = a.id and mm.k = d.kpi
   where a.active
   order by a.name, d.sort_order;
end $function$;

CREATE OR REPLACE FUNCTION public.task_generate_due_recurrences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.task_recurrences%rowtype; v_count integer:=0; v_next timestamptz; v_due timestamptz;
  v_task_id uuid; v_open boolean; v_guard integer;
begin
  for r in select * from public.task_recurrences where active and next_run_at<=now()
    and (ends_at is null or next_run_at::date<=ends_at) order by next_run_at for update skip locked
  loop
    select exists(select 1 from public.tasks t where t.recurrence_id=r.id and t.status not in ('done','cancelled')) into v_open;
    v_task_id:=null;
    if not v_open then
      v_due:=case when r.due_offset_days is null then null else now()+make_interval(days=>r.due_offset_days) end;
      insert into public.tasks(project_id,parent_task_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at,recurrence_id,recurrence_occurrence)
      values(r.project_id,r.parent_task_id,r.title,r.description,r.expected_output,r.assignee_id,r.created_by,'todo',r.priority,v_due,r.id,r.next_occurrence)
      on conflict (recurrence_id,recurrence_occurrence) where recurrence_id is not null do nothing
      returning id into v_task_id;
      if v_task_id is not null then
        insert into public.task_notifications(recipient_id,task_id,kind,message)
        values(r.assignee_id,v_task_id,'assigned','تم إنشاء المهمة الدورية: '||r.title) on conflict do nothing;
        v_count:=v_count+1;
      end if;
    end if;
    v_next:=public.task_recurrence_step(r.next_run_at,r.interval_value,r.interval_unit); v_guard:=0;
    while v_next<=now() and v_guard<1000 loop
      v_next:=public.task_recurrence_step(v_next,r.interval_value,r.interval_unit); v_guard:=v_guard+1;
    end loop;
    update public.task_recurrences set next_run_at=v_next,
      next_occurrence=next_occurrence+case when v_open then 0 else 1 end,
      active=(ends_at is null or v_next::date<=ends_at),updated_at=now() where id=r.id;
  end loop;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.task_notify_due_soon()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  insert into public.task_notifications(recipient_id, task_id, kind, message, reference_date)
    select t.assignee_id, t.id, 'due_soon', 'موعد المهمة خلال 24 ساعة: ' || t.title, current_date
      from public.tasks t
     where t.assignee_id is not null and t.status not in ('done','cancelled')
       and t.due_at > now() and t.due_at <= now() + interval '24 hours'
    on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;

CREATE OR REPLACE FUNCTION public.task_refresh_overdue_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
 if public.my_admin_id() is null then raise exception 'Authentication required';end if;
 insert into public.task_notifications(recipient_id,task_id,kind,message,reference_date)
 select public.my_admin_id(),t.id,'overdue','المهمة متأخرة: '||t.title,current_date from public.task_list_visible() t
 where t.status not in ('done','cancelled','review') and t.due_at<now() on conflict do nothing;
 get diagnostics n=row_count;return n;
end $function$;

CREATE OR REPLACE FUNCTION public.weekly_marketing_report_data(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,7), 31)));
  v_prev timestamptz := now() - make_interval(days => 2*greatest(1, least(coalesce(p_days,7), 31)));
  v_pub jsonb; v_totals jsonb; v_prev_totals jsonb; v_top jsonb; v_low jsonb; v_fmt jsonb; v_hours jsonb;
  v_sched jsonb; v_ads jsonb; v_leads jsonb; v_msgs jsonb; v_tasks jsonb; v_pending jsonb; v_followers jsonb;
begin
  -- المحتوى المنشور في الفترة (+ الروابط والأرقام)
  select coalesce(jsonb_agg(x order by x->>'published_at' desc), '[]'::jsonb) into v_pub from (
    select jsonb_build_object('id', c.id, 'title', c.title, 'brand', c.brand, 'format', c.content_format, 'published_at', c.published_at,
      'by_claude', c.created_by = 'a0fbdfee-d147-4282-b988-186a9ae3e88c', 'url', coalesce(j.facebook_permalink, j.instagram_permalink, c.published_url),
      'fb_url', j.facebook_permalink, 'ig_url', j.instagram_permalink,
      'reach', coalesce(i.fb_reach,0) + coalesce(i.ig_reach,0), 'views', coalesce(i.fb_views,0) + coalesce(i.ig_views,0),
      'reactions', coalesce(i.fb_reactions,0) + coalesce(i.ig_likes,0), 'comments', coalesce(i.fb_comments,0) + coalesce(i.ig_comments,0),
      'shares', coalesce(i.fb_shares,0) + coalesce(i.ig_shares,0), 'saves', coalesce(i.ig_saves,0),
      'interactions', coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)) x
    from public.content_items c
    left join public.post_insights i on i.content_id = c.id
    left join lateral (select facebook_permalink, instagram_permalink from public.meta_publish_jobs where content_id = c.id and status = 'published' order by published_at desc nulls last limit 1) j on true
    where c.stage = 'published' and c.published_at >= v_from and c.published_at <= v_to
  ) s;

  select jsonb_build_object('posts', count(*), 'reach', coalesce(sum(coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0)),0),
      'interactions', coalesce(sum(coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)),0),
      'claude_posts', count(*) filter (where c.created_by = 'a0fbdfee-d147-4282-b988-186a9ae3e88c'),
      'staff_posts', count(*) filter (where c.created_by <> 'a0fbdfee-d147-4282-b988-186a9ae3e88c'))
    into v_totals
    from public.content_items c left join public.post_insights i on i.content_id = c.id
   where c.stage = 'published' and c.published_at >= v_from and c.published_at <= v_to;
  select jsonb_build_object('posts', count(*), 'reach', coalesce(sum(coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0)),0),
      'interactions', coalesce(sum(coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)),0))
    into v_prev_totals
    from public.content_items c left join public.post_insights i on i.content_id = c.id
   where c.stage = 'published' and c.published_at >= v_prev and c.published_at < v_from;

  -- أفضل وأضعف 3 منشورات بالتفاعل
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_top from (select e as x from jsonb_array_elements(v_pub) e order by (e->>'interactions')::int desc limit 3) s;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_low from (select e as x from jsonb_array_elements(v_pub) e where (e->>'reach')::int > 0 order by (e->>'interactions')::numeric / nullif((e->>'reach')::numeric,0) asc nulls last limit 3) s;

  -- أداء كل نوع محتوى + أفضل ساعات النشر (توقيت القاهرة)
  select coalesce(jsonb_agg(jsonb_build_object('format', f, 'posts', n, 'avg_reach', round(r), 'avg_interactions', round(it)) order by it desc), '[]'::jsonb) into v_fmt from (
    select e->>'format' f, count(*) n, avg((e->>'reach')::numeric) r, avg((e->>'interactions')::numeric) it from jsonb_array_elements(v_pub) e group by 1) s;
  select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'posts', n, 'avg_interactions', round(it)) order by it desc), '[]'::jsonb) into v_hours from (
    select extract(hour from (e->>'published_at')::timestamptz at time zone 'Africa/Cairo')::int h, count(*) n, avg((e->>'interactions')::numeric) it from jsonb_array_elements(v_pub) e group by 1) s;

  -- المجدول للأسبوع الجاي
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'brand', brand, 'format', content_format, 'at', scheduled_publish_at) order by scheduled_publish_at), '[]'::jsonb) into v_sched
    from public.content_items where stage = 'scheduled' and scheduled_publish_at between v_to and v_to + interval '7 days';
  -- بانتظار الاعتماد/المراجعة
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'brand', brand, 'stage', stage, 'format', content_format, 'since', updated_at) order by updated_at), '[]'::jsonb) into v_pending
    from public.content_items where stage in ('initial_approval','final_approval','needs_revision','ready_to_publish');

  -- إعلانات (آخر استيراد من ميتا) + عدد النتائج
  select coalesce(jsonb_agg(jsonb_build_object('name', campaign_name, 'objective', objective, 'spent', amount_spent, 'reach', reach, 'results', results, 'indicator', result_indicator, 'cost_per_result', cost_per_result, 'ctr', ctr, 'from', reporting_start, 'to', reporting_end) order by amount_spent desc nulls last), '[]'::jsonb) into v_ads
    from public.ad_campaigns;

  -- ليدز الأسبوع (أعداد بس، من غير أي بيانات شخصية)
  select jsonb_build_object('new_leads', count(*) filter (where created_at >= v_from), 'from_ads', count(*) filter (where created_at >= v_from and (meta_campaign_id is not null or acquisition_type ilike '%ad%' or acquisition_type ilike '%paid%' or acquisition_type ilike '%إعلان%')),
      'booked', count(*) filter (where booking_date >= v_from::date and booking_date <= v_to::date),
      'prev_new_leads', count(*) filter (where created_at >= v_prev and created_at < v_from)) into v_leads from public.leads;
  select jsonb_build_object('messages', count(*) filter (where updated_at >= v_from), 'needing_reply', count(*) filter (where status = 'new')) into v_msgs from public.social_messages;

  -- متابعين (إدخال يدوي أسبوعي)
  select coalesce(jsonb_agg(jsonb_build_object('week', week_start, 'reach', reach, 'engagement_rate', engagement_rate, 'new_followers', new_followers) order by week_start desc), '[]'::jsonb) into v_followers
    from (select * from public.weekly_social_metrics order by week_start desc limit 4) w;

  -- مهام مشروع التسويق (حالة كل مهمة + مسؤولها)
  select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'status', t.status, 'assignee', a.name, 'due', t.due_at, 'overdue', t.status not in ('done','cancelled') and t.due_at < now(), 'updated_at', t.updated_at) order by t.due_at), '[]'::jsonb) into v_tasks
    from public.tasks t left join public.admins a on a.id = t.assignee_id
   where t.project_id = '1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32' and t.title <> 'التقرير الأسبوعي لتسويق سونو' and t.status <> 'cancelled';

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', greatest(1, least(coalesce(p_days,7), 31))),
    'totals', v_totals, 'previous_totals', v_prev_totals, 'published', v_pub, 'top_posts', v_top, 'weakest_posts', v_low,
    'by_format', v_fmt, 'by_hour_cairo', v_hours, 'scheduled_next_7_days', v_sched, 'waiting_approval', v_pending,
    'ads', v_ads, 'leads', v_leads, 'social_messages', v_msgs, 'weekly_social_metrics', v_followers, 'marketing_project_tasks', v_tasks);
end $function$;

CREATE OR REPLACE FUNCTION public.weekly_midweek_nudge()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.weekly_reports; total int; open_n int; rec record; n int := 0; mgr uuid;
  proj uuid := '1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32';
begin
  select * into r from public.weekly_reports where week_end >= current_date - 10 order by week_end desc, created_at desc limit 1;
  if not found then return 0; end if;
  select count(*), count(*) filter (where status not in ('done','cancelled')) into total, open_n
    from public.tasks where project_id = proj and description like '%[weekly:' || r.id || ':%' and status <> 'cancelled';
  if total = 0 or open_n = 0 then return 0; end if;
  select manager_id into mgr from public.task_projects where id = proj;
  for rec in
    select distinct on (assignee_id) assignee_id, id, title,
           count(*) over (partition by assignee_id) as mine
      from public.tasks
     where project_id = proj and description like '%[weekly:' || r.id || ':%' and status not in ('done','cancelled')
     order by assignee_id, due_at
  loop
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (rec.assignee_id, rec.id, 'due_soon', 'تذكير منتصف الأسبوع: عندك ' || rec.mine || ' من مقترحات تقرير الجمعة لسه مفتوحة — أقربها: ' || rec.title)
      on conflict do nothing;
    n := n + 1;
  end loop;
  if mgr is not null then
    select id into rec.id from public.tasks where project_id = proj and description like '%[weekly:' || r.id || ':%' and status not in ('done','cancelled') order by due_at limit 1;
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (mgr, rec.id, 'due_soon', 'منتصف الأسبوع: ' || open_n || ' من ' || total || ' مقترحات تقرير الجمعة لسه مفتوحة')
      on conflict do nothing;
    n := n + 1;
  end if;
  return n;
end $function$;

-- ---------- totals: cancelled tasks are not counted anywhere (owner «نشيل المهام الملغاة من العدد») ----------
CREATE OR REPLACE FUNCTION public.business_strategy_snapshot(p_period text DEFAULT 'week'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare from_ts timestamptz; result jsonb;
begin
 if not public.business_manager() then raise exception 'Management access required'; end if;
 from_ts:=case p_period when 'today' then date_trunc('day',now()) when 'month' then date_trunc('month',now()) else date_trunc('week',now()) end;
 select jsonb_build_object(
 'period',p_period,'generated_at',now(),
 'needs_decision',jsonb_build_object(
   'recommendations',coalesce((select jsonb_agg(to_jsonb(r) order by case r.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,r.created_at desc) from (select id,title,rationale,recommendation_type,priority,status,expected_metric,expected_direction,brand,specialty,service,measure_after,created_at from public.business_recommendations where status in ('proposed','approved') order by created_at desc limit 30) r),'[]'::jsonb),
   'decisions_due',coalesce((select jsonb_agg(to_jsonb(d) order by d.review_on,d.decided_at desc) from (select id,title,decision,reason,scope,expected_metric,review_on,status,decided_at from public.business_decisions where status in ('active','review_due') and review_on is not null and review_on<=current_date order by review_on,decided_at desc limit 30) d),'[]'::jsonb),
   'knowledge_review_due',coalesce((select jsonb_agg(to_jsonb(k) order by k.review_after) from (select id,knowledge_type,title,statement,status,confidence,review_after,expires_at from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and review_after is not null and review_after<=now() order by review_after limit 30) k),'[]'::jsonb)
 ),
 'opportunities',coalesce((select jsonb_agg(to_jsonb(k) order by (k.status='validated_by_data') desc,k.confidence desc,k.created_at desc) from (select id,knowledge_type,title,statement,status,confidence,confidence_reason,brand,specialty,service,audience,tags,review_after,expires_at,created_at from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and (expires_at is null or expires_at>now()) and knowledge_type in ('marketing_opportunity','service_insight','sales_insight','audience_insight','content_insight') order by (status='validated_by_data') desc,confidence desc,created_at desc limit 40) k),'[]'::jsonb),
 'recent_task_digest',coalesce((select jsonb_agg(to_jsonb(x) order by x.completed_at desc) from (select t.id,t.title,t.status,t.completed_at,t.due_at,p.id project_id,p.title project_title,a.id author_id,a.name author_name,wr.created_at result_created_at,case when wr.body is null then '' else left(regexp_replace(wr.body,E'[\\n\\r\\t ]+',' ','g'),420) end result_preview from public.tasks t left join public.task_projects p on p.id=t.project_id left join lateral (select w.* from public.task_work_results w where w.task_id=t.id and w.status='review' order by w.created_at desc limit 1) wr on true left join public.admins a on a.id=wr.author_id where t.completed_at>=from_ts and t.status<>'cancelled' order by t.completed_at desc limit 40) x),'[]'::jsonb),
 'top_campaigns',coalesce((select jsonb_agg(to_jsonb(x) order by x.cost_per_result asc nulls last,x.results desc) from (select c.id,c.campaign_name,round(coalesce(sum(p.spend),0),2) spend,round(coalesce(sum(p.results),0),2) results,round(coalesce(sum(p.leads),0),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cost_per_result,round(case when sum(p.leads)>0 then sum(p.spend)/sum(p.leads) end,2) cost_per_lead,round(case when sum(p.spend)>0 then sum(p.ctr*p.spend)/sum(p.spend) end,2) weighted_ctr,max(p.updated_at) performance_updated_at from public.meta_campaigns c join public.meta_ads a on a.campaign_id=c.id join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by c.id,c.campaign_name having sum(p.spend)>0 order by cost_per_result asc nulls last,results desc limit 15) x),'[]'::jsonb),
 'creative_signals',jsonb_build_object(
   'specialties',coalesce((select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc) from (select coalesce(nullif(trim(a.specialty),''),'غير مصنف') label,round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10) x),'[]'::jsonb),
   'angles',coalesce((select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc) from (select coalesce(nullif(trim(a.content_angle),''),'غير مصنف') label,round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10) x),'[]'::jsonb),
   'hooks',coalesce((select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc) from (select coalesce(nullif(trim(a.hook_type),''),'غير مصنف') label,round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10) x),'[]'::jsonb),
   'creative_types',coalesce((select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc) from (select coalesce(nullif(trim(a.creative_type),''),'غير مصنف') label,round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10) x),'[]'::jsonb),
   'ctas',coalesce((select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc) from (select coalesce(nullif(trim(a.cta_type),''),'غير مصنف') label,round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10) x),'[]'::jsonb)
 ),
 'attribution',jsonb_build_object('revenue_ready',false,'booked_meta_attributed',(select count(*) from public.vw_lead_meta_attribution v join public.leads l on l.id=v.lead_id where l.received_at>=from_ts and v.matched_meta_ad_id is not null and (l.booking_date is not null or l.booking_reference is not null)),'explanation','Meta spend/results are lifetime. Lead-to-booking attribution is available. Revenue/profit attribution is not yet deterministic, so ROAS is intentionally not calculated.')
 ) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION clinic_finance.home_inbox_before_inventory_stages()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid:=public.my_admin_id(); tasks jsonb:='[]'; contents jsonb; supplies jsonb; kpis jsonb:='[]'; notices jsonb; unread integer;
begin
 if not exists(select 1 from public.admins where id=me and active) then raise exception 'سجّل الدخول'; end if;
 if public.personal_home_tasks_allowed() then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into tasks from (
   select 'task:'||n.id::text key,'task' type,n.task_id id,n.created_at at,
   case when n.kind='assigned' then 'تم تعيين مهمة جديدة لك: '||t.title||'. برجاء البدء في التنفيذ في أقرب وقت.' else n.message end message,
   n.read_at is not null native_read
   from public.task_notifications n join public.tasks t on t.id=n.task_id join public.task_projects p on p.id=t.project_id
   where p.archived_at is null and n.recipient_id=me and t.status<>'cancelled' and public.task_can_access(n.task_id)
   order by n.created_at desc limit 40) x;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into contents from (
 select 'content:'||id::text||':'||stage||':'||extract(epoch from changed_at)::text key,'content' type,id,changed_at at,
 case bucket when 'approval' then 'مادة في انتظار اعتمادك: ' when 'revision' then 'مادة مطلوب تعديلها: ' when 'design' then 'مادة في انتظار التصميم: ' else 'مادة جاهزة للنشر: ' end||title message,false native_read
 from public.personal_home_content() where bucket in ('approval','revision','design','publish') order by changed_at desc limit 100) x;
 select coalesce(jsonb_agg(jsonb_build_object('key','supply:'||(r->>'id')||':'||(r->>'status')||':'||(r->>'at'),
 'type','supply','id',r->>'id','at',r->>'at','message',case when r->>'status'='pending' then 'طلب مستلزمات بانتظار الصرف — '||(r->>'requester_name') when r->>'status'='rejected' then 'تم رفض طلب المستلزمات؛ راجع ملاحظة المسؤول' else 'تم صرف مستلزماتك — برجاء تأكيد الاستلام' end,'native_read',false)),'[]')
 into supplies from jsonb_array_elements(public.personal_home_supplies()) r;
 if public.my_role() in ('super_admin','general_manager') then
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into kpis from (
   select 'kpi:'||a.id::text key,'kpi' type,a.id id,a.created_at at,a.message message,(a.acknowledged_at is not null) native_read
   from public.staff_kpi_alerts a where a.created_at > now()-interval '21 days' order by a.created_at desc limit 20) x;
 end if;
 with all_items as (select value n from jsonb_array_elements(tasks||contents||supplies||kpis)),
 marked as (select n||jsonb_build_object('read',coalesce((n->>'native_read')::boolean,false) or exists(select 1 from public.personal_notice_reads r where r.admin_id=me and r.notice_key=n->>'key')) n from all_items),
 latest as (select n from marked order by (n->>'at')::timestamptz desc limit 80)
 select coalesce(jsonb_agg(n order by (n->>'at')::timestamptz desc),'[]'),count(*) filter(where not (n->>'read')::boolean) into notices,unread from latest;
 return jsonb_build_object('notices',notices,'unread',unread,'limited',jsonb_array_length(tasks||contents||supplies||kpis)>80,'generated_at',now());
end $function$;
