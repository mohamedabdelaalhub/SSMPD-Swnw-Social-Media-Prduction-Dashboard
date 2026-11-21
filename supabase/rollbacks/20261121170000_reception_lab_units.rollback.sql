-- Rollback of 20261121170000_reception_lab_units.sql (provider capacity + extra departments).
begin;
drop function if exists public.clinic_reception_snapshot(uuid,date,date);
alter function clinic_reception.snapshot_before_lab_units(uuid,date,date) set schema public;
alter function public.snapshot_before_lab_units(uuid,date,date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
do $$ declare r record; begin
  for r in select def from clinic_reception.lab_units_saved_defs loop execute r.def; end loop;
end $$;
drop function clinic_reception.has_provider_service_scope(uuid,text,date);
alter function clinic_reception.has_provider_service_scope_base(uuid,text,date) rename to has_provider_service_scope;
drop table clinic_reception.lab_units_saved_defs;
drop table clinic_reception.provider_departments;
alter table clinic_reception.providers drop column if exists capacity, drop column if exists booking_gap;
commit;
