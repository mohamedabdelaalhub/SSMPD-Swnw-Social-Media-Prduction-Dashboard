-- Strategic owner views: decision queue, opportunities, marketing/ads evidence and task digest.

create or replace function public.business_strategy_snapshot(p_period text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  from_ts timestamptz;
  result jsonb;
begin
  if not public.business_manager() then raise exception 'Management access required'; end if;
  from_ts := case p_period
    when 'today' then date_trunc('day',now())
    when 'month' then date_trunc('month',now())
    else date_trunc('week',now())
  end;

  select jsonb_build_object(
    'period',p_period,
    'generated_at',now(),

    'needs_decision',jsonb_build_object(
      'recommendations',coalesce((
        select jsonb_agg(to_jsonb(r) order by
          case r.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
          r.created_at desc)
        from (
          select id,title,rationale,recommendation_type,priority,status,expected_metric,
                 expected_direction,brand,specialty,service,measure_after,created_at
          from public.business_recommendations
          where status in ('proposed','approved')
          order by created_at desc
          limit 30
        ) r
      ),'[]'::jsonb),
      'decisions_due',coalesce((
        select jsonb_agg(to_jsonb(d) order by d.review_on,d.decided_at desc)
        from (
          select id,title,decision,reason,scope,expected_metric,review_on,status,decided_at
          from public.business_decisions
          where status in ('active','review_due')
            and review_on is not null and review_on<=current_date
          order by review_on,decided_at desc
          limit 30
        ) d
      ),'[]'::jsonb),
      'knowledge_review_due',coalesce((
        select jsonb_agg(to_jsonb(k) order by k.review_after)
        from (
          select id,knowledge_type,title,statement,status,confidence,review_after,expires_at
          from public.business_knowledge_items
          where status in ('manager_approved','validated_by_data')
            and review_after is not null and review_after<=now()
          order by review_after
          limit 30
        ) k
      ),'[]'::jsonb)
    ),

    'opportunities',coalesce((
      select jsonb_agg(to_jsonb(k) order by
        (k.status='validated_by_data') desc,k.confidence desc,k.created_at desc)
      from (
        select id,knowledge_type,title,statement,status,confidence,confidence_reason,
               brand,specialty,service,audience,tags,review_after,expires_at,created_at
        from public.business_knowledge_items
        where status in ('manager_approved','validated_by_data')
          and (expires_at is null or expires_at>now())
          and knowledge_type in ('marketing_opportunity','service_insight','sales_insight','audience_insight','content_insight')
        order by (status='validated_by_data') desc,confidence desc,created_at desc
        limit 40
      ) k
    ),'[]'::jsonb),

    'recent_task_digest',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.completed_at desc)
      from (
        select t.id,t.title,t.status,t.completed_at,t.due_at,
               p.id project_id,p.title project_title,
               a.id author_id,a.name author_name,
               wr.created_at result_created_at,
               case when wr.body is null then '' else left(regexp_replace(wr.body,E'[\\n\\r\\t ]+',' ','g'),420) end result_preview
        from public.tasks t
        left join public.task_projects p on p.id=t.project_id
        left join lateral (
          select w.* from public.task_work_results w
          where w.task_id=t.id and w.status='review'
          order by w.created_at desc limit 1
        ) wr on true
        left join public.admins a on a.id=wr.author_id
        where t.completed_at>=from_ts
        order by t.completed_at desc
        limit 40
      ) x
    ),'[]'::jsonb),

    'top_campaigns',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.cost_per_result asc nulls last,x.results desc)
      from (
        select c.id,c.campaign_name,
               round(coalesce(sum(p.spend),0),2) spend,
               round(coalesce(sum(p.results),0),2) results,
               round(coalesce(sum(p.leads),0),2) leads,
               round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cost_per_result,
               round(case when sum(p.leads)>0 then sum(p.spend)/sum(p.leads) end,2) cost_per_lead,
               round(case when sum(p.spend)>0 then sum(p.ctr*p.spend)/sum(p.spend) end,2) weighted_ctr,
               max(p.updated_at) performance_updated_at
        from public.meta_campaigns c
        join public.meta_ads a on a.campaign_id=c.id
        join public.meta_ad_performance_lifetime p on p.ad_id=a.id
        group by c.id,c.campaign_name
        having sum(p.spend)>0
        order by cost_per_result asc nulls last,results desc
        limit 15
      ) x
    ),'[]'::jsonb),

    'creative_signals',jsonb_build_object(
      'specialties',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc)
        from (
          select coalesce(nullif(trim(a.specialty),''),'غير مصنف') label,
                 round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,
                 round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr
          from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id
          group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10
        ) x
      ),'[]'::jsonb),
      'angles',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc)
        from (
          select coalesce(nullif(trim(a.content_angle),''),'غير مصنف') label,
                 round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,
                 round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr
          from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id
          group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10
        ) x
      ),'[]'::jsonb),
      'hooks',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc)
        from (
          select coalesce(nullif(trim(a.hook_type),''),'غير مصنف') label,
                 round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,
                 round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr
          from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id
          group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10
        ) x
      ),'[]'::jsonb),
      'creative_types',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc)
        from (
          select coalesce(nullif(trim(a.creative_type),''),'غير مصنف') label,
                 round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,
                 round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr
          from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id
          group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10
        ) x
      ),'[]'::jsonb),
      'ctas',coalesce((
        select jsonb_agg(to_jsonb(x) order by x.results desc,x.spend desc)
        from (
          select coalesce(nullif(trim(a.cta_type),''),'غير مصنف') label,
                 round(sum(p.spend),2) spend,round(sum(p.results),2) results,round(sum(p.leads),2) leads,
                 round(case when sum(p.results)>0 then sum(p.spend)/sum(p.results) end,2) cpr
          from public.meta_ads a join public.meta_ad_performance_lifetime p on p.ad_id=a.id
          group by 1 having sum(p.spend)>0 order by results desc,spend desc limit 10
        ) x
      ),'[]'::jsonb)
    ),

    'attribution',jsonb_build_object(
      'revenue_ready',false,
      'booked_meta_attributed',(select count(*) from public.vw_lead_meta_attribution v
        join public.leads l on l.id=v.lead_id
        where l.received_at>=from_ts and v.matched_meta_ad_id is not null
          and (l.booking_date is not null or l.booking_reference is not null)),
      'explanation','Meta spend/results are lifetime. Lead-to-booking attribution is available. Revenue/profit attribution is not yet deterministic, so ROAS is intentionally not calculated.'
    )
  ) into result;

  return result;
end $$;

revoke all on function public.business_strategy_snapshot(text) from public,anon;
grant execute on function public.business_strategy_snapshot(text) to authenticated;
