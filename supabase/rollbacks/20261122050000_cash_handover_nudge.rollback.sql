-- Rollback of 20261122050000_cash_handover_nudge.sql. Nudges are reminders only (no money); their history stays in clinic_finance.audit.
begin;
drop function if exists public.clinic_finance_handover_nudge_seen(uuid);
drop function if exists public.clinic_finance_my_handover_nudges();
drop function if exists public.clinic_finance_handover_nudge(uuid, text);
drop table if exists clinic_finance.handover_nudges;
commit;
