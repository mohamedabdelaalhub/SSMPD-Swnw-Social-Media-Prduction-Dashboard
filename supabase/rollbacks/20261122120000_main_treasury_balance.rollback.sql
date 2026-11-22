-- Rollback of 20261122120000_main_treasury_balance.sql (read-only function; nothing else to undo).
begin;
drop function if exists public.clinic_finance_main_treasury_balance();
commit;
