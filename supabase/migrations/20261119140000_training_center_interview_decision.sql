-- Training & evaluation center, PR 5/6: interview sheet (20 questions), 3 role-plays and the 40/40/20 decision.
-- * The interview content (questions, «what to listen for», red flags, role-play scripts) is reviewer material and
--   is not in this public repo. The owner loads it with training_import_interview(<json>) from a private artifact.
--   Only the owner and the assigned reviewer can read it; never the trainee.
-- * Scores: 1–5 per interview question and per role-play, a short note, and a «blocking» flag (concealing a safety
--   risk, breaching confidentiality, financial manipulation or concealment, falsifying a record).
-- * No self-review: the trainee can never score their own assignment (and the reviewer is never the trainee — PR 1).
-- * Decision (spec §5):
--     result = exam% × 0.4 + (interview avg ÷ 5 × 100) × 0.4 + (role-play avg ÷ 5 × 100) × 0.2
--     ready                = result ≥ 80, no blocking flag, fewer than 2 exam risk flags
--     ready_after_training = 60 ≤ result < 80, or result ≥ 80 with 2+ exam risk flags
--     not_ready            = result < 60, or any blocking flag (locked until the owner reviews it)
--   Weak competencies: interview+role-play average for that competency < 3.5, or its exam percent < 60.
--   The owner approves the suggestion or overrides it with a written reason. Only the owner decides.
begin;

create table if not exists training.interview_content (
  id          boolean primary key default true check (id),
  version     text not null,
  content     jsonb not null,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.admins(id) on delete set null
);

create table if not exists training.interview_scores (
  assignment_id uuid not null references training.assignments(id) on delete cascade,
  item_type     text not null check (item_type in ('question', 'roleplay')),
  item_id       text not null check (item_id ~ '^[a-z0-9_-]{1,20}$'),
  score         smallint not null check (score between 1 and 5),
  note          text check (note is null or length(note) <= 1000),
  blocking      boolean not null default false,
  checklist     jsonb not null default '[]'::jsonb,       -- role-play: indexes of achieved behaviours
  scored_by     uuid references public.admins(id) on delete set null,
  scored_at     timestamptz not null default now(),
  primary key (assignment_id, item_type, item_id)
);

create table if not exists training.decisions (
  assignment_id   uuid primary key references training.assignments(id) on delete cascade,
  computed        jsonb not null,              -- snapshot of the calculation at decision time
  suggested       text not null check (suggested in ('ready', 'ready_after_training', 'not_ready')),
  final           text not null check (final in ('ready', 'ready_after_training', 'not_ready')),
  override_reason text,
  message         text check (message is null or length(message) <= 2000),   -- shown to the trainee in PR 6
  decided_by      uuid references public.admins(id) on delete set null,
  decided_at      timestamptz not null default now(),
  constraint training_decisions_override check (final = suggested or nullif(btrim(override_reason), '') is not null)
);

