-- Rollback of 20261122160000_reception_collect_multi.sql. Payments already taken as one multi-visit payment stay as they are
-- (one payment, its allocations and posting lines are history; reverse them only through the normal refund / review path).
-- payments.note is kept (data); the UI simply stops writing it.
begin;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_collect_multi(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_collect_multi(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function clinic_reception.collect_multi(uuid, jsonb, uuid);
drop table clinic_reception.multi_receipts;
commit;
