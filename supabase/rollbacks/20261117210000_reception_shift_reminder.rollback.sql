-- Rollback of 20261117210000_reception_shift_reminder.sql
begin;
drop function if exists public.clinic_reception_shift_reminder();
commit;
