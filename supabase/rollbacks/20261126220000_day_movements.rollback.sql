-- Rollback of 20261126220000_day_movements.sql: drops the read-only RPC it added. Nothing else was changed.
begin;
drop function if exists public.clinic_finance_day_movements(uuid, date, date, uuid);
commit;
