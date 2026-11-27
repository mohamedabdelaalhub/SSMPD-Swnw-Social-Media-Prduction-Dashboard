-- Rollback of 20261127090000_employee_debt_reschedule.sql. Approved changes already moved installments (that stays — the
-- schedule rows are the current truth); this only removes the request feature and its history table.
begin;
do $$ begin if to_regclass('clinic_finance.employee_debt_changes') is null then raise exception 'الملف مش متطبق'; end if; end $$;
drop function public.clinic_finance_employee_debt_change(text, jsonb);
drop function clinic_finance.employee_debt_change_row(clinic_finance.employee_debt_changes);
drop function clinic_finance.employee_debt_schedule_json(uuid);
drop function clinic_finance.employee_debt_open_schedule(uuid);
drop table clinic_finance.employee_debt_changes;
commit;
