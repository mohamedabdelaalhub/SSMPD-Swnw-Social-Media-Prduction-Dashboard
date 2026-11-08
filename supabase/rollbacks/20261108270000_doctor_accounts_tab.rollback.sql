-- Rollback of 20261108270000_doctor_accounts_tab.sql (read-only functions only; no data is touched).
begin;
drop function if exists public.clinic_finance_doctor_accounts();
drop function if exists public.clinic_finance_hr_staff();
drop function if exists clinic_finance.doctor_accounts();
drop function if exists clinic_finance.hr_staff_for_contracts();
commit;
