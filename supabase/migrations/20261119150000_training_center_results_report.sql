-- Training & evaluation center, PR 6: results for the trainee and the candidate, result-review requests, final report.
--
-- * «نتيجتي» (trainee): after the owner decides, the trainee sees the decision label, the learning areas and the
--   owner's message. NEVER a number, a score, the interview scores, the risk flags or the answer key.
-- * «طلب مراجعة النتيجة»: one request per assignment with a written reason; the owner lists and closes requests.
-- * Candidate result link: separate from the exam link, view-once, issued/re-issued by the owner. Only the sha256 of
--   the token is stored. The public RPC is granted to service_role only (via the training-candidate edge function).
--   The candidate sees the decision label and the owner's message only.
-- * Final report: owner only, one assignment, everything the owner needs to file or print.
begin;

create table if not exists training.result_reviews (
  assignment_id uuid primary key references training.assignments(id) on delete cascade,
  reason        text not null check (length(btrim(reason)) between 3 and 1000),
  requested_by  uuid references public.admins(id) on delete set null,
  requested_at  timestamptz not null default now(),
  status        text not null default 'open' check (status in ('open', 'closed')),
  response      text check (response is null or length(response) <= 2000),
  closed_by     uuid references public.admins(id) on delete set null,
  closed_at     timestamptz,
  constraint training_result_reviews_closed check ((status = 'closed') = (closed_at is not null))
);

create table if not exists training.result_links (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references training.assignments(id) on delete cascade,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at    timestamptz not null,
  viewed_at     timestamptz,
  revoked_at    timestamptz,
  send_channel  text not null default 'manual' check (send_channel in ('manual', 'email')),
  issued_by     uuid references public.admins(id) on delete set null,
  issued_at     timestamptz not null default now()
);
create index if not exists training_result_links_assignment on training.result_links (assignment_id);

do $$
declare t text;
begin
  foreach t in array array['result_reviews', 'result_links'] loop
    execute format('alter table training.%I enable row level security', t);
    execute format('revoke all on training.%I from public, anon, authenticated', t);
  end loop;
end $$;

create or replace function training.decision_label(p_final text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case p_final when 'ready' then 'جاهز' when 'ready_after_training' then 'جاهز بعد تدريب' when 'not_ready' then 'غير جاهز حاليًا' end;
$$;
revoke all on function training.decision_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- trainee
create or replace function public.training_my_result(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments; d training.decisions; rv training.result_reviews;
begin
  select * into a from training.assignments where id = p_assignment;
  if not found or me is null or a.trainee_admin_id is null or a.trainee_admin_id <> me then
    raise exception 'training: not your assignment' using errcode = '42501';
  end if;
  select * into d from training.decisions where assignment_id = p_assignment;
  if not found then return jsonb_build_object('decided', false); end if;
  select * into rv from training.result_reviews where assignment_id = p_assignment;
  return jsonb_build_object('decided', true, 'decision', d.final, 'label', training.decision_label(d.final),
    'message', d.message, 'decided_at', d.decided_at,
    'learning_areas', coalesce((select jsonb_agg(x->>'name_ar') from jsonb_array_elements(coalesce(d.computed->'weaknesses', '[]'::jsonb)) x), '[]'::jsonb),
    'review', case when rv.assignment_id is not null then jsonb_build_object(
        'status', rv.status, 'requested_at', rv.requested_at, 'response', case when rv.status = 'closed' then rv.response end) end);
end $$;
revoke all on function public.training_my_result(uuid) from public, anon;
grant execute on function public.training_my_result(uuid) to authenticated;

create or replace function public.training_request_result_review(p_assignment uuid, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments;
begin
  select * into a from training.assignments where id = p_assignment for update;
  if not found or me is null or a.trainee_admin_id is null or a.trainee_admin_id <> me then
    raise exception 'training: not your assignment' using errcode = '42501';
  end if;
  if not exists (select 1 from training.decisions where assignment_id = p_assignment) then
    raise exception 'training: no decision yet' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'training: a reason is required' using errcode = '22023'; end if;
  if exists (select 1 from training.result_reviews where assignment_id = p_assignment) then
    raise exception 'training: review already requested' using errcode = '22023';
  end if;
  insert into training.result_reviews (assignment_id, reason, requested_by) values (p_assignment, btrim(p_reason), me);
  perform training.audit('result_review_requested', p_assignment, '{}'::jsonb);
end $$;
revoke all on function public.training_request_result_review(uuid, text) from public, anon;
grant execute on function public.training_request_result_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------- owner: review requests
create or replace function public.training_result_reviews()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'assignment_id', rv.assignment_id, 'reason', rv.reason, 'status', rv.status, 'requested_at', rv.requested_at,
             'response', rv.response, 'closed_at', rv.closed_at,
             'trainee_name', coalesce((select coalesce(name, email) from public.admins where id = a.trainee_admin_id), '—'),
             'track_name', (select name_ar from training.tracks where code = a.track),
             'decision', training.decision_label(d.final)) order by (rv.status = 'open') desc, rv.requested_at desc)
      from training.result_reviews rv
      join training.assignments a on a.id = rv.assignment_id
      left join training.decisions d on d.assignment_id = rv.assignment_id), '[]'::jsonb);
end $$;
revoke all on function public.training_result_reviews() from public, anon;
grant execute on function public.training_result_reviews() to authenticated;

