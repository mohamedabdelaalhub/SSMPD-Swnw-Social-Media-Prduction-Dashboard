-- Masa bookings made "for a day" without a time (owner 2026-11-23 «طبق حل الحجوزات», mockup
-- docs/ui-references/mockups/masa-day-only-auto-time-*). Masa stores them at 00:00 (day_only); until now they waited in
-- «حجوزات من غير ساعة» (state needs_time) and failed on the day when the doctor's hours were already full.
--   * auto_book_one: a day-only booking is placed at once in the doctor's FIRST FREE time that day
--     (clinic_reception.auto_book_place_day_only): same patient + doctor + day → linked (merged) first; then the doctor's service
--     for the Masa booking; then each free start (5-minute steps inside the doctor's availability, not overlapping another
--     booking) is tried through the normal reception command, so every booking rule still applies. Placed → state booked,
--     auto_timed, time_told_at null («بلّغ المريض بالميعاد»). Nothing free → review kind 'full_day' («يوم الدكتور مليان»).
--     If Masa later moves the day, the appointment is moved to the first free time of the new day.
--   * auto_book_enqueue: a resync of the same day-only row no longer flips it back to pending every time; a real Masa time
--     (day_only false) still reschedules; rows staff fixed by hand (pinned) keep their day/time (Masa cancellation still applies).
--   * public.clinic_reception_auto_book:
--       extras {ids}       → per row: free times that day, nearest free times on other days, the doctor's day capacity
--       capacity {provider_id, from, to} → per day: booked (incl. overbook) / capacity (availability minutes ÷ service minutes)
--       set_time {id, starts_at, mode: normal | overbook | manual, reason_kind, reason}: any day; overbook / manual use the
--                          existing reception commands (limits, reasons, one-off availability) ; the row is pinned
--       told {id}          → «اتبلّغ المريض»
--     list rows also carry auto_timed / time_told_at / pinned.
--   * one pass at apply time re-places the waiting needs_time rows (today first) as the system account when auto booking is on.
-- No extra doctor hours are opened and nothing is sent to Masa.
-- Rollback: supabase/rollbacks/20261122330000_masa_day_only_auto_time.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.external_bookings') is null or to_regprocedure('clinic_reception.auto_book_one(uuid)') is null
     or to_regprocedure('public.clinic_reception_auto_book(uuid,text,jsonb)') is null then raise exception 'الحجز التلقائي غير موجود'; end if;
  if to_regprocedure('clinic_reception.auto_book_place_day_only(uuid,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.external_bookings
  add column auto_timed boolean not null default false,
  add column time_told_at timestamptz,
  add column time_told_by uuid references public.admins(id),
  add column pinned boolean not null default false;
alter table clinic_reception.external_bookings drop constraint if exists external_bookings_review_kind_check;
alter table clinic_reception.external_bookings add constraint external_bookings_review_kind_check
  check (review_kind in ('patient','age','service','doctor','slot','full_day'));

create table clinic_reception.auto_time_saved_defs(name text primary key, def text not null);
alter table clinic_reception.auto_time_saved_defs enable row level security;
revoke all on clinic_reception.auto_time_saved_defs from public, anon, authenticated;
insert into clinic_reception.auto_time_saved_defs values
  ('auto_book_one', pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)),
  ('auto_book_enqueue', pg_get_functiondef('clinic_reception.auto_book_enqueue(jsonb)'::regprocedure)),
  ('clinic_reception_auto_book', pg_get_functiondef('public.clinic_reception_auto_book(uuid,text,jsonb)'::regprocedure));

