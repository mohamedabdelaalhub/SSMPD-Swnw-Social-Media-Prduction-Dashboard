-- Rollback of 20261127020000_close_shift_blind_switch.sql: drops the outer wrapper and puts the previous snapshot back as
-- public.clinic_finance_snapshot (same signature and grants). The blind-count switch itself (20261126220000) is kept.
begin;
drop function if exists public.clinic_finance_snapshot(date, date, integer);
drop function if exists clinic_finance.blind_reveal(jsonb, uuid);
alter function clinic_finance.snapshot_pre_blind_switch(date, date, integer) rename to clinic_finance_snapshot;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) set schema public;
revoke all on function public.clinic_finance_snapshot(date, date, integer) from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer) to authenticated;
commit;