create or replace function public.training_close_result_review(p_assignment uuid, p_response text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner();
begin
  if length(btrim(coalesce(p_response, ''))) < 3 then raise exception 'training: a response is required' using errcode = '22023'; end if;
  update training.result_reviews set status = 'closed', response = btrim(p_response), closed_by = me, closed_at = now()
   where assignment_id = p_assignment and status = 'open';
  if not found then raise exception 'training: no open review' using errcode = '22023'; end if;
  perform training.audit('result_review_closed', p_assignment, '{}'::jsonb);
end $$;
revoke all on function public.training_close_result_review(uuid, text) from public, anon;
grant execute on function public.training_close_result_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------- owner: candidate result link (issue / re-issue)
create or replace function public.training_issue_result_link(p_assignment uuid, p_days integer default 14)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); a training.assignments; v_token text; v_exp timestamptz;
begin
  select * into a from training.assignments where id = p_assignment;
  if not found or a.candidate_id is null then raise exception 'training: not a candidate assignment' using errcode = '22023'; end if;
  if not exists (select 1 from training.decisions where assignment_id = p_assignment) then
    raise exception 'training: no decision yet' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then raise exception 'training: validity must be 1 to 60 days' using errcode = '22023'; end if;
  update training.result_links set revoked_at = now() where assignment_id = p_assignment and revoked_at is null;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => p_days);
  insert into training.result_links (assignment_id, token_hash, expires_at, issued_by)
  values (p_assignment, training.token_hash(v_token), v_exp, me);
  perform training.audit('result_link_issued', p_assignment, jsonb_build_object('days', p_days));
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;
revoke all on function public.training_issue_result_link(uuid, integer) from public, anon;
grant execute on function public.training_issue_result_link(uuid, integer) to authenticated;

-- Public (edge function, service_role only). View-once: the first valid call returns the result and marks the link
-- viewed; any later call reports «closed». The candidate sees the decision label and the owner's message only.
create or replace function public.training_candidate_result(p_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare l training.result_links; d training.decisions; v_name text;
begin
  if p_token is null or length(p_token) < 40 then raise exception 'training: invalid link' using errcode = '22023'; end if;
  select * into l from training.result_links where token_hash = training.token_hash(p_token) for update;
  if not found then raise exception 'training: invalid link' using errcode = '22023'; end if;
  if l.revoked_at is not null or l.viewed_at is not null then raise exception 'training: link closed' using errcode = '22023'; end if;
  if l.expires_at <= now() then raise exception 'training: link expired' using errcode = '22023'; end if;
  select * into d from training.decisions where assignment_id = l.assignment_id;
  if not found then raise exception 'training: invalid link' using errcode = '22023'; end if;
  select c.full_name into v_name from training.assignments a join training.candidates c on c.id = a.candidate_id where a.id = l.assignment_id;
  update training.result_links set viewed_at = now() where id = l.id;
  insert into training.audit_log (actor_admin_id, action, assignment_id, details) values (null, 'result_link_viewed', l.assignment_id, '{}'::jsonb);
  return jsonb_build_object('name', v_name, 'label', training.decision_label(d.final), 'message', d.message, 'decided_at', d.decided_at);
end $$;
revoke all on function public.training_candidate_result(text) from public, anon, authenticated;
grant execute on function public.training_candidate_result(text) to service_role;

-- ---------------------------------------------------------------- owner: final report
create or replace function public.training_final_report(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); a training.assignments; d training.decisions; r training.attempt_results; t training.attempts;
        rv training.result_reviews;
begin
  select * into a from training.assignments where id = p_assignment;
  if not found then raise exception 'training: assignment not found' using errcode = 'P0002'; end if;
  select * into d from training.decisions where assignment_id = p_assignment;
  select * into t from training.attempts where assignment_id = p_assignment;
  select * into r from training.attempt_results where attempt_id = t.id;
  select * into rv from training.result_reviews where assignment_id = p_assignment;
  return jsonb_build_object(
    'assignment_id', a.id, 'status', a.status, 'created_at', a.created_at,
    'subject_kind', case when a.candidate_id is not null then 'candidate' else 'trainee' end,
    'subject_name', coalesce((select full_name from training.candidates where id = a.candidate_id),
                             (select coalesce(name, email) from public.admins where id = a.trainee_admin_id)),
    'track_name', (select name_ar from training.tracks where code = a.track),
    'reviewer_name', (select coalesce(name, email) from public.admins where id = a.reviewer_admin_id),
    'exam', case when r.attempt_id is not null then jsonb_build_object(
        'percent', r.percent, 'grade', r.grade, 'risk_flags', r.risk_flags, 'answered', r.answered, 'total', cardinality(t.question_ids),
        'points', r.points, 'max_points', r.max_points, 'blur_count', t.blur_count, 'auto_submitted', t.auto_submitted,
        'submitted_at', t.submitted_at, 'used_seconds', floor(extract(epoch from (t.submitted_at - t.started_at)))::int,
        'by_competency', r.by_competency) end,
    'decision', case when d.assignment_id is not null then jsonb_build_object(
        'final', d.final, 'label', training.decision_label(d.final), 'suggested', d.suggested, 'suggested_label', training.decision_label(d.suggested),
        'override_reason', d.override_reason, 'message', d.message, 'decided_at', d.decided_at,
        'decided_by', (select coalesce(name, email) from public.admins where id = d.decided_by), 'computed', d.computed) end,
    'review', case when rv.assignment_id is not null then jsonb_build_object(
        'reason', rv.reason, 'status', rv.status, 'requested_at', rv.requested_at, 'response', rv.response, 'closed_at', rv.closed_at) end);
end $$;
revoke all on function public.training_final_report(uuid) from public, anon;
grant execute on function public.training_final_report(uuid) to authenticated;

commit;
