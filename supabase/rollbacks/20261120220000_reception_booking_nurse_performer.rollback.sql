-- Rollback of 20261120220000_reception_booking_nurse_performer.sql. Columns stay (data kept; defaults harmless).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_nurse(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_nurse(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists public.clinic_reception_nurses(uuid);
drop function if exists clinic_reception.is_nurse(uuid);
commit;