-- the doctor's service for a Masa row: the Masa service text first (when that helper exists), then the doctor's saved
-- auto-book service, then the service this doctor is booked for most in his own department, then a «كشف» of his department.
-- Only a service of the doctor's own department is returned (reception refuses others: «الطبيب خارج تخصص الخدمة»).
create function clinic_reception.auto_time_service(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid; dept text;
begin
  select department into dept from clinic_reception.providers where id = p_provider and workspace_id = p_workspace;
  if dept is null then return null; end if;
  if to_regprocedure('clinic_reception.auto_book_service_for(uuid,uuid,text)') is not null then
    execute 'select clinic_reception.auto_book_service_for($1, $2, $3)' into v using p_workspace, p_provider, p_needed;
    if v is not null and exists (select 1 from clinic_reception.services where id = v and active and department = dept) then return v; end if;
  end if;
  v := clinic_reception.auto_book_service(p_workspace, p_provider);
  if v is not null and exists (select 1 from clinic_reception.services where id = v and active and department = dept) then return v; end if;
  select x.service_id into v from clinic_reception.appointments x join clinic_reception.services s on s.id = x.service_id
   where x.provider_id = p_provider and s.active and s.department = dept and x.status not in ('cancelled')
   group by x.service_id order by count(*) desc limit 1;
  if v is not null then return v; end if;
  select s.id into v from clinic_reception.services s where s.workspace_id = p_workspace and s.active and s.department = dept
   order by (s.name like '%كشف%') desc, s.minutes, s.name limit 1;
  return v;
end $$;

-- free starts of a doctor on a Cairo day: 5-minute steps inside availability, after now, not overlapping a booking
create function clinic_reception.free_starts(p_provider uuid, p_day date, p_minutes int, p_limit int default 60)
returns setof timestamptz language sql stable security definer set search_path = pg_catalog, public as $$
  select t from (
    select distinct g.t from clinic_reception.availability a,
      lateral generate_series(a.starts_at, a.ends_at - make_interval(mins => greatest(p_minutes, 5)), interval '5 minutes') g(t)
     where a.provider_id = p_provider and (a.starts_at at time zone 'Africa/Cairo')::date = p_day) s
   where s.t >= now() + interval '5 minutes'
     and not exists (select 1 from clinic_reception.appointments x where x.provider_id = p_provider
                      and x.status not in ('cancelled', 'no_show') and not coalesce(x.overbook, false)
                      and x.starts_at < s.t + make_interval(mins => greatest(p_minutes, 5)) and x.ends_at > s.t)
   order by s.t limit greatest(p_limit, 1)
$$;

create function clinic_reception.day_capacity(p_workspace uuid, p_provider uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare mins int; avail numeric; booked int;
begin
  select s.minutes into mins from clinic_reception.services s where s.id = clinic_reception.auto_time_service(p_workspace, p_provider, null);
  mins := greatest(coalesce(mins, 15), 5);
  select coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60), 0) into avail from clinic_reception.availability a
   where a.provider_id = p_provider and (a.starts_at at time zone 'Africa/Cairo')::date = p_day;
  select count(*) into booked from clinic_reception.appointments x where x.provider_id = p_provider
     and x.status not in ('cancelled', 'no_show') and (x.starts_at at time zone 'Africa/Cairo')::date = p_day;
  return jsonb_build_object('day', p_day, 'booked', booked, 'capacity', floor(avail / mins)::int, 'minutes', mins,
    'full', avail > 0 and booked >= floor(avail / mins));
end $$;

