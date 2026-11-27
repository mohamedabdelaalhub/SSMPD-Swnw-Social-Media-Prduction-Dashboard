-- Live dry-run, safe by construction (nothing persists). The migration files have their own begin/commit, so strip them first.
-- Run from the repo root (ON_ERROR_STOP):
--   for n in 230000_customer_bookings_payer_approval 240000_website_payer_options 250000_website_booking_attach_approval; do
--     sed -E '/^\s*(begin|commit)\s*;/Id' supabase/migrations/20261127$n.sql; done > /tmp/m.sql
--   psql -v ON_ERROR_STOP=1 -v body="$(cat /tmp/m.sql)" -f tests/website-payer-approval-live-rollback.sql
begin;
:body
select jsonb_object_keys(public.website_payer_options()) as groups;
select (select count(*) from jsonb_array_elements(public.website_payer_options()->'insurance')) as insurers_active;
select public.website_booking_attach_approval('NO-SUCH', '01000000000', 'AP-0000') as must_be_false;
select column_name from information_schema.columns where table_name='customer_bookings' and column_name in ('payment_mode','payer_entity_id','approval_no','approval_at') order by 1;
rollback;
select count(*) as cols_after_rollback from information_schema.columns where table_name='customer_bookings' and column_name in ('payment_mode','payer_entity_id','approval_no','approval_at');
