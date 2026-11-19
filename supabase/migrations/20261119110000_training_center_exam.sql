-- Training & evaluation center, PR 2/6: course progress and the exam (trainee side). Grading is PR 3.
-- * The course text is static (assets/js/training-course-data.js); only completion per module is stored here.
-- * The exam can start only after all 8 modules are completed. The server draws the questions (fixed quota per
--   competency, random pick, random question order) and shuffles each question's options per attempt.
-- * The clock is the server's: deadline_at = started_at + bank duration. Closing the page never submits; the
--   trainee resumes the same questions/answers with the remaining time. Submission happens on «تسليم» or when the
--   deadline passes (finalised lazily the next time anyone reads the attempt or the assignment list).
-- * No RPC here returns option points or critical flags.
begin;

create table if not exists training.course_modules (
  id   text primary key check (id ~ '^m[1-9]$'),
  sort integer not null unique
);
insert into training.course_modules (id, sort) values
  ('m1',1),('m2',2),('m3',3),('m4',4),('m5',5),('m6',6),('m7',7),('m8',8)
on conflict (id) do nothing;

create table if not exists training.module_progress (
  assignment_id uuid not null references training.assignments(id) on delete cascade,
  module_id     text not null references training.course_modules(id),
  completed_at  timestamptz not null default now(),
  primary key (assignment_id, module_id)
);

alter table training.course_modules enable row level security;
alter table training.module_progress enable row level security;
revoke all on training.course_modules, training.module_progress from public, anon, authenticated;

-- ---------------------------------------------------------------- internal helpers
-- Finalise one attempt (idempotent). Moves the assignment to 'submitted'.
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
  perform training.audit(case when p_auto then 'exam_auto_submitted' else 'exam_submitted' end, t.assignment_id,
    jsonb_build_object('answered', (select count(*) from training.attempt_answers where attempt_id = p_attempt)));
end $$;
revoke all on function training.finalize_attempt(uuid, boolean) from public, anon, authenticated;

create or replace function training.finalize_expired()
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare r record;
begin
  for r in select id from training.attempts where status = 'in_progress' and deadline_at <= now() loop
    perform training.finalize_attempt(r.id, true);
  end loop;
end $$;
revoke all on function training.finalize_expired() from public, anon, authenticated;

-- The caller must be the trainee of an open assignment. Returns the locked assignment row.
create or replace function training.my_open_assignment(p_assignment uuid)
returns training.assignments language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments;
begin
  select * into a from training.assignments where id = p_assignment for update;
  if not found or me is null or a.trainee_admin_id <> me then
    raise exception 'training: not your assignment' using errcode = '42501';
  end if;
  if a.status = 'cancelled' then
    raise exception 'training: assignment cancelled' using errcode = '22023';
  end if;
  return a;
end $$;
revoke all on function training.my_open_assignment(uuid) from public, anon, authenticated;

