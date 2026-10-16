-- Indicator reports -> persistent issues -> existing tasks -> measured outcomes.
-- Additive; does not replace task permissions or existing status RPCs.
create table if not exists public.operational_reports (
 id uuid primary key default gen_random_uuid(), fingerprint text not null unique,
 source text not null default 'sono-dashboard', branch text not null, scope text not null,
 period_from date not null, period_to date not null, title text not null,
 snapshot jsonb not null, source_approved_at timestamptz not null, source_actor text not null,
 received_at timestamptz not null default now(),check(period_to>=period_from)
);
create table if not exists public.operational_issues (
 id uuid primary key default gen_random_uuid(), source text not null, branch text not null, scope text not null, risk_key text not null,
 title text not null, area text not null, severity text not null,
 status text not null default 'open' check(status in ('open','persistent','reopened','observing','resolved')),
 first_period date not null,last_period date not null,last_period_to date not null,
 appearance_count integer not null default 1, resolved_after date,resolved_at timestamptz,
 latest_report_id uuid not null references public.operational_reports(id),
 advice jsonb,advice_at timestamptz,updated_at timestamptz not null default now(),
 unique(source,branch,scope,risk_key)
);
create table if not exists public.operational_observations (
 id uuid primary key default gen_random_uuid(),issue_id uuid not null references public.operational_issues(id),
 period_from date not null,period_to date not null,report_id uuid not null references public.operational_reports(id),
 risk jsonb not null, independent_period boolean not null default true,
 unique(issue_id,period_from,period_to)
);
create table if not exists public.operational_report_issues (
 report_id uuid references public.operational_reports(id),issue_id uuid references public.operational_issues(id),
 primary key(report_id,issue_id)
);
create table if not exists public.operational_actions (
 id uuid primary key default gen_random_uuid(),issue_id uuid not null references public.operational_issues(id),
 report_id uuid not null references public.operational_reports(id),task_id uuid not null unique references public.tasks(id) on delete restrict,
 title text not null,kind text not null check(kind in ('operations','content','finance','inventory','followup')),
 brand text not null default 'sono' check(brand in ('sono','dr_dina')),specialty text not null default '',
 brief text not null,expected_output text not null,
 assignee_id uuid not null references public.admins(id),approved_by uuid not null references public.admins(id),
 approved_at timestamptz not null default now(),measure_after date not null,
 active boolean not null default true
);
create table if not exists public.operational_outcomes (
 id uuid primary key default gen_random_uuid(),action_id uuid not null references public.operational_actions(id),
 report_id uuid not null references public.operational_reports(id),
 verdict text not null check(verdict in ('improved','unchanged','worse','resolved','inconclusive')),
 measured_value text not null,explanation text not null,reviewed_by uuid not null references public.admins(id),
 reviewed_at timestamptz not null default now(),unique(action_id,report_id)
);
create table if not exists public.operational_task_events (
 id uuid primary key default gen_random_uuid(),task_id uuid not null references public.tasks(id) on delete cascade,
 actor_id uuid,from_status text,to_status text,old_due_at timestamptz,new_due_at timestamptz,old_assignee_id uuid,new_assignee_id uuid,
 happened_at timestamptz not null default now()
);
create table if not exists public.operational_ai_requests (
 actor_id uuid not null references public.admins(id),requested_at timestamptz not null default now()
);
create index if not exists operational_ai_rate on public.operational_ai_requests(actor_id,requested_at);
create index if not exists operational_observations_issue on public.operational_observations(issue_id,period_from);
create or replace function public.operations_manager() returns boolean language sql stable security definer set search_path=public as $$
 select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('general_manager'));
