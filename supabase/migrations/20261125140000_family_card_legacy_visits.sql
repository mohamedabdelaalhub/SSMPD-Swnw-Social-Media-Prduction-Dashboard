-- 20261125140000 «كارت العيلة»: family-card visits from the OLD system (owner 2026-11-25, «ابني»).
-- Families that already used family-card visits before the dashboard restarted at 10%. Reception enters, once per family,
-- «زيارات كارت العيلة السابقة (السيستم القديم)» — a whole number ≥ 0 with a reason and a proof (document or written note).
-- It counts only after approval by a configured approver who is NOT the person who entered it:
--   clinic_reception.family_legacy_config: approver_roles (default super_admin + financial_manager), required approvals
--   (default 1 = any one of them; 2 = two different people), distinct_roles (with required 2: the two must hold different roles).
-- clinic_reception.family_visits(patient, exclude) = approved old-system visits of the family + family-card visits in the
-- new system; the percent keeps the same family_percent cycle 10/20/30/40/50. A change is a new request that needs approval
-- again (the approved count stays in force until the new one is approved; then the old row becomes «superseded»).
-- One active (pending / approved) entry per family: entering on a second file of the same family is refused.
-- Everything is written to clinic_reception.audit. New public RPCs:
--   clinic_reception_family_legacy(ws, 'status' | 'request', payload)   reception (view / book)
--   clinic_reception_family_legacy_pending()                            approvers: what waits for them (+ can_review)
--   clinic_reception_family_legacy_review(id, approve, note)            approvers
-- Rollback: supabase/rollbacks/20261125140000_family_card_legacy_visits.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.family_visits(uuid,uuid)') is null then raise exception 'طبّق 20261122110000 الأول'; end if;
  if to_regclass('clinic_reception.family_legacy_visits') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.family_legacy_config(
  id boolean primary key default true check (id),
  approver_roles text[] not null default array['super_admin', 'financial_manager'],
  required integer not null default 1 check (required between 1 and 3),
  distinct_roles boolean not null default false,
  updated_at timestamptz not null default now());
insert into clinic_reception.family_legacy_config(id) values (true);
alter table clinic_reception.family_legacy_config enable row level security;
revoke all on clinic_reception.family_legacy_config from public, anon, authenticated;

create table clinic_reception.family_legacy_visits(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  patient_id uuid not null references clinic_reception.patients(id),
  visits integer not null check (visits between 0 and 500),
  reason text not null check (length(btrim(reason)) >= 3),
  proof_path text,
  proof_note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  rejected_by uuid,
  review_note text,
  check (coalesce(length(btrim(proof_path)), 0) >= 4 or coalesce(length(btrim(proof_note)), 0) >= 5));
create unique index family_legacy_one_pending on clinic_reception.family_legacy_visits(patient_id) where status = 'pending';
create unique index family_legacy_one_approved on clinic_reception.family_legacy_visits(patient_id) where status = 'approved';
alter table clinic_reception.family_legacy_visits enable row level security;
revoke all on clinic_reception.family_legacy_visits from public, anon, authenticated;

create table clinic_reception.family_legacy_approvals(
  request_id uuid not null references clinic_reception.family_legacy_visits(id),
  admin_id uuid not null,
  role text not null,
  at timestamptz not null default now(),
  primary key (request_id, admin_id));
alter table clinic_reception.family_legacy_approvals enable row level security;
revoke all on clinic_reception.family_legacy_approvals from public, anon, authenticated;

-- keep the old body for the rollback
create table clinic_reception.family_legacy_saved(name text primary key, def text not null);
insert into clinic_reception.family_legacy_saved values
  ('family_visits', pg_get_functiondef('clinic_reception.family_visits(uuid,uuid)'::regprocedure));
revoke all on clinic_reception.family_legacy_saved from public, anon, authenticated;

-- approved old-system visits of the whole family
create function clinic_reception.family_legacy_count(p_patient uuid) returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(l.visits), 0)::int from clinic_reception.family_legacy_visits l
   where l.status = 'approved' and l.patient_id = any(clinic_reception.family_ids(p_patient)) $$;
revoke all on function clinic_reception.family_legacy_count(uuid) from public, anon, authenticated;

create or replace function clinic_reception.family_visits(p_patient uuid, p_exclude uuid default null) returns integer
language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.family_legacy_count(p_patient) + (select count(*)::int from clinic_reception.appointments a
   where a.patient_id = any(clinic_reception.family_ids(p_patient)) and a.discount_kind = 'family'
     and a.status in ('arrived', 'completed') and a.id is distinct from p_exclude) $$;
revoke all on function clinic_reception.family_visits(uuid, uuid) from public, anon, authenticated;

-- the role the current user approves with (null = not an approver)
create function clinic_reception.family_legacy_role() returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select r from clinic_reception.family_legacy_config c, unnest(c.approver_roles) r where public.has_role(r) order by array_position(c.approver_roles, r) limit 1 $$;
revoke all on function clinic_reception.family_legacy_role() from public, anon, authenticated;

