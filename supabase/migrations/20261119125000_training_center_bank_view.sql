-- Training & evaluation center: owner-only question-bank pages in the dashboard + storage for the job-tracks bank.
-- * Manager bank (exam): already in training.questions/question_options. training_bank_view('manager') returns it with
--   the key — owner (super_admin) only. Nobody else can call it.
-- * Job-tracks bank (continuous-learning phase: cleaning, reception, booking, cashier, social): new tables
--   training.job_* and an owner-only import RPC. Not used by any exam yet. Its key is also owner-only.
-- * As with the manager bank, the content (with its key) is never committed: the owner/main chat loads it on the server
--   from the private artifact with public.training_import_job_bank(<json>).
begin;

create table if not exists training.job_bank_meta (
  id          boolean primary key default true check (id),
  version     text not null,
  sources     jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.admins(id) on delete set null
);
create table if not exists training.job_tracks (
  code        text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_ar     text not null,
  description text,
  sort        integer not null default 0
);
create table if not exists training.job_questions (
  id          text primary key check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  track       text not null references training.job_tracks(code),
  competency  text not null,
  difficulty  text check (difficulty in ('easy', 'medium', 'hard')),
  text        text not null check (length(text) between 1 and 4000),
  rationale   text,
  active      boolean not null default true,
  sort        integer not null default 0
);
create table if not exists training.job_question_options (
  question_id   text not null references training.job_questions(id) on delete cascade,
  option_id     text not null check (option_id ~ '^[a-z]$'),
  text          text not null,
  points        smallint not null check (points in (0, 1, 2)),
  critical_flag boolean not null default false,
  primary key (question_id, option_id)
);
create table if not exists training.job_lessons (
  id      text primary key check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  track   text not null references training.job_tracks(code),
  sort    integer not null default 0,
  content jsonb not null           -- {title, duration_minutes, objective, explanation, scenario, do, dont, check_question, answer}
);
do $$ declare t text; begin
  foreach t in array array['job_bank_meta','job_tracks','job_questions','job_question_options','job_lessons'] loop
    execute format('alter table training.%I enable row level security', t);
    execute format('revoke all on training.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Import: {version, sources[], tracks:{code:{name,description}}, questions:[{id,track,competency,difficulty,question,
--          options:[{id?,text,points,critical_flag}],rationale}], lessons:{track:[{id,title,...}]}}
-- Options without an id get a/b/c/d by position. Re-import replaces the job bank entirely (nothing references it yet).
create or replace function public.training_import_job_bank(p_bank jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare me uuid := training.require_owner(); k text; v jsonb; q jsonb; o jsonb; l jsonb; i int; n_q int := 0; n_l int := 0; bad text;
begin
  if jsonb_typeof(p_bank) <> 'object' or nullif(btrim(p_bank->>'version'), '') is null
     or jsonb_typeof(p_bank->'tracks') <> 'object' or jsonb_typeof(p_bank->'questions') <> 'array' then
    raise exception 'training: job bank must have version, tracks{} and questions[]' using errcode = '22023';
  end if;
  delete from training.job_lessons; delete from training.job_question_options; delete from training.job_questions; delete from training.job_tracks;
  i := 0;
  for k, v in select * from jsonb_each(p_bank->'tracks') loop
    i := i + 1;
    insert into training.job_tracks (code, name_ar, description, sort)    -- jsonb does not keep key order
    values (k, v->>'name', v->>'description', coalesce(array_position(array['cleaning','reception','booking','cashier','social'], k), 100 + i));
  end loop;
  for q in select * from jsonb_array_elements(p_bank->'questions') loop
    n_q := n_q + 1;
    insert into training.job_questions (id, track, competency, difficulty, text, rationale, sort)
    values (q->>'id', q->>'track', q->>'competency', q->>'difficulty', coalesce(q->>'question', q->>'text'), q->>'rationale', n_q);
    i := 0;
    for o in select * from jsonb_array_elements(q->'options') loop
      i := i + 1;
      insert into training.job_question_options (question_id, option_id, text, points, critical_flag)
      values (q->>'id', coalesce(o->>'id', chr(96 + i)), o->>'text', (o->>'points')::smallint, coalesce((o->>'critical_flag')::boolean, false));
    end loop;
  end loop;
  select string_agg(id, ', ') into bad from training.job_questions jq
   where (select count(*) filter (where points = 2) from training.job_question_options where question_id = jq.id) <> 1;
  if bad is not null then raise exception 'training: each job question needs exactly one 2-point option: %', bad using errcode = '22023'; end if;
  if jsonb_typeof(p_bank->'lessons') = 'object' then
    for k, v in select * from jsonb_each(p_bank->'lessons') loop
      i := 0;
      for l in select * from jsonb_array_elements(v) loop
        i := i + 1; n_l := n_l + 1;
        insert into training.job_lessons (id, track, sort, content) values (l->>'id', k, i, l - 'id');
      end loop;
    end loop;
  end if;
  insert into training.job_bank_meta (id, version, sources, imported_at, imported_by)
  values (true, p_bank->>'version', coalesce(p_bank->'sources', '[]'::jsonb), now(), me)
  on conflict (id) do update set version = excluded.version, sources = excluded.sources, imported_at = now(), imported_by = me;
  perform training.audit('job_bank_imported', null, jsonb_build_object('version', p_bank->>'version', 'questions', n_q, 'lessons', n_l));
  return jsonb_build_object('version', p_bank->>'version', 'questions', n_q, 'lessons', n_l);
end $$;
revoke all on function public.training_import_job_bank(jsonb) from public, anon;
grant execute on function public.training_import_job_bank(jsonb) to authenticated;

-- Owner-only bank page data. p_bank = 'manager' | 'jobs'. Includes the key; every view is audited.
create or replace function public.training_bank_view(p_bank text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, training as $$
declare r jsonb;
begin
  perform training.require_owner();
  if p_bank = 'manager' then
    r := jsonb_build_object('bank', 'manager',
      'meta', (select to_jsonb(m) - 'id' - 'imported_by' from training.bank_meta m),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name_ar, 'quota', c.quota,
          'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.text,
              'options', (select jsonb_agg(jsonb_build_object('id', o.option_id, 'text', o.text, 'points', o.points, 'critical', o.critical_flag) order by o.option_id)
                            from training.question_options o where o.question_id = q.id)) order by q.id)
            from training.questions q where q.active and q.competency = c.code), '[]'::jsonb)) order by c.sort)
        from training.competencies c where c.active), '[]'::jsonb));
  elsif p_bank = 'jobs' then
    r := jsonb_build_object('bank', 'jobs',
      'meta', (select to_jsonb(m) - 'id' - 'imported_by' from training.job_bank_meta m),
      'groups', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name_ar, 'description', t.description,
          'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.text, 'competency', q.competency,
              'difficulty', q.difficulty, 'rationale', q.rationale,
              'options', (select jsonb_agg(jsonb_build_object('id', o.option_id, 'text', o.text, 'points', o.points, 'critical', o.critical_flag) order by o.option_id)
                            from training.job_question_options o where o.question_id = q.id)) order by q.sort)
            from training.job_questions q where q.active and q.track = t.code), '[]'::jsonb),
          'lessons', coalesce((select jsonb_agg(l.content || jsonb_build_object('id', l.id) order by l.sort)
            from training.job_lessons l where l.track = t.code), '[]'::jsonb)) order by t.sort)
        from training.job_tracks t), '[]'::jsonb));
  else
    raise exception 'training: unknown bank' using errcode = '22023';
  end if;
  perform training.audit('bank_viewed', null, jsonb_build_object('bank', p_bank));
  return r;
end $$;
revoke all on function public.training_bank_view(text) from public, anon;
grant execute on function public.training_bank_view(text) to authenticated;

commit;
