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
do $hub$ begin
  if to_regprocedure('clinic_reception.journey_hub_before_lead_booking(uuid,date)') is null then return; end if;
  drop function public.clinic_reception_journey_hub_snapshot(uuid, date);
  alter function clinic_reception.journey_hub_before_lead_booking(uuid, date) set schema public;
  alter function public.journey_hub_before_lead_booking(uuid, date) rename to clinic_reception_journey_hub_snapshot;
  revoke all on function public.clinic_reception_journey_hub_snapshot(uuid, date) from public, anon;
  grant execute on function public.clinic_reception_journey_hub_snapshot(uuid, date) to authenticated;
end $hub$;
-- lead attempts logged «حجز: …» stay (history)
commit;
