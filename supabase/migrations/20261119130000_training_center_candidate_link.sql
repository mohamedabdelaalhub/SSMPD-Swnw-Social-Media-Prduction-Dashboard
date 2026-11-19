-- Training & evaluation center, PR 4: external candidate one-time exam link.
--
-- * A candidate is NOT a dashboard user. The owner creates a personal, one-time invite; the candidate opens a public
--   static page that talks ONLY to the edge function `training-candidate`, which calls the token-scoped RPCs below with
--   the service role. Those RPCs are granted to service_role only (never anon/authenticated).
-- * Only the sha256 of the token is stored. The token is returned once, to the owner, when the invite is created.
-- * The link binds to the FIRST device that opens it (device hash). Another device is refused. Closing the page never
--   submits: the server-side timer keeps running and the exam auto-submits at the deadline. Submit closes the link.
-- * Candidates never see a score or a grade. They also skip the course (no module gate).
-- * Retention: candidate data is kept 5 years (purge_after), then reduced to a minimal record
--   (name, phone, date, outcome). Deletion on request is owner-triggered and audited.
-- * Delivery in v1 is manual (copy the link / WhatsApp prefill). send_channel is stored; nothing is «sent» here.
-- * Existing trainee RPCs stay correct: my_open_assignment is re-defined so a candidate assignment (no trainee) can
--   never be opened by a dashboard user through the trainee entry points.
begin;

