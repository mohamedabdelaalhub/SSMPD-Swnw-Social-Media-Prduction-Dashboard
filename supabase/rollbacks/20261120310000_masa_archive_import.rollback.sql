-- Rollback of 20261120310000_masa_archive_import.sql (drops the copied archive; nothing live depends on it).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_archive(text,jsonb)') is not null then
    drop function public.clinic_reception_fallback_api(text, jsonb);
    alter function clinic_reception.fallback_api_before_archive(text, jsonb) set schema public;
    alter function public.fallback_api_before_archive(text, jsonb) rename to clinic_reception_fallback_api;
    revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
    end if;
  end if;
end $$;
drop function if exists clinic_reception.masa_archive_import(jsonb);
drop function if exists clinic_reception.masa_patients_import(jsonb);
drop function if exists clinic_reception.masa_d(text);
drop function if exists clinic_reception.masa_phone_norm(text);
drop table if exists clinic_reception.masa_archive_bookings, clinic_reception.masa_patients;
commit;
