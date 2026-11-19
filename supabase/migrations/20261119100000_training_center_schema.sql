-- Training & evaluation center, PR 1/6: schema, permissions and owner-only management RPCs.
-- Spec: owner-approved functional spec «مواصفات مركز التعلم والتقييم» (2026-11-19).
--
-- * Everything lives in the private schema `training` (not exposed by PostgREST). RLS is enabled on every table with
--   NO policies and all direct privileges are revoked: the only way in is the public SECURITY DEFINER RPCs below,
--   which check the caller themselves.
-- * The question bank, including its answer key (option points + critical flags), is NOT in this repository (the repo
--   is public). The owner loads it with public.training_import_bank(<bank json>) from the private bank artifact.
--   No RPC returns option points or flags to anyone except super_admin (PR 3 result view), never to a trainee.
-- * No self-review: a reviewer can never be the trainee of the same assignment (table CHECK).
-- * Owner = super_admin (public.is_super()). Reviewers and trainees are active dashboard admins.
-- Later PRs: 2 attempts/exam RPCs + course, 3 server-side grading, 4 external candidate one-time link,
-- 5 interview/role-play/decision, 6 final report.
begin;

create schema if not exists training;
revoke all on schema training from public, anon, authenticated;

-- ---------------------------------------------------------------- reference data
create table if not exists training.tracks (
  code    text primary key check (code in ('branch_manager', 'team_manager')),
  name_ar text not null
);
insert into training.tracks (code, name_ar) values
  ('branch_manager', 'مدير فرع'),
  ('team_manager',   'مدير فريق')
on conflict (code) do update set name_ar = excluded.name_ar;

create table if not exists training.bank_meta (
  id                    boolean primary key default true check (id),
  version               text not null,
  duration_minutes      integer not null check (duration_minutes between 5 and 240),
  questions_per_attempt integer not null check (questions_per_attempt between 1 and 200),
  imported_at           timestamptz not null default now(),
  imported_by           uuid references public.admins(id) on delete set null
);

create table if not exists training.competencies (
  code     text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  name_ar  text not null,
  quota    integer not null check (quota >= 0),
  sort     integer not null default 0,
  active   boolean not null default true
);

create table if not exists training.questions (
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  competency   text not null references training.competencies(code),
  text         text not null check (length(text) between 1 and 4000),
  bank_version text not null,
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);
create index if not exists training_questions_competency on training.questions (competency) where active;

-- The answer key: points (2 best / 1 partial / 0 wrong) and critical (risk) flag per option.
create table if not exists training.question_options (
  question_id   text not null references training.questions(id) on delete cascade,
  option_id     text not null check (option_id ~ '^[a-z]$'),
  text          text not null check (length(text) between 1 and 2000),
  points        smallint not null check (points in (0, 1, 2)),
  critical_flag boolean not null default false,
  primary key (question_id, option_id)
);

-- ---------------------------------------------------------------- assignments, attempts, audit
create table if not exists training.assignments (
  id                uuid primary key default gen_random_uuid(),
  track             text not null references training.tracks(code),
  trainee_admin_id  uuid not null references public.admins(id),
  reviewer_admin_id uuid not null references public.admins(id),
  assigned_by       uuid references public.admins(id) on delete set null,
  due_at            timestamptz,
  status            text not null default 'assigned'
                    check (status in ('assigned', 'in_progress', 'submitted', 'interviewing', 'decided', 'cancelled')),
  note              text check (note is null or length(note) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancel_reason     text check (cancel_reason is null or length(cancel_reason) <= 1000),
  constraint training_assignments_no_self_review check (reviewer_admin_id <> trainee_admin_id),
  constraint training_assignments_cancel_reason check ((status = 'cancelled') = (cancelled_at is not null))
);
create index if not exists training_assignments_trainee  on training.assignments (trainee_admin_id);
create index if not exists training_assignments_reviewer on training.assignments (reviewer_admin_id);

-- One exam attempt per assignment; a retake needs a new assignment from the owner.
create table if not exists training.attempts (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null unique references training.assignments(id) on delete cascade,
  bank_version   text not null,
  question_ids   text[] not null,
  option_order   jsonb not null,           -- {question_id: [option ids in display order]}
  started_at     timestamptz not null default now(),
  deadline_at    timestamptz not null,
  submitted_at   timestamptz,
  auto_submitted boolean not null default false,
  blur_count     integer not null default 0 check (blur_count >= 0),
  status         text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  constraint training_attempts_submitted check ((status = 'submitted') = (submitted_at is not null)),
  constraint training_attempts_deadline check (deadline_at > started_at)
);

create table if not exists training.attempt_answers (
  attempt_id  uuid not null references training.attempts(id) on delete cascade,
  question_id text not null,
  option_id   text not null,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, question_id),
  foreign key (question_id, option_id) references training.question_options(question_id, option_id)
);

