-- Rollback of 20261127180000_customer_bookings_gender_service.sql (drops the two columns and their values).
begin;
alter table public.customer_bookings drop column if exists gender;
alter table public.customer_bookings drop column if exists needed_service;
commit;
