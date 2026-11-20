-- Dental assistant / physio nurse notes: draft → case doctor approval (owner approved 2026-11-20; mockup screen 5).
-- The nurse writes a DRAFT; it never touches the official dental/physio report until the case doctor approves. The doctor can
-- approve, edit-and-approve, or return it with a reason. Approved text is locked (a later correction is a new draft in the
-- doctor's flow). Every step is logged by name and time.
--   * public.patient_clinical_drafts + public.patient_clinical_draft_log (no client grants; everything through the RPC).
--   * public.clinical_drafts(action, payload): save / list_mine / list_review / get / return / approve.
--   * Approval appends one session entry to patient_dental_reports.sessions or patient_physio_reports.sessions (same shape the
--     archive screens already use) and, for dental, may set the treatment plan. The official report row is created if none exists.
--   * The case doctor = the appointment's provider doctor_key matched to clinic_people.people.doctor_key → admin. Managers
--     (super admin / general manager) can act on any draft. If the provider has no linked doctor account (live: 2 of 50), a
--     sono_doctor whose HR department is the same section (dental / physio) can approve; if there is none, managers only
--     (they are the ones notified). The draft carries no_case_doctor so the screen can say so.
--   * Fixed-text staff notices: the doctor is told «مسودة … جاهزة لمراجعتك», the nurse «مسودتك رجعت للتعديل».
-- Nothing in the existing report tables or their policies changes.

begin;

alter table public.staff_notifications drop constraint if exists staff_notifications_kind_check;
alter table public.staff_notifications add constraint staff_notifications_kind_check
  check (kind in ('booking_today','arrived','draft_submitted','draft_returned'));

create table if not exists public.patient_clinical_drafts(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dental','physio')),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid,
  case_doctor_admin_id uuid references public.admins(id),
  author_id uuid not null references public.admins(id),
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','pending_review','approved','returned')),
  submitted_at timestamptz,
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz,
  return_reason text check (length(return_reason) <= 500),
  report_id uuid,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(content) = 'object' and length(content::text) <= 6000)
);
create index if not exists patient_clinical_drafts_patient_idx on public.patient_clinical_drafts(patient_id, created_at desc);
create index if not exists patient_clinical_drafts_review_idx on public.patient_clinical_drafts(status, case_doctor_admin_id);
alter table public.patient_clinical_drafts enable row level security;
revoke all on public.patient_clinical_drafts from public, anon, authenticated;

create table if not exists public.patient_clinical_draft_log(
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.patient_clinical_drafts(id) on delete cascade,
  actor_id uuid references public.admins(id),
  action text not null check (action in ('create','edit','submit','return','edit_by_doctor','approve')),
  changed_fields text[] not null default '{}',
  reason text,
  at timestamptz not null default now()
);
create index if not exists patient_clinical_draft_log_idx on public.patient_clinical_draft_log(draft_id, at);
alter table public.patient_clinical_draft_log enable row level security;
revoke all on public.patient_clinical_draft_log from public, anon, authenticated;

