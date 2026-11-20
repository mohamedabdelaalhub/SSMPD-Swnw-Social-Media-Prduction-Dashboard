begin;
do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_age(text,jsonb)') is not null then
    drop function public.clinic_reception_fallback_api(text, jsonb);
    alter function clinic_reception.fallback_api_before_age(text, jsonb) set schema public;
    alter function public.fallback_api_before_age(text, jsonb) rename to clinic_reception_fallback_api;
    revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
    end if;
  end if;
end $$;
alter table clinic_reception.masa_bookings drop column if exists patient_age;
commit;
