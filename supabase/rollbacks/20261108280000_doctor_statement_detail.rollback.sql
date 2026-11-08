-- Rollback of 20261108280000_doctor_statement_detail.sql (read-only functions only; the base statement is untouched).
begin;
drop function if exists public.clinic_finance_doctor_statement_detail(text, date, date);
drop function if exists clinic_finance.doctor_statement_detail(text, date, date);
commit;
