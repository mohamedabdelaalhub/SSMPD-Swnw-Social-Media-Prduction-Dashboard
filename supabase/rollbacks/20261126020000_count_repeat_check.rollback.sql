-- Rollback of 20261126020000_count_repeat_check.sql (read-only function).
begin;
drop function public.clinic_finance_count_repeat(uuid, jsonb);
commit;