create table if not exists training.audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_admin_id uuid references public.admins(id) on delete set null,
  action         text not null,
  assignment_id  uuid references training.assignments(id) on delete set null,
  details        jsonb not null default '{}'::jsonb
);
create index if not exists training_audit_assignment on training.audit_log (assignment_id, at);

do $$
declare t text;
begin
  foreach t in array array['tracks','bank_meta','competencies','questions','question_options',
                           'assignments','attempts','attempt_answers','audit_log'] loop
    execute format('alter table training.%I enable row level security', t);
    execute format('revoke all on training.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- internal helpers
create or replace function training.audit(p_action text, p_assignment uuid, p_details jsonb)
returns void language sql security definer set search_path = pg_catalog, public, training as $$
  insert into training.audit_log (actor_admin_id, action, assignment_id, details)
  values (public.my_admin_id(), p_action, p_assignment, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function training.audit(text, uuid, jsonb) from public, anon, authenticated;

create or replace function training.require_owner()
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id();
begin
  if me is null or not public.is_super() then
    raise exception 'training: owner only' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function training.require_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------- owner: question bank
-- Accepts the bank JSON as published in the private bank artifact:
-- {version, duration_minutes, questions_per_attempt, competencies:[{code,name_ar,questions_per_attempt}],
--  questions:[{id, competency, text, options:[{id, text, points, critical_flag}]}]}
-- Returns counts only (never echoes the key). Questions missing from a re-import are deactivated, not deleted.
create or replace function public.training_import_bank(p_bank jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare
  me uuid := training.require_owner();
  v_version text := nullif(btrim(p_bank->>'version'), '');
  v_minutes int;
  v_per int;
  c jsonb; q jsonb; o jsonb;
  n_q int := 0; n_o int := 0; quota_sum int := 0;
  bad text;
begin
  if jsonb_typeof(p_bank) <> 'object' or v_version is null
     or jsonb_typeof(p_bank->'competencies') <> 'array' or jsonb_typeof(p_bank->'questions') <> 'array' then
    raise exception 'training: bank must have version, competencies[] and questions[]' using errcode = '22023';
  end if;
  v_minutes := (p_bank->>'duration_minutes')::int;
  v_per := (p_bank->>'questions_per_attempt')::int;

  -- competencies
  update training.competencies set active = false;
  for c in select * from jsonb_array_elements(p_bank->'competencies') loop
    insert into training.competencies (code, name_ar, quota, sort, active)
    values (c->>'code', c->>'name_ar', (c->>'questions_per_attempt')::int,
            (select count(*) from training.competencies), true)
    on conflict (code) do update set name_ar = excluded.name_ar, quota = excluded.quota, active = true;
    quota_sum := quota_sum + (c->>'questions_per_attempt')::int;
  end loop;
  if quota_sum <> v_per then
    raise exception 'training: competency quotas sum to % but questions_per_attempt is %', quota_sum, v_per
      using errcode = '22023';
  end if;

  -- questions + options
  update training.questions set active = false;
  for q in select * from jsonb_array_elements(p_bank->'questions') loop
    if jsonb_typeof(q->'options') <> 'array' or jsonb_array_length(q->'options') < 2 then
      raise exception 'training: question % needs at least 2 options', q->>'id' using errcode = '22023';
    end if;
    insert into training.questions (id, competency, text, bank_version, active, updated_at)
    values (q->>'id', q->>'competency', q->>'text', v_version, true, now())
    on conflict (id) do update set competency = excluded.competency, text = excluded.text,
      bank_version = excluded.bank_version, active = true, updated_at = now();
    n_q := n_q + 1;
    for o in select * from jsonb_array_elements(q->'options') loop
      insert into training.question_options (question_id, option_id, text, points, critical_flag)
      values (q->>'id', o->>'id', o->>'text', (o->>'points')::smallint, coalesce((o->>'critical_flag')::boolean, false))
      on conflict (question_id, option_id) do update set text = excluded.text, points = excluded.points,
        critical_flag = excluded.critical_flag;
      n_o := n_o + 1;
    end loop;
    -- drop options no longer in the bank, unless already answered (FK keeps history intact)
    delete from training.question_options x
     where x.question_id = q->>'id'
       and not exists (select 1 from jsonb_array_elements(q->'options') k where k->>'id' = x.option_id)
       and not exists (select 1 from training.attempt_answers a where a.question_id = x.question_id and a.option_id = x.option_id);
    if not exists (select 1 from training.question_options where question_id = q->>'id' and points = 2) then
      raise exception 'training: question % has no best (2-point) option', q->>'id' using errcode = '22023';
    end if;
  end loop;

  -- every active competency must have enough active questions for its quota
  select string_agg(c2.code, ', ') into bad
    from training.competencies c2
   where c2.active
     and c2.quota > (select count(*) from training.questions q2 where q2.active and q2.competency = c2.code);
  if bad is not null then
    raise exception 'training: not enough questions for competencies: %', bad using errcode = '22023';
  end if;

  insert into training.bank_meta (id, version, duration_minutes, questions_per_attempt, imported_at, imported_by)
  values (true, v_version, v_minutes, v_per, now(), me)
  on conflict (id) do update set version = excluded.version, duration_minutes = excluded.duration_minutes,
    questions_per_attempt = excluded.questions_per_attempt, imported_at = now(), imported_by = me;

  perform training.audit('bank_imported', null,
    jsonb_build_object('version', v_version, 'questions', n_q, 'options', n_o));
  return jsonb_build_object('version', v_version, 'questions', n_q, 'options', n_o,
                            'duration_minutes', v_minutes, 'questions_per_attempt', v_per);
end $$;
revoke all on function public.training_import_bank(jsonb) from public, anon;
grant execute on function public.training_import_bank(jsonb) to authenticated;

-- Owner-only summary: counts per competency, no question text, no key.
create or replace function public.training_bank_summary()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
begin
  perform training.require_owner();
  return jsonb_build_object(
    'meta', (select to_jsonb(m) - 'id' from training.bank_meta m),
    'competencies', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name_ar', c.name_ar, 'quota', c.quota,
               'questions', (select count(*) from training.questions q where q.active and q.competency = c.code))
             order by c.sort)
        from training.competencies c where c.active), '[]'::jsonb));
