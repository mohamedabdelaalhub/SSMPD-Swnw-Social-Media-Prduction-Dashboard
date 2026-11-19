-- Automatic bookings, phase 1 (owner 2026-11-19 «موافق، ابدأ المرحلة الأولى»):
-- every booking made on Masa (by hand), by the WhatsApp agent (mirror / fallback) or confirmed from the patient portal
-- becomes an appointment in reception by itself, linked to the patient's file, so staff do not enter it twice.
-- Owner decisions (2026-11-19):
--   * phone matches a file but the name differs (child / wife on the same number) -> the booking waits in
--     «حجز محتاج تختار المريض»; staff pick «same patient» or «new file» with one click.
--   * Masa bookings stored without a time (day only) -> shown as «بدون ميعاد» on that doctor's day; staff set the time.
--   * portal bookings are confirmed automatically (edge function patient-portal-booking, flag portal_auto_confirm).
--   * a booking cancelled on Masa is cancelled here too.
-- How:
--   clinic_reception.external_bookings  one row per external booking (unique source + external id), filled by triggers
--                                       on masa_bookings / customer_bookings / fallback_bookings and by the portal edge function.
--   clinic_reception.auto_book_run()    every 5 minutes (pg_cron): books pending rows through the SAME reception command
--                                       chain staff use (doctor schedule, conflicts, closures, gaps, fallback holds, notifications),
--                                       acting as one dedicated system account (auto_book_settings.system_admin_id).
--   public.clinic_reception_auto_book() reception list + resolutions (choose patient / age / service / time / retry / dismiss),
--                                       run as the staff member who clicks.
-- Nothing is enabled until auto_book_settings.enabled is set (after a dry run). Nothing here calls Masa or sends messages.
-- New patient files are created only from a valid two-word name, phone and age (psychcare.check_basics); without an age the
-- booking waits for staff to type it. Rollback: supabase/rollbacks/20261120080000_reception_auto_book.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.masa_bookings') is null or to_regclass('clinic_reception.fallback_bookings') is null
     or to_regclass('public.customer_bookings') is null or to_regclass('clinic_reception.masa_doctor_links') is null
     or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('psychcare.phone(text)') is null or to_regprocedure('psychcare.check_basics(text,text,integer)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regclass('clinic_reception.external_bookings') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.auto_book_settings(
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  workspace_id uuid references clinic_reception.workspaces(id),
  system_admin_id uuid references public.admins(id),
  portal_auto_confirm boolean not null default false,
  updated_at timestamptz not null default now(),
  check (not enabled or (workspace_id is not null and system_admin_id is not null))
);
insert into clinic_reception.auto_book_settings(id) values (true);

-- Default service per doctor for automatic bookings (services are versioned, so the active code is stored).
create table clinic_reception.auto_book_services(
  provider_id uuid primary key references clinic_reception.providers(id),
  service_code text not null,
  set_by uuid references public.admins(id),
  set_at timestamptz not null default now()
);

create table clinic_reception.external_bookings(
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('masa','whatsapp','website','social','portal')),
  external_id text not null check (length(external_id) between 1 and 200),
  official_booking_id text,
  fallback_id uuid references clinic_reception.fallback_bookings(id),
  masa_doctor_id int,
  provider_id uuid references clinic_reception.providers(id),
  day date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  day_only boolean not null default false,
  customer_name text,
  phone text,
  age int check (age between 0 and 130),
  needed_service text,
  public_patient_id uuid references public.patients(id),
  ext_status text not null default 'active' check (ext_status in ('active','cancelled')),
  state text not null default 'pending' check (state in ('pending','booked','merged','needs_time','review','failed','cancelled','skipped')),
  review_kind text check (review_kind in ('patient','age','service','doctor','slot')),
  reason text,
  candidate_patient_id uuid references public.patients(id),
  patient_created boolean not null default false,
  reception_patient_id uuid references clinic_reception.patients(id),
  appointment_id uuid references clinic_reception.appointments(id),
  attempts int not null default 0,
  resolved_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  check ((state = 'review') = (review_kind is not null))
);
create index external_bookings_work_idx on clinic_reception.external_bookings(state, day);
create index external_bookings_day_idx on clinic_reception.external_bookings(day);
create index external_bookings_official_idx on clinic_reception.external_bookings(official_booking_id);
create index external_bookings_appointment_idx on clinic_reception.external_bookings(appointment_id);
alter table clinic_reception.auto_book_settings enable row level security;
alter table clinic_reception.auto_book_services enable row level security;
alter table clinic_reception.external_bookings enable row level security;
revoke all on clinic_reception.auto_book_settings, clinic_reception.auto_book_services, clinic_reception.external_bookings
  from public, anon, authenticated;

