begin;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_arrival_qty(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_arrival_qty(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop trigger if exists booking_order_areas on clinic_reception.orders;
drop function if exists clinic_reception.booking_order_areas();
-- appointments.session_areas kept (data)
commit;
