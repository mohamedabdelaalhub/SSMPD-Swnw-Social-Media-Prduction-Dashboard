-- Live rollback test for 20261124200000_instinct_assistant.sql («مساعد إنستنكت»). ONE transaction ending in ROLLBACK, run as postgres.
-- Apply the migration body at the marked spot first if it is not applied yet. Nothing is kept: no auth user, no notes, no messages.
-- Acts as: Mazen (reception, f0891d2c…): ask + patient-data refusals; the owner (administrative_assistant_config.owner_admin_id):
-- approve / publish / audit; a FAKE ai_assistant account created inside this transaction: draft / reply / unread_since / staff
-- descriptions, refused on decide; then, as that AI account, a sweep of every table/view granted to authenticated (must return 0 rows)
-- and of the main RPCs of finance / treasury / reception / patients / leads / HR / inventory / tasks / home (each called with NULL
-- arguments; must be refused or return nothing). Last output = one result table.
begin;
-- >>> apply supabase/migrations/20261124200000_instinct_assistant.sql here (without its own begin / commit) if not applied yet <<<
set local statement_timeout = '15min';
create temp table ins_live(n serial, step text, expected text, actual text, ok boolean);
grant all on ins_live to authenticated; grant usage, select on sequence ins_live_n_seq to authenticated;

do $$
declare
  mazen_sub constant uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb';
  owner_sub uuid; owner_id uuid; mazen_id uuid; gm_sub uuid; ai_sub uuid := gen_random_uuid(); ai_id uuid := gen_random_uuid();
  r jsonb; err text; e2 text; note_id uuid; thread_id uuid;