do $$ declare t text; begin
  foreach t in array array['interview_content','interview_scores','decisions'] loop
    execute format('alter table training.%I enable row level security', t);
    execute format('revoke all on training.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- helpers
-- Owner or the assigned reviewer, never the trainee. Returns the assignment.
create or replace function training.reviewer_assignment(p_assignment uuid)
returns training.assignments language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments;
begin
  select * into a from training.assignments where id = p_assignment;
  if not found or me is null or a.trainee_admin_id = me or not (public.is_super() or a.reviewer_admin_id = me) then
    raise exception 'training: not allowed' using errcode = '42501';
  end if;
  return a;
end $$;
revoke all on function training.reviewer_assignment(uuid) from public, anon, authenticated;

create or replace function training.compute_decision(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare c jsonb; r training.attempt_results; nq int; nr int; iavg numeric; ravg numeric; e numeric; res numeric;
        n_block int; sug text; weak jsonb; complete boolean;
begin
  select ic.content into c from training.interview_content ic;
  select ar.* into r from training.attempt_results ar join training.attempts t on t.id = ar.attempt_id where t.assignment_id = p_assignment;
  nq := coalesce(jsonb_array_length(c->'questions'), 20);
  nr := coalesce(jsonb_array_length(c->'roleplays'), 3);
  select avg(score) into iavg from training.interview_scores where assignment_id = p_assignment and item_type = 'question';
  select avg(score) into ravg from training.interview_scores where assignment_id = p_assignment and item_type = 'roleplay';
  select count(*) into n_block from training.interview_scores s where s.assignment_id = p_assignment and s.blocking;
  complete := coalesce(r.attempt_id is not null
    and (select count(*) from training.interview_scores where assignment_id = p_assignment and item_type = 'question') >= nq
    and (select count(*) from training.interview_scores where assignment_id = p_assignment and item_type = 'roleplay') >= nr, false);
  e := r.percent;
  if complete then
    res := round(e * 0.4 + (iavg / 5 * 100) * 0.4 + (ravg / 5 * 100) * 0.2, 2);
    sug := case when n_block > 0 then 'not_ready'
                when res >= 80 and r.risk_flags < 2 then 'ready'
                when res >= 60 then 'ready_after_training'
                else 'not_ready' end;
  end if;
  -- weak competencies: interview/role-play items mapped through the content's competency_code
  with items as (
    select coalesce(q->>'competency_code', '') code, s.score
      from training.interview_scores s
      cross join lateral (select x from jsonb_array_elements(
              case when s.item_type = 'question' then c->'questions' else c->'roleplays' end) x
             where x->>'id' = s.item_id) j(q)
     where s.assignment_id = p_assignment),
  oral as (select code, avg(score) avg_score from items group by code),
  exam as (select x->>'code' code, x->>'name_ar' name_ar, (x->>'percent')::numeric pct
             from jsonb_array_elements(coalesce(r.by_competency, '[]'::jsonb)) x)
  select coalesce(jsonb_agg(jsonb_build_object('code', co.code, 'name_ar', co.name_ar,
           'oral_avg', round(o.avg_score, 2), 'exam_percent', ex.pct) order by co.sort), '[]'::jsonb)
    into weak
    from training.competencies co
    left join oral o on o.code = co.code
    left join exam ex on ex.code = co.code
   where co.active and (o.avg_score < 3.5 or ex.pct < 60);
  return jsonb_build_object(
    'complete', complete, 'exam_percent', e, 'exam_grade', r.grade, 'exam_risk_flags', r.risk_flags,
    'interview_avg', round(iavg, 2), 'roleplay_avg', round(ravg, 2),
    'interview_scored', (select count(*) from training.interview_scores where assignment_id = p_assignment and item_type = 'question'),
    'roleplay_scored', (select count(*) from training.interview_scores where assignment_id = p_assignment and item_type = 'roleplay'),
    'interview_total', nq, 'roleplay_total', nr,
    'blocking_flags', n_block, 'result', res, 'suggested', sug, 'weaknesses', weak);
end $$;
revoke all on function training.compute_decision(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- owner: load the interview sheet
create or replace function public.training_import_interview(p_content jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); bad text;
begin
  if jsonb_typeof(p_content) <> 'object' or nullif(btrim(p_content->>'version'), '') is null
     or jsonb_typeof(p_content->'questions') <> 'array' or jsonb_typeof(p_content->'roleplays') <> 'array'
     or jsonb_array_length(p_content->'questions') < 1 or jsonb_array_length(p_content->'roleplays') < 1 then
    raise exception 'training: interview content needs version, questions[] and roleplays[]' using errcode = '22023';
  end if;
  select string_agg(coalesce(x->>'id', '?'), ', ') into bad
    from (select jsonb_array_elements(p_content->'questions') x union all select jsonb_array_elements(p_content->'roleplays')) s
   where coalesce(x->>'id', '') !~ '^[a-z0-9_-]{1,20}$'
      or not exists (select 1 from training.competencies c where c.code = x->>'competency_code');
  if bad is not null then raise exception 'training: items with a bad id or competency_code: %', bad using errcode = '22023'; end if;
  insert into training.interview_content (id, version, content, imported_at, imported_by)
  values (true, p_content->>'version', p_content, now(), me)
  on conflict (id) do update set version = excluded.version, content = excluded.content, imported_at = now(), imported_by = me;
  perform training.audit('interview_imported', null, jsonb_build_object('version', p_content->>'version',
    'questions', jsonb_array_length(p_content->'questions'), 'roleplays', jsonb_array_length(p_content->'roleplays')));
  return jsonb_build_object('version', p_content->>'version', 'questions', jsonb_array_length(p_content->'questions'),
                            'roleplays', jsonb_array_length(p_content->'roleplays'));
end $$;
revoke all on function public.training_import_interview(jsonb) from public, anon;
grant execute on function public.training_import_interview(jsonb) to authenticated;

-- ---------------------------------------------------------------- reviewer/owner: sheet + scoring
create or replace function public.training_interview_sheet(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.reviewer_assignment(p_assignment);
begin
  perform training.audit('interview_sheet_viewed', p_assignment, '{}'::jsonb);
  return jsonb_build_object(
    'assignment_id', a.id, 'status', a.status,
    'trainee_name', (select coalesce(name, email) from public.admins where id = a.trainee_admin_id),
    'track_name', (select name_ar from training.tracks where code = a.track),
    'can_score', a.status in ('submitted', 'interviewing'),
    'content', (select content from training.interview_content),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('item_type', item_type, 'item_id', item_id, 'score', score,
                 'note', note, 'blocking', blocking, 'checklist', checklist, 'scored_at', scored_at))
                 from training.interview_scores where assignment_id = p_assignment), '[]'::jsonb),
    'summary', training.compute_decision(p_assignment),
    'decision', (select jsonb_build_object('suggested', d.suggested, 'final', d.final, 'override_reason', d.override_reason,
                   'message', d.message, 'decided_at', d.decided_at) from training.decisions d where d.assignment_id = p_assignment));
end $$;
revoke all on function public.training_interview_sheet(uuid) from public, anon;
grant execute on function public.training_interview_sheet(uuid) to authenticated;

create or replace function public.training_save_interview_score(p_assignment uuid, p_item_type text, p_item_id text,
  p_score int, p_note text, p_blocking boolean, p_checklist jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.reviewer_assignment(p_assignment); c jsonb;
begin
  if a.status not in ('submitted', 'interviewing') then
    raise exception 'training: interview is open only after the exam is submitted and before the decision' using errcode = '22023';
  end if;
  select content into c from training.interview_content;
  if c is null then raise exception 'training: interview sheet not loaded yet' using errcode = '22023'; end if;
  if p_item_type not in ('question', 'roleplay') or not exists (
       select 1 from jsonb_array_elements(case when p_item_type = 'question' then c->'questions' else c->'roleplays' end) x
        where x->>'id' = p_item_id) then
    raise exception 'training: unknown interview item' using errcode = '22023';
  end if;
  if p_score is null or p_score not between 1 and 5 then raise exception 'training: score must be 1 to 5' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_checklist, '[]'::jsonb)) <> 'array' then raise exception 'training: checklist must be a list' using errcode = '22023'; end if;
  insert into training.interview_scores (assignment_id, item_type, item_id, score, note, blocking, checklist, scored_by, scored_at)
  values (p_assignment, p_item_type, p_item_id, p_score, nullif(btrim(p_note), ''), coalesce(p_blocking, false),
          coalesce(p_checklist, '[]'::jsonb), public.my_admin_id(), now())
  on conflict (assignment_id, item_type, item_id) do update set score = excluded.score, note = excluded.note,
    blocking = excluded.blocking, checklist = excluded.checklist, scored_by = excluded.scored_by, scored_at = now();
  if a.status = 'submitted' then
    update training.assignments set status = 'interviewing', updated_at = now() where id = p_assignment;
  end if;
  perform training.audit('interview_scored', p_assignment, jsonb_build_object('item_type', p_item_type, 'item_id', p_item_id,
    'score', p_score, 'blocking', coalesce(p_blocking, false)));
  return training.compute_decision(p_assignment);
