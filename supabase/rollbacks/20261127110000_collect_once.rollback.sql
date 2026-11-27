-- Rollback of 20261127110000_collect_once.sql: drops the outer wrapper and puts the previous command back (same signature and grants).
-- Notes already written on confirmed second receipts stay (they are plain text on those receipts).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists clinic_reception.collect_method_label(text);
alter function clinic_reception.command_before_collect_once(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_collect_once(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
commit;