-- ---------------------------------------------------------------- tables
create table if not exists training.candidates (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null check (length(btrim(full_name)) between 2 and 120),
  phone               text check (phone is null or length(phone) <= 40),
  phone_normalized    text check (phone_normalized is null or length(phone_normalized) <= 15),
  email               text check (email is null or length(email) <= 200),
  experience          text check (experience is null or length(experience) <= 3000),
  qualifications      text check (qualifications is null or length(qualifications) <= 3000),
  owner_notes         text check (owner_notes is null or length(owner_notes) <= 3000),
  consent_text_version text,
  consent_at          timestamptz,
  profile_at          timestamptz,
  purge_after         timestamptz not null default (now() + interval '5 years'),
  minimal_after_purge boolean not null default false,
  created_by          uuid references public.admins(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists training_candidates_phone on training.candidates (phone_normalized);

create table if not exists training.candidate_invites (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references training.candidates(id) on delete cascade,
  assignment_id uuid not null unique references training.assignments(id) on delete cascade,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at    timestamptz not null,
  device_hash   text,
  status        text not null default 'pending' check (status in ('pending', 'opened', 'submitted', 'revoked')),
  send_channel  text not null default 'manual' check (send_channel in ('manual', 'email')),
  opened_at     timestamptz,
  closed_at     timestamptz,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 1000),
  created_by    uuid references public.admins(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists training_candidate_invites_candidate on training.candidate_invites (candidate_id);

-- Assignments may belong to a candidate instead of a dashboard trainee (exactly one of the two).
alter table training.assignments add column if not exists candidate_id uuid references training.candidates(id) on delete set null;
alter table training.assignments alter column trainee_admin_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'training_assignments_one_subject') then
    alter table training.assignments add constraint training_assignments_one_subject
      check (num_nonnulls(trainee_admin_id, candidate_id) = 1) not valid;
    alter table training.assignments validate constraint training_assignments_one_subject;
  end if;
end $$;
create index if not exists training_assignments_candidate on training.assignments (candidate_id);

do $$
declare t text;
begin
  foreach t in array array['candidates', 'candidate_invites'] loop
    execute format('alter table training.%I enable row level security', t);
    execute format('revoke all on training.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- guards on the trainee entry points
create or replace function training.my_open_assignment(p_assignment uuid)
returns training.assignments language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments;
begin
  select * into a from training.assignments where id = p_assignment for update;
  if not found or me is null or a.trainee_admin_id is null or a.trainee_admin_id <> me then
    raise exception 'training: not your assignment' using errcode = '42501';
  end if;
  if a.status = 'cancelled' then
    raise exception 'training: assignment cancelled' using errcode = '22023';
  end if;
  return a;
end $$;
revoke all on function training.my_open_assignment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function training.token_hash(p_token text)
returns text language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;
revoke all on function training.token_hash(text) from public, anon, authenticated;

create or replace function training.normalize_phone(p text)
returns text language sql immutable set search_path = pg_catalog as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10), '');
$$;
revoke all on function training.normalize_phone(text) from public, anon, authenticated;

-- Resolve + lock the invite for a token/device pair. Binds the device on first open.
-- p_bind = true only for the "open" call; every other call requires the same device.
create or replace function training.candidate_invite_for(p_token text, p_device text, p_bind boolean default false)
returns training.candidate_invites language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites; att training.attempts;
begin
  if p_token is null or length(p_token) < 40 or p_device is null or length(p_device) < 16 then
    raise exception 'training: invalid link' using errcode = '22023';
  end if;
  select * into i from training.candidate_invites where token_hash = training.token_hash(p_token) for update;
  if not found then raise exception 'training: invalid link' using errcode = '22023'; end if;
  if i.status = 'revoked' then raise exception 'training: link closed' using errcode = '22023'; end if;
  -- an expired exam closes the link even if nobody comes back
  select * into att from training.attempts where assignment_id = i.assignment_id;
  if att.id is not null and att.status = 'in_progress' and att.deadline_at <= now() then
    perform training.finalize_attempt(att.id, true);
    att.status := 'submitted';
  end if;
  if att.id is not null and att.status = 'submitted' and i.status <> 'submitted' then
    update training.candidate_invites set status = 'submitted', closed_at = now() where id = i.id returning * into i;
  end if;
  if i.status = 'submitted' then return i; end if;       -- closed: callers show «done», never exam data
  if i.expires_at <= now() and att.id is null then
    raise exception 'training: link expired' using errcode = '22023';
  end if;
  if i.device_hash is null then
    if not p_bind then raise exception 'training: invalid link' using errcode = '22023'; end if;
    update training.candidate_invites set device_hash = p_device, status = 'opened', opened_at = now()
     where id = i.id returning * into i;
    perform training.audit('candidate_link_opened', i.assignment_id, '{}'::jsonb);
  elsif i.device_hash <> p_device then
    raise exception 'training: link is bound to another device' using errcode = '42501';
  end if;
  return i;
end $$;
revoke all on function training.candidate_invite_for(text, text, boolean) from public, anon, authenticated;

create or replace function training.candidate_state(p_invite training.candidate_invites)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, training as $$
  select jsonb_build_object(
    'stage', case when p_invite.status = 'submitted' then 'done'
                  when c.consent_at is null then 'consent'
                  when c.profile_at is null then 'profile'
                  when att.id is null then 'ready'
                  else 'exam' end,
    'name', c.full_name, 'expires_at', p_invite.expires_at,
    'email', c.email, 'phone', c.phone, 'experience', c.experience, 'qualifications', c.qualifications,
    'exam', case when att.id is not null and att.status = 'in_progress' then training.exam_payload(att.id) end)
  from training.candidates c
  left join training.attempts att on att.assignment_id = p_invite.assignment_id
 where c.id = p_invite.candidate_id;
$$;
revoke all on function training.candidate_state(training.candidate_invites) from public, anon, authenticated;

-- ---------------------------------------------------------------- owner RPCs (dashboard, authenticated)
-- Creates candidate + candidate assignment + invite. The raw token is returned ONCE.
create or replace function public.training_invite_candidate(p_name text, p_phone text, p_email text, p_track text,
                                                            p_reviewer uuid, p_days integer default 7)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); v_c uuid; v_a uuid; v_token text; v_exp timestamptz; v_prev integer;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'training: candidate name required' using errcode = '22023'; end if;
  if not exists (select 1 from training.tracks where code = p_track) then
    raise exception 'training: unknown track' using errcode = '22023';
  end if;
  if p_reviewer is null or not exists (select 1 from public.admins where id = p_reviewer and active) then
    raise exception 'training: reviewer must be an active dashboard user' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'training: validity must be 1 to 60 days' using errcode = '22023';
  end if;
  select count(*) into v_prev from training.candidates
   where phone_normalized is not null and phone_normalized = training.normalize_phone(p_phone);
  insert into training.candidates (full_name, phone, phone_normalized, email, created_by)
  values (btrim(p_name), nullif(btrim(p_phone), ''), training.normalize_phone(p_phone), nullif(btrim(p_email), ''), me)
  returning id into v_c;
  insert into training.assignments (track, candidate_id, reviewer_admin_id, assigned_by)
  values (p_track, v_c, p_reviewer, me) returning id into v_a;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => p_days);
  insert into training.candidate_invites (candidate_id, assignment_id, token_hash, expires_at, created_by)
  values (v_c, v_a, training.token_hash(v_token), v_exp, me);
  perform training.audit('candidate_invited', v_a,
    jsonb_build_object('candidate', v_c, 'track', p_track, 'reviewer', p_reviewer, 'days', p_days, 'returning', v_prev > 0));
  return jsonb_build_object('candidate_id', v_c, 'assignment_id', v_a, 'token', v_token, 'expires_at', v_exp,
                            'returning_applicant', v_prev > 0);
