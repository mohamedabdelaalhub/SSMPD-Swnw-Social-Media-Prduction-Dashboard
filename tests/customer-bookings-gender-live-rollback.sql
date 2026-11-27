-- Live dry-run: applies the migration inside a transaction, checks, then ROLLS BACK (nothing persists).
begin;
\i supabase/migrations/20261127180000_customer_bookings_gender_service.sql
select column_name, data_type from information_schema.columns where table_name='customer_bookings' and column_name in ('gender','needed_service') order by 1;
select count(*) as rows_with_gender from public.customer_bookings where gender is not null;
rollback;
select count(*) as cols_after_rollback from information_schema.columns where table_name='customer_bookings' and column_name in ('gender','needed_service');