create function clinic_reception.auto_book_place_day_only(p_id uuid, p_workspace uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare b clinic_reception.external_bookings%rowtype; appt clinic_reception.appointments%rowtype; svc uuid; mins int; t timestamptz;
  r jsonb; placed timestamptz; err text; tried int := 0;
begin
  select * into b from clinic_reception.external_bookings where id = p_id for update;
  if b.appointment_id is not null then
    select * into appt from clinic_reception.appointments where id = b.appointment_id;
    if found and appt.status not in ('cancelled', 'no_show') and clinic_reception.cairo_day(appt.starts_at) = b.day
       and appt.provider_id = b.provider_id then
      update clinic_reception.external_bookings set starts_at = appt.starts_at,
        state = case when state = 'merged' then 'merged' else 'booked' end, review_kind = null, reason = null, updated_at = now() where id = b.id;
      return 'unchanged';
    end if;
    if not found or appt.status <> 'booked' then appt := null; end if;
  end if;
  -- the same patient already has this doctor that day → link, never book twice
  if appt.id is null then
    select * into appt from clinic_reception.appointments a where a.workspace_id = p_workspace and a.patient_id = b.reception_patient_id
       and a.provider_id = b.provider_id and clinic_reception.cairo_day(a.starts_at) = b.day and a.status not in ('cancelled', 'no_show')
     order by a.starts_at limit 1;
    if found then
      update clinic_reception.external_bookings set appointment_id = appt.id, starts_at = appt.starts_at, auto_timed = false,
        state = 'merged', review_kind = null, reason = null, updated_at = now() where id = b.id;
      return 'merged';
    end if;
    appt := null;
  end if;
  svc := coalesce(appt.service_id, clinic_reception.auto_time_service(p_workspace, b.provider_id, b.needed_service));
  if svc is null then
    return clinic_reception.auto_book_review(b.id, 'service', 'اختار خدمة الحجز للدكتور ده مرة واحدة وهتتحفظ للحجوزات الجاية');
  end if;
  select minutes into mins from clinic_reception.services where id = svc;
  for t in select x from clinic_reception.free_starts(b.provider_id, b.day, coalesce(mins, 15), 96) x loop
    tried := tried + 1;
    begin
      if appt.id is not null then
        r := public.clinic_reception_command(p_workspace, 'reschedule', jsonb_build_object('id', appt.id, 'patient_id', b.reception_patient_id,
          'provider_id', b.provider_id, 'service_id', appt.service_id, 'starts_at', t), gen_random_uuid());
      else
        r := public.clinic_reception_command(p_workspace, 'book', jsonb_build_object('patient_id', b.reception_patient_id,
          'provider_id', b.provider_id, 'service_id', svc, 'starts_at', t, 'source', 'unknown', 'source_evidence', 'unknown'), gen_random_uuid());
      end if;
      placed := t;
      exit;
    exception when others then
      err := sqlerrm;
    end;
  end loop;
  if placed is null and tried > 0 then   -- free times exist but the booking rules refused all of them: say why
    return clinic_reception.auto_book_review(b.id, 'slot', 'مقدرتش أسجّل أول ميعاد فاضي: ' || coalesce(err, 'سبب غير معروف'));
  end if;
  if placed is null then
    return clinic_reception.auto_book_review(b.id, 'full_day',
      'يوم الدكتور مليان — مفيش ميعاد فاضي في اليوم ده. اختار وقت من الأيام اللي جنبه، أو حجز إضافي فوق الجدول، أو ميعاد يدوي، أو كلّم المريض للتأجيل.');
  end if;
  update clinic_reception.external_bookings set starts_at = placed, appointment_id = coalesce(appt.id, (r->>'id')::uuid), auto_timed = true,
    time_told_at = null, time_told_by = null, state = 'booked', review_kind = null, reason = null, updated_at = now() where id = b.id;
  return 'booked';
end $$;

-- auto_book_one: day-only → place it now (was: wait as needs_time); plainer slot error
do $$ declare d text := pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure);
  a1 text := $a$  if b.day_only or b.starts_at is null then
    update clinic_reception.external_bookings set state = 'needs_time', review_kind = null, reason = null, updated_at = now() where id = b.id;
    return 'needs_time';
  end if;$a$;
  a2 text := $a$'مقدرتش أسجّل الميعاد: ' || sqlerrm$a$;
begin
  if (length(d) - length(replace(d, a1, ''))) <> length(a1) then raise exception 'auto_book_one: day-only anchor not found once'; end if;
  if (length(d) - length(replace(d, a2, ''))) <> length(a2) then raise exception 'auto_book_one: slot anchor not found once'; end if;
  d := replace(d, a1, $b$  if b.day_only or b.starts_at is null then
    return clinic_reception.auto_book_place_day_only(b.id, ws);
  end if;$b$);
  d := replace(d, a2, $b$'مقدرتش أسجّل الميعاد ده: ' || sqlerrm || ' — اختار وقت من الأوقات الفاضية أو «حجز إضافي فوق الجدول»'$b$);
  execute d;
end $$;

