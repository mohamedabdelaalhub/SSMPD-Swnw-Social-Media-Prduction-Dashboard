-- Live rollback test for 20261124200000_instinct_assistant.sql («مساعد إنستنكت»). ONE transaction ending in ROLLBACK, run as postgres.
-- Apply the migration body at the marked spot first if it is not applied yet. Nothing is kept: no auth user, no notes, no messages.
-- The REAL Instinct account (admins.id 6bc2a2ff-9947-4a3f-a06d-e10b5130a526) is first moved to ai_assistant exactly like
-- docs/ops/2026-11-24-instinct-account-to-ai-assistant.sql (as the owner), inside this transaction — then rolled back with the rest.
-- Acts as: Mazen (reception, f0891d2c…): ask + patient-data refusals; the owner (administrative_assistant_config.owner_admin_id):
-- edit / approve / publish / hide a reply / kill switch / audit; Instinct: draft / reply / unread_since / staff descriptions,
-- refused on edit / decide / hide / admins writes; service_role: outbox lease + ack. Then 3 normal RPCs each as Mazen, a financial
-- manager and the owner (must still work), and, as Instinct, a sweep of every table/view granted to authenticated (0 rows) and of
-- the main RPCs of finance / treasury / reception / patients / leads / HR / inventory / tasks / home / prices / content (NULL
-- arguments; must be refused or return nothing). Also lists every table that got instinct_ai_block* and the system identities.
-- Last output = one result table.
begin;
-- >>> apply supabase/migrations/20261124200000_instinct_assistant.sql here (without its own begin / commit) if not applied yet <<<
set local statement_timeout = '15min';
create temp table ins_live(n serial, step text, expected text, actual text, ok boolean);
grant all on ins_live to authenticated, service_role; grant usage, select on sequence ins_live_n_seq to authenticated, service_role;

do $$
declare
  mazen_sub constant uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; ai_id constant uuid := '6bc2a2ff-9947-4a3f-a06d-e10b5130a526';
  owner_sub uuid; owner_id uuid; mazen_id uuid; gm_sub uuid; ai_sub uuid; sets text;
  r jsonb; err text; e2 text; note_id uuid; thread_id uuid; reply_id uuid; k int;
