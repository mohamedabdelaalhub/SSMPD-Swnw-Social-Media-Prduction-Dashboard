-- Rollback of 20261117200000_reception_booking_gap.sql: reverse the text patches, drop the trigger, helper and column.
begin;
do $rb$
declare
  f text; i int;
  targets text[] := array[
    'clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)',
    'clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)',
    'clinic_reception.fallback_api(text,jsonb)',
    'public.clinic_reception_command(uuid,text,jsonb,uuid)',
    'public.clinic_reception_journey_reschedule_slots(uuid,uuid,date)',
    'public.clinic_reception_journey_reschedule_slots(uuid,uuid,date)'];
  anchors text[] := array[
    'a.starts_at < p_end and a.ends_at > p_start',
    'f.starts_at < p_end and f.ends_at > p_start',
    't := e;',
    'a.starts_at<t+make_interval(mins=>mins) and a.ends_at>t',
    'make_interval(mins=>mins)
    ) gs',
    'other.starts_at<s.ends_at and other.ends_at>s.starts_at'];
  repl text[] := array[
    'a.starts_at < p_end + clinic_reception.provider_gap(p_provider) and a.ends_at + clinic_reception.provider_gap(p_provider) > p_start',
    'f.starts_at < p_end + clinic_reception.provider_gap(p_provider) and f.ends_at + clinic_reception.provider_gap(p_provider) > p_start',
    't := e + clinic_reception.provider_gap(pr.id);',
    'a.starts_at<t+make_interval(mins=>mins)+clinic_reception.provider_gap(prov) and a.ends_at+clinic_reception.provider_gap(prov)>t',
    'make_interval(mins=>mins)+clinic_reception.provider_gap(a.provider_id)
    ) gs',
    'other.starts_at<s.ends_at+clinic_reception.provider_gap(a.provider_id) and other.ends_at+clinic_reception.provider_gap(a.provider_id)>s.starts_at'];
begin
  for i in 1 .. array_length(targets, 1) loop
    if to_regprocedure(targets[i]) is null then continue; end if;
    f := pg_get_functiondef(targets[i]::regprocedure);
    if position(repl[i] in f) > 0 then execute replace(f, repl[i], anchors[i]); end if;
  end loop;
end $rb$;
drop trigger if exists appointments_respect_gap on clinic_reception.appointments;
drop function if exists clinic_reception.appointments_respect_gap();
drop function if exists clinic_reception.provider_gap(uuid);
alter table clinic_reception.workspaces drop column if exists booking_gap_minutes;
commit;