$$;
-- Only managers see financial/report snapshots. Employees see their assigned task context.
do $$declare t text;begin
 foreach t in array array['operational_reports','operational_issues','operational_observations','operational_report_issues','operational_actions','operational_outcomes','operational_task_events','operational_ai_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
 end loop;
 foreach t in array array['operational_reports','operational_issues','operational_observations','operational_report_issues','operational_actions','operational_outcomes'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop policy if exists operations_manager_read on public.%I',t);
  execute format('create policy operations_manager_read on public.%I for select to authenticated using(public.operations_manager())',t);
 end loop;
end $$;
create or replace function public.operations_ingest_snapshot(p_snapshot jsonb,p_approved_at timestamptz,p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rid uuid; item jsonb; iid uuid; old public.operational_issues%rowtype; inserted integer; pf date;pt date; independent boolean;fp text;
begin
 fp:=p_snapshot->>'fingerprint';pf:=(p_snapshot->>'period_from')::date;pt:=(p_snapshot->>'period_to')::date;
 if p_snapshot->>'schema_version'<>'1' or fp !~ '^[0-9a-f]{64}$' or pf is null or pt is null or pt<pf or jsonb_typeof(p_snapshot->'risks')<>'array' or jsonb_array_length(p_snapshot->'risks')>200 then raise exception 'Invalid report snapshot';end if;
 perform pg_advisory_xact_lock(hashtextextended('operations-ingest',0));
 select id into rid from public.operational_reports where fingerprint=fp;
 if rid is not null then return jsonb_build_object('id',rid,'duplicate',true);end if;
 insert into public.operational_reports(fingerprint,branch,scope,period_from,period_to,title,snapshot,source_approved_at,source_actor)
 values(fp,p_snapshot->>'branch',p_snapshot->>'scope',pf,pt,p_snapshot->>'title',p_snapshot,p_approved_at,p_actor) returning id into rid;
 for item in select value from jsonb_array_elements(p_snapshot->'risks') loop
  if length(coalesce(item->>'id','')) not between 1 and 180 or length(coalesce(item->>'title','')) not between 1 and 500 then raise exception 'Invalid issue';end if;
  select * into old from public.operational_issues where source='sono-dashboard' and branch=p_snapshot->>'branch' and scope=p_snapshot->>'scope' and risk_key=item->>'id' for update;
  if not found then
   insert into public.operational_issues(source,branch,scope,risk_key,title,area,severity,first_period,last_period,last_period_to,latest_report_id)
   values('sono-dashboard',p_snapshot->>'branch',p_snapshot->>'scope',item->>'id',item->>'title',coalesce(item->>'area',''),coalesce(item->>'sev','medium'),pf,pf,pt,rid) returning id into iid;
   independent:=true;
  else
   iid:=old.id;
   -- Overlapping windows are evidence updates, not another independent recurrence.
   independent:=not exists(select 1 from public.operational_observations where issue_id=iid and period_from<=pt and period_to>=pf);
  end if;
  insert into public.operational_report_issues values(rid,iid);
  insert into public.operational_observations(issue_id,period_from,period_to,report_id,risk,independent_period)
   values(iid,pf,pt,rid,item,independent) on conflict(issue_id,period_from,period_to) do nothing;
  get diagnostics inserted=row_count;
  -- A late delivery/backfill never replaces more recent evidence or reopens a resolved issue.
  if old.id is not null then
   if pt>=old.last_period_to and p_approved_at >= (select source_approved_at from public.operational_reports where id=old.latest_report_id) then
    update public.operational_observations set report_id=rid,risk=item where issue_id=iid and period_from=pf and period_to=pt;
    update public.operational_issues set title=item->>'title',area=coalesce(item->>'area',''),severity=coalesce(item->>'sev','medium'),
     status=case when old.status='resolved' and (pf>old.resolved_after or (pt>=old.resolved_after and p_approved_at>old.resolved_at)) then 'reopened' when old.status in ('resolved','observing','reopened') then old.status when old.appearance_count+case when independent and inserted=1 then 1 else 0 end>1 then 'persistent' else 'open' end,
     latest_report_id=rid,last_period=pf,last_period_to=pt,updated_at=now() where id=iid;
   end if;
   update public.operational_issues set first_period=least(first_period,pf),appearance_count=appearance_count+case when independent and inserted=1 then 1 else 0 end where id=iid;
  end if;
  old:=null;
 end loop;
 return jsonb_build_object('id',rid,'duplicate',false);
end $$;
-- This function is callable only by the authenticated HMAC receiver's server client.
revoke all on function public.operations_ingest_snapshot(jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.operations_ingest_snapshot(jsonb,timestamptz,text) to service_role;

-- Event timing preserves the employee submission separately from managerial acceptance.
alter table public.tasks add column if not exists original_due_at timestamptz;
alter table public.tasks add column if not exists first_submitted_at timestamptz;
alter table public.tasks add column if not exists first_submission_due_at timestamptz;
alter table public.tasks add column if not exists latest_submitted_at timestamptz;
alter table public.tasks add column if not exists work_started_at timestamptz;
create or replace function public.operations_task_timing() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then
  new.original_due_at:=new.due_at;new.first_submitted_at:=null;new.first_submission_due_at:=null;new.latest_submitted_at:=null;new.work_started_at:=null;
 else
  if new.status='done' and old.status<>'done' and exists(select 1 from public.operational_actions where task_id=old.id) and exists(select 1 from public.tasks where parent_task_id=old.id and status<>'done') then raise exception 'اعتمد كل مراحل المهمة قبل اعتماد اكتمالها';end if;
  new.original_due_at:=coalesce(old.original_due_at,old.due_at);
  new.first_submitted_at:=old.first_submitted_at;new.first_submission_due_at:=old.first_submission_due_at;new.latest_submitted_at:=old.latest_submitted_at;new.work_started_at:=old.work_started_at;
  if new.status='in_progress' and old.status is distinct from new.status then new.work_started_at:=coalesce(old.work_started_at,now());end if;
  if new.status='review' and old.status is distinct from new.status then new.first_submitted_at:=coalesce(old.first_submitted_at,now());new.first_submission_due_at:=case when old.first_submitted_at is null then old.due_at else old.first_submission_due_at end;new.latest_submitted_at:=now();end if;
  if old.status is distinct from new.status or old.due_at is distinct from new.due_at or old.assignee_id is distinct from new.assignee_id then
   insert into public.operational_task_events(task_id,actor_id,from_status,to_status,old_due_at,new_due_at,old_assignee_id,new_assignee_id) values(old.id,public.my_admin_id(),old.status,new.status,old.due_at,new.due_at,old.assignee_id,new.assignee_id);
  end if;
 end if;return new;
end $$;
drop trigger if exists operations_task_timing on public.tasks;
create trigger operations_task_timing before insert or update on public.tasks for each row execute function public.operations_task_timing();

create or replace function public.operations_create_action(p_issue_id uuid,p_project_id uuid,p_title text,p_brief text,p_output text,p_assignee uuid,p_due timestamptz,p_measure_after date,p_kind text,p_brand text,p_specialty text,p_steps jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare issue public.operational_issues%rowtype;tid uuid;aid uuid;child uuid;st jsonb;prior_due timestamptz;step_due timestamptz;step_owner uuid;
begin
 if not public.operations_manager() or not public.task_can_manage_project(p_project_id) then raise exception 'غير مسموح باعتماد التكليف';end if;
 select * into issue from public.operational_issues where id=p_issue_id for update;
 if not found or issue.status='resolved' then raise exception 'اختر مشكلة مفتوحة';end if;
 if length(trim(p_title)) not between 2 and 180 or length(trim(p_brief)) not between 2 and 4000 or length(trim(p_output)) not between 2 and 2000 or p_due is null or p_due<=now() or p_measure_after<p_due::date or p_measure_after is null then raise exception 'أكمل التكليف والموعد وموعد قياس النتيجة';end if;
 if p_kind not in ('operations','content','finance','inventory','followup') or p_brand not in ('sono','dr_dina') then raise exception 'نوع التكليف غير صالح';end if;
 if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps) not between 1 and 12 then raise exception 'أضف من مرحلة إلى 12 مرحلة';end if;
 if exists(select 1 from public.operational_actions a join public.tasks t on t.id=a.task_id where a.issue_id=p_issue_id and a.active and (t.status<>'done' or not exists(select 1 from public.operational_outcomes o where o.action_id=a.id)) and lower(trim(a.title))=lower(trim(p_title))) then raise exception 'التكليف موجود أو ينتظر قياس الأثر؛ تابع تقدمه بدل تكراره';end if;
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
end $$;
create or replace function public.operations_record_outcome(p_action_id uuid,p_report_id uuid,p_verdict text,p_value text,p_explanation text)
returns uuid language plpgsql security definer set search_path=public as $$
declare a public.operational_actions%rowtype;i public.operational_issues%rowtype;r public.operational_reports%rowtype;oid uuid;
begin
 if not public.operations_manager() then raise exception 'اعتماد النتيجة للإدارة فقط';end if;
 select * into a from public.operational_actions where id=p_action_id for update;
 if not found then raise exception 'التكليف غير موجود';end if;
 select * into i from public.operational_issues where id=a.issue_id for update;
 select * into r from public.operational_reports where id=p_report_id;
 if now()::date<a.measure_after then raise exception 'لم يحن موعد قياس الأثر';end if;
 if not found or r.source<>i.source or r.branch<>i.branch or r.scope<>i.scope or r.period_to<greatest(a.measure_after,(select completed_at::date from public.tasks where id=a.task_id)) or r.period_from<=(select period_to from public.operational_reports where id=a.report_id) then raise exception 'اختر تقرير متابعة لنفس الفرع والنطاق بعد موعد القياس';end if;
 if (select status from public.tasks where id=a.task_id)<>'done' then raise exception 'اعتمد تنفيذ المهمة قبل قياس أثرها';end if;
 if p_verdict not in ('improved','unchanged','worse','resolved','inconclusive') or length(trim(p_value)) not between 1 and 200 or length(trim(p_explanation)) not between 5 and 4000 then raise exception 'أكمل القياس وسبب الحكم';end if;
 insert into public.operational_outcomes(action_id,report_id,verdict,measured_value,explanation,reviewed_by)
 values(a.id,r.id,p_verdict,p_value,p_explanation,public.my_admin_id()) returning id into oid;
 -- An old measurement is retained as history but cannot close a newer observation.
 if r.period_to>=i.last_period_to then
  update public.operational_issues set status=case when p_verdict='resolved' then 'resolved' when p_verdict in ('improved','inconclusive') then 'observing' else 'persistent' end,
  resolved_after=case when p_verdict='resolved' then r.period_to else null end,resolved_at=case when p_verdict='resolved' then now() else null end,updated_at=now() where id=i.id;
 end if;
 return oid;
end $$;
create or replace function public.operations_issue_detail(p_issue_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.operations_manager() then raise exception 'غير مسموح';end if;
 select jsonb_build_object('issue',to_jsonb(i),'report',(select to_jsonb(r) from operational_reports r where r.id=i.latest_report_id),
 'observations',coalesce((select jsonb_agg(to_jsonb(o) order by o.period_from desc) from operational_observations o where o.issue_id=i.id),'[]'),
 'actions',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('task_status',t.status,'submitted_at',t.latest_submitted_at,'first_submitted_at',t.first_submitted_at,'accepted_at',t.completed_at,'due_at',t.due_at,'original_due_at',t.original_due_at,
 'employee_late_seconds',case when t.first_submitted_at is not null and t.first_submission_due_at is not null then greatest(0,extract(epoch from t.first_submitted_at-t.first_submission_due_at)) end,
 'review_wait_seconds',case when t.latest_submitted_at is not null and t.status in ('review','done') then greatest(0,extract(epoch from coalesce(t.completed_at,now())-t.latest_submitted_at)) end) order by a.approved_at desc) from operational_actions a join tasks t on t.id=a.task_id where a.issue_id=i.id),'[]'),
 'outcomes',coalesce((select jsonb_agg(to_jsonb(o) order by o.reviewed_at desc) from operational_outcomes o join operational_actions a on a.id=o.action_id where a.issue_id=i.id),'[]')) into result from operational_issues i where id=p_issue_id;
 return result;
end $$;
create or replace function public.operations_task_context(p_task_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.task_can_access(p_task_id) then raise exception 'غير مسموح';end if;
 select jsonb_build_object('issue_title',i.title,'appearances',i.appearance_count,'issue_status',i.status,'measure_after',a.measure_after,'submitted_at',t.latest_submitted_at,'original_due_at',t.original_due_at,'accepted_at',t.completed_at,'due_at',t.due_at)
 into result from operational_actions a join operational_issues i on i.id=a.issue_id join tasks t on t.id=p_task_id where a.task_id=p_task_id or a.task_id=t.parent_task_id;
 return result;
end $$;
create or replace function public.operations_content_brief(p_brand text,p_specialty text default '') returns text language sql stable security definer set search_path=public as $$
 select coalesce(string_agg('تكليف معتمد: '||a.title||E'\nالمطلوب: '||a.brief||E'\nالمخرج: '||a.expected_output||E'\nخبرة التنفيذ السابقة (أحكام الإدارة وليست إثبات سببية): '||coalesce((select string_agg(o.verdict||': '||o.explanation,' / ') from operational_outcomes o where o.action_id=a.id),'لم يقس الأثر بعد'),E'\n\n'),'')
 from (select x.* from operational_actions x join tasks t on t.id=x.task_id where x.kind='content' and x.active and x.brand=p_brand and (x.specialty='' or x.specialty=coalesce(p_specialty,''))
 and public.my_admin_id() is not null and public.task_can_access(x.task_id) and t.status<>'done' order by x.approved_at desc limit 5) a;
$$;
-- Privileged worker queue: external agents receive only their approved assignments.
create or replace function public.operations_agent_brief(p_assignee uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('action_id',a.id,'task_id',a.task_id,'title',a.title,'brief',a.brief,'expected_output',a.expected_output,'brand',a.brand,'specialty',a.specialty,'due_at',t.due_at)),'[]') from operational_actions a join tasks t on t.id=a.task_id join admins u on u.id=t.assignee_id where t.assignee_id=p_assignee and u.active and a.active and a.kind='content' and t.status in ('todo','in_progress','revision');
$$;
revoke all on function public.operations_agent_brief(uuid) from public,anon,authenticated;
grant execute on function public.operations_agent_brief(uuid) to service_role;
create or replace function public.operations_advice_limit() returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not public.operations_manager() then raise exception 'غير مسموح';end if;
 perform pg_advisory_xact_lock(hashtextextended(public.my_admin_id()::text,1));
 if (select count(*) from operational_ai_requests where actor_id=public.my_admin_id() and requested_at>now()-interval '1 day')>=20 then return false;end if;
 insert into operational_ai_requests(actor_id) values(public.my_admin_id());return true;
end $$;
create or replace function public.operations_save_advice(p_issue_id uuid,p_advice jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.operations_manager() then raise exception 'غير مسموح';end if;
 if length(p_advice::text)>30000 or jsonb_typeof(p_advice)<>'object' then raise exception 'مقترح غير صالح';end if;
 update operational_issues set advice=p_advice,advice_at=now() where id=p_issue_id;
end $$;
-- Explicit grants for every user-callable function; no anonymous defaults.
do $$declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('operations_manager','operations_create_action','operations_record_outcome','operations_issue_detail','operations_task_context','operations_content_brief','operations_advice_limit','operations_save_advice') loop
 execute format('revoke all on function %s from public,anon',f);execute format('grant execute on function %s to authenticated',f);
 end loop;
end $$;
revoke all on function public.operations_task_timing() from public,anon,authenticated;

-- Preserve the current home implementation and its extra modules; correct only timing counters.
create or replace function public.operations_home_snapshot() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare b jsonb;mine_late integer;team_late integer;
begin
 b:=public.personal_home_snapshot();
 if b->'tasks' is not null and b->'tasks'<>'null'::jsonb then
  select count(*) filter(where (t.assignee_id=public.my_admin_id() or not t.can_manage)),count(*) filter(where t.can_manage)
  into mine_late,team_late from public.task_list_visible() t join public.task_projects p on p.id=t.project_id
  where p.archived_at is null and t.status not in ('done','review') and t.due_at<now();
  b:=jsonb_set(jsonb_set(b,'{tasks,late}',to_jsonb(mine_late)),'{tasks,team_late}',to_jsonb(team_late));
 end if;return b;
end $$;
revoke all on function public.operations_home_snapshot() from public,anon;
grant execute on function public.operations_home_snapshot() to authenticated;
create or replace function public.task_refresh_overdue_notifications() returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if public.my_admin_id() is null then raise exception 'Authentication required';end if;
 insert into public.task_notifications(recipient_id,task_id,kind,message,reference_date)
 select public.my_admin_id(),t.id,'overdue','المهمة متأخرة: '||t.title,current_date from public.task_list_visible() t
 where t.status not in ('done','review') and t.due_at<now() on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function public.task_refresh_overdue_notifications() from public,anon;
grant execute on function public.task_refresh_overdue_notifications() to authenticated;
