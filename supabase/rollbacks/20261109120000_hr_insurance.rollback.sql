-- Rollback of 20261109120000_hr_insurance.sql.
-- WARNING: drops the insurance register and the payment links. Export first if anything was recorded:
--   select * from clinic_people.insurance_enrollments;  select * from clinic_finance.insurance_payments;
-- Payments already posted to the books stay (they are normal statutory_payment requests and journal lines); only the link rows are dropped.
-- clinic_people.audit rows (action like 'insurance_%') are kept on purpose.
begin;
drop function if exists public.clinic_finance_insurance_pay(date, numeric, text, uuid, text, text, uuid);
drop function if exists public.clinic_finance_insurance_month(date);
drop function if exists clinic_finance.insurance_month(date);
drop function if exists public.hr_insurance_deduction(uuid, date);
drop function if exists public.hr_insurance_workspace();
drop function if exists public.hr_insurance_command(text, jsonb);
drop function if exists clinic_people.insurance_view_all();
drop table if exists clinic_finance.insurance_payments;
drop table if exists clinic_people.insurance_enrollments;
commit;
