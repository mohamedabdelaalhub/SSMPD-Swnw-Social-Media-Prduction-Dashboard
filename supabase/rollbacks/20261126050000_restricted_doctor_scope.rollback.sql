-- Rollback of 20261126050000_restricted_doctor_scope.sql: restores the saved bodies (booking / order / execution / arrival gates,
-- serves_service), unwraps the snapshot, the readiness report and has_provider_service_scope, drops the helper.
-- Drops clinic_reception.provider_restricted_departments_set (the explicit restriction list, e.g. Dr Dalia's 2 rows).
-- Scope rows are data and stay (the ortho rows of supabase/ops/20261126050000_dalia_ortho_scopes.sql included): without the
-- restriction a scope row inside a doctor's own / extra department changes nothing, so she is back to «all services of her
-- departments».
begin;
do $$ declare r record; n int := 0; begin
  if to_regclass('clinic_reception.restricted_scope_saved_defs') is null then raise exception 'الملف مش متطبق'; end if;
  for r in select sig, def from clinic_reception.restricted_scope_saved_defs loop
    execute r.def; n := n + 1;
  end loop;
  if n < 4 then raise exception 'النسخ المحفوظة ناقصة (لقيت % من 4)', n; end if;
end $$;
revoke all on function clinic_reception.serves_service(uuid, text, text) from public, anon, authenticated;

drop function public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_restricted_scope(uuid, date, date) set schema public;
alter function public.snapshot_before_restricted_scope(uuid, date, date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;

drop function public.clinic_reception_booking_readiness(uuid);
alter function clinic_reception.booking_readiness_before_restricted(uuid) set schema public;
alter function public.booking_readiness_before_restricted(uuid) rename to clinic_reception_booking_readiness;
revoke all on function public.clinic_reception_booking_readiness(uuid) from public, anon;
grant execute on function public.clinic_reception_booking_readiness(uuid) to authenticated;

drop function clinic_reception.has_provider_service_scope(uuid, text, date);
alter function clinic_reception.has_provider_service_scope_before_restricted(uuid, text, date) rename to has_provider_service_scope;
revoke all on function clinic_reception.has_provider_service_scope(uuid, text, date) from public, anon, authenticated;
drop function clinic_reception.scope_refusal(uuid, text, text, text);
drop function clinic_reception.provider_serves_code(uuid, text, text, date);
drop function clinic_reception.provider_restricted_departments(uuid);
drop table clinic_reception.provider_restricted_departments_set;
drop table clinic_reception.restricted_scope_saved_defs;
notify pgrst, 'reload schema';
commit;
