-- Training & evaluation center, PR 3/6: server-side grading and the exam result view (owner + assigned reviewer).
-- * Grading runs inside the database when an attempt is finalised (manual or automatic). The browser never
--   receives the key before or during the exam; the trainee still sees no score here (PR 6 shows the approved result).
-- * Per question: points of the chosen option (2 best / 1 partial / 0); unanswered = 0. Percent = points / (2 × drawn).
-- * Risk flags = chosen options with critical_flag. They open human review; they are not a sanction.
-- * Exam grade: strong = ≥ 80% and no risk flag; medium = ≥ 60% and at most one risk flag (this includes ≥ 80% with
--   exactly one flag); otherwise weak.
-- * Per competency: percent of points in that competency's drawn questions (weakness when < 60%, used in PR 5/6).
-- * Result view: owner and the assigned reviewer see the trainee's choice vs the best option per drawn question,
--   with points and flags. The full bank (other questions/options) is never returned.
begin;

create table if not exists training.attempt_results (
  attempt_id     uuid primary key references training.attempts(id) on delete cascade,
  points         integer not null check (points >= 0),
  max_points     integer not null check (max_points > 0),
  percent        numeric(5,2) not null check (percent between 0 and 100),
  answered       integer not null,
  risk_flags     integer not null check (risk_flags >= 0),
  grade          text not null check (grade in ('strong', 'medium', 'weak')),
  by_competency  jsonb not null,            -- [{code, name_ar, points, max_points, percent}]
  graded_at      timestamptz not null default now()
);
alter table training.attempt_results enable row level security;
revoke all on training.attempt_results from public, anon, authenticated;

create or replace function training.grade_attempt(p_attempt uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare t training.attempts; v_points int; v_max int; v_ans int; v_risk int; v_pct numeric; v_grade text; v_comp jsonb;
begin
  select * into t from training.attempts where id = p_attempt;
  if not found or t.status <> 'submitted' then return; end if;
  with drawn as (
    select x.qid, q.competency, o.points, coalesce(o.critical_flag, false) as critical, (a.option_id is not null) as answered
      from unnest(t.question_ids) x(qid)
      join training.questions q on q.id = x.qid
      left join training.attempt_answers a on a.attempt_id = t.id and a.question_id = x.qid
      left join training.question_options o on o.question_id = a.question_id and o.option_id = a.option_id)
  select coalesce(sum(points), 0), 2 * count(*), count(*) filter (where answered), count(*) filter (where critical),
         coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name_ar', c.name_ar, 'points', s.p, 'max_points', s.m,
                     'percent', round(100.0 * s.p / s.m, 2)) order by c.sort)
                     from (select competency, coalesce(sum(points), 0) p, 2 * count(*) m from drawn group by competency) s
                     join training.competencies c on c.code = s.competency), '[]'::jsonb)
    into v_points, v_max, v_ans, v_risk, v_comp
    from drawn;
  v_pct := round(100.0 * v_points / v_max, 2);
  v_grade := case when v_pct >= 80 and v_risk = 0 then 'strong'
                  when v_pct >= 60 and v_risk <= 1 then 'medium'
                  else 'weak' end;
  insert into training.attempt_results (attempt_id, points, max_points, percent, answered, risk_flags, grade, by_competency, graded_at)
  values (t.id, v_points, v_max, v_pct, v_ans, v_risk, v_grade, v_comp, now())
  on conflict (attempt_id) do update set points = excluded.points, max_points = excluded.max_points, percent = excluded.percent,
    answered = excluded.answered, risk_flags = excluded.risk_flags, grade = excluded.grade,
    by_competency = excluded.by_competency, graded_at = now();
end $$;
revoke all on function training.grade_attempt(uuid) from public, anon, authenticated;

