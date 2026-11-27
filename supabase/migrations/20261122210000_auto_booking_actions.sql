-- «حجوزات آلية» actions in «تشغيل اليوم» (owner 2026-11-22, mockup docs/ui-references/mockups/today-shortcuts-* approved «طبق يلا»).
-- Bookings that came from WhatsApp / Facebook / Instagram / the website live in public.customer_bookings, a MIRROR of Masa that the
-- agent sync rewrites every few minutes. The agent's Masa bridge cannot cancel / reschedule / mark no-show (deliberate no-ops), so
-- reception's decisions are kept HERE, beside the mirror, never written into it:
--   clinic_reception.auto_booking_state  — one row per customer booking: local status (cancelled / no_show / rescheduled / void_test),
--                                          reason, requested new date/time, name/phone correction, «مردّش» tries, «مش تجريبي».
--   clinic_reception.auto_booking_events — every action (who, when, what), plus a clinic_reception.audit row.
-- The screen shows «لازم يتلغي / يتغير على مسا كمان» until the mirror agrees (Masa state reaches the same status / time).
-- public.clinic_reception_auto_booking(workspace, action, payload):
--   list {date}                       → that day's mirror bookings with state, channel, linked doctor, registered flag
--   no_answer {id}                    → one more «مردّش» try (time + employee)
--   confirm {id}                      → back to «مؤكد» (clears a local cancel / no-show / reschedule)
--   no_show {id, note?}               → «لم يحضر» (refused once the arrival is registered)
--   cancel {id, reason_kind, note?}   → «ملغي» with a reason (other → note ≥ 3 letters); refused once registered
--   reschedule {id, date, time, note?}→ requested new time (date ≥ today, HH:MM)
--   edit {id, name?, phone?}          → name / phone correction used on this screen and for the arrival search
--   test_void {id}                    → hide a test booking (managers only)
--   not_test {id}                     → «مش تجريبي» (stop flagging it)
-- Access: 'book' (reception / customer service / GM / super admin on the live workspace); test_void needs manage. Nothing is deleted.
-- Rollback: supabase/rollbacks/20261122210000_auto_booking_actions.rollback.sql
begin;

