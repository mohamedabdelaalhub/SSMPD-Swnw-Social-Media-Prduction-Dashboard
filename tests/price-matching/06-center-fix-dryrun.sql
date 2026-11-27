-- DRY RUN of 05-center-fix-steps.sql — one transaction, ends in ROLLBACK, nothing is kept.
-- Needs mig 20261123090000 applied first (or prepend its function body inside this transaction for a pre-apply check).
-- Run:  psql -v ON_ERROR_STOP=1 -f 06-center-fix-dryrun.sql   (05 must sit in the same folder)
begin;
create temp table dry_before on commit drop as
 select (select revision from clinic_prices.lists where id='12289346-917a-40e6-bd74-9b9696f844f4') rev,
        (select count(*) from clinic_prices.items where list_id='12289346-917a-40e6-bd74-9b9696f844f4') items,
        (select count(*) from public.pricing_services) services,
        (select jsonb_object_agg(status,c) from (select status,count(*) c from clinic_prices.batches where list_id='12289346-917a-40e6-bd74-9b9696f844f4' group by status) q) batches;
\i 05-center-fix-steps.sql
select 'result' part, jsonb_build_object(
 'before',(select to_jsonb(d) from dry_before d),
 'after_items',(select count(*) from clinic_prices.items where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'after_batches',(select jsonb_object_agg(status,c) from (select status,count(*) c from clinic_prices.batches where list_id='12289346-917a-40e6-bd74-9b9696f844f4' group by status) q),
 'sections',(select jsonb_agg(name order by name) from clinic_prices.sections where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'services_created_by_steps',(select count(*) from public.pricing_services)-(select services from dry_before),
 'review_status',(select status from clinic_prices.master_reviews where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'plan_groups',(select jsonb_array_length(plan) from clinic_prices.master_reviews where list_id='12289346-917a-40e6-bd74-9b9696f844f4'),
 'plan_existing_one',(select count(*) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'existing_ids')=1),
 'plan_would_create_NEW',(select count(*) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'existing_ids')=0),
 'plan_new_list',(select jsonb_agg(jsonb_build_array(x->>'category',x->>'name')) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'existing_ids')=0),
 'plan_merging_rows',(select count(*) from clinic_prices.master_reviews m,jsonb_array_elements(m.plan) x where m.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and jsonb_array_length(x->'source_rows')>1),
 'audit_rows_written',(select jsonb_agg(action order by id) from clinic_prices.audit where list_id='12289346-917a-40e6-bd74-9b9696f844f4' and created_at=now()));
rollback;