end $$;
revoke all on function public.training_save_interview_score(uuid, text, text, int, text, boolean, jsonb) from public, anon;
grant execute on function public.training_save_interview_score(uuid, text, text, int, text, boolean, jsonb) to authenticated;

-- ---------------------------------------------------------------- owner: final decision
create or replace function public.training_decide(p_assignment uuid, p_final text, p_override_reason text, p_message text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); a training.assignments; d jsonb;
begin
  select * into a from training.assignments where id = p_assignment for update;
  if not found then raise exception 'training: assignment not found' using errcode = 'P0002'; end if;
  if a.trainee_admin_id = me then raise exception 'training: cannot decide on your own assignment' using errcode = '42501'; end if;
  if a.status not in ('submitted', 'interviewing') then
    raise exception 'training: assignment is not awaiting a decision' using errcode = '22023';
  end if;
  d := training.compute_decision(p_assignment);
  if not (d->>'complete')::boolean then
    raise exception 'training: score every interview question and role-play first' using errcode = '22023';
  end if;
  if p_final not in ('ready', 'ready_after_training', 'not_ready') then
    raise exception 'training: unknown decision' using errcode = '22023';
  end if;
  if p_final <> d->>'suggested' and nullif(btrim(p_override_reason), '') is null then
    raise exception 'training: a written reason is required to change the suggested decision' using errcode = '22023';
  end if;
  insert into training.decisions (assignment_id, computed, suggested, final, override_reason, message, decided_by, decided_at)
  values (p_assignment, d, d->>'suggested', p_final, nullif(btrim(p_override_reason), ''), nullif(btrim(p_message), ''), me, now());
  update training.assignments set status = 'decided', updated_at = now() where id = p_assignment;
  perform training.audit('decided', p_assignment, jsonb_build_object('suggested', d->>'suggested', 'final', p_final,
    'overridden', p_final <> d->>'suggested', 'result', d->'result'));
  return d || jsonb_build_object('final', p_final);
end $$;
revoke all on function public.training_decide(uuid, text, text, text) from public, anon;
grant execute on function public.training_decide(uuid, text, text, text) to authenticated;

commit;
