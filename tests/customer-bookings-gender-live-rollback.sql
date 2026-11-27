-- Live dry-run, safe by construction: nothing persists.
-- The migration file has its own begin/commit; calling it with \i inside a begin would COMMIT it for real.
-- So strip those lines first. Run from the repo root:
--   sed -E '/^\s*(begin|commit)\s*;/Id' supabase/migrations/20261127180000_customer_bookings_gender_service.sql > /tmp/m.sql
--   psql -v ON_ERROR_STOP=1 -v body="$(cat /tmp/m.sql)" -f tests/customer-bookings-gender-live-rollback.sql
begin;
:body
select column_name, data_type, is_nullable from information_schema.columns where table_name='customer_bookings' and column_name in ('gender','needed_service') order by 1;
select count(*) as rows_with_gender from public.customer_bookings where gender is not null;
rollback;
select count(*) as cols_after_rollback from information_schema.columns where table_name='customer_bookings' and column_name in ('gender','needed_service');
