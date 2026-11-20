-- Nursing «تشغيل اليوم — التمريض» (owner approved 2026-11-20: mockup docs/ui-references/mockups/nursing-day-ops.html,
-- «موافق على اقتراحات التمريض»). One transaction.
-- 1. Sections: physio / dental / general. A booking's section comes from its doctor's department; a nurse's section from
--    HR (clinic_people.people department + job_title) with a per-nurse override (super admin / head nurse) and an
--    «absent today» flag. General nurses also see a section whose nurses are all absent today. Head nurse and managers see all.
-- 2. public.clinic_reception_nursing(workspace, action, payload): day list, prep checklist, triage («الفحص قبل الكشف»),
--    doctor confirmation of chronic diseases into the permanent profile, own notifications, settings, file-open log.
-- 3. clinic_reception.visit_triage (+ log): vitals and history per visit. Vitals stay on the visit only; chronic diseases move to
--    public.patient_medical_profile only when the case doctor confirms.
-- 4. public.staff_notifications: fixed-text notices for nurses («مريض حجز أسنان الساعة 3:30 — د. فلان»), no patient name or
--    medical data. A never-failing trigger on clinic_reception.appointments creates them for bookings and arrivals today.
-- 5. public.patient_file_opens + public.log_patient_file_open(): every file a nurse opens is logged with the opener.
-- Doctor drafts and approval for dental/physio notes come in the next migration.

begin;

create table if not exists clinic_reception.nursing_assignments(
  admin_id uuid primary key references public.admins(id) on delete cascade,
  section_override text check (section_override in ('physio','dental','general')),
  absent_on date,
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now()
);
alter table clinic_reception.nursing_assignments enable row level security;
revoke all on clinic_reception.nursing_assignments from public, anon, authenticated;

create table if not exists clinic_reception.nursing_prep(
  appointment_id uuid not null references clinic_reception.appointments(id) on delete cascade,
  item text not null check (length(item) between 1 and 60),
  done_by uuid references public.admins(id),
  done_at timestamptz not null default now(),
  primary key (appointment_id, item)
);
alter table clinic_reception.nursing_prep enable row level security;
revoke all on clinic_reception.nursing_prep from public, anon, authenticated;