end $$;
revoke all on function public.training_bank_summary() from public, anon;
grant execute on function public.training_bank_summary() to authenticated;

-- ---------------------------------------------------------------- owner: assignments
create or replace function public.training_assign(p_track text, p_trainee uuid, p_reviewer uuid,
                                                  p_due timestamptz default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); v_id uuid;
begin
  if not exists (select 1 from training.tracks where code = p_track) then
    raise exception 'training: unknown track' using errcode = '22023';
  end if;
  if p_trainee is null or p_reviewer is null or p_trainee = p_reviewer then
    raise exception 'training: reviewer must be a different person from the trainee' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admins where id = p_trainee and active)
     or not exists (select 1 from public.admins where id = p_reviewer and active) then
    raise exception 'training: trainee and reviewer must be active dashboard users' using errcode = '22023';
  end if;
  if p_due is not null and p_due <= now() then
    raise exception 'training: due date must be in the future' using errcode = '22023';
  end if;
  insert into training.assignments (track, trainee_admin_id, reviewer_admin_id, assigned_by, due_at, note)
  values (p_track, p_trainee, p_reviewer, me, p_due, nullif(btrim(p_note), ''))
  returning id into v_id;
  perform training.audit('assigned', v_id,
    jsonb_build_object('track', p_track, 'trainee', p_trainee, 'reviewer', p_reviewer, 'due_at', p_due));
  return v_id;
