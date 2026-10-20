-- SSMPD Business Intelligence Brain
-- Additive foundation on top of tasks, operations, content learning, Meta Ads and staff KPIs.
-- External AI stays OFF by default. The database stores an auditable queue and approved knowledge.

create table if not exists public.business_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  knowledge_type text not null check (knowledge_type in (
    'audience_insight','customer_pain','content_insight','marketing_opportunity',
    'competitor_insight','operational_issue','recommendation','kpi','risk',
    'hypothesis','decision','result','brand_rule','service_insight','sales_insight'
  )),
  memory_layer text not null default 'dynamic' check (memory_layer in ('stable','dynamic','decision','result')),
  title text not null check (length(trim(title)) between 2 and 240),
  statement text not null check (length(trim(statement)) between 2 and 8000),
  status text not null default 'draft' check (status in (
    'draft','ai_extracted','employee_confirmed','manager_approved',
    'validated_by_data','outdated','superseded'
  )),
  confidence numeric(5,4) not null default 0.50 check (confidence between 0 and 1),
  confidence_reason text,
  brand text not null default '',
  specialty text not null default '',
  service text not null default '',
  audience text not null default '',
  source_type text not null default 'manual' check (source_type in (
    'manual','task_result','operations_report','content_performance','ad_performance',
    'lead_analysis','finance','customer_interaction','employee_review','decision','result'
  )),
  source_task_id uuid references public.tasks(id) on delete set null,
  source_result_id uuid references public.task_work_results(id) on delete set null,
  source_project_id uuid references public.task_projects(id) on delete set null,
  source_author_id uuid references public.admins(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  valid_from timestamptz not null default now(),
  last_validated_at timestamptz,
  review_after timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.business_knowledge_items(id) on delete set null,
  created_by uuid references public.admins(id) on delete set null,
  approved_by uuid references public.admins(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_knowledge_status_idx on public.business_knowledge_items(status, knowledge_type, created_at desc);
create index if not exists business_knowledge_scope_idx on public.business_knowledge_items(brand, specialty, service, created_at desc);
create index if not exists business_knowledge_source_idx on public.business_knowledge_items(source_task_id, source_result_id);
create index if not exists business_knowledge_review_idx on public.business_knowledge_items(review_after) where status in ('manager_approved','validated_by_data');

create table if not exists public.business_knowledge_relations (
  id uuid primary key default gen_random_uuid(),
  from_item_id uuid not null references public.business_knowledge_items(id) on delete cascade,
  to_item_id uuid not null references public.business_knowledge_items(id) on delete cascade,
  relation_type text not null check (relation_type in (
    'supports','contradicts','caused_action','validated_by','supersedes','related_to',
    'targets_audience','targets_service','derived_from','led_to_result'
  )),
  note text,
  created_by uuid references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(from_item_id,to_item_id,relation_type),
  check (from_item_id <> to_item_id)
);

create table if not exists public.business_recommendations (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 240),
  rationale text not null check (length(trim(rationale)) between 2 and 8000),
  recommendation_type text not null default 'marketing' check (recommendation_type in (
    'content','marketing','ads','operations','sales','finance','staff','customer_experience'
  )),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'proposed' check (status in ('proposed','approved','converted_to_task','measuring','validated','rejected','closed')),
  brand text not null default '',
  specialty text not null default '',
  service text not null default '',
  expected_metric text,
  expected_direction text check (expected_direction is null or expected_direction in ('up','down','maintain','learn')),
  source_knowledge_ids uuid[] not null default '{}',
  task_id uuid references public.tasks(id) on delete set null,
  operational_action_id uuid references public.operational_actions(id) on delete set null,
  proposed_by uuid references public.admins(id) on delete set null,
  approved_by uuid references public.admins(id) on delete set null,
  approved_at timestamptz,
  measure_after date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_recommendations_status_idx on public.business_recommendations(status, priority, created_at desc);
create index if not exists business_recommendations_task_idx on public.business_recommendations(task_id) where task_id is not null;

create table if not exists public.business_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 240),
  decision text not null check (length(trim(decision)) between 2 and 8000),
  reason text not null default '',
  scope text not null default 'business' check (scope in ('business','marketing','content','ads','operations','finance','staff','customer_experience')),
  source_knowledge_ids uuid[] not null default '{}',
  recommendation_id uuid references public.business_recommendations(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  expected_metric text,
  review_on date,
  status text not null default 'active' check (status in ('active','review_due','completed','reversed','superseded')),
  decided_by uuid references public.admins(id) on delete set null,
  decided_at timestamptz not null default now(),
  result_summary text,
  learning text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_decisions_status_idx on public.business_decisions(status, review_on, decided_at desc);

create table if not exists public.business_measurements (
  id uuid primary key default gen_random_uuid(),
  knowledge_item_id uuid references public.business_knowledge_items(id) on delete set null,
  recommendation_id uuid references public.business_recommendations(id) on delete set null,
  decision_id uuid references public.business_decisions(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  metric text not null,
  baseline_value numeric,
  measured_value numeric,
  unit text not null default '',
  verdict text not null check (verdict in ('improved','unchanged','worse','resolved','inconclusive','learned')),
  explanation text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  measured_by uuid references public.admins(id) on delete set null,
  measured_at timestamptz not null default now()
);

create index if not exists business_measurements_links_idx on public.business_measurements(recommendation_id, decision_id, task_id, measured_at desc);

create table if not exists public.business_extraction_queue (
  id uuid primary key default gen_random_uuid(),
  source_result_id uuid not null references public.task_work_results(id) on delete cascade unique,
  task_id uuid not null references public.tasks(id) on delete cascade,
  project_id uuid references public.task_projects(id) on delete set null,
  author_id uuid references public.admins(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','processing','done','skipped','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  last_error text,
  queued_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists business_extraction_queue_status_idx on public.business_extraction_queue(status, queued_at);

alter table public.business_knowledge_items enable row level security;
alter table public.business_knowledge_relations enable row level security;
alter table public.business_recommendations enable row level security;
alter table public.business_decisions enable row level security;
alter table public.business_measurements enable row level security;
alter table public.business_extraction_queue enable row level security;

-- Explicit Data API grants. Supabase stops auto-exposing new public tables in Oct 2026.
grant select,insert,update on public.business_knowledge_items to authenticated;
grant select,insert,update on public.business_knowledge_relations to authenticated;
grant select,insert,update on public.business_recommendations to authenticated;
grant select,insert,update on public.business_decisions to authenticated;
grant select,insert,update on public.business_measurements to authenticated;
grant select on public.business_extraction_queue to authenticated;
grant all on public.business_knowledge_items, public.business_knowledge_relations, public.business_recommendations,
  public.business_decisions, public.business_measurements, public.business_extraction_queue to service_role;

create or replace function public.business_manager()
returns boolean language sql stable security definer set search_path='public'
as $$ select public.operations_manager(); $$;

revoke all on function public.business_manager() from public;
grant execute on function public.business_manager() to authenticated, service_role;

create policy "business managers read knowledge" on public.business_knowledge_items for select to authenticated using (public.business_manager());
create policy "business managers create knowledge" on public.business_knowledge_items for insert to authenticated with check (public.business_manager());
create policy "business managers update knowledge" on public.business_knowledge_items for update to authenticated using (public.business_manager()) with check (public.business_manager());
create policy "business managers read relations" on public.business_knowledge_relations for select to authenticated using (public.business_manager());
create policy "business managers create relations" on public.business_knowledge_relations for insert to authenticated with check (public.business_manager());
create policy "business managers update relations" on public.business_knowledge_relations for update to authenticated using (public.business_manager()) with check (public.business_manager());
create policy "business managers read recommendations" on public.business_recommendations for select to authenticated using (public.business_manager());
create policy "business managers create recommendations" on public.business_recommendations for insert to authenticated with check (public.business_manager());
create policy "business managers update recommendations" on public.business_recommendations for update to authenticated using (public.business_manager()) with check (public.business_manager());
create policy "business managers read decisions" on public.business_decisions for select to authenticated using (public.business_manager());
create policy "business managers create decisions" on public.business_decisions for insert to authenticated with check (public.business_manager());
create policy "business managers update decisions" on public.business_decisions for update to authenticated using (public.business_manager()) with check (public.business_manager());
create policy "business managers read measurements" on public.business_measurements for select to authenticated using (public.business_manager());
create policy "business managers create measurements" on public.business_measurements for insert to authenticated with check (public.business_manager());
create policy "business managers update measurements" on public.business_measurements for update to authenticated using (public.business_manager()) with check (public.business_manager());
create policy "business managers read extraction queue" on public.business_extraction_queue for select to authenticated using (public.business_manager());

-- External analysis of employee report text remains disabled until management explicitly approves that data transfer.
create or replace function public.business_ai_enabled()
returns boolean language sql stable set search_path=''
as $$ select false; $$;
grant execute on function public.business_ai_enabled() to authenticated, service_role;

create or replace function public.business_touch_updated_at()
returns trigger language plpgsql set search_path='public'
as $$ begin new.updated_at=now(); return new; end $$;

create trigger business_knowledge_touch before update on public.business_knowledge_items for each row execute function public.business_touch_updated_at();
create trigger business_recommendations_touch before update on public.business_recommendations for each row execute function public.business_touch_updated_at();
create trigger business_decisions_touch before update on public.business_decisions for each row execute function public.business_touch_updated_at();

-- A completed task is queued once. No external call happens inside the trigger.
create or replace function public.business_queue_completed_task()
returns trigger language plpgsql security definer set search_path='public'
as $$
declare r public.task_work_results%rowtype;
begin
  if new.status='done' and old.status is distinct from new.status then
    select * into r from public.task_work_results
    where task_id=new.id and status='review'
    order by created_at desc limit 1;
    if found then
      insert into public.business_extraction_queue(source_result_id,task_id,project_id,author_id)
      values(r.id,new.id,new.project_id,r.author_id)
      on conflict(source_result_id) do nothing;
    end if;
  end if;
  return new;
end $$;

create trigger business_queue_task_done after update of status on public.tasks
for each row execute function public.business_queue_completed_task();

-- Manager review makes the confidence lifecycle explicit and auditable.
create or replace function public.business_knowledge_review(
  p_id uuid, p_status text, p_confidence numeric default null, p_reason text default null,
  p_review_after timestamptz default null, p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='public'
as $$
declare actor uuid:=public.my_admin_id(); row public.business_knowledge_items%rowtype;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  if p_status not in ('employee_confirmed','manager_approved','validated_by_data','outdated','superseded') then raise exception 'Invalid knowledge status'; end if;
  update public.business_knowledge_items set
    status=p_status,
    confidence=coalesce(p_confidence,confidence),
    confidence_reason=coalesce(nullif(trim(coalesce(p_reason,'')),''),confidence_reason),
    last_validated_at=case when p_status in ('manager_approved','validated_by_data') then now() else last_validated_at end,
    review_after=coalesce(p_review_after,review_after), expires_at=coalesce(p_expires_at,expires_at),
    approved_by=case when p_status in ('manager_approved','validated_by_data') then actor else approved_by end,
    approved_at=case when p_status in ('manager_approved','validated_by_data') then now() else approved_at end
  where id=p_id returning * into row;
  if not found then raise exception 'Knowledge item not found'; end if;
  return to_jsonb(row);
end $$;
revoke all on function public.business_knowledge_review(uuid,text,numeric,text,timestamptz,timestamptz) from public;
grant execute on function public.business_knowledge_review(uuid,text,numeric,text,timestamptz,timestamptz) to authenticated;

-- Converts an approved recommendation into the existing task workflow. No parallel task system.
create or replace function public.business_recommendation_to_task(
  p_id uuid, p_project_id uuid, p_assignee uuid, p_due timestamptz,
  p_expected_output text default '', p_priority text default 'medium'
) returns uuid language plpgsql security definer set search_path='public'
as $$
declare r public.business_recommendations%rowtype; tid uuid;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  select * into r from public.business_recommendations where id=p_id for update;
  if not found then raise exception 'Recommendation not found'; end if;
  if r.status not in ('proposed','approved') then raise exception 'Recommendation already processed'; end if;
  tid:=public.task_create(p_project_id,null,r.title,r.rationale,coalesce(nullif(trim(p_expected_output),''),coalesce(r.expected_metric,'نتيجة قابلة للقياس')),p_assignee,p_due,p_priority);
  update public.business_recommendations set task_id=tid,status='converted_to_task',approved_by=public.my_admin_id(),approved_at=coalesce(approved_at,now()) where id=p_id;
  return tid;
end $$;
revoke all on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) from public;
grant execute on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) to authenticated;

create or replace function public.business_decision_save(
 p_title text,p_decision text,p_reason text,p_scope text,p_recommendation uuid default null,
 p_task uuid default null,p_expected_metric text default null,p_review_on date default null,p_source_knowledge_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path='public'
as $$ declare v uuid; begin
 if not public.business_manager() then raise exception 'Management access required'; end if;
 insert into public.business_decisions(title,decision,reason,scope,recommendation_id,task_id,expected_metric,review_on,source_knowledge_ids,decided_by)
 values(trim(p_title),trim(p_decision),trim(coalesce(p_reason,'')),p_scope,p_recommendation,p_task,p_expected_metric,p_review_on,coalesce(p_source_knowledge_ids,'{}'),public.my_admin_id()) returning id into v;
 return v;
end $$;
revoke all on function public.business_decision_save(text,text,text,text,uuid,uuid,text,date,uuid[]) from public;
grant execute on function public.business_decision_save(text,text,text,text,uuid,uuid,text,date,uuid[]) to authenticated;

create or replace function public.business_measurement_save(
 p_recommendation uuid,p_decision uuid,p_task uuid,p_knowledge uuid,p_metric text,
 p_baseline numeric,p_measured numeric,p_unit text,p_verdict text,p_explanation text,p_evidence jsonb default '{}'
) returns uuid language plpgsql security definer set search_path='public'
as $$ declare v uuid; begin
 if not public.business_manager() then raise exception 'Management access required'; end if;
 insert into public.business_measurements(recommendation_id,decision_id,task_id,knowledge_item_id,metric,baseline_value,measured_value,unit,verdict,explanation,evidence,measured_by)
 values(p_recommendation,p_decision,p_task,p_knowledge,trim(p_metric),p_baseline,p_measured,coalesce(p_unit,''),p_verdict,coalesce(p_explanation,''),coalesce(p_evidence,'{}'),public.my_admin_id()) returning id into v;
 if p_recommendation is not null then update public.business_recommendations set status=case when p_verdict in ('improved','resolved','learned') then 'validated' else 'measuring' end where id=p_recommendation; end if;
 if p_decision is not null then update public.business_decisions set result_summary=trim(coalesce(p_explanation,'')),reviewed_at=now(),status='completed' where id=p_decision; end if;
 if p_knowledge is not null and p_verdict in ('improved','resolved','learned') then update public.business_knowledge_items set status='validated_by_data',last_validated_at=now(),approved_by=coalesce(approved_by,public.my_admin_id()),approved_at=coalesce(approved_at,now()) where id=p_knowledge and status not in ('outdated','superseded'); end if;
 return v;
end $$;
revoke all on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) from public;
grant execute on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) to authenticated;

-- Approved knowledge only. Raw report text never enters content generation.
create or replace function public.business_content_brief(p_brand text,p_specialty text default '')
returns text language sql stable security definer set search_path='public'
as $$
select case when public.my_admin_id() is null then '' else coalesce(string_agg(line,E'\n'),'') end
from (
  select '- ['||knowledge_type||'] '||title||': '||left(statement,900)||
         ' | الثقة '||round(confidence*100)||'%'||
         case when expires_at is not null then ' | صالح حتى '||expires_at::date else '' end as line
  from public.business_knowledge_items
  where status in ('manager_approved','validated_by_data')
    and (expires_at is null or expires_at>now())
    and (brand='' or brand=coalesce(p_brand,''))
    and (specialty='' or specialty=coalesce(p_specialty,''))
    and knowledge_type in ('audience_insight','customer_pain','content_insight','marketing_opportunity','service_insight','sales_insight','brand_rule','hypothesis')
  order by (status='validated_by_data') desc,confidence desc,last_validated_at desc nulls last,created_at desc
  limit 14
) q;
$$;
revoke all on function public.business_content_brief(text,text) from public;
grant execute on function public.business_content_brief(text,text) to authenticated;

-- One source for the owner screen. This intentionally aggregates rather than returning patient or lead identities.
create or replace function public.business_owner_snapshot(p_period text default 'week')
returns jsonb language plpgsql stable security definer set search_path='public'
as $$
declare
  from_ts timestamptz;
  result jsonb;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  from_ts:=case p_period when 'today' then date_trunc('day',now()) when 'month' then date_trunc('month',now()) else date_trunc('week',now()) end;
  select jsonb_build_object(
    'period',p_period,'from',from_ts,'generated_at',now(),
    'tasks',jsonb_build_object(
      'completed',(select count(*) from public.tasks where completed_at>=from_ts),
      'overdue',(select count(*) from public.tasks where status not in ('done','review') and due_at<now()),
      'review',(select count(*) from public.tasks where status='review'),
      'revision',(select count(*) from public.tasks where status='revision'),
      'blocked',(select count(*) from public.tasks where status='blocked')
    ),
    'projects',coalesce((select jsonb_agg(x order by (x->>'progress')::numeric asc) from (
      select jsonb_build_object('id',p.id,'title',p.title,'total',count(t.id),'done',count(t.id) filter(where t.status='done'),
        'overdue',count(t.id) filter(where t.status not in ('done','review') and t.due_at<now()),
        'progress',case when count(t.id)=0 then 0 else round(100.0*count(t.id) filter(where t.status='done')/count(t.id),1) end) x
      from public.task_projects p left join public.tasks t on t.project_id=p.id where p.archived_at is null group by p.id,p.title
      order by p.updated_at desc limit 12
    ) s),'[]'::jsonb),
    'knowledge',jsonb_build_object(
      'new',(select count(*) from public.business_knowledge_items where created_at>=from_ts),
      'waiting_review',(select count(*) from public.business_knowledge_items where status in ('draft','ai_extracted','employee_confirmed')),
      'validated',(select count(*) from public.business_knowledge_items where status='validated_by_data'),
      'review_due',(select count(*) from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and review_after is not null and review_after<=now()),
      'recent',coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at desc) from (select id,knowledge_type,memory_layer,title,statement,status,confidence,brand,specialty,service,audience,source_task_id,source_author_id,review_after,expires_at,created_at from public.business_knowledge_items where created_at>=from_ts order by created_at desc limit 20) k),'[]'::jsonb)
    ),
    'recommendations',jsonb_build_object(
      'pending',(select count(*) from public.business_recommendations where status in ('proposed','approved')),
      'measuring',(select count(*) from public.business_recommendations where status in ('converted_to_task','measuring')),
      'items',coalesce((select jsonb_agg(to_jsonb(r) order by case r.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,r.created_at desc) from (select id,title,rationale,recommendation_type,priority,status,expected_metric,task_id,measure_after,created_at from public.business_recommendations where status not in ('rejected','closed') order by created_at desc limit 20) r),'[]'::jsonb)
    ),
    'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_at desc) from (select id,title,decision,reason,scope,status,expected_metric,review_on,result_summary,learning,decided_at from public.business_decisions where status not in ('superseded') order by decided_at desc limit 20) d),'[]'::jsonb),
    'operations',jsonb_build_object(
      'open_issues',(select count(*) from public.operational_issues where status<>'resolved'),
      'repeated',(select count(*) from public.operational_issues where status<>'resolved' and appearance_count>=3),
      'items',coalesce((select jsonb_agg(to_jsonb(o) order by o.appearance_count desc,o.last_period desc) from (select id,title,status,appearance_count,last_period from public.operational_issues where status<>'resolved' order by appearance_count desc,last_period desc limit 10) o),'[]'::jsonb)
    ),
    'leads',jsonb_build_object(
      'total',(select count(*) from public.leads where received_at>=from_ts),
      'booked',(select count(*) from public.leads where received_at>=from_ts and (booking_date is not null or booking_reference is not null)),
      'conversion',coalesce((select round(100.0*count(*) filter(where booking_date is not null or booking_reference is not null)/nullif(count(*),0),1) from public.leads where received_at>=from_ts),0)
    ),
    'ads',jsonb_build_object(
      'basis','Meta lifetime performance; use as direction, not a period ROAS claim',
      'spend',(select coalesce(sum(p.spend),0) from public.meta_ad_performance_lifetime p),
      'results',(select coalesce(sum(p.results),0) from public.meta_ad_performance_lifetime p),
      'leads',(select coalesce(sum(p.leads),0) from public.meta_ad_performance_lifetime p),
      'booked_attributed',(select count(*) from public.vw_lead_meta_attribution where received_at>=from_ts and current_status is not null and matched_meta_ad_id is not null and lead_id in (select id from public.leads where booking_date is not null or booking_reference is not null)),
      'revenue_attribution_ready',false
    ),
    'team_impact',coalesce((select jsonb_agg(to_jsonb(x) order by x.validated_knowledge desc,x.completed_tasks desc) from (
      select a.id,a.name,
        count(distinct t.id) filter(where t.completed_at>=from_ts) completed_tasks,
        count(distinct k.id) filter(where k.status in ('manager_approved','validated_by_data') and k.created_at>=from_ts) approved_knowledge,
        count(distinct k.id) filter(where k.status='validated_by_data' and k.created_at>=from_ts) validated_knowledge,
        count(distinct br.id) filter(where br.task_id is not null and br.created_at>=from_ts) adopted_recommendations,
        count(distinct bm.id) filter(where bm.verdict in ('improved','resolved','learned') and bm.measured_at>=from_ts) positive_measured_outcomes
      from public.admins a
      left join public.tasks t on t.assignee_id=a.id
      left join public.business_knowledge_items k on k.source_author_id=a.id
      left join public.business_recommendations br on br.proposed_by=a.id
      left join public.business_measurements bm on bm.task_id=t.id
      where a.active=true group by a.id,a.name
    ) x),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(v) from (
      select jsonb_build_object('severity','high','kind','task','title','مهام متأخرة','detail',count(*)||' مهمة متأخرة تحتاج تحديد سبب أو إعادة ترتيب.') v from public.tasks where status not in ('done','review') and due_at<now() having count(*)>0
      union all
      select jsonb_build_object('severity','high','kind','operations','title','مشكلات متكررة','detail',count(*)||' مشكلة ظهرت في 3 فترات أو أكثر ولم تغلق بعد.') from public.operational_issues where status<>'resolved' and appearance_count>=3 having count(*)>0
      union all
      select jsonb_build_object('severity','medium','kind','knowledge','title','معرفة تحتاج مراجعة','detail',count(*)||' معلومة معتمدة وصلت لموعد إعادة التحقق.') from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and review_after is not null and review_after<=now() having count(*)>0
      union all
      select jsonb_build_object('severity','medium','kind','decision','title','قرارات حان قياسها','detail',count(*)||' قرار وصل لتاريخ المراجعة بدون نتيجة نهائية.') from public.business_decisions where status='active' and review_on is not null and review_on<=current_date having count(*)>0
    ) a(v)),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.business_owner_snapshot(text) from public;
grant execute on function public.business_owner_snapshot(text) to authenticated;

-- Aggregated context for the owner copilot. No patient names, phone numbers or raw employee report text.
create or replace function public.business_copilot_context(p_period text default 'month')
returns jsonb language sql stable security definer set search_path='public'
as $$ select case when public.business_manager() then jsonb_build_object(
  'snapshot',public.business_owner_snapshot(p_period),
  'approved_knowledge',coalesce((select jsonb_agg(to_jsonb(k)) from (select id,knowledge_type,title,statement,status,confidence,brand,specialty,service,audience,created_at,last_validated_at from public.business_knowledge_items where status in ('manager_approved','validated_by_data') and (expires_at is null or expires_at>now()) order by confidence desc,created_at desc limit 80) k),'[]'::jsonb),
  'measurements',coalesce((select jsonb_agg(to_jsonb(m)) from (select metric,baseline_value,measured_value,unit,verdict,explanation,measured_at from public.business_measurements order by measured_at desc limit 50) m),'[]'::jsonb)
) else '{}'::jsonb end; $$;
revoke all on function public.business_copilot_context(text) from public;
grant execute on function public.business_copilot_context(text) to authenticated;

-- Scenario planning based on observed lifetime cost per result. This is a mechanical sensitivity model, not a guarantee.
create or replace function public.business_ads_scenario(p_extra_budget numeric)
returns jsonb language plpgsql stable security definer set search_path='public'
as $$
declare rows jsonb; base_results numeric; low_results numeric; high_results numeric;
begin
 if not public.business_manager() then raise exception 'Management access required'; end if;
 if p_extra_budget is null or p_extra_budget<=0 or p_extra_budget>10000000 then raise exception 'Invalid budget'; end if;
 with perf as (
   select c.id,c.campaign_name,sum(p.spend) spend,sum(p.results) results,
          case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end cpr
   from public.meta_campaigns c join public.meta_ads a on a.campaign_id=c.id
   join public.meta_ad_performance_lifetime p on p.ad_id=a.id
   group by c.id,c.campaign_name having sum(p.spend)>0 and sum(p.results)>0
 ), ranked as (
   select *,row_number() over(order by cpr asc,results desc) rn from perf
 ), chosen as (select * from ranked where rn<=3), weights as (
   select *, (1/cpr)/sum(1/cpr) over() weight from chosen
 ), alloc as (
   select campaign_name,spend,results,cpr,round(p_extra_budget*weight,2) allocation,
          round((p_extra_budget*weight)/cpr,2) projected_extra_results from weights
 )
 select coalesce(jsonb_agg(to_jsonb(alloc) order by cpr asc),'[]'::jsonb),coalesce(sum(projected_extra_results),0) into rows,base_results from alloc;
 low_results:=round(base_results*0.8,2); high_results:=round(base_results*1.2,2);
 return jsonb_build_object('extra_budget',p_extra_budget,'basis','historical lifetime cost per result','allocations',rows,
   'mechanical_projection',base_results,'sensitivity_80pct',low_results,'sensitivity_120pct',high_results,
   'interpretation','Sensitivity band only; not a confidence interval or guaranteed result. Re-check lead quality, bookings and revenue before increasing spend.');
end $$;
revoke all on function public.business_ads_scenario(numeric) from public;
grant execute on function public.business_ads_scenario(numeric) to authenticated;

comment on table public.business_knowledge_items is 'Central auditable business memory. Approved/validated facts feed content and recommendations; raw reports remain in task_work_results.';
comment on table public.business_extraction_queue is 'Queue only. External AI extraction must remain disabled until business_ai_enabled is intentionally changed after data-transfer approval.';