begin
  select a.user_id, a.id into owner_sub, owner_id from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1;
  select id into mazen_id from public.admins where user_id = mazen_sub and active;
  if owner_sub is null or mazen_id is null then raise exception 'owner or Mazen not found'; end if;
  select a.user_id into gm_sub from public.admins a where a.active and a.user_id is not null and a.id <> owner_id and a.role in ('general_manager', 'super_admin') limit 1;

  -- the real Instinct account → ai_assistant (same statements as the ops file, as the owner); its login is not touched
  select user_id into ai_sub from public.admins where id = ai_id;
  if ai_sub is null then
    -- not linked yet: a throw-away auth user for this test only (rolled back)
    ai_sub := gen_random_uuid();
    insert into auth.users(id, aud, role, email, created_at, updated_at) values (ai_sub, 'authenticated', 'authenticated', 'instinct-dryrun-' || left(ai_sub::text, 8) || '@invalid.test', now(), now());
    perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', owner_sub::text, true);
    update public.admins set user_id = ai_sub where id = ai_id;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_sub::text, true);
  insert into ins_live(step, expected, actual, ok) select 'Instinct before', 'page_manager + flags', a.role || ' / ' || coalesce((select string_agg(e.key, ',') from jsonb_each(to_jsonb(a)) e
    where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb), 'no flags'), true from public.admins a where a.id = ai_id;
  delete from public.admin_extra_roles where admin_id = ai_id;
  if to_regclass('public.admin_module_permissions') is not null then delete from public.admin_module_permissions where admin_id = ai_id; end if;
  select string_agg(format('%I = false', column_name), ', ' order by column_name) into sets from information_schema.columns
   where table_schema = 'public' and table_name = 'admins' and data_type = 'boolean' and (column_name like 'has\_%' or column_name like 'can\_%');
  execute format('update public.admins set role = %L%s where id = %L', 'ai_assistant', coalesce(', ' || sets, ''), ai_id);
  insert into ins_live(step, expected, actual, ok) select 'ops step: Instinct after', 'ai_assistant, no flags', a.role || ' / ' || coalesce((select string_agg(e.key, ',') from jsonb_each(to_jsonb(a)) e
    where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb), 'no flags'),
    a.role = 'ai_assistant' and not exists (select 1 from jsonb_each(to_jsonb(a)) e where (e.key like 'has\_%' or e.key like 'can\_%') and e.value = 'true'::jsonb)
    from public.admins a where a.id = ai_id;
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
  begin update public.admins set name = name || ' x' where id = ai_id; get diagnostics k = row_count; err := k || ' rows'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: update own admins row', '0 rows / refused', err, err = '0 rows' or err like '%row-level security%' or err like '%permission denied%' or err like '%غير مسموح%');
  r := public.instinct_context();
  insert into ins_live(step, expected, actual, ok) values ('AI: context', 'kind instinct, can_draft, can_reply', r::text, r->>'kind' = 'instinct' and (r->>'can_draft')::boolean and (r->>'can_reply')::boolean and not (r->>'can_decide')::boolean);
  r := public.instinct_note_save(null, 'تجربة تراجع: الحجز السريع', 'افتح «الاستقبال والخدمات» ثم «حجز جديد».', 'reception'); note_id := (r->>'id')::uuid;
  insert into ins_live(step, expected, actual, ok) values ('AI: draft', 'status draft', r->>'status', r->>'status' = 'draft');
  begin perform public.instinct_note_save(null, 'رقم', 'كلم ٠١٠١٢٣٤٥٦٧٨', 'all'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: draft with a mobile', 'refused', err, err like '%رقم موبايل%');
  begin perform public.instinct_note_decide(note_id, 'publish'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: publish own draft', 'refused (owner only)', err, err like '%للمالك بس%');
  begin perform public.instinct_note_save(note_id, 'تعديل', 'تعديل المسودة', 'all'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: edit own draft', 'refused (owner only)', err, err like '%للمالك بس%');
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
  r := public.instinct_reply(thread_id, 'تجربة تراجع: افتح «الاستقبال والخدمات» ثم «حجز جديد».'); reply_id := (r->>'message_id')::uuid;
  begin perform public.instinct_message_hide(reply_id, true); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI: hide a reply', 'refused (owner only)', err, err like '%للمالك بس%');
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
  r := public.instinct_note_save(note_id, 'تجربة تراجع: الحجز السريع', 'افتح «الاستقبال والخدمات» ثم اضغط «حجز جديد».', 'reception');
  insert into ins_live(step, expected, actual, ok) values ('owner: edit draft', 'still draft', r->>'status', r->>'status' = 'draft');
  r := public.instinct_note_decide(note_id, 'approve');
  insert into ins_live(step, expected, actual, ok) values ('owner: approve', 'approved', r->>'status', r->>'status' = 'approved');
  r := public.instinct_message_hide(reply_id, true);
  insert into ins_live(step, expected, actual, ok) values ('owner: hide reply', 'hidden', r::text, (r->>'hidden')::boolean);
  r := public.instinct_note_decide(note_id, 'publish');
  insert into ins_live(step, expected, actual, ok) values ('owner: publish', 'published', r->>'status', r->>'status' = 'published');
  insert into ins_live(step, expected, actual, ok) select 'owner: all threads', 'includes Mazen''s', count(*)::text, count(*) = 1 from jsonb_array_elements(public.instinct_threads_list()) e where e->>'id' = thread_id::text;
  insert into ins_live(step, expected, actual, ok) select 'owner: audit', 'create, question x2, reply, approve, publish', string_agg(e->>'action', ',' order by (e->>'id')::bigint),
    count(*) = 7 from jsonb_array_elements(public.instinct_audit_list(500)) e where e->>'entity_id' in (note_id::text, thread_id::text);
  r := public.instinct_set_ai_active(ai_id, false);
  insert into ins_live(step, expected, actual, ok) values ('owner: kill switch off', 'inactive', r::text, not (r->>'active')::boolean);
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  execute 'set local role authenticated';
  begin perform public.instinct_reply(thread_id, 'رد'); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI after kill switch: reply', 'refused', err, err <> 'accepted');
  begin perform public.instinct_context(); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('AI after kill switch: context', 'refused', err, err <> 'accepted');
  execute 'reset role';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', owner_sub::text, true);
  execute 'set local role authenticated';
  r := public.instinct_set_ai_active(ai_id, true);
  insert into ins_live(step, expected, actual, ok) values ('owner: kill switch on', 'active', r::text, (r->>'active')::boolean);
  execute 'reset role';
  -- outbox: lines without message text; service_role leases + acks
  insert into ins_live(step, expected, actual, ok) select 'outbox lines (this test)', 'new_draft + 2 new_question, no text', string_agg(kind, ',' order by created_at),
    count(*) = 3 and bool_and(to_jsonb(o)::text not like '%تجربة تراجع%' and to_jsonb(o)::text not like '%ألغيه%')
    from public.instinct_notify_outbox o where item_id in (note_id, thread_id);
  execute 'set local role service_role';
  r := public.instinct_outbox_lease(100, 60);
  insert into ins_live(step, expected, actual, ok) values ('service_role: lease', '≥ 3 items', jsonb_array_length(r->'items')::text, jsonb_array_length(r->'items') >= 3);
  k := public.instinct_outbox_ack((r->>'lease_token')::uuid, array(select (i->>'id')::uuid from jsonb_array_elements(r->'items') i), true);
  insert into ins_live(step, expected, actual, ok) values ('service_role: ack', 'all leased marked sent', k::text, k = jsonb_array_length(r->'items'));
  execute 'reset role';
  begin update public.instinct_audit_log set action = action where entity_id = note_id; err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('audit update (even as postgres)', 'refused', err, err like '%للإضافة فقط%');

  -- ===== Mazen sees the published note and the reply =====
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen_sub::text, true);
  execute 'set local role authenticated';
  insert into ins_live(step, expected, actual, ok) select 'Mazen: published note', 'listed', count(*)::text, count(*) = 1 from jsonb_array_elements(public.instinct_notes_list()) e where e->>'id' = note_id::text;
  r := public.instinct_thread(thread_id);
  insert into ins_live(step, expected, actual, ok) values ('Mazen: thread (reply hidden by owner)', 'staff, staff', (select string_agg(m->>'author_kind', ',') from jsonb_array_elements(r->'messages') m),
    (select string_agg(m->>'author_kind', ',') from jsonb_array_elements(r->'messages') m) = 'staff,staff');
  begin perform public.instinct_outbox_lease(1, 60); err := 'accepted'; exception when others then err := sqlerrm; end;
  insert into ins_live(step, expected, actual, ok) values ('Mazen: outbox lease', 'permission denied', err, err like '%permission denied%');
  execute 'reset role';
end $$;

-- ===== normal users still work: 3 RPCs each as Mazen, a financial manager, the owner =====
do $$
declare who record; fn text; res text; err text; fm_sub uuid;
begin
  select user_id into fm_sub from public.admins where active and user_id is not null and role = 'financial_manager' limit 1;
  for who in select * from (values ('Mazen', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'::uuid, array['personal_home_inbox', 'clinic_reception_workspaces', 'inventory_my_access']),
                                   ('financial manager', fm_sub, array['personal_home_inbox', 'clinic_finance_my_handover_nudges', 'inventory_my_access']),
                                   ('owner', (select a.user_id from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1),
                                     array['personal_home_inbox', 'clinic_reception_workspaces', 'clinic_finance_my_handover_nudges'])) v(label, sub, fns) loop
    if who.sub is null then insert into ins_live(step, expected, actual, ok) values (who.label || ': normal RPCs', 'work', 'no such user', false); continue; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', who.sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', who.sub::text, true);
    foreach fn in array who.fns || array['my_admin_id'] loop
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn and p.pronargs = 0) then
        insert into ins_live(step, expected, actual, ok) values (who.label || ': ' || fn || '()', 'works', 'no zero-argument function', true); continue;
      end if;
      begin
        execute 'set local role authenticated';
        execute format('select left(string_agg(x::text, '',''), 80) from (select public.%I() as x limit 3) s', fn) into res;
        execute 'reset role'; err := null;
      exception when others then execute 'reset role'; err := sqlerrm; end;
      insert into ins_live(step, expected, actual, ok) values (who.label || ': ' || fn || '()', 'works', coalesce(err, 'ok: ' || coalesce(res, 'null')),
        err is null and (fn <> 'my_admin_id' or res is not null));
    end loop;
  end loop;
end $$;

insert into ins_live(step, expected, actual, ok)
select 'tables with instinct_ai_block* (' || count(distinct p.polrelid) || ')', 'every RLS table outside system schemas',
       string_agg(distinct format('%I.%I', n.nspname, c.relname), ' ' order by format('%I.%I', n.nspname, c.relname)), count(*) > 0
  from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where p.polname like 'instinct\_ai\_block%';
insert into ins_live(step, expected, actual, ok)
select 'RLS tables WITHOUT the policy', 'none (or only tables not owned by the migration role)',
       coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ' '), 'none'), true
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', '_realtime',
       'supabase_functions', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'pgsodium_masks', 'vault', 'cron', 'pgbouncer', '_analytics', 'pg_toast')
   and n.nspname not like 'pg\_%' and not (n.nspname = 'public' and c.relname like 'instinct\_%')
   and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname like 'instinct\_ai\_block%');