-- Exam payload for the trainee: question/option text in this attempt's order, chosen option ids, clock. No key.
create or replace function training.exam_payload(p_attempt uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, training as $$
  select jsonb_build_object(
    'attempt_id', t.id, 'status', t.status, 'started_at', t.started_at, 'deadline_at', t.deadline_at,
    'submitted_at', t.submitted_at, 'auto_submitted', t.auto_submitted, 'server_now', now(),
    'remaining_seconds', greatest(0, floor(extract(epoch from (t.deadline_at - now()))))::int,
    'total', cardinality(t.question_ids),
    'answered', (select count(*) from training.attempt_answers a where a.attempt_id = t.id),
    'questions', case when t.status = 'in_progress' then (
       select jsonb_agg(jsonb_build_object(
                'id', q.id, 'text', q.text,
                'options', (select jsonb_agg(jsonb_build_object('id', o.option_id, 'text', o.text) order by k.ord)
                              from jsonb_array_elements_text(t.option_order -> q.id) with ordinality k(oid, ord)
                              join training.question_options o on o.question_id = q.id and o.option_id = k.oid))
              order by x.ord)
         from unnest(t.question_ids) with ordinality x(qid, ord)
         join training.questions q on q.id = x.qid) end,
    'answers', case when t.status = 'in_progress' then coalesce((
       select jsonb_object_agg(a.question_id, a.option_id) from training.attempt_answers a where a.attempt_id = t.id),
       '{}'::jsonb) end)
  from training.attempts t where t.id = p_attempt;
$$;
revoke all on function training.exam_payload(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- course
create or replace function public.training_course_progress(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
declare me uuid := public.my_admin_id(); a training.assignments;
begin
  select * into a from training.assignments where id = p_assignment;
  if not found or me is null
     or not (a.trainee_admin_id = me or a.reviewer_admin_id = me or public.is_super()) then
    raise exception 'training: not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'modules', (select jsonb_agg(id order by sort) from training.course_modules),
    'completed', coalesce((select jsonb_object_agg(module_id, completed_at)
                             from training.module_progress where assignment_id = p_assignment), '{}'::jsonb),
    'exam', (select jsonb_build_object('status', t.status, 'deadline_at', t.deadline_at, 'submitted_at', t.submitted_at)
               from training.attempts t where t.assignment_id = p_assignment),
    'bank_ready', exists (select 1 from training.bank_meta),
    'duration_minutes', (select duration_minutes from training.bank_meta),
    'questions_per_attempt', (select questions_per_attempt from training.bank_meta));
end $$;
revoke all on function public.training_course_progress(uuid) from public, anon;
grant execute on function public.training_course_progress(uuid) to authenticated;

create or replace function public.training_complete_module(p_assignment uuid, p_module text)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.my_open_assignment(p_assignment);
begin
  if a.status not in ('assigned', 'in_progress') then
    raise exception 'training: the course is closed for this assignment' using errcode = '22023';
  end if;
  if not exists (select 1 from training.course_modules where id = p_module) then
    raise exception 'training: unknown module' using errcode = '22023';
  end if;
  insert into training.module_progress (assignment_id, module_id) values (p_assignment, p_module)
  on conflict do nothing;
  if a.status = 'assigned' then
    update training.assignments set status = 'in_progress', updated_at = now() where id = p_assignment;
  end if;
end $$;
revoke all on function public.training_complete_module(uuid, text) from public, anon;
grant execute on function public.training_complete_module(uuid, text) to authenticated;

-- ---------------------------------------------------------------- exam
create or replace function public.training_start_exam(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare
  a training.assignments := training.my_open_assignment(p_assignment);
  m training.bank_meta; t_id uuid; qids text[]; orders jsonb;
begin
  select id into t_id from training.attempts where assignment_id = p_assignment;
  if t_id is not null then                      -- resume (or show submitted state); never a second attempt
    if (select status from training.attempts where id = t_id) = 'in_progress'
       and (select deadline_at from training.attempts where id = t_id) <= now() then
      perform training.finalize_attempt(t_id, true);
    end if;
    return training.exam_payload(t_id);
  end if;
  if a.status not in ('assigned', 'in_progress') then
    raise exception 'training: the exam is closed for this assignment' using errcode = '22023';
  end if;
  if (select count(*) from training.module_progress where assignment_id = p_assignment)
     < (select count(*) from training.course_modules) then
    raise exception 'training: complete all course modules first' using errcode = '22023';
  end if;
  select * into m from training.bank_meta;
  if not found then raise exception 'training: question bank not loaded yet' using errcode = '22023'; end if;

  select array_agg(id order by random()) into qids from (
    select q.id from training.competencies c
    cross join lateral (select q.id from training.questions q
                         where q.active and q.competency = c.code order by random() limit c.quota) q
    where c.active) s;
  if coalesce(cardinality(qids), 0) <> m.questions_per_attempt then
    raise exception 'training: question bank cannot fill the exam' using errcode = '22023';
  end if;
  select jsonb_object_agg(q, (select jsonb_agg(option_id order by random())
                                from training.question_options where question_id = q))
    into orders from unnest(qids) q;

  insert into training.attempts (assignment_id, bank_version, question_ids, option_order, started_at, deadline_at)
  values (p_assignment, m.version, qids, orders, now(), now() + make_interval(mins => m.duration_minutes))
  returning id into t_id;
  update training.assignments set status = 'in_progress', updated_at = now() where id = p_assignment;
  perform training.audit('exam_started', p_assignment, jsonb_build_object('questions', cardinality(qids)));
  return training.exam_payload(t_id);
end $$;
revoke all on function public.training_start_exam(uuid) from public, anon;
grant execute on function public.training_start_exam(uuid) to authenticated;

create or replace function public.training_save_answer(p_assignment uuid, p_question text, p_option text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.my_open_assignment(p_assignment); t training.attempts;
begin
  select * into t from training.attempts where assignment_id = p_assignment for update;
  if not found then raise exception 'training: exam not started' using errcode = '22023'; end if;
  if t.status <> 'in_progress' then raise exception 'training: exam already submitted' using errcode = '22023'; end if;
  if t.deadline_at <= now() then
    perform training.finalize_attempt(t.id, true);
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
revoke all on function public.training_save_answer(uuid, text, text) from public, anon;
grant execute on function public.training_save_answer(uuid, text, text) to authenticated;

create or replace function public.training_record_blur(p_assignment uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.my_open_assignment(p_assignment);
begin
  update training.attempts set blur_count = blur_count + 1
   where assignment_id = p_assignment and status = 'in_progress' and deadline_at > now();
end $$;
revoke all on function public.training_record_blur(uuid) from public, anon;
grant execute on function public.training_record_blur(uuid) to authenticated;

create or replace function public.training_submit_exam(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare a training.assignments := training.my_open_assignment(p_assignment); t training.attempts;
begin
  select * into t from training.attempts where assignment_id = p_assignment;
  if not found then raise exception 'training: exam not started' using errcode = '22023'; end if;
  perform training.finalize_attempt(t.id, t.deadline_at <= now());
  return training.exam_payload(t.id);
end $$;
revoke all on function public.training_submit_exam(uuid) from public, anon;
grant execute on function public.training_submit_exam(uuid) to authenticated;

-- Assignment list now finalises expired attempts first (so the owner sees «تم التسليم» without the trainee
-- returning) and shows course/exam progress. Same visibility rules as PR 1; still no scores.
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
             'exam_status', (select x.status from training.attempts x where x.assignment_id = a.id),
             'exam_submitted_at', (select x.submitted_at from training.attempts x where x.assignment_id = a.id),
             'exam_auto_submitted', (select x.auto_submitted from training.attempts x where x.assignment_id = a.id),
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

-- Owner's assignment form needs the list of active users (names only).
create or replace function public.training_people()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, training as $$
begin
  perform training.require_owner();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(name, email)) order by coalesce(name, email))
                     from public.admins where active), '[]'::jsonb);
end $$;
revoke all on function public.training_people() from public, anon;
grant execute on function public.training_people() to authenticated;

commit;