create table if not exists clinic_reception.visit_triage(
  appointment_id uuid primary key references clinic_reception.appointments(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  patient_id uuid not null references clinic_reception.patients(id),
  nurse_id uuid references public.admins(id),
  status text not null default 'recorded' check (status in ('draft','recorded')),
  bp_sys smallint check (bp_sys between 40 and 300),
  bp_dia smallint check (bp_dia between 20 and 200),
  pulse smallint check (pulse between 20 and 250),
  temp_c numeric(4,1) check (temp_c between 30 and 45),
  spo2 smallint check (spo2 between 50 and 100),
  weight_kg numeric(5,1) check (weight_kg between 1 and 400),
  sugar_mgdl smallint check (sugar_mgdl between 10 and 1000),
  on_chronic_meds boolean,
  chronic_meds text check (length(chronic_meds) <= 500),
  recent_surgery boolean,
  surgery_note text check (length(surgery_note) <= 500),
  allergies text check (length(allergies) <= 300),
  chronic_diseases text[] not null default '{}',
  chronic_other text check (length(chronic_other) <= 300),
  chief_complaint text check (length(chief_complaint) <= 800),
  nursing_note text check (length(nursing_note) <= 800),
  profile_confirmed_at timestamptz,
  profile_confirmed_by uuid references public.admins(id),
  revision int not null default 1,
  recorded_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table clinic_reception.visit_triage enable row level security;
revoke all on clinic_reception.visit_triage from public, anon, authenticated;

create table if not exists clinic_reception.visit_triage_log(
  id bigint generated always as identity primary key,
  appointment_id uuid not null,
  actor_id uuid references public.admins(id),
  action text not null,
  revision int,
  snapshot jsonb,
  at timestamptz not null default now()
);
create index if not exists visit_triage_log_appt_idx on clinic_reception.visit_triage_log(appointment_id, at);
alter table clinic_reception.visit_triage_log enable row level security;
revoke all on clinic_reception.visit_triage_log from public, anon, authenticated;

create table if not exists public.staff_notifications(
  id uuid primary key default gen_random_uuid(),
  recipient_admin_id uuid not null references public.admins(id) on delete cascade,
  kind text not null check (kind in ('booking_today','arrived')),
  appointment_id uuid,
  archive_patient_id uuid,
  title text not null check (length(title) <= 200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists staff_notifications_recipient_idx on public.staff_notifications(recipient_admin_id, read_at, created_at desc);
alter table public.staff_notifications enable row level security;
revoke all on public.staff_notifications from public, anon;
grant select on public.staff_notifications to authenticated;
drop policy if exists staff_notifications_own on public.staff_notifications;
create policy staff_notifications_own on public.staff_notifications for select to authenticated using (recipient_admin_id = public.my_admin_id());

create table if not exists public.patient_file_opens(
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid,
  source text not null default 'archive',
  opened_at timestamptz not null default now()
);
create index if not exists patient_file_opens_patient_idx on public.patient_file_opens(patient_id, opened_at desc);
create index if not exists patient_file_opens_admin_idx on public.patient_file_opens(admin_id, opened_at desc);
alter table public.patient_file_opens enable row level security;
revoke all on public.patient_file_opens from public, anon, authenticated;
grant select on public.patient_file_opens to authenticated;
drop policy if exists patient_file_opens_read on public.patient_file_opens;
create policy patient_file_opens_read on public.patient_file_opens for select to authenticated
  using (public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('head_nursing'));

-- ---------------------------------------------------------------- helpers
create or replace function clinic_reception.is_nurse(p_admin uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.admins a where a.id = p_admin and a.active
    and (a.role in ('nursing','head_nursing')
      or exists(select 1 from public.admin_extra_roles r where r.admin_id = a.id and r.role in ('nursing','head_nursing'))))
$$;

create or replace function clinic_reception.section_of_text(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when translate(coalesce(p, ''), 'أإآ', 'ااا') ilike '%علاج%طبيعي%' or coalesce(p, '') ilike '%فيزيو%' then 'physio'
    when translate(coalesce(p, ''), 'أإآ', 'ااا') ilike '%اسنان%' then 'dental'
    else 'general' end
$$;

create or replace function clinic_reception.nurse_section(p_admin uuid)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ov text; d text := ''; t text := '';
begin
  select section_override into ov from clinic_reception.nursing_assignments where admin_id = p_admin;
  if ov is not null then return ov; end if;
  if to_regclass('clinic_people.people') is not null then
    select coalesce(pe.department, ''), coalesce(pe.job_title, '') into d, t from clinic_people.people pe where pe.admin_id = p_admin;
  end if;
  return clinic_reception.section_of_text(d || ' ' || t);
end $$;

create or replace function clinic_reception.nurse_absent(p_admin uuid, p_day date)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from clinic_reception.nursing_assignments where admin_id = p_admin and absent_on = p_day)
$$;

create or replace function clinic_reception.section_covered(p_section text, p_day date)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.admins a where clinic_reception.is_nurse(a.id)
    and clinic_reception.nurse_section(a.id) = p_section and not clinic_reception.nurse_absent(a.id, p_day))
$$;

create or replace function clinic_reception.my_nursing_sections(p_day date)
returns text[] language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s text; res text[];
begin
  if public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('head_nursing') then
    return array['physio','dental','general'];
  end if;
  s := clinic_reception.nurse_section(me);
  res := array[s];
  if s = 'general' then
    if not clinic_reception.section_covered('physio', p_day) then res := array_append(res, 'physio'); end if;
    if not clinic_reception.section_covered('dental', p_day) then res := array_append(res, 'dental'); end if;
  end if;
  return res;
end $$;

create or replace function clinic_reception.appointment_section(p_provider uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.section_of_text((select department from clinic_reception.providers where id = p_provider))
$$;

create or replace function clinic_reception.is_case_doctor(p_appointment uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); ok boolean := false;
begin
  if to_regclass('clinic_people.people') is null then return false; end if;
  select exists(select 1 from clinic_reception.appointments a join clinic_reception.providers pr on pr.id = a.provider_id
      join clinic_people.people pe on pe.doctor_key is not null and pe.doctor_key = pr.doctor_key
     where a.id = p_appointment and pe.admin_id = me) into ok;
  return ok;
end $$;

-- Fixed-text notice to the nurses of the booking's section (or general nurses if nobody of that section is in today).
create or replace function clinic_reception.notify_nursing()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare sec text; day date; label text; doc text; t text; kind text; r record; ap public.patients;
begin
  begin
    day := (new.starts_at at time zone 'Africa/Cairo')::date;
    if day is distinct from clinic_reception.today() then return new; end if;
    if tg_op = 'INSERT' then
      if new.status <> 'booked' then return new; end if;
      kind := 'booking_today';
    elsif new.status = 'arrived' and old.status is distinct from 'arrived' then
      kind := 'arrived';
    elsif new.starts_at is distinct from old.starts_at and new.status = 'booked' then
      kind := 'booking_today';
    else
      return new;
    end if;
    sec := clinic_reception.appointment_section(new.provider_id);
    select name into doc from clinic_reception.providers where id = new.provider_id;
    select p.* into ap from clinic_reception.patients rp join public.patients p on p.id = rp.patient_id where rp.id = new.patient_id;
    label := case sec when 'dental' then 'أسنان' when 'physio' then 'علاج طبيعي' else 'تمريض عام' end;
    t := case kind when 'arrived' then 'وصل مريض ' || label else 'مريض حجز ' || label end
         || ' الساعة ' || to_char(new.starts_at at time zone 'Africa/Cairo', 'FMHH12:MI') || coalesce(' — ' || doc, '');
    for r in select a.id from public.admins a where clinic_reception.is_nurse(a.id) and not clinic_reception.nurse_absent(a.id, day)
               and (clinic_reception.nurse_section(a.id) = sec
                    or (sec <> 'general' and clinic_reception.nurse_section(a.id) = 'general' and not clinic_reception.section_covered(sec, day)))
    loop
      insert into public.staff_notifications(recipient_admin_id, kind, appointment_id, archive_patient_id, title)
      values (r.id, kind, new.id, ap.id, t);
    end loop;
  exception when others then
    null; -- a notice must never block a booking
  end;
  return new;
end $$;
revoke all on function clinic_reception.notify_nursing() from public, anon, authenticated;
drop trigger if exists trg_notify_nursing on clinic_reception.appointments;
create trigger trg_notify_nursing after insert or update of status, starts_at on clinic_reception.appointments
  for each row execute function clinic_reception.notify_nursing();

-- Every file a nurse opens is logged with the opener (no-op for other roles).
create or replace function public.log_patient_file_open(p_patient uuid, p_source text default 'archive', p_appointment uuid default null)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null or p_patient is null or not clinic_reception.is_nurse(me) then return; end if;
  if not exists (select 1 from public.patients where id = p_patient) then return; end if;
  insert into public.patient_file_opens(admin_id, patient_id, appointment_id, source)
  values (me, p_patient, p_appointment, left(coalesce(nullif(p_source, ''), 'archive'), 30));
end $$;
revoke all on function public.log_patient_file_open(uuid, text, uuid) from public, anon;
grant execute on function public.log_patient_file_open(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------- the RPC
create or replace function public.clinic_reception_nursing(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p jsonb := coalesce(p_payload, '{}'); day date; secs text[]; a clinic_reception.appointments; t clinic_reception.visit_triage;
  sec text; rp clinic_reception.patients; mgr boolean; doc boolean; nrs boolean; rev int; st text; names text[]; prof public.patient_medical_profile;
  has_prof boolean; cc jsonb; n int; target uuid;
begin
  me := clinic_reception.access(p_workspace, 'view');
  nrs := clinic_reception.is_nurse(me);
  mgr := public.has_role('super_admin') or public.has_role('general_manager');
  doc := public.has_role('sono_doctor');
  day := coalesce(nullif(p->>'date', '')::date, clinic_reception.today());

  if p_action = 'day' then
    if not (nrs or mgr) then raise exception 'الشاشة دي للتمريض'; end if;
    secs := clinic_reception.my_nursing_sections(day);
    return jsonb_build_object('date', day, 'my_section', clinic_reception.nurse_section(me), 'sections', to_jsonb(secs),
      'unread', (select count(*) from public.staff_notifications where recipient_admin_id = me and read_at is null),
      'appointments', coalesce((select jsonb_agg(y.r order by (y.r->>'starts_at'))
        from (select jsonb_build_object('id', x.id, 'starts_at', x.starts_at, 'section', x.sec, 'patient_name', x.pname, 'file_no', x.file_no,
              'archive_patient_id', x.archive_id, 'service', x.service, 'doctor', x.doctor, 'status', x.status, 'queue_status', x.qstatus,
              'ticket_no', x.ticket_no, 'triage', x.triage,
              'prep', coalesce((select jsonb_agg(np.item) from clinic_reception.nursing_prep np where np.appointment_id = x.id), '[]')) as r
              from (select a2.id, a2.starts_at, a2.status, clinic_reception.appointment_section(a2.provider_id) sec, rp2.name pname, rp2.file_no,
                           rp2.patient_id archive_id, sv.name service, pr.name doctor, q.status qstatus, q.ticket_no,
                           coalesce(tr.status, 'none') triage
                      from clinic_reception.appointments a2
                      join clinic_reception.patients rp2 on rp2.id = a2.patient_id
                      join clinic_reception.providers pr on pr.id = a2.provider_id
                      left join clinic_reception.services sv on sv.id = a2.service_id
                      left join clinic_reception.queue_entries q on q.appointment_id = a2.id
                      left join clinic_reception.visit_triage tr on tr.appointment_id = a2.id
                     where a2.workspace_id = p_workspace and (a2.starts_at at time zone 'Africa/Cairo')::date = day
                       and a2.status not in ('cancelled')) x
             where x.sec = any(secs)) y), '[]'));

  elsif p_action = 'prep_set' then
    if not (nrs or mgr) then raise exception 'للتمريض بس'; end if;
    select * into a from clinic_reception.appointments where id = (p->>'appointment_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الحجز غير موجود'; end if;
    if coalesce((p->>'done')::boolean, true) then
      insert into clinic_reception.nursing_prep(appointment_id, item, done_by) values (a.id, left(trim(p->>'item'), 60), me)
        on conflict (appointment_id, item) do update set done_by = me, done_at = now();
    else
      delete from clinic_reception.nursing_prep where appointment_id = a.id and item = trim(p->>'item');
    end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'triage_get' then
    if not (nrs or mgr or doc) then raise exception 'مش مسموح'; end if;
    select * into t from clinic_reception.visit_triage where appointment_id = (p->>'appointment_id')::uuid and workspace_id = p_workspace;
    if not found then return jsonb_build_object('triage', null); end if;
    return jsonb_build_object('triage', to_jsonb(t) || jsonb_build_object(
      'nurse_name', (select coalesce(nullif(name, ''), email) from public.admins where id = t.nurse_id)));

  elsif p_action = 'triage_save' then
    if not (nrs or mgr) then raise exception 'التمريض بس يسجل الفحص قبل الكشف'; end if;
    select * into a from clinic_reception.appointments where id = (p->>'appointment_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الحجز غير موجود'; end if;
    if a.status in ('cancelled','no_show') then raise exception 'الحجز ده مش ساري'; end if;
    st := case when p->>'status' = 'draft' then 'draft' else 'recorded' end;
    names := coalesce((select array_agg(left(trim(x), 60)) from jsonb_array_elements_text(coalesce(p->'chronic_diseases', '[]')) x where trim(x) <> ''), '{}');
    select coalesce(max(revision), 0) + 1 into rev from clinic_reception.visit_triage where appointment_id = a.id;
    insert into clinic_reception.visit_triage as v(appointment_id, workspace_id, patient_id, nurse_id, status, bp_sys, bp_dia, pulse, temp_c, spo2, weight_kg,
        sugar_mgdl, on_chronic_meds, chronic_meds, recent_surgery, surgery_note, allergies, chronic_diseases, chronic_other, chief_complaint,
        nursing_note, revision, recorded_at, updated_at)
    values (a.id, p_workspace, a.patient_id, me, st, nullif(p->>'bp_sys', '')::smallint, nullif(p->>'bp_dia', '')::smallint,
        nullif(p->>'pulse', '')::smallint, nullif(p->>'temp_c', '')::numeric, nullif(p->>'spo2', '')::smallint,
        nullif(p->>'weight_kg', '')::numeric, nullif(p->>'sugar_mgdl', '')::smallint, (p->>'on_chronic_meds')::boolean,
        nullif(trim(p->>'chronic_meds'), ''), (p->>'recent_surgery')::boolean, nullif(trim(p->>'surgery_note'), ''),
        nullif(trim(p->>'allergies'), ''), names, nullif(trim(p->>'chronic_other'), ''), nullif(trim(p->>'chief_complaint'), ''),
        nullif(trim(p->>'nursing_note'), ''), rev, case when st = 'recorded' then now() end, now())
    on conflict (appointment_id) do update set nurse_id = me, status = excluded.status, bp_sys = excluded.bp_sys, bp_dia = excluded.bp_dia,
        pulse = excluded.pulse, temp_c = excluded.temp_c, spo2 = excluded.spo2, weight_kg = excluded.weight_kg, sugar_mgdl = excluded.sugar_mgdl,
        on_chronic_meds = excluded.on_chronic_meds, chronic_meds = excluded.chronic_meds, recent_surgery = excluded.recent_surgery,
        surgery_note = excluded.surgery_note, allergies = excluded.allergies, chronic_diseases = excluded.chronic_diseases,
        chronic_other = excluded.chronic_other, chief_complaint = excluded.chief_complaint, nursing_note = excluded.nursing_note,
        revision = v.revision + 1, recorded_at = case when excluded.status = 'recorded' then coalesce(v.recorded_at, now()) else v.recorded_at end,
        profile_confirmed_at = null, profile_confirmed_by = null, updated_at = now()
    returning * into t;
    insert into clinic_reception.visit_triage_log(appointment_id, actor_id, action, revision, snapshot)
      values (a.id, me, case when st = 'draft' then 'save_draft' else 'record' end, t.revision, to_jsonb(t));
    return jsonb_build_object('ok', true, 'status', t.status, 'revision', t.revision);

  elsif p_action = 'triage_confirm_profile' then
    if not (doc or mgr) then raise exception 'تأكيد نقل الأمراض المزمنة للملف الطبي للدكتور'; end if;
    select * into a from clinic_reception.appointments where id = (p->>'appointment_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الحجز غير موجود'; end if;
    if not (mgr or clinic_reception.is_case_doctor(a.id)) then raise exception 'الدكتور صاحب الحجز بس يأكد'; end if;
    select * into t from clinic_reception.visit_triage where appointment_id = a.id;
    if not found or t.status <> 'recorded' then raise exception 'مفيش فحص قبل كشف مسجّل'; end if;
    select * into rp from clinic_reception.patients where id = a.patient_id;
    if rp.patient_id is null then raise exception 'المريض مش مربوط بملف في الأرشيف'; end if;
    select * into prof from public.patient_medical_profile where patient_id = rp.patient_id;
    has_prof := found;
    cc := coalesce(case when has_prof then prof.chronic_conditions end, '[]'::jsonb);
    n := 0;
    for sec in select unnest(t.chronic_diseases || case when t.chronic_other is not null then array[t.chronic_other] else '{}' end)
    loop
      if not exists (select 1 from jsonb_array_elements(cc) e where lower(trim(e->>'name')) = lower(trim(sec))) then
        cc := cc || jsonb_build_array(jsonb_build_object('name', sec, 'has', true, 'medication', ''));
        n := n + 1;
      end if;
    end loop;
    insert into public.patient_medical_profile(patient_id, chronic_conditions, updated_by, updated_at)
      values (rp.patient_id, cc, me, now())
      on conflict (patient_id) do update set chronic_conditions = excluded.chronic_conditions, updated_by = me, updated_at = now();
    update clinic_reception.visit_triage set profile_confirmed_at = now(), profile_confirmed_by = me where appointment_id = a.id;
    insert into clinic_reception.visit_triage_log(appointment_id, actor_id, action, revision, snapshot)
      values (a.id, me, 'confirm_profile', t.revision, jsonb_build_object('added', n));
    return jsonb_build_object('ok', true, 'added', n);

  elsif p_action = 'notifications' then
    return jsonb_build_object('unread', (select count(*) from public.staff_notifications where recipient_admin_id = me and read_at is null),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', n2.id, 'kind', n2.kind, 'title', n2.title, 'appointment_id', n2.appointment_id,
          'archive_patient_id', n2.archive_patient_id, 'created_at', n2.created_at, 'read', n2.read_at is not null) order by n2.created_at desc)
        from (select * from public.staff_notifications where recipient_admin_id = me order by created_at desc limit 30) n2), '[]'));

  elsif p_action = 'notifications_read' then
    update public.staff_notifications set read_at = now()
     where recipient_admin_id = me and read_at is null and (p->'ids' is null or id in (select (x #>> '{}')::uuid from jsonb_array_elements(p->'ids') x));
    return jsonb_build_object('ok', true);

  elsif p_action = 'open_file' then
    if not (nrs or mgr or doc) then raise exception 'مش مسموح'; end if;
    perform public.log_patient_file_open((p->>'patient_id')::uuid, coalesce(p->>'source', 'nursing_day'), nullif(p->>'appointment_id', '')::uuid);
    return jsonb_build_object('ok', true);

  elsif p_action = 'settings_get' then
    if not (mgr or public.has_role('head_nursing')) then raise exception 'للسوبر أدمن ورئيس التمريض'; end if;
    return jsonb_build_object('nurses', coalesce((select jsonb_agg(jsonb_build_object('admin_id', a3.id, 'name', coalesce(nullif(a3.name, ''), a3.email),
        'default_section', (select case when to_regclass('clinic_people.people') is null then 'general' else
            clinic_reception.section_of_text((select coalesce(pe.department, '') || ' ' || coalesce(pe.job_title, '') from clinic_people.people pe where pe.admin_id = a3.id)) end),
        'override', (select section_override from clinic_reception.nursing_assignments where admin_id = a3.id),
        'section', clinic_reception.nurse_section(a3.id),
        'absent_today', clinic_reception.nurse_absent(a3.id, clinic_reception.today())) order by coalesce(nullif(a3.name, ''), a3.email))
      from public.admins a3 where clinic_reception.is_nurse(a3.id)), '[]'));

  elsif p_action = 'settings_save' then
    if not (mgr or public.has_role('head_nursing')) then raise exception 'للسوبر أدمن ورئيس التمريض'; end if;
    target := (p->>'admin_id')::uuid;
    if not clinic_reception.is_nurse(target) then raise exception 'مش من التمريض'; end if;
    if nullif(p->>'section_override', '') is not null and p->>'section_override' not in ('physio','dental','general') then raise exception 'قسم غير معروف'; end if;
    insert into clinic_reception.nursing_assignments(admin_id, section_override, absent_on, updated_by, updated_at)
      values (target, nullif(p->>'section_override', ''), case when coalesce((p->>'absent_today')::boolean, false) then clinic_reception.today() end, me, now())
    on conflict (admin_id) do update set section_override = excluded.section_override, absent_on = excluded.absent_on, updated_by = me, updated_at = now();
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;
revoke all on function clinic_reception.is_nurse(uuid), clinic_reception.section_of_text(text), clinic_reception.nurse_section(uuid),
  clinic_reception.nurse_absent(uuid, date), clinic_reception.section_covered(text, date), clinic_reception.my_nursing_sections(date),
  clinic_reception.appointment_section(uuid), clinic_reception.is_case_doctor(uuid) from public, anon, authenticated;

commit;
