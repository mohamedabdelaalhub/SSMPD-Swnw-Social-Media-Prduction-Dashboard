begin;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_manual_time(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_manual_time(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
-- appointments.manual_time / manual_reason / manual_by and the 'manual' availability rows are kept (history)
commit;
