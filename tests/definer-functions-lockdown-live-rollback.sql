-- Live rollback test for 20261125040000_definer_functions_lockdown.sql. ONE transaction ending in ROLLBACK, run as postgres.
-- Apply the migration body at the marked spot first (without its own begin / commit). Nothing is kept; no worker function is
-- actually called by a browser role (message_claim is only privilege-checked, never executed).
-- Also prints, from pg_stat_statements (read as postgres), WHICH database role has been calling each function on live — the
-- evidence that the booking agent / workers use service_role before the browser grant goes. Last output = one result table.
begin;
create temp table dl_live(n serial, step text, expected text, actual text, ok boolean);
grant all on dl_live to authenticated, service_role; grant usage, select on sequence dl_live_n_seq to authenticated, service_role;

-- 0. who calls these today (before the change)
insert into dl_live(step, expected, actual, ok)
select 'callers (pg_stat_statements): ' || f, 'service_role / postgres / supabase_* only',
       coalesce(string_agg(distinct r.rolname || '×' || s.calls, ', '), 'no calls recorded'),
       coalesce(bool_and(r.rolname not in ('authenticated', 'anon')), true)
  from unnest(array['clinic_reception_message_claim', 'clinic_reception_message_ack', 'clinic_reception_agent_health', 'content_archive_candidates',
                    'content_archive_pending_cleanup', 'content_learning_brief(', 'content_learning_brief_core', 'lead_capture_gap']) f
  left join extensions.pg_stat_statements s on s.query ilike '%' || f || '%' and s.query not ilike '%pg_stat_statements%'
  left join pg_roles r on r.oid = s.userid
 group by f;

-- >>> apply supabase/migrations/20261125040000_definer_functions_lockdown.sql here (without its own begin / commit) <<<

-- 1. grants
insert into dl_live(step, expected, actual, ok)
select 'grant ' || p.oid::regprocedure, 'authenticated/anon: no · service_role: yes',
       'authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE') || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
         || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE'),
       not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('clinic_reception_message_claim', 'clinic_reception_message_ack', 'clinic_reception_agent_health',
       'content_archive_candidates', 'content_archive_pending_cleanup', 'content_learning_brief', 'content_learning_brief_core');

-- 2. as people
do $$
declare who record; res text; err text; fm_sub uuid; owner_sub uuid; ai_sub uuid;
begin
  select user_id into fm_sub from public.admins where active and user_id is not null and role = 'financial_manager' limit 1;
  select a.user_id into owner_sub from public.administrative_assistant_config c join public.admins a on a.id = c.owner_admin_id where c.id = 1;
  select user_id into ai_sub from public.admins where role = 'ai_assistant' and user_id is not null limit 1;
  for who in select * from (values
      ('Mazen (reception)', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'::uuid, 'select (select row_to_json(g)::text from public.lead_capture_gap() g)', true),
      ('Mazen (reception)', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'::uuid, $q$select left(public.content_learning_brief_staff('sono')::text, 60)$q$, true),
      ('Mazen (reception)', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'::uuid, 'select public.clinic_reception_agent_health()::text', false),
      ('Mazen (reception)', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'::uuid, $q$select public.content_learning_brief('sono')::text$q$, false),
      ('financial manager', fm_sub, 'select (select row_to_json(g)::text from public.lead_capture_gap() g)', false),
      ('owner', owner_sub, 'select (select row_to_json(g)::text from public.lead_capture_gap() g)', true),
      ('owner', owner_sub, 'select left(public.digital_team_dashboard()::text, 60)', true),
      ('Instinct (ai_assistant)', ai_sub, 'select (select row_to_json(g)::text from public.lead_capture_gap() g)', false),
      ('Instinct (ai_assistant)', ai_sub, 'select public.clinic_reception_agent_health()::text', false)) v(label, sub, sql, should_work) loop
    if who.sub is null then insert into dl_live(step, expected, actual, ok) values (who.label || ': ' || who.sql, 'n/a', 'no such user', true); continue; end if;
    if who.sql like '%digital_team_dashboard%' and to_regprocedure('public.digital_team_dashboard()') is null then continue; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', who.sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', who.sub::text, true);
    begin
      execute 'set local role authenticated'; execute who.sql into res; execute 'reset role'; err := null;
    exception when others then execute 'reset role'; err := sqlerrm; end;
    insert into dl_live(step, expected, actual, ok) values (who.label || ': ' || left(who.sql, 70), case when who.should_work then 'works' else 'refused' end,
      coalesce('ERROR: ' || err, 'ok: ' || left(coalesce(res, 'null'), 100)), (err is null) = who.should_work);
  end loop;
end $$;

-- 3. as service_role (worker path)
do $$
declare res text; err text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  foreach res in array array['select public.clinic_reception_agent_health()::text', 'select (select row_to_json(g)::text from public.lead_capture_gap() g)',
                             $q$select left(public.content_learning_brief('sono')::text, 60)$q$] loop
    declare sql text := res; begin
      begin execute 'set local role service_role'; execute sql into res; execute 'reset role'; err := null;
      exception when others then execute 'reset role'; err := sqlerrm; end;
      insert into dl_live(step, expected, actual, ok) values ('service_role: ' || left(sql, 70), 'works', coalesce('ERROR: ' || err, 'ok: ' || left(coalesce(res, 'null'), 100)), err is null);
    end;
  end loop;
end $$;

select step, expected, actual, ok from dl_live order by n;
rollback;