create function clinic_reception.cairo_day(t timestamptz) returns date language sql immutable as $$
  select (t at time zone 'Africa/Cairo')::date
$$;

-- One entry point for every source. Re-sending the same booking updates it; a change of time, doctor or status after it was
-- booked sends it back to the queue (reschedule / cancel). A Masa booking already known under another source is not added twice.
create function clinic_reception.auto_book_enqueue(p jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare src text := p->>'source'; ext text := nullif(p->>'external_id', ''); off text := nullif(p->>'official_booking_id', '');
  st timestamptz := nullif(p->>'starts_at', '')::timestamptz; dy date; cur clinic_reception.external_bookings%rowtype; v uuid;
  canc boolean := coalesce(p->>'ext_status', 'active') = 'cancelled';
begin
  if ext is null then return null; end if;
  dy := coalesce(nullif(p->>'day', '')::date, clinic_reception.cairo_day(st));
  if dy is null then return null; end if;
  select * into cur from clinic_reception.external_bookings where source = src and external_id = ext for update;
  if not found then
    if off is not null and exists (select 1 from clinic_reception.external_bookings where official_booking_id = off) then return null; end if;
    if canc then return null; end if;   -- never booked here, nothing to cancel
    insert into clinic_reception.external_bookings(source, external_id, official_booking_id, fallback_id, masa_doctor_id, provider_id, day,
        starts_at, ends_at, day_only, customer_name, phone, age, needed_service, public_patient_id)
      values (src, ext, off, nullif(p->>'fallback_id', '')::uuid, nullif(p->>'masa_doctor_id', '')::int, nullif(p->>'provider_id', '')::uuid, dy,
        case when coalesce((p->>'day_only')::boolean, false) then null else st end, nullif(p->>'ends_at', '')::timestamptz,
        coalesce((p->>'day_only')::boolean, false) or st is null, left(nullif(trim(p->>'customer_name'), ''), 180), left(nullif(trim(p->>'phone'), ''), 40),
        case when (p->>'age') ~ '^[0-9]{1,3}$' and (p->>'age')::int <= 130 then (p->>'age')::int end,
        left(nullif(trim(p->>'needed_service'), ''), 80), nullif(p->>'public_patient_id', '')::uuid)
      returning id into v;
    return v;
  end if;
  update clinic_reception.external_bookings b set
    official_booking_id = coalesce(off, b.official_booking_id),
    masa_doctor_id = coalesce(nullif(p->>'masa_doctor_id', '')::int, b.masa_doctor_id),
    provider_id = coalesce(nullif(p->>'provider_id', '')::uuid, b.provider_id),
    day = dy,
    starts_at = case when coalesce((p->>'day_only')::boolean, false) then b.starts_at else coalesce(st, b.starts_at) end,
    ends_at = coalesce(nullif(p->>'ends_at', '')::timestamptz, b.ends_at),
    ext_status = case when canc then 'cancelled' else 'active' end,
    public_patient_id = coalesce(b.public_patient_id, nullif(p->>'public_patient_id', '')::uuid),
    state = case
      when canc and b.state not in ('cancelled', 'skipped') then 'pending'
      when not canc and b.state in ('booked', 'merged') and (b.starts_at is distinct from coalesce(st, b.starts_at)
           or b.provider_id is distinct from coalesce(nullif(p->>'provider_id', '')::uuid, b.provider_id)) then 'pending'
      when not canc and b.state = 'cancelled' then 'pending'
      else b.state end,
    review_kind = case when (canc and b.state not in ('cancelled', 'skipped')) or (not canc and b.state = 'cancelled') then null else b.review_kind end,
    reason = case when (canc and b.state not in ('cancelled', 'skipped')) or (not canc and b.state = 'cancelled') then null else b.reason end,
    updated_at = now()
  where b.id = cur.id;
  return cur.id;
end $$;
revoke all on function clinic_reception.auto_book_enqueue(jsonb) from public, anon, authenticated;

create function clinic_reception.auto_book_from_masa() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_reception.auto_book_enqueue(jsonb_build_object('source', 'masa', 'external_id', new.official_booking_id,
    'official_booking_id', new.official_booking_id, 'masa_doctor_id', new.masa_doctor_id, 'provider_id', new.provider_id,
    'starts_at', new.starts_at, 'ends_at', case when coalesce(new.day_only, false) then null else new.ends_at end,
    'day', clinic_reception.cairo_day(new.starts_at), 'day_only', coalesce(new.day_only, false),
    'customer_name', new.patient_name, 'phone', new.phone, 'needed_service', new.needed_service,
    'ext_status', case when new.status = 'cancelled' then 'cancelled' else 'active' end));
  return new;
exception when others then
  raise warning 'auto-book enqueue skipped: %', sqlerrm;  -- never block the source write
  return new;
end $$;
create trigger auto_book_from_masa after insert or update on clinic_reception.masa_bookings
  for each row execute function clinic_reception.auto_book_from_masa();

-- Agent bookings mirrored from Masa (booking-sync-ingest). Same key as the fallback booking (BookingRequestId), so a
-- fallback replayed to Masa and then mirrored is one booking.
create function clinic_reception.auto_book_from_agent() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare t timestamptz;
begin
  if new.appointment_date is null then return new; end if;
  if coalesce(new.appointment_time, '') ~ '^[0-9]{1,2}:[0-9]{2}' then
    t := ((new.appointment_date::text || ' ' || substring(new.appointment_time from '^[0-9]{1,2}:[0-9]{2}'))::timestamp at time zone 'Africa/Cairo');
  end if;
  perform clinic_reception.auto_book_enqueue(jsonb_build_object(
    'source', case when coalesce(new.channel, 'whatsapp') = 'whatsapp' then 'whatsapp' else 'social' end,
    'external_id', new.booking_request_id, 'official_booking_id', new.official_booking_id, 'masa_doctor_id', new.masa_doctor_id,
    'provider_id', (select l.provider_id from clinic_reception.masa_doctor_links l where l.masa_doctor_id = new.masa_doctor_id and l.status = 'linked'),
    'starts_at', t, 'day', new.appointment_date, 'day_only', t is null, 'customer_name', new.customer_name, 'phone', new.phone,
    'ext_status', case when new.status = 'cancelled' then 'cancelled' else 'active' end));
  return new;
exception when others then
  raise warning 'auto-book enqueue skipped: %', sqlerrm;  -- never block the source write
  return new;
end $$;
create trigger auto_book_from_agent after insert or update on public.customer_bookings
  for each row execute function clinic_reception.auto_book_from_agent();

create function clinic_reception.auto_book_from_fallback() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_reception.auto_book_enqueue(jsonb_build_object('source', new.source, 'external_id', new.booking_request_id,
    'official_booking_id', new.official_booking_id, 'fallback_id', new.id, 'masa_doctor_id', new.masa_doctor_id,
    'provider_id', new.provider_id, 'starts_at', new.starts_at, 'ends_at', new.ends_at, 'customer_name', new.customer_name,
    'phone', new.phone, 'age', new.customer_age, 'needed_service', new.needed_service,
    'ext_status', case when new.status in ('cancel_pending', 'cancelled') then 'cancelled' else 'active' end));
  -- the fallback row knows its own id; keep it on the shared row even when the agent mirror arrived first
  update clinic_reception.external_bookings set fallback_id = new.id
    where source = new.source and external_id = new.booking_request_id and fallback_id is null;
  return new;
exception when others then
  raise warning 'auto-book enqueue skipped: %', sqlerrm;  -- never block the source write
  return new;
end $$;
create trigger auto_book_from_fallback after insert or update on clinic_reception.fallback_bookings
  for each row execute function clinic_reception.auto_book_from_fallback();

create function clinic_reception.auto_book_service(p_workspace uuid, p_provider uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select s.id from clinic_reception.auto_book_services d join clinic_reception.services s
       on s.workspace_id = p_workspace and s.code = d.service_code and s.active where d.provider_id = p_provider limit 1),
    (select min(s.id::text)::uuid from clinic_reception.services s join clinic_reception.providers pr on pr.id = p_provider
       where s.workspace_id = p_workspace and s.active and s.department = pr.department and s.name like 'كشف%'
       having count(*) = 1))
