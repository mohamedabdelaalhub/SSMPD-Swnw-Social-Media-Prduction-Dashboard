-- Rollback of 20261108250000_doctor_statement.sql (read-only functions only; no data is touched).
begin;
drop function if exists public.clinic_finance_doctor_statement(text, date, date);
drop function if exists clinic_finance.doctor_statement(text, date, date);
commit;
