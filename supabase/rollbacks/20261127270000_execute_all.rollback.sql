-- Rollback of 20261127270000_execute_all.sql: drops the outer wrapper and the precheck and puts the previous command back
-- (same signature and grants). Services already executed through «تنفيذ الكل» stay executed (they are ordinary executions).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists clinic_reception.execute_precheck(uuid, jsonb);
drop function if exists public.clinic_reception_execute_all_info(uuid);
drop function if exists public.clinic_reception_device_last_reading(uuid, uuid);
drop function if exists clinic_reception.execute_pulses(jsonb);
alter function clinic_reception.command_before_execute_all(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_execute_all(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
commit;
