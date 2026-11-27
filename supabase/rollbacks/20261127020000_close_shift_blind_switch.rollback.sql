-- Rollback of 20261127020000_close_shift_blind_switch.sql: drops the two outer wrappers and puts the previous functions back as
-- public.clinic_finance_snapshot and public.clinic_booking_snapshot (same signatures and grants). The blind-count switch (20261126220000) stays.
begin;
drop function if exists public.clinic_finance_snapshot(date, date, integer);
drop function if exists public.clinic_booking_snapshot(date, date);
drop function if exists clinic_finance.blind_reveal(jsonb, uuid);
alter function clinic_finance.snapshot_pre_blind_switch(date, date, integer) rename to clinic_finance_snapshot;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) set schema public;
alter function clinic_finance.booking_snapshot_pre_blind_switch(date, date) rename to clinic_booking_snapshot;
alter function clinic_finance.clinic_booking_snapshot(date, date) set schema public;
revoke all on function public.clinic_finance_snapshot(date, date, integer), public.clinic_booking_snapshot(date, date) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer), public.clinic_booking_snapshot(date, date) to authenticated;
commit;
