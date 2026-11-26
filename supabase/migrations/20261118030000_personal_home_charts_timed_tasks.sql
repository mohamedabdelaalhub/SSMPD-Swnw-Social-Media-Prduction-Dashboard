-- Owner 2026-11-18: home v2 «my month» card shows how many timed tasks the on-time % is based on.
-- Depends on 20261118020000_personal_home_unread_daily.sql (PR #551): apply that one first.
-- personal_home_charts() is re-created from #551's final body with ONE change in my_month:
--   my_month.timed_tasks (integer) = employee_task_performance('month')->'timed', the same row tasks_on_time_pct is computed
--   from (round(on_time / timed × 100)). Returned whenever that row is available (tasks module allowed), 0 included.
--   tasks_on_time_pct is still omitted when timed_tasks = 0 (unchanged rule).
-- Nothing else changes: no table, no other function. Read-only, execute: authenticated only.
-- Rollback: supabase/rollbacks/20261118030000_personal_home_charts_timed_tasks.rollback.sql (restores #551's body)
begin;

do $$ begin
  if to_regclass('public.personal_home_unread_daily') is null then raise exception 'طبّق 20261118020000_personal_home_unread_daily أولاً'; end if;
  if to_regprocedure('public.employee_task_performance(text,date,date,uuid)') is null then raise exception 'employee_task_performance غير موجودة'; end if;
end $$;

create or replace function public.personal_home_charts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  tasks_ok boolean := false;
  can_team boolean := false;
  review_ok boolean := false;
  boss boolean := false;
  approver boolean := false;
  result jsonb := '{}'::jsonb;
  team_load jsonb;
  trend jsonb;
  month_part jsonb := '{}'::jsonb;
  perf jsonb;
  person uuid;
  month_counted integer;
  month_on_time integer;
  weekly jsonb;
  unread_trend jsonb;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then
    raise exception 'سجّل الدخول' using errcode = '42501';
  end if;

  tasks_ok := public.personal_home_tasks_allowed();
  if tasks_ok then
    -- the snapshot's team_tasks are the visible rows with can_manage = task_can_manage_project(project)
    can_team := exists (select 1 from public.task_projects p where p.archived_at is null and public.task_can_manage_project(p.id));
    review_ok := public.personal_home_module_allowed('tasks', 'update');
    boss := public.has_role('super_admin') or public.has_role('general_manager');
  end if;
  approver := public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin');

  -- 1. tasks.team_load
  if can_team then
    select coalesce(jsonb_agg(jsonb_build_object('assignee_id', x.assignee_id, 'assignee_name', x.assignee_name,
             'department', x.department, 'open', x.open, 'late', x.late, 'blocked', x.blocked)
             order by x.late + x.blocked desc, x.open desc, x.assignee_name nulls last, x.assignee_id), '[]'::jsonb)
      into team_load
      from (
        select y.*
          from (
            select v.assignee_id,
                   case when v.assignee_id is null then null else max(v.assignee_name) end as assignee_name,
                   max(pp.department) as department,
                   count(*)::integer as open,
                   (count(*) filter (where v.due_at < now() and v.status not in ('blocked','review')))::integer as late,
                   (count(*) filter (where v.status = 'blocked'))::integer as blocked
              from public.task_list_visible() v
              join public.task_projects p on p.id = v.project_id
              left join clinic_people.people pp on pp.admin_id = v.assignee_id
             where p.archived_at is null and v.can_manage and v.status not in ('done', 'cancelled')
             group by v.assignee_id
          ) y
         order by y.late + y.blocked desc, y.open desc, y.assignee_name nulls last, y.assignee_id
         limit 12
      ) x;
    result := result || jsonb_build_object('tasks', jsonb_build_object('team_load', team_load));
  end if;

  -- 2. trend: the tile values at the end of each of the last 7 Cairo days
  with days as (
    select g::date as d,
           least(now(), ((g::date + 1)::timestamp at time zone 'Africa/Cairo')) as cut
      from generate_series(today - 6, today, interval '1 day') g
  ),
  base as materialized (
    -- every task the caller could count today: assigned to them at some point, or in a project they manage
    select t.id, t.status, t.assignee_id, t.created_at, t.completed_at, p.archived_at,
           (boss or p.manager_id = me or exists (select 1 from public.task_project_members m
              where m.project_id = p.id and m.admin_id = me and m.role_name = 'manager')) as mng
      from public.tasks t
      join public.task_projects p on p.id = t.project_id
      join public.admins a on a.id = t.assignee_id
     where tasks_ok
       and (t.assignee_id = me or boss or p.manager_id = me
            or exists (select 1 from public.task_project_members m where m.project_id = p.id and m.admin_id = me and m.role_name = 'manager')
            or exists (select 1 from public.operational_task_events e where e.task_id = t.id and (e.old_assignee_id = me or e.new_assignee_id = me)))
  ),
  state as (
    select d.d, b.mng,
           case when bf.hit then bf.to_status
                when af.hit then af.from_status
                when b.status = 'done' and b.completed_at > d.cut then '_open'
                else b.status end as status_at,
           case when bf.hit then bf.new_assignee_id
                when af.hit then af.old_assignee_id
                else b.assignee_id end as assignee_at
      from days d
      join base b on b.created_at <= d.cut and (b.archived_at is null or b.archived_at > d.cut)
      left join lateral (select true as hit, e.to_status, e.new_assignee_id from public.operational_task_events e
                          where e.task_id = b.id and e.happened_at <= d.cut order by e.happened_at desc limit 1) bf on true
      left join lateral (select true as hit, e.from_status, e.old_assignee_id from public.operational_task_events e
                          where e.task_id = b.id and e.happened_at > d.cut order by e.happened_at limit 1) af on true
  ),
  task_counts as (
    select d.d,
           (count(s.d) filter (where s.assignee_at = me and s.status_at not in ('done', 'cancelled')))::integer as mine_open,
           (count(s.d) filter (where s.mng and s.status_at not in ('done', 'cancelled')))::integer as team_open,
           (count(s.d) filter (where s.mng and s.status_at = 'review'))::integer as review
      from days d left join state s on s.d = d.d
     group by d.d
  ),
  content_counts as (
    select d.d,
           (count(c.id) filter (where approver and c.stage_at in ('initial_approval', 'final_approval')))::integer as approval
      from days d
      left join lateral (
        select ci.id,
               coalesce((select h.e->>'stage'
                           from jsonb_array_elements(case when jsonb_typeof(ci.stage_history) = 'array' then ci.stage_history else '[]'::jsonb end)
                                with ordinality h(e, o)
                          where (h.e->>'at')::timestamptz <= d.cut
                          order by (h.e->>'at')::timestamptz desc, h.o desc limit 1),
                        case when jsonb_typeof(ci.stage_history) = 'array' then ci.stage_history->0->>'stage' end,
                        ci.stage) as stage_at
          from public.content_items ci
         where approver and ci.created_at <= d.cut
      ) c on true
     group by d.d
  )
  select jsonb_build_object('days', jsonb_agg(to_char(d.d, 'YYYY-MM-DD') order by d.d),
                            'mine_open', jsonb_agg(tc.mine_open order by d.d),
                            'approvals', jsonb_agg((case when review_ok then tc.review else 0 end) + cc.approval order by d.d),
                            'team_open', jsonb_agg(tc.team_open order by d.d))
    into trend
    from days d join task_counts tc on tc.d = d.d join content_counts cc on cc.d = d.d;
  if not tasks_ok then trend := trend - 'mine_open'; end if;
  if not can_team then trend := trend - 'team_open'; end if;
  -- trend.unread: the value personal_home_inbox() recorded for each Cairo day, today included (null = no row yet, no backfill).
  -- Read-only and cheap: the live number is already on the KPI tile; the sparkline only shows the recorded series.
  select jsonb_agg(to_jsonb(u.unread) order by g)
    into unread_trend
    from generate_series(today - 6, today, interval '1 day') g
    left join public.personal_home_unread_daily u on u.admin_id = me and u.day = g::date;
  trend := trend || jsonb_build_object('unread', unread_trend);
  result := result || jsonb_build_object('trend', trend);

  -- 3. my_month (self)
  select p.id into person from clinic_people.people p
   where p.admin_id = me and p.status <> 'ended' and p.kind <> 'doctor';
  if person is not null then
    with att as (
      select g::date as day,
             (e.status not in ('upcoming', 'waiting', 'unmapped', 'leave') and not (e.status = 'absent' and e.excused)) as counted,
             e.status
        from generate_series(least(date_trunc('month', today)::date, date_trunc('week', today)::date - 49), today, interval '1 day') g,
             lateral clinic_people.attendance_eval(g::date, now()) e
       where e.person_id = person
    ),
    wk as (
      select k, (date_trunc('week', today)::date - 7 * (7 - k)) as wfrom from generate_series(0, 7) k
    )
    select (select count(*) filter (where counted) from att where day >= date_trunc('month', today)::date),
           (select count(*) filter (where counted and status not in ('absent', 'late')) from att where day >= date_trunc('month', today)::date),
           (select jsonb_agg(w.pct order by w.k) from (
              select wk.k,
                     case when count(*) filter (where a.counted) = 0 then null
                          else round(100.0 * count(*) filter (where a.counted and a.status not in ('absent', 'late'))
                                     / count(*) filter (where a.counted))::integer end as pct
                from wk left join att a on a.day between wk.wfrom and wk.wfrom + 6
               group by wk.k) w)
      into month_counted, month_on_time, weekly;
    if month_counted > 0 then
      month_part := month_part || jsonb_build_object('commitment_pct', round(100.0 * month_on_time / month_counted)::integer);
    end if;
    if exists (select 1 from jsonb_array_elements(weekly) x(v) where x.v <> 'null'::jsonb) then
      month_part := month_part || jsonb_build_object('weekly_commitment', weekly);
    end if;
  end if;
  if tasks_ok then
    begin
      perf := public.employee_task_performance('month');
    exception when insufficient_privilege then perf := null;
    end;
    -- timed_tasks = the employee_task_performance('month') «timed» count behind tasks_on_time_pct (0 included);
    -- tasks_on_time_pct stays omitted when it is 0.
    if perf is not null then
      month_part := month_part || jsonb_build_object('timed_tasks', coalesce((perf->>'timed')::integer, 0));
    end if;
    if coalesce((perf->>'timed')::integer, 0) > 0 then
      month_part := month_part || jsonb_build_object('tasks_on_time_pct',
        round(100.0 * (perf->>'on_time')::integer / (perf->>'timed')::integer)::integer);
    end if;
  end if;
  if month_part <> '{}'::jsonb then result := result || jsonb_build_object('my_month', month_part); end if;

  return result;
end
$function$;

comment on function public.personal_home_charts() is
  'Home v2 charts: tasks.team_load, 7-day KPI trend (mine_open/approvals/team_open, unread from recorded daily values), my_month attendance and task on-time %. Read-only; keys omitted when not allowed or not reconstructable.';

revoke all on function public.personal_home_charts() from public, anon;
grant execute on function public.personal_home_charts() to authenticated;

notify pgrst, 'reload schema';

commit;
