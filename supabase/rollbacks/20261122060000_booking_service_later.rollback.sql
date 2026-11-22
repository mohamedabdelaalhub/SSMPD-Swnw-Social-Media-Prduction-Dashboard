-- Refuses while a booking still waits for its service (choose the service or cancel those bookings first).
begin;
do $$ begin
  if exists (select 1 from clinic_reception.appointments where service_later and status = 'booked') then
    raise exception 'فيه حجوزات «الخدمة تتحدد عند الحضور» لسه مستنية — حدد خدمتها أو ألغيها الأول';
  end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_service_later(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_service_later(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_service_later(uuid, date, date) set schema public;
alter function public.snapshot_before_service_later(uuid, date, date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;
drop function clinic_reception.has_provider_service_scope(uuid, text, date);
alter function clinic_reception.has_provider_service_scope_before_later(uuid, text, date) rename to has_provider_service_scope;
drop function clinic_reception.service_later_id(uuid, text);
drop function clinic_reception.provider_serves(uuid, text);
-- services.placeholder rows (inactive), services.placeholder and appointments.service_later kept (history)
commit;