end $$;
revoke all on function public.training_invite_candidate(text, text, text, text, uuid, integer) from public, anon;
grant execute on function public.training_invite_candidate(text, text, text, text, uuid, integer) to authenticated;

-- Owner (all) and the assigned reviewer (own candidates). No token, no score; phone/email only for the owner/reviewer.
create or replace function public.training_candidates()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); owner boolean := public.is_super();
begin
  if me is null then raise exception 'training: not allowed' using errcode = '42501'; end if;
  perform training.finalize_expired();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'candidate_id', c.id, 'assignment_id', a.id, 'name', c.full_name, 'phone', c.phone, 'email', c.email,
             'experience', c.experience, 'qualifications', c.qualifications,
             'owner_notes', case when owner then c.owner_notes end,
             'track', a.track, 'track_name', (select name_ar from training.tracks where code = a.track),
             'assignment_status', a.status, 'invite_status', i.status, 'expires_at', i.expires_at,
             'opened_at', i.opened_at, 'consent_at', c.consent_at, 'minimal', c.minimal_after_purge,
             'reviewer_name', (select coalesce(name, email) from public.admins where id = a.reviewer_admin_id),
             'returning_applicant', exists (select 1 from training.candidates o
                                             where o.id <> c.id and o.phone_normalized is not null
                                               and o.phone_normalized = c.phone_normalized),
             'created_at', c.created_at) order by c.created_at desc)
      from training.candidates c
      join training.assignments a on a.candidate_id = c.id
      left join training.candidate_invites i on i.assignment_id = a.id
     where owner or a.reviewer_admin_id = me), '[]'::jsonb);
end $$;
revoke all on function public.training_candidates() from public, anon;
grant execute on function public.training_candidates() to authenticated;

create or replace function public.training_revoke_candidate_invite(p_assignment uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); i training.candidate_invites;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'training: a reason is required' using errcode = '22023'; end if;
  select * into i from training.candidate_invites where assignment_id = p_assignment for update;
  if not found then raise exception 'training: no such invite' using errcode = '22023'; end if;
  if i.status = 'submitted' then raise exception 'training: already submitted' using errcode = '22023'; end if;
  update training.candidate_invites set status = 'revoked', closed_at = now(), revoke_reason = btrim(p_reason) where id = i.id;
  update training.assignments set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now()
   where id = p_assignment and status in ('assigned', 'in_progress');
  perform training.audit('candidate_invite_revoked', p_assignment, jsonb_build_object('reason', btrim(p_reason)));
end $$;
revoke all on function public.training_revoke_candidate_invite(uuid, text) from public, anon;
grant execute on function public.training_revoke_candidate_invite(uuid, text) to authenticated;