insert into ins_live(step, expected, actual, ok)
select '2c: guarded functions / revoked grants / RLS on backups', '9 fns guarded; system tables revoked or reported; ops_backup_* RLS on',
       coalesce(string_agg(name, ' ' order by name), 'none'), count(*) filter (where name like 'fn:%') >= 9
  from public.instinct_saved_defs where name like 'fn:%' or name like 'grant:%' or name like 'rls:%';
insert into ins_live(step, expected, actual, ok)
select 'system identities (my_admin_id patch)', 'none has role ai_assistant', coalesce(string_agg(coalesce(name, '?') || ':' || role || ':' || active, ', '), 'none'),
       coalesce(bool_and(role <> 'ai_assistant'), true) from public.admins where is_system_identity;

-- ===== as Instinct: every table / view the dashboard can read returns nothing =====
do $$
declare r record; ai_sub uuid; leaked text := ''; checked int := 0; k bigint; err text;
begin
  select user_id into ai_sub from public.admins where id = '6bc2a2ff-9947-4a3f-a06d-e10b5130a526';
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
  select user_id into ai_sub from public.admins where id = '6bc2a2ff-9947-4a3f-a06d-e10b5130a526';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ai_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ai_sub::text, true);
  for r in select p.oid, p.oid::regproc::text fn,
                  (select coalesce(string_agg('NULL::' || format_type(t, null), ', ' order by o), '') from unnest(p.proargtypes::oid[]) with ordinality u(t, o)) args
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.provariadic = 0 and p.prorettype <> 'trigger'::regtype
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and p.proname ~ '^(clinic_finance|clinic_reception|finance|treasury|accounting|patient|patients|lead|leads|archive|booking|hr_|inventory|task_|tasks|personal_home|kpi|staff_kpi|price_list|workforce|contract|reports?_|report_catalog|media_buyer|meta_ads|content|ad_|digital_|administrative_)'
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
