-- FULL DRY RUN, OPTION د: dedup (09) → catalogue move to «العلاج الطبيعي» (11d) → section fixes + reopen + prepare (05d). One transaction, ends in ROLLBACK.
-- Needs mig 20261123090000 applied inside the same transaction or beforehand. Run from tests/price-matching:
--   psql -v ON_ERROR_STOP=1 -f 10-center-full-dryrun.sql
begin;
create temp table dry_before on commit drop as
 select (select count(*) from clinic_prices.items where list_id='12289346-917a-40e6-bd74-9b9696f844f4') items,
        (select count(*) from public.pricing_services) services,
        (select count(*) from public.pricing_services where active) active_services;
\i 09-dedup-two-services-steps.sql
\i 11d-option-d-move-to-physio-steps.sql
\i 05d-center-fix-steps-option-d.sql
select 'result' part, jsonb_build_object(
 'before',(select to_jsonb(d) from dry_before d),
 'active_services_after',(select count(*) from public.pricing_services where active),
 'services_created',(select count(*) from public.pricing_services)-(select services from dry_before),
 'sections',(select jsonb_agg(name order by name) from clinic_prices.sections where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'batches',(select jsonb_object_agg(status,c) from (select status,count(*) c from clinic_prices.batches where list_id='12289346-917a-40e6-bd74-9b9696f844f4' group by status) q),
 'items_after',(select count(*) from clinic_prices.items where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'review_status',(select status from clinic_prices.master_reviews where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'plan_groups',(select jsonb_array_length(plan) from clinic_prices.master_reviews where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'plan_existing_one',(select count(*) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'existing_ids')=1),
 'plan_would_create_NEW',(select jsonb_agg(jsonb_build_array(x->>'category',x->>'name')) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'existing_ids')=0),
 'plan_merging_rows',(select count(*) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'source_rows')>1),
 'audit_actions',(select jsonb_agg(action order by id) from clinic_prices.audit where list_id='12289346-917a-40e6-bd74-9b9696f844f4' and created_at=now()));
rollback;
