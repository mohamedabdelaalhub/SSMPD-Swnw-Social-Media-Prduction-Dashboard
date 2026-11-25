-- Rollback of 20261125110000_shift_count_check.sql (no posting, no shift data changed).
begin;
drop function public.clinic_finance_count_check(text, jsonb);
drop table clinic_finance.count_attempts;
drop table clinic_finance.count_check_settings;
commit;
