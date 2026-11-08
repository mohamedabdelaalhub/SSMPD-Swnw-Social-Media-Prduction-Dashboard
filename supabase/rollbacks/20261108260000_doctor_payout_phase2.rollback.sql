-- Rollback for 20261108260000_doctor_payout_phase2.sql: removes the wrapper and the new helper functions. No data was changed by the migration.
-- Payouts created/approved while it was live stay as they are (their payload keeps tax_pct / withholding_pct; audit rows 'doctor_payout_terms' / 'doctor_payout_review_gate' stay).
begin;
drop function if exists public.clinic_finance_doctor_command(text, jsonb, uuid);
do $$ begin
  if to_regprocedure('clinic_finance.doctor_command_before_payout2(text,jsonb,uuid)') is not null then
    alter function clinic_finance.doctor_command_before_payout2(text, jsonb, uuid) rename to clinic_finance_doctor_command;
    alter function clinic_finance.clinic_finance_doctor_command(text, jsonb, uuid) set schema public;
  end if;
end $$;
revoke all on function public.clinic_finance_doctor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_command(text, jsonb, uuid) to authenticated;
drop function if exists public.clinic_finance_doctor_payable(text);
drop function if exists clinic_finance.payout_review_mode();
drop function if exists clinic_finance.has_financial_manager();
drop function if exists clinic_finance.doctor_payable_now(text);
drop function if exists clinic_finance.doctor_held_fees(text);
drop function if exists clinic_finance.invoice_fully_paid(uuid);
commit;