-- auto_book_enqueue: keep day-only rows still on resync, follow a Masa day change, keep rows staff pinned
do $$ declare d text := pg_get_functiondef('clinic_reception.auto_book_enqueue(jsonb)'::regprocedure); i int := 1; e text[] := array[
  $a$    day = dy,$a$,
  $a$    day = case when b.pinned then b.day else dy end,
    day_only = case when b.pinned then b.day_only else coalesce((p->>'day_only')::boolean, false) or st is null end,$a$,
  $a$    starts_at = case when coalesce((p->>'day_only')::boolean, false) then b.starts_at else coalesce(st, b.starts_at) end,$a$,
  $a$    starts_at = case when b.pinned or coalesce((p->>'day_only')::boolean, false) then b.starts_at else coalesce(st, b.starts_at) end,$a$,
  $a$      when not canc and b.state in ('booked', 'merged') and (b.starts_at is distinct from coalesce(st, b.starts_at)$a$,
  $a$      when not canc and not b.pinned and b.state in ('booked', 'merged') and b.day_only and coalesce((p->>'day_only')::boolean, false) and b.day is distinct from dy then 'pending'
      when not canc and not b.pinned and b.state in ('needs_time', 'review') and b.day_only and coalesce((p->>'day_only')::boolean, false) and b.day is distinct from dy then 'pending'
      when not canc and not b.pinned and b.state in ('booked', 'merged') and ((not coalesce((p->>'day_only')::boolean, false) and b.starts_at is distinct from coalesce(st, b.starts_at))$a$];
begin
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'auto_book_enqueue patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  execute d;
end $$;

-- the reception RPC: extras / capacity / told, set_time modes, list fields
do $$ declare d text := pg_get_functiondef('public.clinic_reception_auto_book(uuid,text,jsonb)'::regprocedure); i int := 1; e text[] := array[
  $a$case when p_action = 'list' then 'view' else 'book' end$a$,
  $a$case when p_action in ('list', 'extras', 'capacity') then 'view' else 'book' end$a$,
  $a$'patient_created', e.patient_created,$a$,
  $a$'patient_created', e.patient_created, 'auto_timed', e.auto_timed, 'time_told_at', e.time_told_at, 'pinned', e.pinned,$a$,
  $a$  select * into b from clinic_reception.external_bookings where id = nullif(p_payload->>'id', '')::uuid for update;$a$,
  $a$  if p_action = 'extras' then
    return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id,
        'free', coalesce((select jsonb_agg(fs.v order by fs.v) from clinic_reception.free_starts(x.provider_id, x.day, x.mins, 8) as fs(v)), '[]'::jsonb),
        'suggest', coalesce((select jsonb_agg(sg.v order by sg.v) from (select f2.v from generate_series(greatest(x.day - 3, clinic_reception.cairo_day(now())), x.day + 10, interval '1 day') g(dd),
              lateral clinic_reception.free_starts(x.provider_id, g.dd::date, x.mins, 1) as f2(v)
              where g.dd::date <> x.day order by abs(g.dd::date - x.day), f2.v limit 3) sg), '[]'::jsonb),
        'capacity', clinic_reception.day_capacity(p_workspace, x.provider_id, x.day)))
      from (select e2.id, e2.provider_id, e2.day,
              coalesce((select s2.minutes from clinic_reception.services s2 where s2.id = clinic_reception.auto_time_service(p_workspace, e2.provider_id, e2.needed_service)), 15) as mins
              from clinic_reception.external_bookings e2
             where e2.id in (select (v #>> '{}')::uuid from jsonb_array_elements(coalesce(p_payload->'ids', '[]'::jsonb)) v limit 60)
               and e2.provider_id is not null) x), '[]'::jsonb));
  elsif p_action = 'capacity' then
    f := coalesce(nullif(p_payload->>'from', '')::date, clinic_reception.cairo_day(now()));
    t := coalesce(nullif(p_payload->>'to', '')::date, f);
    if t < f or t - f > 31 then raise exception 'اختر فترة حتى 31 يوم'; end if;
    if not exists (select 1 from clinic_reception.providers where id = nullif(p_payload->>'provider_id', '')::uuid and workspace_id = p_workspace) then
      raise exception 'اختار الدكتور'; end if;
    return jsonb_build_object('days', (select jsonb_agg(clinic_reception.day_capacity(p_workspace, (p_payload->>'provider_id')::uuid, g::date) order by g)
      from generate_series(f, t, interval '1 day') g));
  end if;
  select * into b from clinic_reception.external_bookings where id = nullif(p_payload->>'id', '')::uuid for update;$a$,
  $a$  elsif p_action = 'set_time' then
    if b.state not in ('needs_time', 'review', 'failed') then raise exception 'الحجز ده متسجّل بالفعل'; end if;
    if nullif(p_payload->>'starts_at', '') is null or clinic_reception.cairo_day((p_payload->>'starts_at')::timestamptz) <> b.day then
      raise exception 'اختار ساعة في نفس يوم الحجز'; end if;
    update clinic_reception.external_bookings set starts_at = (p_payload->>'starts_at')::timestamptz, ends_at = null, day_only = false,
      state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now() where id = b.id;$a$,
  $a$  elsif p_action = 'set_time' then
    declare st timestamptz := nullif(p_payload->>'starts_at', '')::timestamptz; md text := coalesce(nullif(p_payload->>'mode', ''), 'normal');
      rr jsonb; ap clinic_reception.appointments%rowtype; sv uuid;
    begin
      if not (b.state in ('needs_time', 'review', 'failed') or (b.state = 'booked' and (b.auto_timed or b.pinned))) then raise exception 'الحجز ده متسجّل بالفعل'; end if;
      if st is null then raise exception 'اختار الساعة'; end if;
      if st < now() - interval '5 minutes' then raise exception 'الوقت ده فات — اختار وقت جاي'; end if;
      if md not in ('normal', 'overbook', 'manual') then raise exception 'اختيار غير معروف'; end if;
      if md = 'normal' then
        update clinic_reception.external_bookings set starts_at = st, day = clinic_reception.cairo_day(st), ends_at = null, day_only = false,
          pinned = true, auto_timed = false, state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now() where id = b.id;
      else
        if b.reception_patient_id is null or b.provider_id is null then raise exception 'كمّل بيانات المريض والدكتور الأول'; end if;
        if b.appointment_id is not null then select * into ap from clinic_reception.appointments where id = b.appointment_id and status = 'booked'; end if;
        if md = 'overbook' and ap.id is not null then raise exception 'الحجز ده متسجّل — غيّر الساعة من الأوقات الفاضية أو ميعاد يدوي'; end if;
        sv := coalesce(ap.service_id, clinic_reception.auto_time_service(p_workspace, b.provider_id, b.needed_service));
        if sv is null then raise exception 'اختار خدمة الحجز للدكتور ده الأول'; end if;
        if md = 'overbook' then
          rr := public.clinic_reception_command(p_workspace, 'overbook', jsonb_build_object('patient_id', b.reception_patient_id, 'provider_id', b.provider_id,
            'service_id', sv, 'starts_at', st, 'reason_kind', coalesce(nullif(p_payload->>'reason_kind', ''), 'حجز ماسا واليوم مليان'),
            'reason', coalesce(p_payload->>'reason', '')), gen_random_uuid());
        elsif ap.id is not null then
          rr := public.clinic_reception_command(p_workspace, 'reschedule', jsonb_build_object('id', ap.id, 'patient_id', b.reception_patient_id,
            'provider_id', b.provider_id, 'service_id', sv, 'starts_at', st, 'manual_time', true,
            'manual_reason_kind', coalesce(nullif(p_payload->>'reason_kind', ''), 'doctor_agreement'), 'manual_reason', p_payload->>'reason'), gen_random_uuid());
        else
          rr := public.clinic_reception_command(p_workspace, 'book', jsonb_build_object('patient_id', b.reception_patient_id, 'provider_id', b.provider_id,
            'service_id', sv, 'starts_at', st, 'source', 'unknown', 'source_evidence', 'unknown', 'manual_time', true,
            'manual_reason_kind', coalesce(nullif(p_payload->>'reason_kind', ''), 'doctor_agreement'), 'manual_reason', p_payload->>'reason'), gen_random_uuid());
        end if;
        update clinic_reception.external_bookings set starts_at = st, day = clinic_reception.cairo_day(st), day_only = false, pinned = true,
          auto_timed = false, appointment_id = coalesce(ap.id, nullif(rr->>'id', '')::uuid), state = 'booked', review_kind = null, reason = null,
          resolved_by = me, updated_at = now() where id = b.id;
        insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
          values (p_workspace, me, 'auto_booking_set_time_' || md, b.id, jsonb_build_object('source', b.source, 'starts_at', st));
        return jsonb_build_object('id', b.id, 'state', 'booked');
      end if;
    end;
  elsif p_action = 'told' then
    if b.appointment_id is null then raise exception 'الحجز ده لسه مالوش ميعاد'; end if;
    update clinic_reception.external_bookings set time_told_at = now(), time_told_by = me where id = b.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'auto_booking_time_told', b.id, jsonb_build_object('source', b.source));
    return jsonb_build_object('id', b.id, 'state', b.state, 'told', true);$a$];
