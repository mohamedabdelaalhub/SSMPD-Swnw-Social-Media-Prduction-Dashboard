-- Feedback-loop queue for owner measurement UI.
create or replace function public.business_measurement_queue()
returns jsonb
language sql
stable
security definer
set search_path='public'
as $$
select case when public.business_manager() then coalesce((
  select jsonb_agg(to_jsonb(x) order by
    case x.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    x.created_at desc)
  from (
    select r.id recommendation_id,r.title,r.rationale,r.recommendation_type,r.priority,r.status,
           r.expected_metric,r.expected_direction,r.measure_after,r.task_id,r.created_at,
           t.title task_title,t.status task_status,t.completed_at task_completed_at,
           m.id latest_measurement_id,m.metric latest_metric,m.baseline_value latest_baseline,
           m.measured_value latest_measured,m.unit latest_unit,m.verdict latest_verdict,
           m.explanation latest_explanation,m.measured_at latest_measured_at
    from public.business_recommendations r
    left join public.tasks t on t.id=r.task_id
    left join lateral (
      select bm.* from public.business_measurements bm
      where bm.recommendation_id=r.id
      order by bm.measured_at desc limit 1
    ) m on true
    where r.status in ('converted_to_task','measuring','validated')
    order by r.created_at desc
    limit 50
  ) x
),'[]'::jsonb) else '[]'::jsonb end;
$$;

revoke all on function public.business_measurement_queue() from public,anon;
grant execute on function public.business_measurement_queue() to authenticated;
