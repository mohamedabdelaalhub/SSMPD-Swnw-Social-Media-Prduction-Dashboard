-- Rollback of 20261127230000_customer_bookings_payer_approval.sql (drops the four columns and their values).
begin;
drop index if exists public.customer_bookings_payer_entity_idx;
alter table public.customer_bookings drop constraint if exists customer_bookings_payer_consistent;
alter table public.customer_bookings drop column if exists approval_at, drop column if exists approval_no, drop column if exists payer_entity_id, drop column if exists payment_mode;
commit;
