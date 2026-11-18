-- Rollback for 20261118050000_finance_overview.sql: the read-only accounting overview RPC is new, so dropping it is enough.
-- Nothing else was changed (no tables, no data, no other functions).
begin;
drop function if exists public.clinic_finance_overview();
commit;