create function clinic_reception.family_legacy_row(l clinic_reception.family_legacy_visits) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', l.id, 'patient_id', l.patient_id, 'patient', p.name, 'file_no', p.file_no, 'visits', l.visits,
    'reason', l.reason, 'proof_path', l.proof_path, 'proof_note', l.proof_note, 'status', l.status, 'created_at', l.created_at,
    'decided_at', l.decided_at, 'review_note', l.review_note,
    'created_by', (select coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') from public.admins a where a.id = l.created_by),
    'mine', l.created_by = public.my_admin_id(),
    'rejected_by', (select coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') from public.admins a where a.id = l.rejected_by),
    'approved_by', coalesce((select jsonb_agg(coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') order by x.at) from clinic_reception.family_legacy_approvals x
       join public.admins a on a.id = x.admin_id where x.request_id = l.id), '[]'::jsonb),
    'i_approved', exists (select 1 from clinic_reception.family_legacy_approvals x where x.request_id = l.id and x.admin_id = public.my_admin_id()))
  from clinic_reception.patients p where p.id = l.patient_id $$;
revoke all on function clinic_reception.family_legacy_row(clinic_reception.family_legacy_visits) from public, anon, authenticated;

-- reception: status of the family + request (enter / change)
create function public.clinic_reception_family_legacy(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; pid uuid := nullif(p_payload->>'patient_id', '')::uuid; fam uuid[]; n int; path text; note text; why text;
  has_file boolean; other record; v uuid; can_book boolean;
begin
  if p_action not in ('status', 'request') then raise exception 'إجراء غير متاح'; end if;
  me := clinic_reception.access(p_workspace, case when p_action = 'request' then 'book' else 'view' end);
  if not exists (select 1 from clinic_reception.patients where id = pid and workspace_id = p_workspace) then raise exception 'الملف مش موجود'; end if;
  fam := clinic_reception.family_ids(pid);
  if p_action = 'request' then
    if (p_payload->>'visits') !~ '^\s*[0-9]+\s*$' then raise exception 'اكتب عدد الزيارات السابقة (رقم صحيح 0 أو أكتر)'; end if;
    n := btrim(p_payload->>'visits')::int;
    if n > 500 then raise exception 'عدد الزيارات كبير — راجع الرقم'; end if;
    why := btrim(coalesce(p_payload->>'reason', ''));
    if length(why) < 3 then raise exception 'اكتب السبب'; end if;
    path := nullif(btrim(coalesce(p_payload->>'proof_path', '')), '');
    note := nullif(btrim(coalesce(p_payload->>'proof_note', '')), '');
    if path is null and coalesce(length(note), 0) < 5 then raise exception 'ارفع مستند أو اكتب ملاحظة الإثبات'; end if;
    if path is not null and to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''booking-discount-cards'' and o.name = $1)' into has_file using path;
      if not has_file then raise exception 'المستند مااترفعش — ارفعه تاني'; end if;
    end if;
    -- one active entry per family
    select l.patient_id, p.name into other from clinic_reception.family_legacy_visits l join clinic_reception.patients p on p.id = l.patient_id
     where l.status in ('pending', 'approved') and l.patient_id = any(fam) and l.patient_id <> pid limit 1;
    if other.patient_id is not null then
      raise exception 'زيارات العيلة القديمة متسجّلة على ملف % — عدّلها من هناك', other.name; end if;
    if exists (select 1 from clinic_reception.family_legacy_visits where patient_id = pid and status = 'pending') then
      raise exception 'في طلب مستني الاعتماد للعيلة دي'; end if;
    if exists (select 1 from clinic_reception.family_legacy_visits where patient_id = pid and status = 'approved' and visits = n) then
      raise exception 'نفس العدد متعتمد قبل كده'; end if;
    insert into clinic_reception.family_legacy_visits(workspace_id, patient_id, visits, reason, proof_path, proof_note, created_by)
      values (p_workspace, pid, n, left(why, 300), path, left(note, 500), me) returning id into v;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'family_legacy_request', v, jsonb_build_object('patient_id', pid, 'visits', n, 'reason', left(why, 300),
        'proof_path', path, 'proof_note', left(note, 500),
        'replaces', (select l.visits from clinic_reception.family_legacy_visits l where l.patient_id = pid and l.status = 'approved')));
  end if;
  begin perform clinic_reception.access(p_workspace, 'book'); can_book := true; exception when others then can_book := false; end;
  return jsonb_build_object('patient_id', pid,
    'legacy_visits', clinic_reception.family_legacy_count(pid),
    'used', clinic_reception.family_visits(pid, null),
    'next_percent', clinic_reception.family_percent(clinic_reception.family_visits(pid, null)),
    'can_request', can_book and not exists (select 1 from clinic_reception.family_legacy_visits l
        where l.status in ('pending', 'approved') and l.patient_id = any(fam) and l.patient_id <> pid)
      and not exists (select 1 from clinic_reception.family_legacy_visits l where l.patient_id = pid and l.status = 'pending'),
    'required', (select required from clinic_reception.family_legacy_config),
    'entries', coalesce((select jsonb_agg(clinic_reception.family_legacy_row(l) order by l.created_at desc, (l.status = 'pending') desc)
      from clinic_reception.family_legacy_visits l where l.patient_id = any(fam)), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_family_legacy(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_family_legacy(uuid, text, jsonb) to authenticated;

-- approvers: what waits for them
create function public.clinic_reception_family_legacy_pending() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); my_role text := clinic_reception.family_legacy_role();
begin
  if me is null or my_role is null then return jsonb_build_object('can_review', false, 'pending', '[]'::jsonb); end if;
  return jsonb_build_object('can_review', true, 'role', my_role, 'required', (select required from clinic_reception.family_legacy_config),
    'pending', coalesce((select jsonb_agg(clinic_reception.family_legacy_row(l)
        || jsonb_build_object('old_visits', (select o.visits from clinic_reception.family_legacy_visits o where o.patient_id = l.patient_id and o.status = 'approved'),
                              'new_system', clinic_reception.family_visits(l.patient_id, null) - clinic_reception.family_legacy_count(l.patient_id))
        order by l.created_at)
      from clinic_reception.family_legacy_visits l where l.status = 'pending'), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_family_legacy_pending() from public, anon;
grant execute on function public.clinic_reception_family_legacy_pending() to authenticated;

create function public.clinic_reception_family_legacy_review(p_id uuid, p_approve boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); my_role text := clinic_reception.family_legacy_role(); cfg clinic_reception.family_legacy_config%rowtype;
  l clinic_reception.family_legacy_visits%rowtype; got int; roles int;
begin
  if me is null or my_role is null then raise exception 'اعتماد زيارات كارت العيلة القديمة مش من صلاحيتك' using errcode = '42501'; end if;
  select * into cfg from clinic_reception.family_legacy_config;
  select * into l from clinic_reception.family_legacy_visits where id = p_id for update;
  if not found then raise exception 'الطلب مش موجود'; end if;
  if l.status <> 'pending' then raise exception 'الطلب ده اتراجع قبل كده'; end if;
  if l.created_by = me then raise exception 'اللي سجّل الزيارات مايقدرش يعتمدها — محتاج حد تاني'; end if;
  if not coalesce(p_approve, false) then
    if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
    update clinic_reception.family_legacy_visits set status = 'rejected', rejected_by = me, decided_at = now(), review_note = left(btrim(p_note), 300) where id = l.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (l.workspace_id, me, 'family_legacy_reject', l.id, jsonb_build_object('patient_id', l.patient_id, 'visits', l.visits, 'role', my_role, 'note', left(btrim(p_note), 300)));
    return jsonb_build_object('id', l.id, 'status', 'rejected');
  end if;
  if exists (select 1 from clinic_reception.family_legacy_approvals where request_id = l.id and admin_id = me) then
    raise exception 'إنت اعتمدت الطلب ده قبل كده — محتاج حد تاني'; end if;
  if cfg.distinct_roles and exists (select 1 from clinic_reception.family_legacy_approvals where request_id = l.id and role = my_role) then
    raise exception 'الاعتماد التاني لازم يكون من دور مختلف'; end if;
  insert into clinic_reception.family_legacy_approvals(request_id, admin_id, role) values (l.id, me, my_role);
  select count(*), count(distinct x.role) into got, roles from clinic_reception.family_legacy_approvals x where x.request_id = l.id;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (l.workspace_id, me, 'family_legacy_approve', l.id, jsonb_build_object('patient_id', l.patient_id, 'visits', l.visits, 'role', my_role, 'approvals', got, 'required', cfg.required));
  if got < cfg.required then return jsonb_build_object('id', l.id, 'status', 'pending', 'approvals', got, 'required', cfg.required); end if;
  update clinic_reception.family_legacy_visits set status = 'superseded', decided_at = now() where patient_id = l.patient_id and status = 'approved';
  update clinic_reception.family_legacy_visits set status = 'approved', decided_at = now() where id = l.id;
  return jsonb_build_object('id', l.id, 'status', 'approved', 'approvals', got, 'required', cfg.required,
    'used', clinic_reception.family_visits(l.patient_id, null), 'next_percent', clinic_reception.family_percent(clinic_reception.family_visits(l.patient_id, null)));
end $$;
revoke all on function public.clinic_reception_family_legacy_review(uuid, boolean, text) from public, anon;
grant execute on function public.clinic_reception_family_legacy_review(uuid, boolean, text) to authenticated;
