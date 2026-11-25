-- Rollback of 20261125130000_package_partial_pulse.sql: restores order_use_package and clinic_reception_legacy_packages.
-- Pulse orders already attached / executed keep their link and quantities (the entitlement balances stay correct).
begin;
do $$ declare r record; begin
  if to_regprocedure('clinic_reception.order_use_package_before_pulse(uuid,jsonb,uuid)') is null then raise exception 'الملف مش متطبق'; end if;
  drop function clinic_reception.order_use_package(uuid, jsonb, uuid);
  drop function clinic_reception.order_use_package_before_pulse(uuid, jsonb, uuid);
  for r in select def from clinic_reception.package_pulse_saved loop execute r.def; end loop;
end $$;
revoke all on function clinic_reception.order_use_package(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.clinic_reception_legacy_packages(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_legacy_packages(uuid, uuid) to authenticated;
drop table clinic_reception.package_pulse_saved;
drop function clinic_reception.pulse_entitlement(uuid);
commit;
