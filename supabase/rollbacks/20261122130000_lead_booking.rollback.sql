begin;
drop function public.lead_booking_funnel(date, date);
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_lead_booking(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_lead_booking(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_lead_booking(uuid, date, date) set schema public;
alter function public.snapshot_before_lead_booking(uuid, date, date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;
-- lead attempts logged «حجز: …» stay (history)
commit;
