begin;
drop trigger if exists appointments_same_patient_overlap on clinic_reception.appointments;
drop function if exists clinic_reception.same_patient_overlap();
drop function if exists public.clinic_reception_appointment_details(uuid, uuid);
do $$ begin
  if to_regprocedure('clinic_reception.command_before_same_patient(uuid,text,jsonb,uuid)') is not null then
    drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
    alter function clinic_reception.command_before_same_patient(uuid, text, jsonb, uuid) set schema public;
    alter function public.command_before_same_patient(uuid, text, jsonb, uuid) rename to clinic_reception_command;
    revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
    grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
  end if;
end $$;
drop function if exists clinic_reception.same_patient_day(uuid, uuid, date);
commit;