begin
  select a.user_id, a.id into owner_sub, owner_id from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1;
  select id into mazen_id from public.admins where user_id = mazen_sub and active;
  if owner_sub is null or mazen_id is null then raise exception 'owner or Mazen not found'; end if;
  select a.user_id into gm_sub from public.admins a where a.active and a.user_id is not null and a.id <> owner_id and a.role in ('general_manager', 'super_admin') limit 1;

  -- fake Instinct account (rolled back): auth user + admins row with role ai_assistant
  insert into auth.users(id, aud, role, email, created_at, updated_at) values (ai_sub, 'authenticated', 'authenticated', 'instinct-dryrun-' || left(ai_sub::text, 8) || '@invalid.test', now(), now());
  insert into public.admins(id, user_id, email, name, role, active) values (ai_id, ai_sub, 'instinct-dryrun-' || left(ai_sub::text, 8) || '@invalid.test', 'إنستنكت (تجربة)', 'ai_assistant', true);
  begin update public.admins set has_archive_access = true where id = ai_id; err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('ai_assistant + access flag', 'refused', err, err like '%صلاحيات إضافية%');

  -- ===== as the fake Instinct =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  execute 'set local role authenticated';
  insert into ins_live(step, expected, actual, ok) select 'AI: my_admin_id()', 'null', coalesce(public.my_admin_id()::text, 'null'), public.my_admin_id() is null;
  insert into ins_live(step, expected, actual, ok) select 'AI: staff roles', 'none', public.has_any_role(array['super_admin','general_manager','reception','customer_service','accountant','financial_manager','page_manager','designer','approver','nursing','head_nursing','sono_doctor','contract_manager'])::text,
    not public.has_any_role(array['super_admin','general_manager','reception','customer_service','accountant','financial_manager','page_manager','designer','approver','nursing','head_nursing','sono_doctor','contract_manager']);
  insert into ins_live(step, expected, actual, ok) select 'AI: admins rows visible', '1 (own)', count(*)::text, count(*) = 1 and bool_and(id = ai_id) from public.admins;
  r := public.instinct_context();
  insert into ins_live(step, expected, actual, ok) values ('AI: context', 'kind instinct, can_draft, can_reply', r::text, r->>'kind' = 'instinct' and (r->>'can_draft')::boolean and (r->>'can_reply')::boolean and not (r->>'can_decide')::boolean);
  r := public.instinct_note_save(null, 'تجربة تراجع: الحجز السريع', 'افتح «الاستقبال والخدمات» ثم «حجز جديد».', 'reception'); note_id := (r->>'id')::uuid;
  insert into ins_live(step, expected, actual, ok) values ('AI: draft', 'status draft', r->>'status', r->>'status' = 'draft');
  begin perform public.instinct_note_save(null, 'رقم', 'كلم ٠١٠١٢٣٤٥٦٧٨', 'all'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: draft with a mobile', 'refused', err, err like '%رقم موبايل%');
  begin perform public.instinct_note_decide(note_id, 'publish'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: publish own draft', 'refused (owner only)', err, err like '%للمالك بس%');
  begin perform public.instinct_ask(null, 'سؤال'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: ask', 'refused', err, err like '%مش بيسأل%');
  execute 'reset role';

  -- ===== as Mazen (reception) =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen_sub::text, true);
  execute 'set local role authenticated';
  r := public.instinct_context();
  insert into ins_live(step, expected, actual, ok) values ('Mazen: context', 'staff, groups ⊇ reception, can_ask', r::text, r->>'kind' = 'staff' and r->'groups' ? 'reception' and (r->>'can_ask')::boolean and not (r->>'can_decide')::boolean);
  insert into ins_live(step, expected, actual, ok) select 'Mazen: draft hidden', 'not listed', count(*)::text, count(*) = 0 from jsonb_array_elements(public.instinct_notes_list()) e where e->>'id' = note_id::text;
  foreach err in array array['المريض رقمه 01012345678', 'رقم ٠١١ ٢٣٤٥ ٦٧٨٩', 'ملف P-2026-000123', 'رقم قومي 29001011234567'] loop
    begin perform public.instinct_ask(null, err); e2 := 'accepted'; exception when others then e2 := sqlerrm; end;
    insert into ins_live(step, expected, actual, ok) values ('Mazen: ask «' || err || '»', 'refused', e2, e2 like 'ممنوع كتابة%');
  end loop;
  r := public.instinct_ask(null, 'تجربة تراجع: إزاي أعمل حجز جديد؟'); thread_id := (r->>'thread_id')::uuid;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: ask', 'thread created', r::text, thread_id is not null);
  r := public.instinct_ask(thread_id, 'وإزاي ألغيه؟');
  insert into ins_live(step, expected, actual, ok) values ('Mazen: follow-up', 'same thread', r->>'thread_id', (r->>'thread_id')::uuid = thread_id);
  begin perform public.instinct_reply(thread_id, 'رد'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: reply', 'refused', err, err like '%لمساعد إنستنكت بس%');
  begin perform public.instinct_note_decide(note_id, 'approve'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: approve', 'refused', err, err like '%للمالك بس%');
  begin perform public.instinct_staff_profiles(); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: hidden descriptions', 'refused', err, err like '%للمالك ومساعد إنستنكت بس%');
  begin perform count(*) from public.instinct_messages; err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: direct table read', 'permission denied', err, err like '%permission denied%');
  execute 'reset role';

  -- ===== another manager (not the owner) =====
  if gm_sub is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', gm_sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', gm_sub::text, true);
    execute 'set local role authenticated';
    begin perform public.instinct_note_decide(note_id, 'approve'); err := 'accepted'; exception when others then err := sqlerrm; end;
    insert into ins_live(step, expected, actual, ok) values ('other manager: approve', 'refused (owner only)', err, err like '%للمالك بس%');
    execute 'reset role';
  end if;

  -- ===== Instinct replies =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  execute 'set local role authenticated';
  r := public.instinct_unread_since(now() - interval '1 minute');
  insert into ins_live(step, expected, actual, ok) values ('AI: unread_since', '≥ 2 new questions', jsonb_array_length(r->'new_questions')::text, jsonb_array_length(r->'new_questions') >= 2);
  r := public.instinct_reply(thread_id, 'تجربة تراجع: افتح «الاستقبال والخدمات» ثم «حجز جديد».');
  insert into ins_live(step, expected, actual, ok) values ('AI: reply', 'same thread', r->>'thread_id', (r->>'thread_id')::uuid = thread_id);
  r := public.instinct_staff_profiles();
  insert into ins_live(step, expected, actual, ok) values ('AI: hidden descriptions', '> 0, no emails', jsonb_array_length(r)::text, jsonb_array_length(r) > 0 and r::text !~ '@');
  insert into ins_live(step, expected, actual, ok) select 'AI: notifications', '≥ 2 new_question', count(*)::text, count(*) >= 2 from jsonb_array_elements(public.instinct_notifications_list()) e where e->>'kind' = 'new_question';
  execute 'reset role';

  -- ===== the owner =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_sub::text, true);
  execute 'set local role authenticated';
  insert into ins_live(step, expected, actual, ok) select 'owner: notifications', 'new_draft + new_question', string_agg(distinct e->>'kind', ','),
    bool_or(e->>'kind' = 'new_draft') and bool_or(e->>'kind' = 'new_question') from jsonb_array_elements(public.instinct_notifications_list()) e where (e->>'created_at')::timestamptz > now() - interval '1 minute';
  r := public.instinct_note_decide(note_id, 'approve');
  insert into ins_live(step, expected, actual, ok) values ('owner: approve', 'approved', r->>'status', r->>'status' = 'approved');
  r := public.instinct_note_decide(note_id, 'publish');
  insert into ins_live(step, expected, actual, ok) values ('owner: publish', 'published', r->>'status', r->>'status' = 'published');
  insert into ins_live(step, expected, actual, ok) select 'owner: all threads', 'includes Mazen''s', count(*)::text, count(*) = 1 from jsonb_array_elements(public.instinct_threads_list()) e where e->>'id' = thread_id::text;
  insert into ins_live(step, expected, actual, ok) select 'owner: audit', 'create, question x2, reply, approve, publish', string_agg(e->>'action', ',' order by (e->>'id')::bigint),
    count(*) = 6 from jsonb_array_elements(public.instinct_audit_list(500)) e where e->>'entity_id' in (note_id::text, thread_id::text);
  execute 'reset role';
  begin update public.instinct_audit_log set action = action where entity_id = note_id; err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('audit update (even as postgres)', 'refused', err, err like '%للإضافة فقط%');

  -- ===== Mazen sees the published note and the reply =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen_sub::text, true);
  execute 'set local role authenticated';
  insert into ins_live(step, expected, actual, ok) select 'Mazen: published note', 'listed', count(*)::text, count(*) = 1 from jsonb_array_elements(public.instinct_notes_list()) e where e->>'id' = note_id::text;
  r := public.instinct_thread(thread_id);
  insert into ins_live(step, expected, actual, ok) values ('Mazen: thread', 'staff, staff, instinct', (select string_agg(m->>'author_kind', ',') from jsonb_array_elements(r->'messages') m),
    (select string_agg(m->>'author_kind', ',') from jsonb_array_elements(r->'messages') m) = 'staff,staff,instinct');
  execute 'reset role';
end $$;

-- ===== as the fake Instinct: every table / view the dashboard can read returns nothing =====
do $$
declare r record; ai_sub uuid; leaked text := ''; checked int := 0; k bigint; err text;
begin
  select user_id into ai_sub from public.admins where role = 'ai_assistant' and email like 'instinct-dryrun-%@invalid.test' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  for r in select c.oid, format('%I.%I', n.nspname, c.relname) t from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\_%'
              and has_table_privilege('authenticated', c.oid, 'SELECT') order by 2 loop
    checked := checked + 1;
    begin
      execute 'set local role authenticated';
      execute format('select count(*) from (select 1 from %s limit 1) s', r.t) into k;
      execute 'reset role';
      if k > 0 and r.t not in ('public.admins') then leaked := leaked || ' ' || r.t; end if;
    exception when others then execute 'reset role'; end;
  end loop;
  insert into ins_live(step, expected, actual, ok) values ('AI sweep: ' || checked || ' readable tables/views', '0 rows everywhere', coalesce(nullif(leaked, ''), 'none'), leaked = '');
end $$;

-- ===== as the fake Instinct: main RPCs of the other modules, NULL arguments =====
do $$
declare r record; ai_sub uuid; res text; returned text := ''; flags text := ''; refused int := 0; empty int := 0; total int := 0;
begin
  select user_id into ai_sub from public.admins where role = 'ai_assistant' and email like 'instinct-dryrun-%@invalid.test' limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  for r in select p.oid, p.oid::regproc::text fn,
                  (select coalesce(string_agg('NULL::' || format_type(t, null), ', ' order by o), '') from unnest(p.proargtypes::oid[]) with ordinality u(t, o)) args
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.provariadic = 0 and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and p.proname ~ '^(clinic_finance|clinic_reception|finance|treasury|accounting|patient|patients|lead|leads|archive|booking|hr_|inventory|task_|tasks|personal_home|kpi|staff_kpi|price_list|contract|reports?_|report_catalog|media_buyer|meta_ads)'
            order by 2 loop
    total := total + 1;
    begin
      execute 'set local role authenticated';
      execute format('select left(string_agg(x::text, '',''), 120) from (select %s(%s) as x limit 3) s', r.fn, r.args) into res;
      execute 'reset role';
      if res is null or res in ('', '[]', '{}', 'false', '0', 'null', '{"rows": []}') or res ~ '^(\{\}|\[\]|f|0)(,|$)' then empty := empty + 1;
      elsif res in ('t', 'true') then flags := flags || ' ' || r.fn;
      else returned := returned || ' ' || r.fn || '=' || res; end if;
    exception when others then execute 'reset role'; refused := refused + 1; end;
  end loop;
  insert into ins_live(step, expected, actual, ok) values ('AI RPC sweep: ' || total || ' functions', 'all refused or empty',
    refused || ' refused, ' || empty || ' empty' || case when flags <> '' then '; boolean true (review):' || left(flags, 1500) else '' end || case when returned <> '' then '; RETURNED DATA:' || left(returned, 3000) else '' end, returned = '');
end $$;

select step, expected, actual, ok from ins_live order by n;
rollback;