create or replace function public.training_candidate_note(p_candidate uuid, p_note text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner();
begin
  update training.candidates set owner_notes = nullif(btrim(p_note), '') where id = p_candidate and not minimal_after_purge;
  if not found then raise exception 'training: no such candidate' using errcode = '22023'; end if;
  perform training.audit('candidate_note', null, jsonb_build_object('candidate', p_candidate));
end $$;
revoke all on function public.training_candidate_note(uuid, text) from public, anon;
grant execute on function public.training_candidate_note(uuid, text) to authenticated;

-- Deletion on request (owner-triggered, logged): keeps only name, phone and dates; closes any open invite.
create or replace function training.minimise_candidate(p_candidate uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
begin
  update training.candidates
     set email = null, experience = null, qualifications = null, owner_notes = null, minimal_after_purge = true
   where id = p_candidate;
  update training.candidate_invites set status = 'revoked', closed_at = coalesce(closed_at, now()),
         revoke_reason = coalesce(revoke_reason, 'data minimised')
   where candidate_id = p_candidate and status in ('pending', 'opened');
end $$;
revoke all on function training.minimise_candidate(uuid) from public, anon, authenticated;

create or replace function public.training_delete_candidate_data(p_candidate uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner();
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'training: a reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from training.candidates where id = p_candidate) then
    raise exception 'training: no such candidate' using errcode = '22023';
  end if;
  perform training.minimise_candidate(p_candidate);
  perform training.audit('candidate_data_deleted', null,
    jsonb_build_object('candidate', p_candidate, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.training_delete_candidate_data(uuid, text) from public, anon;
grant execute on function public.training_delete_candidate_data(uuid, text) to authenticated;

-- Retention job (5 years). Not scheduled here: the main chat decides when to run it.
create or replace function training.purge_expired_candidates()
returns integer language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare r record; n integer := 0;
begin
  for r in select id from training.candidates where purge_after <= now() and not minimal_after_purge loop
    perform training.minimise_candidate(r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function training.purge_expired_candidates() from public, anon, authenticated;

-- ---------------------------------------------------------------- public (edge function, service_role only)
create or replace function public.training_candidate_open(p_token text, p_device text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, true);
begin return training.candidate_state(i); end $$;

create or replace function public.training_candidate_consent(p_token text, p_device text, p_version text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false);
begin
  if i.status = 'submitted' then return training.candidate_state(i); end if;
  if length(btrim(coalesce(p_version, ''))) < 1 or length(p_version) > 40 then
    raise exception 'training: consent version required' using errcode = '22023';
  end if;
  update training.candidates set consent_text_version = p_version, consent_at = coalesce(consent_at, now())
   where id = i.candidate_id;
  perform training.audit('candidate_consent', i.assignment_id, jsonb_build_object('version', p_version));
  return training.candidate_state(i);
end $$;

create or replace function public.training_candidate_profile(p_token text, p_device text, p_phone text, p_email text,
                                                             p_experience text, p_qualifications text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false);
begin
  if i.status = 'submitted' then return training.candidate_state(i); end if;
  if (select consent_at from training.candidates where id = i.candidate_id) is null then
    raise exception 'training: consent first' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_experience, ''))) < 3 or length(btrim(coalesce(p_qualifications, ''))) < 3 then
    raise exception 'training: experience and qualifications are required' using errcode = '22023';
  end if;
  update training.candidates
     set phone = coalesce(nullif(btrim(p_phone), ''), phone),
         phone_normalized = coalesce(training.normalize_phone(p_phone), phone_normalized),
         email = coalesce(nullif(btrim(p_email), ''), email),
         experience = btrim(p_experience), qualifications = btrim(p_qualifications), profile_at = now()
   where id = i.candidate_id;
  return training.candidate_state(i);
end $$;

-- Starts (or resumes) the exam. Same draw as the trainee exam, without the course gate.
create or replace function public.training_candidate_start(p_token text, p_device text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false);
        m training.bank_meta; t_id uuid; qids text[]; orders jsonb; c training.candidates;
begin
  if i.status = 'submitted' then return training.candidate_state(i); end if;
  select * into c from training.candidates where id = i.candidate_id;
  if c.consent_at is null or c.profile_at is null then
    raise exception 'training: consent and profile first' using errcode = '22023';
  end if;
  select id into t_id from training.attempts where assignment_id = i.assignment_id;
  if t_id is null then
    if i.expires_at <= now() then raise exception 'training: link expired' using errcode = '22023'; end if;
    select * into m from training.bank_meta;
    if not found then raise exception 'training: question bank not loaded yet' using errcode = '22023'; end if;
    select array_agg(id order by random()) into qids from (
      select q.id from training.competencies cp
      cross join lateral (select q.id from training.questions q
                           where q.active and q.competency = cp.code order by random() limit cp.quota) q
      where cp.active) s;
    if coalesce(cardinality(qids), 0) <> m.questions_per_attempt then
      raise exception 'training: question bank cannot fill the exam' using errcode = '22023';
    end if;
    select jsonb_object_agg(q, (select jsonb_agg(option_id order by random())
                                  from training.question_options where question_id = q))
      into orders from unnest(qids) q;
    insert into training.attempts (assignment_id, bank_version, question_ids, option_order, started_at, deadline_at)
    values (i.assignment_id, m.version, qids, orders, now(), now() + make_interval(mins => m.duration_minutes))
    returning id into t_id;
    update training.assignments set status = 'in_progress', updated_at = now() where id = i.assignment_id;
    perform training.audit('exam_started', i.assignment_id, jsonb_build_object('questions', cardinality(qids), 'candidate', true));
  end if;
  return training.candidate_state(i);
end $$;

create or replace function public.training_candidate_save(p_token text, p_device text, p_question text, p_option text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false); t training.attempts;
begin
  if i.status = 'submitted' then return jsonb_build_object('saved', false, 'status', 'submitted'); end if;
  select * into t from training.attempts where assignment_id = i.assignment_id for update;
  if not found then raise exception 'training: exam not started' using errcode = '22023'; end if;
  if t.status <> 'in_progress' then return jsonb_build_object('saved', false, 'status', 'submitted'); end if;
  if t.deadline_at <= now() then
    perform training.finalize_attempt(t.id, true);
    update training.candidate_invites set status = 'submitted', closed_at = now() where id = i.id;
    return jsonb_build_object('saved', false, 'status', 'submitted');
  end if;
  if not (p_question = any (t.question_ids))
     or not exists (select 1 from training.question_options where question_id = p_question and option_id = p_option) then
    raise exception 'training: invalid answer' using errcode = '22023';
  end if;
  insert into training.attempt_answers (attempt_id, question_id, option_id, answered_at)
  values (t.id, p_question, p_option, now())
  on conflict (attempt_id, question_id) do update set option_id = excluded.option_id, answered_at = now();
  return jsonb_build_object('saved', true, 'status', 'in_progress',
    'remaining_seconds', greatest(0, floor(extract(epoch from (t.deadline_at - now()))))::int);
end $$;

create or replace function public.training_candidate_blur(p_token text, p_device text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false);
begin
  update training.attempts set blur_count = blur_count + 1
   where assignment_id = i.assignment_id and status = 'in_progress' and deadline_at > now();
end $$;

-- Submit closes the link for good. Returns only «done»: no score, no grade, no key.
create or replace function public.training_candidate_submit(p_token text, p_device text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare i training.candidate_invites := training.candidate_invite_for(p_token, p_device, false); t training.attempts;
begin
  if i.status <> 'submitted' then
    select * into t from training.attempts where assignment_id = i.assignment_id;
    if not found then raise exception 'training: exam not started' using errcode = '22023'; end if;
    perform training.finalize_attempt(t.id, t.deadline_at <= now());
    update training.candidate_invites set status = 'submitted', closed_at = now() where id = i.id returning * into i;
  end if;
  return training.candidate_state(i);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'training_candidate_open(text, text)', 'training_candidate_consent(text, text, text)',
    'training_candidate_profile(text, text, text, text, text, text)', 'training_candidate_start(text, text)',
    'training_candidate_save(text, text, text, text)', 'training_candidate_blur(text, text)',
    'training_candidate_submit(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