$$;

create function clinic_reception.auto_book_review(p_id uuid, p_kind text, p_reason text, p_candidate uuid default null) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update clinic_reception.external_bookings set state = 'review', review_kind = p_kind, reason = left(p_reason, 300),
    candidate_patient_id = coalesce(p_candidate, candidate_patient_id), updated_at = now() where id = p_id;
  return 'review';
end $$;

-- Book one external booking as the CURRENT user (system account from the cron, or the staff member who resolved it).
create function clinic_reception.auto_book_one(p_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cfg clinic_reception.auto_book_settings%rowtype; b clinic_reception.external_bookings%rowtype; ws uuid; prov uuid; svc uuid;
  pid uuid; rp uuid; ph text; n_same int; n_phone int; cand uuid; appt clinic_reception.appointments%rowtype; r jsonb; mins int;
  src text; created boolean := false;
begin
  select * into cfg from clinic_reception.auto_book_settings where id;
  ws := cfg.workspace_id;
  if ws is null then raise exception 'الحجز التلقائي لم يُضبط'; end if;
  select * into b from clinic_reception.external_bookings where id = p_id for update;
  if not found or b.state in ('skipped') then return 'skipped'; end if;

  -- cancellation from the source
  if b.ext_status = 'cancelled' then
    if b.appointment_id is not null then
      select * into appt from clinic_reception.appointments where id = b.appointment_id;
      if appt.status = 'booked' then
        perform public.clinic_reception_command(ws, 'cancel', jsonb_build_object('id', appt.id,
          'reason', 'اتلغى على ' || case b.source when 'masa' then 'ماسا' when 'portal' then 'بوابة المرضى' else 'الواتساب' end), gen_random_uuid());
      end if;
    end if;
    update clinic_reception.external_bookings set state = 'cancelled', review_kind = null, reason = null, updated_at = now() where id = b.id;
    return 'cancelled';
  end if;

  -- doctor
  prov := coalesce(b.provider_id, (select l.provider_id from clinic_reception.masa_doctor_links l where l.masa_doctor_id = b.masa_doctor_id and l.status = 'linked'));
  if prov is null or not exists (select 1 from clinic_reception.providers where id = prov and workspace_id = ws and active) then
    return clinic_reception.auto_book_review(b.id, 'doctor', 'الدكتور ده مش مربوط بدكتور في الداشبورد — اربطه من «ربط دكاترة ماسا»');
  end if;
  if b.provider_id is distinct from prov then update clinic_reception.external_bookings set provider_id = prov where id = b.id; b.provider_id := prov; end if;

  -- patient
  pid := b.public_patient_id;
  if b.reception_patient_id is null then
    if pid is null then
      ph := psychcare.phone(b.phone);
      if ph !~ '^[0-9]{8,15}$' then
        return clinic_reception.auto_book_review(b.id, 'patient', 'رقم التليفون ناقص أو غلط في الحجز — اختار المريض أو صحّح الرقم');
      end if;
      perform pg_advisory_xact_lock(hashtextextended(ph, 781));
      select count(*) filter (where psychcare.name(x.full_name) = psychcare.name(b.customer_name)), count(*)
        into n_same, n_phone from public.patients x where x.status = 'active' and psychcare.phone(x.phone) = ph;
      if n_same = 1 then
        select x.id into pid from public.patients x where x.status = 'active' and psychcare.phone(x.phone) = ph
          and psychcare.name(x.full_name) = psychcare.name(b.customer_name);
      elsif n_phone > 0 then
        select x.id into cand from public.patients x where x.status = 'active' and psychcare.phone(x.phone) = ph
          order by (psychcare.name(x.full_name) = psychcare.name(b.customer_name)) desc, x.last_visit_date desc nulls last, x.created_at desc limit 1;
        return clinic_reception.auto_book_review(b.id, 'patient', case when n_same > 1 then 'فيه أكتر من ملف بنفس الاسم والرقم — اختار الملف الصح'
          else 'الرقم ده متسجّل لمريض تاني باسم مختلف — اختار الملف الصح أو افتح ملف جديد' end, cand);
      else
        if b.age is null then
          return clinic_reception.auto_book_review(b.id, 'age', 'مريض جديد — اكتب سنه عشان يتفتح ملفه والموعد يتسجّل');
        end if;
        begin
          perform psychcare.check_basics(b.customer_name, b.phone, b.age);
        exception when others then
          return clinic_reception.auto_book_review(b.id, 'patient', 'بيانات المريض الجديد ناقصة: ' || sqlerrm);
        end;
        insert into public.patients(full_name, phone, phone_normalized, age, created_by)
          values (regexp_replace(trim(b.customer_name), '\s+', ' ', 'g'), b.phone, '+' || ph, b.age, public.my_admin_id()) returning id into pid;
        created := true;
      end if;
    end if;
    r := public.clinic_reception_command(ws, 'patient_attach', jsonb_build_object('patient_id', pid), gen_random_uuid());
    rp := (r->>'id')::uuid;
    update clinic_reception.external_bookings set public_patient_id = pid, reception_patient_id = rp,
      patient_created = patient_created or created where id = b.id;
    b.reception_patient_id := rp; b.public_patient_id := pid;
  end if;

  -- day only: shown under the doctor's day as «بدون ميعاد» until staff set the time
  if b.day_only or b.starts_at is null then
    update clinic_reception.external_bookings set state = 'needs_time', review_kind = null, reason = null, updated_at = now() where id = b.id;
    return 'needs_time';
  end if;

  -- already on reception's book (staff entered it, or booked earlier): link, do not book twice
  if b.appointment_id is not null then
    select * into appt from clinic_reception.appointments where id = b.appointment_id;
    if found and appt.status not in ('cancelled', 'no_show') and appt.starts_at = b.starts_at and appt.provider_id = b.provider_id then
      update clinic_reception.external_bookings set state = case when state = 'merged' then 'merged' else 'booked' end, review_kind = null, reason = null,
        updated_at = now() where id = b.id;
      return 'unchanged';
    end if;
  else
    select * into appt from clinic_reception.appointments a where a.workspace_id = ws and a.patient_id = b.reception_patient_id
      and a.provider_id = b.provider_id and clinic_reception.cairo_day(a.starts_at) = b.day and a.status not in ('cancelled', 'no_show')
      order by abs(extract(epoch from a.starts_at - b.starts_at)) limit 1;
    if found then
      update clinic_reception.external_bookings set appointment_id = appt.id, state = 'merged', review_kind = null, reason = null, updated_at = now()
        where id = b.id;
      return 'merged';
    end if;
  end if;

  -- service
  svc := clinic_reception.auto_book_service(ws, b.provider_id);
  if svc is null then
    return clinic_reception.auto_book_review(b.id, 'service', 'اختار خدمة الحجز للدكتور ده مرة واحدة وهتتحفظ للحجوزات الجاية');
  end if;
  mins := case when b.ends_at is not null and b.ends_at > b.starts_at then ceil(extract(epoch from b.ends_at - b.starts_at) / 60)::int end;
  src := case b.source when 'masa' then 'unknown' when 'portal' then 'unknown' when 'social' then 'facebook' else b.source end;

  begin
    if b.fallback_id is not null then
      update clinic_reception.fallback_bookings set slot_released_at = coalesce(slot_released_at, now()),
        slot_released_by = coalesce(slot_released_by, public.my_admin_id()) where id = b.fallback_id;
    end if;
    if appt.id is not null and b.appointment_id is not null and appt.status = 'booked' then
      r := public.clinic_reception_command(ws, 'reschedule', jsonb_build_object('id', appt.id, 'patient_id', b.reception_patient_id,
        'provider_id', b.provider_id, 'service_id', appt.service_id, 'starts_at', b.starts_at) || jsonb_strip_nulls(jsonb_build_object('minutes', mins)),
        gen_random_uuid());
      update clinic_reception.external_bookings set state = 'booked', review_kind = null, reason = null, updated_at = now() where id = b.id;
      return 'rescheduled';
    end if;
    r := public.clinic_reception_command(ws, 'book', jsonb_strip_nulls(jsonb_build_object('patient_id', b.reception_patient_id,
      'provider_id', b.provider_id, 'service_id', svc, 'starts_at', b.starts_at, 'minutes', mins, 'source', src, 'source_evidence', 'unknown')),
      gen_random_uuid());
  exception when others then
    return clinic_reception.auto_book_review(b.id, 'slot', 'مقدرتش أسجّل الميعاد: ' || sqlerrm);
  end;
  update clinic_reception.external_bookings set appointment_id = (r->>'id')::uuid, state = 'booked', review_kind = null, reason = null,
    updated_at = now() where id = b.id;
  return 'booked';
end $$;
revoke all on function clinic_reception.cairo_day(timestamptz), clinic_reception.auto_book_service(uuid, uuid),
  clinic_reception.auto_book_review(uuid, text, text, uuid), clinic_reception.auto_book_one(uuid),
  clinic_reception.auto_book_from_masa(), clinic_reception.auto_book_from_agent(), clinic_reception.auto_book_from_fallback()
  from public, anon, authenticated;

-- Cron worker: acts as the system account so every rule of the reception command chain applies and the audit says who.
create function clinic_reception.auto_book_run(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cfg clinic_reception.auto_book_settings%rowtype; sys uuid; old_claims text; old_sub text; r record; res text; out jsonb := '{}';
begin
  select * into cfg from clinic_reception.auto_book_settings where id;
  if not cfg.enabled then return jsonb_build_object('enabled', false); end if;
  select user_id into sys from public.admins where id = cfg.system_admin_id and active;
  if sys is null then raise exception 'حساب الحجز التلقائي غير نشط'; end if;
  old_claims := current_setting('request.jwt.claims', true); old_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sys, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sys::text, true);
  for r in select id from clinic_reception.external_bookings
      where (state = 'pending' or (state = 'failed' and attempts < 5 and updated_at < now() - interval '10 minutes'))
        and day >= clinic_reception.cairo_day(now())
      order by day, starts_at nulls last limit greatest(1, least(p_limit, 500)) loop
    begin
      res := clinic_reception.auto_book_one(r.id);
    exception when others then
      res := 'failed';
      update clinic_reception.external_bookings set state = 'failed', reason = left(sqlerrm, 300), attempts = attempts + 1, updated_at = now()
        where id = r.id;
    end;
    out := jsonb_set(out, array[res], to_jsonb(coalesce((out->>res)::int, 0) + 1));
  end loop;
  -- past days that never got booked leave the queue quietly
  update clinic_reception.external_bookings set state = 'skipped', review_kind = null, reason = coalesce(reason, 'اليوم عدّى')
    where state in ('pending', 'failed', 'needs_time', 'review') and day < clinic_reception.cairo_day(now()) - 1;
  perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  return out || jsonb_build_object('enabled', true);
end $$;
revoke all on function clinic_reception.auto_book_run(int) from public, anon, authenticated;

-- Reception: list + resolutions, as the staff member.
create function public.clinic_reception_auto_book(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; cfg clinic_reception.auto_book_settings%rowtype; b clinic_reception.external_bookings%rowtype; f date; t date;
  pid uuid; res text; ph text; svc clinic_reception.services%rowtype;
begin
  me := clinic_reception.access(p_workspace, case when p_action = 'list' then 'view' else 'book' end);
  select * into cfg from clinic_reception.auto_book_settings where id;
  if cfg.workspace_id is distinct from p_workspace then
    if p_action = 'list' then return jsonb_build_object('enabled', false, 'rows', '[]'::jsonb); end if;
    raise exception 'الحجز التلقائي مش شغال على المساحة دي';
  end if;
  if p_action = 'list' then
    f := coalesce(nullif(p_payload->>'from', '')::date, clinic_reception.cairo_day(now()));
    t := coalesce(nullif(p_payload->>'to', '')::date, f);
    if t < f or t - f > 31 then raise exception 'اختر فترة حتى ٣١ يوم'; end if;
    return jsonb_build_object('enabled', cfg.enabled,
      'synced_at', (select max(synced_at) from clinic_reception.fallback_sync_state where key = 'bookings'),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'source', e.source, 'state', e.state, 'review_kind', e.review_kind,
          'reason', e.reason, 'day', e.day, 'starts_at', e.starts_at, 'day_only', e.day_only, 'customer_name', e.customer_name, 'phone', e.phone,
          'age', e.age, 'provider_id', e.provider_id, 'doctor_name', pr.name, 'appointment_id', e.appointment_id,
          'patient_created', e.patient_created, 'patient_code', pp.patient_code, 'created_at', e.created_at,
          'candidate', case when c.id is not null then jsonb_build_object('id', c.id, 'patient_code', c.patient_code, 'full_name', c.full_name,
             'last_visit_date', c.last_visit_date) end) order by e.day, e.starts_at nulls last)
        from clinic_reception.external_bookings e left join clinic_reception.providers pr on pr.id = e.provider_id
        left join public.patients pp on pp.id = e.public_patient_id left join public.patients c on c.id = e.candidate_patient_id
        where (e.day between f and t and e.state not in ('skipped'))
           or (e.state in ('review', 'failed', 'needs_time') and e.day >= clinic_reception.cairo_day(now()))), '[]'::jsonb),
      'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'department', s.department) order by s.department, s.name)
        from clinic_reception.services s where s.workspace_id = p_workspace and s.active), '[]'::jsonb));
  end if;

  select * into b from clinic_reception.external_bookings where id = nullif(p_payload->>'id', '')::uuid for update;
  if not found then raise exception 'الحجز غير موجود'; end if;
  if p_action = 'resolve_patient' then
    if b.state <> 'review' or b.review_kind not in ('patient', 'age') then raise exception 'الحجز ده مش مستني اختيار مريض'; end if;
    if p_payload->>'choice' = 'existing' then
      pid := coalesce(nullif(p_payload->>'patient_id', '')::uuid, b.candidate_patient_id);
      if pid is null or not exists (select 1 from public.patients where id = pid and status = 'active') then raise exception 'اختار ملف مريض نشط'; end if;
    elsif p_payload->>'choice' = 'new' then
      ph := psychcare.phone(coalesce(nullif(p_payload->>'phone', ''), b.phone));
      perform psychcare.check_basics(coalesce(nullif(trim(p_payload->>'full_name'), ''), b.customer_name), coalesce(nullif(p_payload->>'phone', ''), b.phone),
        nullif(p_payload->>'age', '')::int);
      insert into public.patients(full_name, phone, phone_normalized, age, created_by)
        values (regexp_replace(trim(coalesce(nullif(trim(p_payload->>'full_name'), ''), b.customer_name)), '\s+', ' ', 'g'),
          coalesce(nullif(p_payload->>'phone', ''), b.phone), '+' || ph, (p_payload->>'age')::int, me) returning id into pid;
      update clinic_reception.external_bookings set patient_created = true where id = b.id;
    else raise exception 'اختار: نفس المريض أو ملف جديد'; end if;
    update clinic_reception.external_bookings set public_patient_id = pid, reception_patient_id = null, state = 'pending', review_kind = null,
      reason = null, resolved_by = me, updated_at = now() where id = b.id;
  elsif p_action = 'set_service' then
    select * into svc from clinic_reception.services where id = nullif(p_payload->>'service_id', '')::uuid and workspace_id = p_workspace and active;
    if not found then raise exception 'اختار الخدمة'; end if;
    if b.provider_id is null then raise exception 'اربط الدكتور الأول'; end if;
    insert into clinic_reception.auto_book_services(provider_id, service_code, set_by) values (b.provider_id, svc.code, me)
      on conflict (provider_id) do update set service_code = excluded.service_code, set_by = me, set_at = now();
    update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now()
      where id = b.id or (state = 'review' and review_kind = 'service' and provider_id = b.provider_id);
  elsif p_action = 'set_time' then
    if b.state not in ('needs_time', 'review', 'failed') then raise exception 'الحجز ده متسجّل بالفعل'; end if;
    if nullif(p_payload->>'starts_at', '') is null or clinic_reception.cairo_day((p_payload->>'starts_at')::timestamptz) <> b.day then
      raise exception 'اختار ساعة في نفس يوم الحجز'; end if;
    update clinic_reception.external_bookings set starts_at = (p_payload->>'starts_at')::timestamptz, ends_at = null, day_only = false,
      state = 'pending', review_kind = null, reason = null, resolved_by = me, updated_at = now() where id = b.id;
  elsif p_action = 'retry' then
    if b.state not in ('review', 'failed') then raise exception 'الحجز ده مش محتاج إعادة'; end if;
    update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, attempts = 0, resolved_by = me,
      updated_at = now() where id = b.id;
  elsif p_action = 'dismiss' then
    if b.state not in ('review', 'failed', 'needs_time', 'pending') then raise exception 'الحجز ده متسجّل بالفعل'; end if;
    if length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب السبب'; end if;
    update clinic_reception.external_bookings set state = 'skipped', review_kind = null, reason = left(trim(p_payload->>'reason'), 300),
      resolved_by = me, updated_at = now() where id = b.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'auto_booking_dismissed', b.id, jsonb_build_object('source', b.source, 'reason', p_payload->>'reason'));
    return jsonb_build_object('id', b.id, 'state', 'skipped');
  else
    raise exception 'إجراء غير معروف';
  end if;
  if not cfg.enabled then return jsonb_build_object('id', b.id, 'state', 'pending'); end if;
  res := clinic_reception.auto_book_one(b.id);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'auto_booking_' || p_action, b.id, jsonb_build_object('source', b.source, 'result', res));
  return jsonb_build_object('id', b.id, 'state', res);
