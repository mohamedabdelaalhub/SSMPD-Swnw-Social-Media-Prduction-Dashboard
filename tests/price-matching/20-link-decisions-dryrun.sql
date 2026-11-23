-- DRY RUN of 19-link-decisions-steps.sql — one transaction, ends in ROLLBACK. Run from tests/price-matching:
--   psql -v ON_ERROR_STOP=1 -f 20-link-decisions-dryrun.sql
begin;
\i 19-link-decisions-steps.sql
select 'plan_by_list' part, jsonb_object_agg(list_name, a) from (
  select list_name, jsonb_object_agg(action, n) a from (select list_name, action, count(*) n from lk_plan group by 1,2) q group by list_name) z
union all
select 'calls', jsonb_build_object('ok',(select count(*) from lk_log where ok),'failed',(select count(*) from lk_log where not ok),
  'failed_by_error',(select jsonb_object_agg(err,n) from (select left(err,90) err,count(*) n from lk_log where not ok group by 1) q),
  'failed_samples',(select jsonb_agg(jsonb_build_array(list_name,idx,action,left(err,120))) from (select * from lk_log where not ok limit 15) q))
union all
select 'absent_by_topic', jsonb_object_agg(topic,n) from (select topic,count(*) n from lk_plan where action='defer_absent' group by 1) q
union all
select 'review_left_by_reason', jsonb_object_agg(action,n) from (select action,count(*) n from lk_plan where action like 'review%' group by 1) q
union all
select 'fuzzy_links_sample', jsonb_agg(jsonb_build_array(rname,top3->0->>'name',round(best,2))) from (select * from lk_plan where action='link_fuzzy' order by random() limit 25) q
union all
select 'twin_links', jsonb_agg(jsonb_build_array(rname,(select category from public.pricing_services where id=target))) from lk_plan where action='link_twin'
union all
select 'price_defers', jsonb_agg(jsonb_build_array(list_name,rname,rprice)) from lk_plan where action='defer_price'
union all
select 'after_per_list', jsonb_agg(jsonb_build_object('list',l.name,'rows',(select count(*) from clinic_prices.batches b,jsonb_array_elements(b.rows) x where b.list_id=l.id and b.status<>'discarded'),
   'confirmed',(select count(*) from clinic_prices.batches b,jsonb_array_elements(b.rows) x where b.list_id=l.id and b.status<>'discarded' and coalesce((x->>'confirmed')::boolean,false)),
   'deferred',(select count(*) from clinic_prices.batches b,jsonb_array_elements(b.rows) x where b.list_id=l.id and b.status<>'discarded' and x->>'review_status'='deferred'),
   'items',(select count(*) from clinic_prices.items i where i.list_id=l.id),
   'batch_status',(select jsonb_agg(status) from clinic_prices.batches b where b.list_id=l.id)) order by l.name)
 from clinic_prices.lists l where l.list_kind='reference' and l.deleted_at is null and l.status='draft' and l.name not like '%2023%';
rollback;