-- Finalisation now grades in the same transaction.
create or replace function training.finalize_attempt(p_attempt uuid, p_auto boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare t training.attempts;
begin
  select * into t from training.attempts where id = p_attempt for update;
  if not found or t.status = 'submitted' then return; end if;
  update training.attempts
     set status = 'submitted', auto_submitted = p_auto,
         submitted_at = case when p_auto then least(now(), t.deadline_at) else now() end
   where id = p_attempt;
  update training.assignments set status = 'submitted', updated_at = now()
   where id = t.assignment_id and status in ('assigned', 'in_progress');
  perform training.grade_attempt(p_attempt);
  perform training.audit(case when p_auto then 'exam_auto_submitted' else 'exam_submitted' end, t.assignment_id,
    jsonb_build_object('answered', (select count(*) from training.attempt_answers where attempt_id = p_attempt)));
end $$;
revoke all on function training.finalize_attempt(uuid, boolean) from public, anon, authenticated;

-- Grade anything already submitted before this migration.
do $$ declare r record; begin
  for r in select id from training.attempts where status = 'submitted'
             and id not in (select attempt_id from training.attempt_results) loop
    perform training.grade_attempt(r.id);
  end loop;
end $$;

-- Owner or the assigned reviewer (never the trainee, never self-review) reads the result.
create or replace function public.training_exam_result(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments; t training.attempts; r training.attempt_results;
begin
  perform training.finalize_expired();
  select * into a from training.assignments where id = p_assignment;
  if not found or me is null or a.trainee_admin_id = me
     or not (public.is_super() or a.reviewer_admin_id = me) then
    raise exception 'training: not allowed' using errcode = '42501';
  end if;
  select * into t from training.attempts where assignment_id = p_assignment;
  if not found or t.status <> 'submitted' then
    return jsonb_build_object('status', coalesce(t.status, 'not_started'));
  end if;
  select * into r from training.attempt_results where attempt_id = t.id;
  perform training.audit('exam_result_viewed', p_assignment, '{}'::jsonb);
  return jsonb_build_object(
    'status', 'submitted',
    'trainee_name', (select coalesce(name, email) from public.admins where id = a.trainee_admin_id),
    'track_name', (select name_ar from training.tracks where code = a.track),
    'started_at', t.started_at, 'submitted_at', t.submitted_at, 'auto_submitted', t.auto_submitted,
    'used_seconds', floor(extract(epoch from (t.submitted_at - t.started_at)))::int,
    'blur_count', t.blur_count, 'bank_version', t.bank_version,
    'points', r.points, 'max_points', r.max_points, 'percent', r.percent, 'answered', r.answered,
    'total', cardinality(t.question_ids), 'risk_flags', r.risk_flags, 'grade', r.grade, 'by_competency', r.by_competency,
    'questions', (
      select jsonb_agg(jsonb_build_object(
               'n', x.ord, 'id', q.id, 'competency', c.name_ar, 'text', q.text,
               'chosen', case when ch.option_id is null then null else jsonb_build_object('text', ch.text, 'points', ch.points, 'critical', ch.critical_flag) end,
               'best', (select jsonb_agg(b.text order by b.option_id) from training.question_options b where b.question_id = q.id and b.points = 2))
             order by x.ord)
        from unnest(t.question_ids) with ordinality x(qid, ord)
        join training.questions q on q.id = x.qid
        join training.competencies c on c.code = q.competency
        left join training.attempt_answers aa on aa.attempt_id = t.id and aa.question_id = q.id
        left join training.question_options ch on ch.question_id = aa.question_id and ch.option_id = aa.option_id));
end $$;
revoke all on function public.training_exam_result(uuid) from public, anon;
grant execute on function public.training_exam_result(uuid) to authenticated;

-- Assignment list: owner/reviewer also get the exam grade label (trainee never does).
create or replace function public.training_assignments()
returns jsonb language plpgsql volatile security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); owner boolean := public.is_super();
begin
  if me is null then raise exception 'training: sign in required' using errcode = '42501'; end if;
  perform training.finalize_expired();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'track', a.track, 'track_name', t.name_ar,
             'trainee_id', a.trainee_admin_id, 'trainee_name', coalesce(tr.name, tr.email),
             'reviewer_id', a.reviewer_admin_id, 'reviewer_name', coalesce(rv.name, rv.email),
             'due_at', a.due_at, 'status', a.status, 'created_at', a.created_at,
             'note', case when owner or a.reviewer_admin_id = me then a.note end,
             'cancel_reason', case when owner then a.cancel_reason end,
             'modules_done', (select count(*) from training.module_progress p where p.assignment_id = a.id),
             'modules_total', (select count(*) from training.course_modules),
             'exam_status', x.status, 'exam_submitted_at', x.submitted_at, 'exam_auto_submitted', x.auto_submitted,
             'exam_grade', case when a.trainee_admin_id <> me and (owner or a.reviewer_admin_id = me) then res.grade end,
             'exam_risk_flags', case when a.trainee_admin_id <> me and (owner or a.reviewer_admin_id = me) then res.risk_flags end,
             'relation', case when a.trainee_admin_id = me then 'trainee'
                              when a.reviewer_admin_id = me then 'reviewer'
                              else 'owner' end)
           order by a.created_at desc)
      from training.assignments a
      join training.tracks t on t.code = a.track
      join public.admins tr on tr.id = a.trainee_admin_id
      join public.admins rv on rv.id = a.reviewer_admin_id
      left join training.attempts x on x.assignment_id = a.id
      left join training.attempt_results res on res.attempt_id = x.id
     where owner or a.trainee_admin_id = me or a.reviewer_admin_id = me), '[]'::jsonb);
end $$;
revoke all on function public.training_assignments() from public, anon;
grant execute on function public.training_assignments() to authenticated;

commit;
