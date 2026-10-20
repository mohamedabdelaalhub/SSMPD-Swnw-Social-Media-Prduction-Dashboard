-- Close the feedback loop: a measured recommendation validates the knowledge that supported it.
create or replace function public.business_measurement_save(
 p_recommendation uuid,p_decision uuid,p_task uuid,p_knowledge uuid,p_metric text,
 p_baseline numeric,p_measured numeric,p_unit text,p_verdict text,p_explanation text,p_evidence jsonb default '{}'
) returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  v uuid;
  kid uuid;
  source_ids uuid[] := '{}'::uuid[];
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;

  insert into public.business_measurements(
    recommendation_id,decision_id,task_id,knowledge_item_id,metric,
    baseline_value,measured_value,unit,verdict,explanation,evidence,measured_by
  ) values(
    p_recommendation,p_decision,p_task,p_knowledge,trim(p_metric),
    p_baseline,p_measured,coalesce(p_unit,''),p_verdict,
    coalesce(p_explanation,''),coalesce(p_evidence,'{}'),public.my_admin_id()
  ) returning id into v;

  if p_recommendation is not null then
    select coalesce(source_knowledge_ids,'{}'::uuid[]) into source_ids
    from public.business_recommendations where id=p_recommendation;

    update public.business_recommendations
    set status=case when p_verdict in ('improved','resolved','learned') then 'validated' else 'measuring' end
    where id=p_recommendation;
  end if;

  if p_decision is not null then
    update public.business_decisions
    set result_summary=trim(coalesce(p_explanation,'')), reviewed_at=now(), status='completed'
    where id=p_decision;
  end if;

  if p_verdict in ('improved','resolved','learned') then
    if p_knowledge is not null then
      update public.business_knowledge_items
      set status='validated_by_data',last_validated_at=now(),
          approved_by=coalesce(approved_by,public.my_admin_id()),approved_at=coalesce(approved_at,now())
      where id=p_knowledge and status not in ('outdated','superseded');
    end if;

    foreach kid in array source_ids loop
      update public.business_knowledge_items
      set status='validated_by_data',last_validated_at=now(),
          approved_by=coalesce(approved_by,public.my_admin_id()),approved_at=coalesce(approved_at,now())
      where id=kid and status not in ('outdated','superseded');

      insert into public.business_entity_links(
        from_type,from_key,relation_type,to_type,to_key,metadata
      ) values(
        'measurement',v::text,'validates','knowledge',kid::text,
        jsonb_build_object('verdict',p_verdict,'metric',trim(p_metric),'via','recommendation')
      ) on conflict do nothing;
    end loop;
  end if;

  return v;
end $$;

revoke all on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) from public,anon;
grant execute on function public.business_measurement_save(uuid,uuid,uuid,uuid,text,numeric,numeric,text,text,text,jsonb) to authenticated;