do $$ begin
  if to_regclass('public.customer_bookings') is null or to_regprocedure('clinic_reception.access(uuid,text)') is null then
    raise exception 'مكونات الحجز الآلي غير موجودة'; end if;
  if to_regclass('clinic_reception.auto_booking_state') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.auto_booking_state(
  customer_booking_id uuid primary key references public.customer_bookings(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  local_status text check (local_status is null or local_status in ('cancelled','no_show','rescheduled','void_test')),
  reason text check (reason is null or length(reason) <= 300),
  new_date date, new_time text check (new_time is null or new_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  name_override text check (name_override is null or length(name_override) between 2 and 120),
  phone_override text check (phone_override is null or phone_override ~ '^01[0-9]{9}$'),
  tries integer not null default 0, last_try_at timestamptz, last_try_by uuid references public.admins(id),
  not_test boolean not null default false,
  updated_by uuid references public.admins(id), updated_at timestamptz not null default now()
);
create table clinic_reception.auto_booking_events(
  id bigint generated always as identity primary key,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  customer_booking_id uuid not null references public.customer_bookings(id) on delete cascade,
  action text not null, detail jsonb not null default '{}', actor_id uuid references public.admins(id),
  created_at timestamptz not null default now()
);
create index auto_booking_events_booking on clinic_reception.auto_booking_events(customer_booking_id, created_at desc);
alter table clinic_reception.auto_booking_state enable row level security;
alter table clinic_reception.auto_booking_events enable row level security;
revoke all on clinic_reception.auto_booking_state, clinic_reception.auto_booking_events from public, anon, authenticated;

create function public.clinic_reception_auto_booking(p_workspace uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p jsonb := coalesce(p_payload, '{}'::jsonb); bid uuid; cb public.customer_bookings%rowtype;
  st clinic_reception.auto_booking_state%rowtype; d date; why text; note text; registered boolean := false;
  today date := (now() at time zone 'Africa/Cairo')::date; kinds jsonb := '{"patient_excused":"المريض اعتذر","no_answer":"مردّش أكتر من مرة","doctor_absent":"الدكتور مش موجود","duplicate":"حجز مكرر","other":"أخرى"}';
begin
  me := clinic_reception.access(p_workspace, 'book');
  if jsonb_typeof(p) <> 'object' then raise exception 'بيانات غير صالحة'; end if;

  if p_action = 'list' then
    d := coalesce(nullif(p->>'date', '')::date, today);
    return jsonb_build_object('date', d, 'can_manage', clinic_reception.can_manage(p_workspace), 'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cb2.id, 'channel', cb2.channel, 'wa_id', cb2.wa_id, 'customer_name', cb2.customer_name, 'phone', cb2.phone,
        'doctor_name', coalesce(pr.name, cb2.doctor_name), 'specialty_name', cb2.specialty_name, 'provider_id', pr.id,
        'appointment_date', cb2.appointment_date, 'appointment_time', cb2.appointment_time, 'status', cb2.status,
        'booking_reference', cb2.booking_reference,
        'registered', exists (select 1 from clinic_reception.agent_booking_links al where al.customer_booking_id = cb2.id),
        'local_status', s.local_status, 'reason', s.reason, 'new_date', s.new_date, 'new_time', s.new_time,
        'name_override', s.name_override, 'phone_override', s.phone_override, 'tries', coalesce(s.tries, 0),
        'last_try_at', s.last_try_at, 'last_try_by', (select a.name from public.admins a where a.id = s.last_try_by),
        'not_test', coalesce(s.not_test, false)) order by cb2.appointment_time, cb2.created_at)
      from public.customer_bookings cb2
      left join clinic_reception.masa_doctor_links k on k.masa_doctor_id = cb2.masa_doctor_id and k.status = 'linked' and k.workspace_id = p_workspace
      left join clinic_reception.providers pr on pr.id = k.provider_id
      left join clinic_reception.auto_booking_state s on s.customer_booking_id = cb2.id
      where cb2.appointment_date = d), '[]'::jsonb));
  end if;

  bid := nullif(p->>'id', '')::uuid;
  select * into cb from public.customer_bookings where id = bid for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  registered := exists (select 1 from clinic_reception.agent_booking_links al where al.customer_booking_id = cb.id);
  insert into clinic_reception.auto_booking_state(customer_booking_id, workspace_id, updated_by) values (cb.id, p_workspace, me)
    on conflict (customer_booking_id) do nothing;
  select * into st from clinic_reception.auto_booking_state where customer_booking_id = cb.id for update;
  note := left(nullif(btrim(coalesce(p->>'note', '')), ''), 200);

  if p_action = 'no_answer' then
    update clinic_reception.auto_booking_state set tries = tries + 1, last_try_at = now(), last_try_by = me, updated_by = me, updated_at = now()
     where customer_booking_id = cb.id;
  elsif p_action = 'confirm' then
    update clinic_reception.auto_booking_state set local_status = null, reason = null, new_date = null, new_time = null, updated_by = me, updated_at = now()
     where customer_booking_id = cb.id;
  elsif p_action = 'no_show' then
    if registered then raise exception 'الحجز ده اتسجل وصوله — «لم يحضر» من الجدول نفسه'; end if;
    update clinic_reception.auto_booking_state set local_status = 'no_show', reason = note, updated_by = me, updated_at = now() where customer_booking_id = cb.id;
  elsif p_action = 'cancel' then
    if registered then raise exception 'الحجز ده اتسجل وصوله — الإلغاء من الجدول نفسه'; end if;
    if not (kinds ? coalesce(p->>'reason_kind', '')) then raise exception 'اختار سبب الإلغاء'; end if;
    if p->>'reason_kind' = 'other' and length(coalesce(note, '')) < 3 then raise exception 'اكتب سبب الإلغاء'; end if;
    why := (kinds->>(p->>'reason_kind')) || coalesce(' — ' || note, '');
    update clinic_reception.auto_booking_state set local_status = 'cancelled', reason = why, updated_by = me, updated_at = now() where customer_booking_id = cb.id;
  elsif p_action = 'reschedule' then
    if registered then raise exception 'الحجز ده اتسجل وصوله — تعديل الميعاد من الجدول نفسه'; end if;
    d := nullif(p->>'date', '')::date;
    if d is null or d < today then raise exception 'اختار يوم النهارده أو بعده'; end if;
    if coalesce(p->>'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'اكتب الساعة'; end if;
    update clinic_reception.auto_booking_state set local_status = 'rescheduled', new_date = d, new_time = p->>'time', reason = note, updated_by = me, updated_at = now()
     where customer_booking_id = cb.id;
  elsif p_action = 'edit' then
    if nullif(btrim(coalesce(p->>'name', '')), '') is not null and length(btrim(p->>'name')) not between 2 and 120 then raise exception 'راجع الاسم'; end if;
    if nullif(btrim(coalesce(p->>'phone', '')), '') is not null and btrim(p->>'phone') !~ '^01[0-9]{9}$' then raise exception 'رقم الموبايل لازم 11 رقم ويبدأ بـ 01'; end if;
    update clinic_reception.auto_booking_state set name_override = nullif(btrim(coalesce(p->>'name', '')), ''), phone_override = nullif(btrim(coalesce(p->>'phone', '')), ''),
      updated_by = me, updated_at = now() where customer_booking_id = cb.id;
  elsif p_action = 'test_void' then
    if not clinic_reception.can_manage(p_workspace) then raise exception 'حذف الحجز التجريبي للمديرين بس' using errcode = '42501'; end if;
    if registered then raise exception 'الحجز ده اتسجل وصوله — مينفعش يتشال كتجريبي'; end if;
    update clinic_reception.auto_booking_state set local_status = 'void_test', reason = coalesce(note, 'حجز تجريبي'), updated_by = me, updated_at = now() where customer_booking_id = cb.id;
  elsif p_action = 'not_test' then
    update clinic_reception.auto_booking_state set not_test = true, updated_by = me, updated_at = now() where customer_booking_id = cb.id;
  else
    raise exception 'إجراء غير معروف';
  end if;

  insert into clinic_reception.auto_booking_events(workspace_id, customer_booking_id, action, detail, actor_id)
    values (p_workspace, cb.id, p_action, p - 'id', me);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'auto_booking_' || p_action, cb.id, (p - 'id') || jsonb_build_object('channel', cb.channel));
  select * into st from clinic_reception.auto_booking_state where customer_booking_id = cb.id;
  return jsonb_build_object('id', cb.id, 'local_status', st.local_status, 'tries', st.tries, 'reason', st.reason);
end $$;
revoke all on function public.clinic_reception_auto_booking(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_booking(uuid, text, jsonb) to authenticated;

commit;
