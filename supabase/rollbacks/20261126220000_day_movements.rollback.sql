-- Rollback of 20261126220000_day_movements.sql: drops the read-only RPC, the blind-count switch RPC and its settings row/table.
-- Nothing else was changed (the close-shift flow and clinic_finance_shift_movements were never touched).
begin;
drop function if exists public.clinic_finance_day_movements(uuid, date, date, uuid);
drop function if exists public.clinic_finance_blind_count(text, boolean);
drop table if exists clinic_finance.blind_count_settings;
commit;
