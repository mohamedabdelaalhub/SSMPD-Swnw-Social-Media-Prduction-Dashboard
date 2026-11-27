-- Website booking form (owner 2026-11-27): the form collects what Masa needs (name, phone, age, optional service text = Masa NeededService)
-- and what only the dashboard needs (optional gender). booking-sync-ingest now keeps both on the customer booking.
--   * public.customer_bookings.needed_service: the service / reason for the visit as the patient wrote it (also sent to Masa as NeededService).
--   * public.customer_bookings.gender: 'male' | 'female', dashboard only (Masa never gets it); reception can use it when the patient file is made on arrival.
-- Additive and nullable: existing rows and writers are unaffected. Rollback: supabase/rollbacks/20261127130000_customer_bookings_gender_service.rollback.sql
begin;
do $$ begin
  if to_regclass('public.customer_bookings') is null then raise exception 'customer_bookings غير موجود'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_bookings' and column_name = 'gender') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
alter table public.customer_bookings add column needed_service text check (needed_service is null or length(needed_service) <= 80);
alter table public.customer_bookings add column gender text check (gender is null or gender in ('male', 'female'));
commit;