end $$;
revoke all on function public.training_assign(text, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.training_assign(text, uuid, uuid, timestamptz, text) to authenticated;

-- Owner may change reviewer / due date / note while the assignment is open.
create or replace function public.training_update_assignment(p_id uuid, p_reviewer uuid, p_due timestamptz, p_note text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); a training.assignments;
begin
  select * into a from training.assignments where id = p_id for update;
  if not found then raise exception 'training: assignment not found' using errcode = 'P0002'; end if;
  if a.status in ('decided', 'cancelled') then
    raise exception 'training: assignment is closed' using errcode = '22023';
  end if;
  if p_reviewer is null or p_reviewer = a.trainee_admin_id
     or not exists (select 1 from public.admins where id = p_reviewer and active) then
    raise exception 'training: reviewer must be an active user other than the trainee' using errcode = '22023';
  end if;
  update training.assignments
     set reviewer_admin_id = p_reviewer, due_at = p_due, note = nullif(btrim(p_note), ''), updated_at = now()
   where id = p_id;
  perform training.audit('assignment_updated', p_id,
    jsonb_build_object('reviewer', p_reviewer, 'previous_reviewer', a.reviewer_admin_id, 'due_at', p_due));
end $$;
revoke all on function public.training_update_assignment(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.training_update_assignment(uuid, uuid, timestamptz, text) to authenticated;

create or replace function public.training_cancel_assignment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); a training.assignments;
begin
  if nullif(btrim(p_reason), '') is null then
    raise exception 'training: a cancel reason is required' using errcode = '22023';
  end if;
  select * into a from training.assignments where id = p_id for update;
  if not found then raise exception 'training: assignment not found' using errcode = 'P0002'; end if;
  if a.status in ('decided', 'cancelled') then
    raise exception 'training: assignment is already closed' using errcode = '22023';
  end if;
  update training.assignments
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now()
   where id = p_id;
  perform training.audit('assignment_cancelled', p_id, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke all on function public.training_cancel_assignment(uuid, text) from public, anon;
grant execute on function public.training_cancel_assignment(uuid, text) to authenticated;

-- ---------------------------------------------------------------- everyone: my assignments
-- Owner sees all; a reviewer sees those assigned to them; a trainee sees their own. No scores here.
create or replace function public.training_assignments()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); owner boolean := public.is_super();
begin
  if me is null then raise exception 'training: sign in required' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'track', a.track, 'track_name', t.name_ar,
             'trainee_id', a.trainee_admin_id, 'trainee_name', coalesce(tr.name, tr.email),
             'reviewer_id', a.reviewer_admin_id, 'reviewer_name', coalesce(rv.name, rv.email),
             'due_at', a.due_at, 'status', a.status, 'created_at', a.created_at,
             'note', case when owner or a.reviewer_admin_id = me then a.note end,
             'cancel_reason', case when owner then a.cancel_reason end,
             'relation', case when a.trainee_admin_id = me then 'trainee'
                              when a.reviewer_admin_id = me then 'reviewer'
                              else 'owner' end)
           order by a.created_at desc)
      from training.assignments a
      join training.tracks t on t.code = a.track
      join public.admins tr on tr.id = a.trainee_admin_id
      join public.admins rv on rv.id = a.reviewer_admin_id
     where owner or a.trainee_admin_id = me or a.reviewer_admin_id = me), '[]'::jsonb);
end $$;
revoke all on function public.training_assignments() from public, anon;
grant execute on function public.training_assignments() to authenticated;

commit;
