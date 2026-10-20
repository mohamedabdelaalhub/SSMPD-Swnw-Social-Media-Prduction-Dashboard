-- Align Business Intelligence recommendation priorities with the existing task workflow.
create or replace function public.business_recommendation_to_task(
  p_id uuid, p_project_id uuid, p_assignee uuid, p_due timestamptz,
  p_expected_output text default '', p_priority text default null
) returns uuid language plpgsql security definer set search_path='public'
as $$
declare
  r public.business_recommendations%rowtype;
  tid uuid;
  requested_priority text;
  task_priority text;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  select * into r from public.business_recommendations where id=p_id for update;
  if not found then raise exception 'Recommendation not found'; end if;
  if r.status not in ('proposed','approved') then raise exception 'Recommendation already processed'; end if;

  -- Native task priorities can override. Business priorities such as medium/critical
  -- are otherwise mapped from the recommendation itself.
  requested_priority := lower(trim(coalesce(p_priority,'')));
  if requested_priority not in ('low','normal','high','urgent') then requested_priority := r.priority; end if;
  task_priority := case requested_priority
    when 'low' then 'low'
    when 'high' then 'high'
    when 'critical' then 'urgent'
    when 'urgent' then 'urgent'
    else 'normal'
  end;

  tid:=public.task_create(
    p_project_id,null,r.title,r.rationale,
    coalesce(nullif(trim(p_expected_output),''),coalesce(r.expected_metric,'نتيجة قابلة للقياس')),
    p_assignee,p_due,task_priority
  );
  update public.business_recommendations
  set task_id=tid,status='converted_to_task',approved_by=public.my_admin_id(),approved_at=coalesce(approved_at,now())
  where id=p_id;
  return tid;
end $$;

revoke all on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) from public;
grant execute on function public.business_recommendation_to_task(uuid,uuid,uuid,timestamptz,text,text) to authenticated;