begin
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'clinic_reception_auto_book patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  execute d;
end $$;

revoke all on function clinic_reception.auto_time_service(uuid, uuid, text), clinic_reception.free_starts(uuid, date, int, int),
  clinic_reception.day_capacity(uuid, uuid, date), clinic_reception.auto_book_place_day_only(uuid, uuid) from public, anon, authenticated;
revoke all on function public.clinic_reception_auto_book(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_book(uuid, text, jsonb) to authenticated;

-- one pass: re-place the waiting day-only rows as the system account (today first), only when auto booking is on
do $$ declare cfg clinic_reception.auto_book_settings%rowtype; sys uuid; old_claims text; old_sub text; r record;
begin
  select * into cfg from clinic_reception.auto_book_settings where id;
  if not found or not cfg.enabled then return; end if;
  select user_id into sys from public.admins where id = cfg.system_admin_id and active;
  if sys is null then return; end if;
  old_claims := current_setting('request.jwt.claims', true); old_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sys, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sys::text, true);
  for r in select id from clinic_reception.external_bookings
            where state = 'needs_time' and day >= clinic_reception.cairo_day(now()) order by day, created_at loop
    update clinic_reception.external_bookings set state = 'pending', updated_at = now() where id = r.id;
    perform clinic_reception.auto_book_one(r.id);
  end loop;
  perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
end $$;

commit;
