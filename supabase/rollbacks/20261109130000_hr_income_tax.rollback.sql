-- Rollback of 20261109130000_hr_income_tax.sql.
-- WARNING: drops the monthly tax register, the payment links and tax_types. Export first if anything was recorded:
--   select * from clinic_people.tax_entries;  select * from clinic_finance.tax_payments;
-- Payments already posted to the books stay (normal statutory_payment requests + journal lines). clinic_people.audit rows (action like 'tax_%') are kept.
begin;
drop function if exists public.clinic_finance_tax_pay(date, text, numeric, text, uuid, text, text, uuid);
drop function if exists public.clinic_finance_tax_month(date, text);
drop function if exists clinic_finance.tax_month(date, text);
drop function if exists public.hr_tax_amount(uuid, date, text);
drop function if exists public.hr_tax_workspace(date);
drop function if exists public.hr_tax_command(text, jsonb);
drop table if exists clinic_finance.tax_payments;
drop table if exists clinic_people.tax_entries;
drop table if exists clinic_finance.tax_types;
commit;