end $$;
revoke all on function public.clinic_reception_auto_book(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_book(uuid, text, jsonb) to authenticated;

-- Service role only (edge function patient-portal-booking): settings + portal bookings confirmed on Masa.
create function public.clinic_reception_auto_book_service_api(p_op text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare cfg clinic_reception.auto_book_settings%rowtype; claims jsonb; v uuid; off text := nullif(p->>'official_booking_id', '');
begin
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if coalesce(claims->>'role', current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'service role only' using errcode = '42501';
  end if;
  select * into cfg from clinic_reception.auto_book_settings where id;
  if p_op = 'config' then
    return jsonb_build_object('enabled', cfg.enabled, 'portal_auto_confirm', cfg.enabled and cfg.portal_auto_confirm, 'system_admin_id', cfg.system_admin_id);
  elsif p_op = 'portal_confirmed' then
    -- the same Masa booking may already be queued from the Masa import: give it the verified portal patient instead
    update clinic_reception.external_bookings set public_patient_id = coalesce(public_patient_id, nullif(p->>'patient_id', '')::uuid),
        state = case when state = 'review' and review_kind in ('patient', 'age') then 'pending' else state end,
        review_kind = case when state = 'review' and review_kind in ('patient', 'age') then null else review_kind end,
        reason = case when state = 'review' and review_kind in ('patient', 'age') then null else reason end, updated_at = now()
      where off is not null and official_booking_id = off and source <> 'portal' returning id into v;
    if v is not null then return jsonb_build_object('id', v, 'merged', true); end if;
    v := clinic_reception.auto_book_enqueue(jsonb_build_object('source', 'portal', 'external_id', p->>'request_id', 'official_booking_id', off,
      'masa_doctor_id', p->>'masa_doctor_id', 'starts_at', ((p->>'date') || ' ' || (p->>'time'))::timestamp at time zone 'Africa/Cairo',
      'public_patient_id', p->>'patient_id'));
    return jsonb_build_object('id', v);
  end if;
  raise exception 'unknown op';
end $$;
revoke all on function public.clinic_reception_auto_book_service_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clinic_reception_auto_book_service_api(text, jsonb) to service_role;
  end if;
end $$;

-- Today and later: queue what is already known (it is booked only once the settings are enabled).
insert into clinic_reception.external_bookings(source, external_id, official_booking_id, masa_doctor_id, provider_id, day, starts_at, ends_at,
    day_only, customer_name, phone, needed_service)
  select 'masa', m.official_booking_id, m.official_booking_id, m.masa_doctor_id, m.provider_id, clinic_reception.cairo_day(m.starts_at),
    case when coalesce(m.day_only, false) then null else m.starts_at end, case when coalesce(m.day_only, false) then null else m.ends_at end,
    coalesce(m.day_only, false), m.patient_name, m.phone, m.needed_service
  from clinic_reception.masa_bookings m
  where m.status = 'active' and clinic_reception.cairo_day(m.starts_at) >= clinic_reception.cairo_day(now())
  on conflict do nothing;
select clinic_reception.auto_book_enqueue(jsonb_build_object('source', f.source, 'external_id', f.booking_request_id,
    'official_booking_id', f.official_booking_id, 'fallback_id', f.id, 'masa_doctor_id', f.masa_doctor_id, 'provider_id', f.provider_id,
    'starts_at', f.starts_at, 'ends_at', f.ends_at, 'customer_name', f.customer_name, 'phone', f.phone, 'age', f.customer_age,
    'needed_service', f.needed_service))
  from clinic_reception.fallback_bookings f
  where f.status in ('pending', 'replayed', 'conflict') and f.slot_released_at is null and f.starts_at >= now();
select clinic_reception.auto_book_enqueue(jsonb_build_object(
    'source', case when coalesce(c.channel, 'whatsapp') = 'whatsapp' then 'whatsapp' else 'social' end,
    'external_id', c.booking_request_id, 'official_booking_id', c.official_booking_id, 'masa_doctor_id', c.masa_doctor_id,
    'provider_id', (select l.provider_id from clinic_reception.masa_doctor_links l where l.masa_doctor_id = c.masa_doctor_id and l.status = 'linked'),
    'starts_at', case when coalesce(c.appointment_time, '') ~ '^[0-9]{1,2}:[0-9]{2}'
      then (c.appointment_date::text || ' ' || substring(c.appointment_time from '^[0-9]{1,2}:[0-9]{2}'))::timestamp at time zone 'Africa/Cairo' end,
    'day', c.appointment_date, 'day_only', coalesce(c.appointment_time, '') !~ '^[0-9]{1,2}:[0-9]{2}',
    'customer_name', c.customer_name, 'phone', c.phone))
  from public.customer_bookings c
  where c.appointment_date >= clinic_reception.cairo_day(now()) and c.status <> 'cancelled';

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('reception-auto-book-5m', '*/5 * * * *', 'select clinic_reception.auto_book_run(200)');
  end if;
end $$;

commit;
