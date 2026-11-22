-- «حجز بميعاد يدوي (متفق عليه مع الدكتور)» (owner 2026-11-22, mockup docs/ui-references/mockups/booking-manual-time-*
-- approved «طبقه»): when the system shows no free time, reception books at a time it types, because doctor / reception
-- arrangements are not always in the system.
-- clinic_reception_command('book' | 'reschedule', {..., manual_time: true, manual_reason_kind, manual_reason}):
--   * reason kind: doctor_agreement «اتفاق مع الدكتور» | doctor_other_time «الدكتور جاي في ميعاد تاني» | other «أخرى»
--     (other needs a text ≥ 3 letters); optional note (≤ 200);
--   * if the doctor's availability does not cover the slot, a one-off availability row (source 'manual') is added for
--     exactly that slot, then the normal booking runs — so official center closures, the doctor-overlap / capacity,
--     gap and same-patient checks all still apply (a refused booking adds nothing: same transaction);
--   * the appointment is flagged manual_time with manual_reason and manual_by; audit row 'manual_time'.
-- New outermost wrapper (previous → clinic_reception.command_before_manual_time); every other call passes through.
-- Rollback: supabase/rollbacks/20261122080000_booking_manual_time.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regclass('clinic_reception.availability') is null then raise exception 'مكونات الحجز غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_manual_time(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.appointments
  add column if not exists manual_time boolean not null default false,
  add column if not exists manual_reason text check (manual_reason is null or length(manual_reason) <= 300),
  add column if not exists manual_by uuid references public.admins(id);

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_manual_time;
  alter function public.command_before_manual_time(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_manual_time(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; kind text; note text; why text; t timestamptz; e timestamptz; mins integer; prov uuid; ap clinic_reception.appointments%rowtype;
  out jsonb; b jsonb;
begin
  if p_action not in ('book', 'reschedule') or jsonb_typeof(p_payload) <> 'object'
     or not coalesce((p_payload->>'manual_time')::boolean, false) then
    return clinic_reception.command_before_manual_time(p_workspace, p_action, p_payload - 'manual_time' - 'manual_reason_kind' - 'manual_reason', p_token);
  end if;
  me := clinic_reception.access(p_workspace, 'book');
  kind := coalesce(p_payload->>'manual_reason_kind', '');
  note := left(nullif(btrim(coalesce(p_payload->>'manual_reason', '')), ''), 200);
  if kind not in ('doctor_agreement', 'doctor_other_time', 'other') then raise exception 'اختار سبب الميعاد اليدوي'; end if;
  if kind = 'other' and length(coalesce(note, '')) < 3 then raise exception 'اكتب سبب الميعاد اليدوي'; end if;
  why := case kind when 'doctor_agreement' then 'اتفاق مع الدكتور' when 'doctor_other_time' then 'الدكتور جاي في ميعاد تاني' else 'أخرى' end
         || coalesce(' — ' || note, '');
  t := nullif(p_payload->>'starts_at', '')::timestamptz;
  if t is null then raise exception 'اكتب ساعة الميعاد اليدوي'; end if;
  if p_action = 'reschedule' then
    select * into ap from clinic_reception.appointments a
     where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid;
  end if;
  prov := coalesce(nullif(p_payload->>'provider_id', '')::uuid, ap.provider_id);
  if not exists (select 1 from clinic_reception.providers where id = prov and workspace_id = p_workspace and active) then
    raise exception 'اختار الطبيب'; end if;
  if nullif(p_payload->>'minutes', '') is not null then
    if p_payload->>'minutes' !~ '^[0-9]{1,3}$' then raise exception 'مدة الجلسة غير صحيحة'; end if;
    mins := (p_payload->>'minutes')::integer;
  else
    select s.minutes into mins from clinic_reception.services s
     where s.workspace_id = p_workspace and s.id = coalesce(nullif(p_payload->>'service_id', '')::uuid, ap.service_id);
  end if;
  mins := coalesce(mins, 30);
  if mins not between 5 and 480 then raise exception 'مدة الجلسة من ٥ لـ ٤٨٠ دقيقة'; end if;
  e := t + make_interval(mins => mins);
  if not exists (select 1 from clinic_reception.availability a
                  where a.workspace_id = p_workspace and a.provider_id = prov and a.starts_at <= t and a.ends_at >= e) then
    insert into clinic_reception.availability(workspace_id, provider_id, starts_at, ends_at, source)
      values (p_workspace, prov, t, e, 'manual')
      on conflict (provider_id, starts_at) do update set ends_at = greatest(clinic_reception.availability.ends_at, excluded.ends_at);
  end if;
  b := p_payload - 'manual_time' - 'manual_reason_kind' - 'manual_reason';
  out := clinic_reception.command_before_manual_time(p_workspace, p_action, b, p_token);
  update clinic_reception.appointments set manual_time = true, manual_reason = why, manual_by = me
   where workspace_id = p_workspace and id = coalesce(nullif(out->>'id', '')::uuid, nullif(p_payload->>'id', '')::uuid);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'manual_time', coalesce(nullif(out->>'id', '')::uuid, nullif(p_payload->>'id', '')::uuid),
            jsonb_build_object('starts_at', t, 'ends_at', e, 'provider_id', prov, 'reason', why));
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
