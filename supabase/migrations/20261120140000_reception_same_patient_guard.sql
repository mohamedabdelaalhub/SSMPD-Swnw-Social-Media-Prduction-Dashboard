-- Same patient booked twice (owner 2026-11-19, screenshot of one patient at 5:00 and 6:00; mockup approved «موافق»):
-- 1. The same patient can never hold two active appointments (booked / arrived) whose times overlap — every path
--    (book, reschedule, walk-in, automatic bookings). Rows that already overlap are left alone unless their time moves.
-- 2. Booking a patient who already has an active appointment that day (any doctor) needs an explicit confirmation:
--    clinic_reception_command('book' | 'walk_in') answers HINT 'same_patient_same_day' with the other bookings
--    (time, service, doctor, status, source, who booked it, note) in DETAIL; the screen shows them and, if reception
--    confirms it is the same patient for another service, sends the booking again with same_day_ok = true.
--    Automatic bookings (20261120130000) are not asked: the booking already exists on Masa / WhatsApp / the portal, and
--    the same doctor on the same day is already merged there. Recognised by its queued row (same patient, doctor, time).
-- Rollback: supabase/rollbacks/20261120140000_reception_same_patient_guard.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.appointments') is null or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regclass('clinic_reception.external_bookings') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.command_before_same_patient(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

create function clinic_reception.same_patient_overlap() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare x record;
begin
  if new.status not in ('booked', 'arrived') then return new; end if;
  if tg_op = 'UPDATE' and old.patient_id = new.patient_id and old.starts_at = new.starts_at and old.ends_at = new.ends_at
     and old.status in ('booked', 'arrived') then return new; end if;
  select a.starts_at, a.ends_at, coalesce(s.name, 'موعد') as svc, coalesce(pr.name, 'الطبيب') as doc into x
    from clinic_reception.appointments a
    left join clinic_reception.services s on s.id = a.service_id left join clinic_reception.providers pr on pr.id = a.provider_id
    where a.patient_id = new.patient_id and a.id <> new.id and a.status in ('booked', 'arrived')
      and a.starts_at < new.ends_at and a.ends_at > new.starts_at
    order by a.starts_at limit 1;
  if found then
    raise exception 'المريض ده محجوز في نفس الوقت: % مع % (% – %). اختار ساعة تانية أو عدّل الحجز الأساسي', x.svc, x.doc,
      to_char(x.starts_at at time zone 'Africa/Cairo', 'HH24:MI'), to_char(x.ends_at at time zone 'Africa/Cairo', 'HH24:MI')
      using hint = 'same_patient_overlap';
  end if;
  return new;
end $$;
revoke all on function clinic_reception.same_patient_overlap() from public, anon, authenticated;
create trigger appointments_same_patient_overlap before insert or update of patient_id, starts_at, ends_at, status
  on clinic_reception.appointments for each row execute function clinic_reception.same_patient_overlap();

-- The patient's other active appointments on a Cairo day, for the warning and the details popup.
create function clinic_reception.same_patient_day(p_workspace uuid, p_patient uuid, p_day date) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status,
      'confirmed', a.confirmed_at is not null, 'service', s.name, 'doctor', pr.name, 'department', pr.department,
      'source', a.source, 'booked_by', ad.name, 'booked_at', a.created_at, 'patient', rp.name, 'file_no', rp.file_no,
      'note', (select e.note from clinic_reception.appointment_extras e where e.appointment_id = a.id)) order by a.starts_at)
  from clinic_reception.appointments a
  join clinic_reception.patients rp on rp.id = a.patient_id
  left join clinic_reception.services s on s.id = a.service_id left join clinic_reception.providers pr on pr.id = a.provider_id
  left join public.admins ad on ad.id = a.created_by
  where a.workspace_id = p_workspace and a.patient_id = p_patient and a.status in ('booked', 'arrived')
    and (a.starts_at at time zone 'Africa/Cairo')::date = p_day
$$;
revoke all on function clinic_reception.same_patient_day(uuid, uuid, date) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_same_patient;
  alter function public.command_before_same_patient(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_same_patient(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare t timestamptz; others jsonb; pid uuid;
begin
  if p_action in ('book', 'walk_in') and jsonb_typeof(p_payload) = 'object'
     and not coalesce((p_payload->>'same_day_ok')::boolean, false) and nullif(p_payload->>'patient_id', '') is not null then
    perform clinic_reception.access(p_workspace, 'book');
    pid := (p_payload->>'patient_id')::uuid;
    t := case when p_action = 'walk_in' then now() else nullif(p_payload->>'starts_at', '')::timestamptz end;
    if t is not null and p_action = 'book' and exists (select 1 from clinic_reception.external_bookings e
        where e.reception_patient_id = pid and e.provider_id = nullif(p_payload->>'provider_id', '')::uuid and e.starts_at = t
          and e.state not in ('booked', 'merged', 'cancelled', 'skipped')) then
      t := null;   -- an automatic booking being booked now
    end if;
    if t is not null then
      others := clinic_reception.same_patient_day(p_workspace, pid, (t at time zone 'Africa/Cairo')::date);
      if others is not null then
        raise exception 'المريض ده عنده حجز تاني في نفس اليوم — راجع الحجز قبل ما تكمّل'
          using hint = 'same_patient_same_day', detail = others::text;
      end if;
    end if;
  end if;
  return clinic_reception.command_before_same_patient(p_workspace, p_action, p_payload, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- Details popup for any appointment the user can see (same access as the reception screen).
create function public.clinic_reception_appointment_details(p_workspace uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare a clinic_reception.appointments%rowtype; v jsonb;
begin
  perform clinic_reception.access(p_workspace, 'view');
  select * into a from clinic_reception.appointments where id = p_id and workspace_id = p_workspace;
  if not found then raise exception 'الحجز غير موجود'; end if;
  select x into v from jsonb_array_elements(coalesce(clinic_reception.same_patient_day(p_workspace, a.patient_id,
    (a.starts_at at time zone 'Africa/Cairo')::date), '[]')) x where x->>'id' = a.id::text;
  if v is null then   -- cancelled / finished: build it directly
    select jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'confirmed', a.confirmed_at is not null,
      'service', (select name from clinic_reception.services where id = a.service_id), 'doctor', (select name from clinic_reception.providers where id = a.provider_id),
      'source', a.source, 'booked_by', (select name from public.admins where id = a.created_by), 'booked_at', a.created_at,
      'patient', (select name from clinic_reception.patients where id = a.patient_id), 'file_no', (select file_no from clinic_reception.patients where id = a.patient_id),
      'note', (select e.note from clinic_reception.appointment_extras e where e.appointment_id = a.id)) into v;
  end if;
  return v;
end $$;
revoke all on function public.clinic_reception_appointment_details(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_appointment_details(uuid, uuid) to authenticated;

commit;
