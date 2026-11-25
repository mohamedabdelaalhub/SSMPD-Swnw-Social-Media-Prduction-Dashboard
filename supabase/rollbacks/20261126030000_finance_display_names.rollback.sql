-- Rollback of 20261126030000_finance_display_names.sql: drop the wrappers, move the original functions back to public.
begin;
drop function public.clinic_finance_snapshot(date, date, integer);
drop function public.clinic_finance_doctor_statement(text, date, date);
drop function public.clinic_finance_doctor_statement_detail(text, date, date);
drop function public.clinic_finance_main_treasury_balance();
drop function clinic_finance.with_patient_names(jsonb);
drop function clinic_finance.patient_name_for_ref(text);
alter function clinic_finance.snapshot_pre_names(date, date, integer) rename to clinic_finance_snapshot;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) set schema public;
alter function clinic_finance.doctor_statement_pre_names(text, date, date) rename to clinic_finance_doctor_statement;
alter function clinic_finance.clinic_finance_doctor_statement(text, date, date) set schema public;
alter function clinic_finance.doctor_statement_detail_pre_names(text, date, date) rename to clinic_finance_doctor_statement_detail;
alter function clinic_finance.clinic_finance_doctor_statement_detail(text, date, date) set schema public;
alter function clinic_finance.main_treasury_balance_pre_names() rename to clinic_finance_main_treasury_balance;
alter function clinic_finance.clinic_finance_main_treasury_balance() set schema public;
revoke all on function public.clinic_finance_snapshot(date, date, integer), public.clinic_finance_doctor_statement(text, date, date),
  public.clinic_finance_doctor_statement_detail(text, date, date), public.clinic_finance_main_treasury_balance() from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer), public.clinic_finance_doctor_statement(text, date, date),
  public.clinic_finance_doctor_statement_detail(text, date, date), public.clinic_finance_main_treasury_balance() to authenticated;
commit;