create or replace function clinic_reception.doctor_in_section(p_admin uuid, p_kind text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if to_regclass('clinic_people.people') is null then return false; end if;
  return exists(select 1 from clinic_people.people pe join public.admins a on a.id = pe.admin_id and a.active
     where pe.admin_id = p_admin and (a.role = 'sono_doctor' or exists (select 1 from public.admin_extra_roles r where r.admin_id = a.id and r.role = 'sono_doctor'))
       and clinic_reception.section_of_text(coalesce(pe.department, '') || ' ' || coalesce(pe.job_title, '')) = case p_kind when 'dental' then 'dental' else 'physio' end);
end $$;
revoke all on function clinic_reception.doctor_in_section(uuid, text) from public, anon, authenticated;

create or replace function public.clinical_drafts(p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); p jsonb := coalesce(p_payload, '{}'); nrs boolean; mgr boolean; doc boolean;
  d public.patient_clinical_drafts; c jsonb; keys text[]; doc_admin uuid; ap clinic_reception.appointments; rep_id uuid; sess jsonb;
  can_review boolean; pname text; label text; k text; changed text[] := '{}';
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  nrs := clinic_reception.is_nurse(me);
  mgr := public.has_role('super_admin') or public.has_role('general_manager');
  doc := public.has_role('sono_doctor');

  if p_action = 'save' then
    if not (nrs or mgr) then raise exception 'المسودات للتمريض ومساعدي الأقسام'; end if;
    c := coalesce(p->'content', '{}');
    if jsonb_typeof(c) <> 'object' then raise exception 'محتوى غير صالح'; end if;
    if nullif(p->>'id', '') is not null then
      select * into d from public.patient_clinical_drafts where id = (p->>'id')::uuid for update;
      if not found then raise exception 'المسودة غير موجودة'; end if;
      if d.author_id <> me and not mgr then raise exception 'مسودة غيرك'; end if;
      if d.status in ('pending_review','approved') then raise exception 'المسودة دي اتبعتت للدكتور أو اتعتمدت؛ مينفعش تتعدل'; end if;
      select coalesce(array_agg(k2 order by k2), '{}') into changed from (
        select key k2 from jsonb_each(d.content) a full join jsonb_each(c) b using (key) where a.value is distinct from b.value) z;
      if array_length(changed, 1) > 0 then
        update public.patient_clinical_drafts set content = c, revision = revision + 1, updated_at = now() where id = d.id returning * into d;
        insert into public.patient_clinical_draft_log(draft_id, actor_id, action, changed_fields) values (d.id, me, 'edit', changed);
      end if;
    else
      if (p->>'kind') not in ('dental','physio') then raise exception 'اختر نوع المسودة'; end if;
      if not exists (select 1 from public.patients where id = (p->>'patient_id')::uuid) then raise exception 'المريض غير موجود'; end if;
      doc_admin := null;
      if nullif(p->>'appointment_id', '') is not null then
        select * into ap from clinic_reception.appointments where id = (p->>'appointment_id')::uuid;
        if found and to_regclass('clinic_people.people') is not null then
          select pe.admin_id into doc_admin from clinic_reception.providers pr join clinic_people.people pe on pe.doctor_key is not null and pe.doctor_key = pr.doctor_key
           where pr.id = ap.provider_id and pe.admin_id is not null limit 1;
        end if;
      end if;
      insert into public.patient_clinical_drafts(kind, patient_id, appointment_id, case_doctor_admin_id, author_id, content)
        values (p->>'kind', (p->>'patient_id')::uuid, nullif(p->>'appointment_id', '')::uuid, doc_admin, me, c) returning * into d;
      insert into public.patient_clinical_draft_log(draft_id, actor_id, action) values (d.id, me, 'create');
    end if;
    if coalesce((p->>'submit')::boolean, false) then
      update public.patient_clinical_drafts set status = 'pending_review', submitted_at = now(), return_reason = null, updated_at = now() where id = d.id returning * into d;
      insert into public.patient_clinical_draft_log(draft_id, actor_id, action) values (d.id, me, 'submit');
      label := case d.kind when 'dental' then 'أسنان' else 'علاج طبيعي' end;
      insert into public.staff_notifications(recipient_admin_id, kind, appointment_id, archive_patient_id, title)
        select a.id, 'draft_submitted', d.appointment_id, d.patient_id, 'مسودة ' || label || ' جاهزة لمراجعتك'
          from public.admins a where a.active and (
            (d.case_doctor_admin_id is not null and a.id = d.case_doctor_admin_id)
            or (d.case_doctor_admin_id is null and (
                  clinic_reception.doctor_in_section(a.id, d.kind)
                  or (not exists (select 1 from public.admins a2 where a2.active and clinic_reception.doctor_in_section(a2.id, d.kind))
                      and (a.role in ('general_manager','super_admin') or exists (select 1 from public.admin_extra_roles r where r.admin_id = a.id and r.role in ('general_manager','super_admin')))))));
    end if;
    return jsonb_build_object('ok', true, 'id', d.id, 'status', d.status, 'revision', d.revision);

  elsif p_action = 'list_mine' then
    return jsonb_build_object('drafts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'patient_id', x.patient_id,
        'appointment_id', x.appointment_id, 'content', x.content, 'return_reason', x.return_reason, 'updated_at', x.updated_at, 'no_case_doctor', x.case_doctor_admin_id is null) order by x.updated_at desc)
      from (select * from public.patient_clinical_drafts where author_id = me and (p->>'appointment_id' is null or appointment_id = (p->>'appointment_id')::uuid)
              order by updated_at desc limit 50) x), '[]'));

  elsif p_action = 'list_review' then
    if not (doc or mgr) then raise exception 'للدكاترة'; end if;
    return jsonb_build_object('drafts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'patient_id', x.patient_id,
        'patient_name', x.pname, 'appointment_id', x.appointment_id, 'content', x.content, 'author', x.author, 'submitted_at', x.submitted_at) order by x.submitted_at)
      from (select d2.*, (select full_name from public.patients where id = d2.patient_id) pname, (select coalesce(nullif(name, ''), email) from public.admins where id = d2.author_id) author
              from public.patient_clinical_drafts d2
             where d2.status = 'pending_review' and (mgr or coalesce(d2.case_doctor_admin_id = me, false) or (d2.case_doctor_admin_id is null and doc and clinic_reception.doctor_in_section(me, d2.kind)))
             order by d2.submitted_at limit 100) x), '[]'));

  elsif p_action = 'get' then
    select * into d from public.patient_clinical_drafts where id = (p->>'id')::uuid;
    if not found then raise exception 'المسودة غير موجودة'; end if;
    can_review := mgr or coalesce(d.case_doctor_admin_id = me, false) or (d.case_doctor_admin_id is null and doc and clinic_reception.doctor_in_section(me, d.kind));
    if not (d.author_id = me or can_review) then raise exception 'مش مسموح'; end if;
    return jsonb_build_object('draft', to_jsonb(d) || jsonb_build_object('can_review', can_review, 'no_case_doctor', d.case_doctor_admin_id is null,
        'patient_name', (select full_name from public.patients where id = d.patient_id),
        'author', (select coalesce(nullif(name, ''), email) from public.admins where id = d.author_id)),
      'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor', (select coalesce(nullif(name, ''), email) from public.admins where id = l.actor_id),
          'changed_fields', l.changed_fields, 'reason', l.reason, 'at', l.at) order by l.at) from public.patient_clinical_draft_log l where l.draft_id = d.id), '[]'));

  elsif p_action in ('return', 'approve') then
    select * into d from public.patient_clinical_drafts where id = (p->>'id')::uuid for update;
    if not found then raise exception 'المسودة غير موجودة'; end if;
    can_review := mgr or coalesce(d.case_doctor_admin_id = me, false) or (d.case_doctor_admin_id is null and doc and clinic_reception.doctor_in_section(me, d.kind));
    if not can_review then raise exception 'الدكتور صاحب الحجز بس يراجع'; end if;
    if d.status <> 'pending_review' then raise exception 'المسودة دي مش مستنية مراجعة'; end if;
    if p_action = 'return' then
      if nullif(trim(p->>'reason'), '') is null then raise exception 'اكتب سبب الرجوع للتعديل'; end if;
      update public.patient_clinical_drafts set status = 'returned', reviewed_by = me, reviewed_at = now(), return_reason = left(trim(p->>'reason'), 500), updated_at = now() where id = d.id returning * into d;
      insert into public.patient_clinical_draft_log(draft_id, actor_id, action, reason) values (d.id, me, 'return', d.return_reason);
      label := case d.kind when 'dental' then 'أسنان' else 'علاج طبيعي' end;
      insert into public.staff_notifications(recipient_admin_id, kind, appointment_id, archive_patient_id, title)
        values (d.author_id, 'draft_returned', d.appointment_id, d.patient_id, 'مسودتك (' || label || ') رجعت للتعديل');
      return jsonb_build_object('ok', true, 'status', d.status);
    end if;
    -- approve (optionally with the doctor's own edits)
    c := d.content;
    if p->'content' is not null and jsonb_typeof(p->'content') = 'object' then
      select coalesce(array_agg(k2 order by k2), '{}') into changed from (
        select key k2 from jsonb_each(d.content) a full join jsonb_each(p->'content') b using (key) where a.value is distinct from b.value) z;
      c := p->'content';
      if array_length(changed, 1) > 0 then
        insert into public.patient_clinical_draft_log(draft_id, actor_id, action, changed_fields) values (d.id, me, 'edit_by_doctor', changed);
      end if;
    end if;
    if d.kind = 'dental' then
      sess := jsonb_build_object('date', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'), 'tooth', coalesce(c->>'tooth', ''),
        'service', coalesce(nullif(c->>'procedure_label', ''), c->>'procedure', ''),
        'notes', trim(both ' ' from concat_ws(' — ', nullif(c->>'notes', ''),
           case when nullif(c->>'material', '') is not null then 'الخامة: ' || (c->>'material') end,
           case when nullif(c->>'extraction_site', '') is not null then 'مكان السن المخلوع: ' || (c->>'extraction_site') end,
           case when coalesce((c->>'pediatric')::boolean, false) then 'أسنان أطفال' end,
           case when coalesce((c->>'radiograph_needed')::boolean, false) then 'أشعة مطلوبة' end)));
      select id into rep_id from public.patient_dental_reports where patient_id = d.patient_id order by report_date desc, created_at desc limit 1;
      if rep_id is null then
        insert into public.patient_dental_reports(patient_id, doctor_name, created_by, sessions, treatment_plan)
          values (d.patient_id, coalesce((select name from public.admins where id = me), ''), me, jsonb_build_array(sess), coalesce(c->>'plan', ''))
          returning id into rep_id;
      else
        update public.patient_dental_reports set sessions = coalesce(sessions, '[]'::jsonb) || jsonb_build_array(sess),
               treatment_plan = case when nullif(c->>'plan', '') is not null then coalesce(nullif(treatment_plan, '') || E'\n', '') || (c->>'plan') else treatment_plan end,
               updated_at = now() where id = rep_id;
      end if;
    else
      sess := jsonb_build_object('date', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
        'treatments', coalesce(c->'treatments', '[]'::jsonb), 'duration', coalesce(c->>'duration', ''), 'notes', trim(both ' ' from concat_ws(' — ', nullif(c->>'area', ''), nullif(c->>'notes', ''))));
      select id into rep_id from public.patient_physio_reports where patient_id = d.patient_id order by visit_date desc, created_at desc limit 1;
      if rep_id is null then
        insert into public.patient_physio_reports(patient_id, doctor_name, created_by, sessions)
          values (d.patient_id, coalesce((select name from public.admins where id = me), ''), me, jsonb_build_array(sess)) returning id into rep_id;
      else
        update public.patient_physio_reports set sessions = coalesce(sessions, '[]'::jsonb) || jsonb_build_array(sess), updated_at = now() where id = rep_id;
      end if;
    end if;
    update public.patient_clinical_drafts set content = c, status = 'approved', reviewed_by = me, reviewed_at = now(), report_id = rep_id, updated_at = now() where id = d.id returning * into d;
    insert into public.patient_clinical_draft_log(draft_id, actor_id, action) values (d.id, me, 'approve');
    return jsonb_build_object('ok', true, 'status', d.status, 'report_id', rep_id);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinical_drafts(text, jsonb) from public, anon;
grant execute on function public.clinical_drafts(text, jsonb) to authenticated;

commit;
