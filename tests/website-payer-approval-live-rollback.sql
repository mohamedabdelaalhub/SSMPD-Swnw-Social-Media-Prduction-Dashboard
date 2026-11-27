-- Live dry-run of the FOUR migrations (230000 -> 260000) in ONE transaction that ends in ROLLBACK (nothing persists).
-- The migration files have their own begin/commit, so strip them first. Run from the repo root:
--   for n in 230000_customer_bookings_payer_approval 240000_website_payer_options 250000_website_booking_attach_approval 260000_fallback_bookings_payer; do
--     sed -E '/^\s*(begin|commit)\s*;/Id' supabase/migrations/20261127$n.sql; done > /tmp/m.sql
--   psql -v ON_ERROR_STOP=1 -v body="$(cat /tmp/m.sql)" -f tests/website-payer-approval-live-rollback.sql
begin;
:body
select jsonb_object_keys(public.website_payer_options()) as groups;
select (select count(*) from jsonb_array_elements(public.website_payer_options()->'insurance')) as insurers_active;
select public.website_booking_attach_approval('NO-SUCH', '01000000000', 'AP-0000') as must_be_false;
select public.website_booking_attach_approval('WEB-NOSUCH00', '01000000000', 'AP-0000') as must_be_false_parked;
select column_name, table_name from information_schema.columns where column_name in ('payment_mode','payer_entity_id','approval_no','approval_at') order by 2, 1;
select to_regprocedure('clinic_reception.fallback_api_before_payer(text,jsonb)') is not null as fallback_api_wrapped;
select clinic_reception.fallback_api('book', '{"booking_request_id":"x","payment_mode":"cash"}'::jsonb) as must_be_invalid_payer;
rollback;
select count(*) as cols_after_rollback from information_schema.columns where column_name in ('payment_mode','payer_entity_id','approval_no','approval_at') and table_name in ('customer_bookings','fallback_bookings');
select to_regprocedure('clinic_reception.fallback_api_before_payer(text,jsonb)') as wrapper_after_rollback;
