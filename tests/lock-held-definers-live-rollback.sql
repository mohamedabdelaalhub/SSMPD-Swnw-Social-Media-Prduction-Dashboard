-- Live rollback test for 20261125190000_lock_held_definers.sql. ONE transaction ending in ROLLBACK, as postgres; paste the
-- migration body at the marked spot. Privileges of the 17 functions + read-only calls:
--   anon → clinic_reception_agent_context (patient by phone): permission denied;  service_role (the agent's edge) → still works;
--   anon / Mazen → staff_kpis_admin: permission denied;  Mazen → my_staff_kpis (own KPIs, definer wrapper): still works;
--   postgres (the Claude mailbox path) → staff_kpi_month_data: still works.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint lh_live_guard;
-- >>> apply supabase/migrations/20261125190000_lock_held_definers.sql here (without its own begin / commit) <<<
create temp table lh_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; bad text; err text;
  S text[] := array['public.claim_server_meta_publish_jobs(integer)','public.storage_offload_mark_deleted(text,text[])','public.storage_offload_candidates(integer)','public.storage_offload_ready_for_delete(integer)','public.claim_next_video_job(text)','public.claim_next_video_job(text,integer)','public.claude_cap_use(text,jsonb)','public.claude_propose_ad_plan(text,text,text,numeric,numeric,date,date,text,text,text,uuid)','public.staff_summary_save(uuid,date,text,text,text,text)','public.staff_kpis_admin(timestamp with time zone,timestamp with time zone)','public.staff_kpi_month_data(date)','public.staff_summary_fallback(date)','public.clinic_reception_agent_context(text)','public.clinic_reception_agent_event(uuid,text,jsonb,text)','public.clinic_reception_pbx_event(text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,text,jsonb)','public.clinic_reception_agent_set_communications(boolean)','public.agent_match_patients_by_phone(text)'];
begin
  select string_agg(x, ', ') into bad from unnest(S) x where has_function_privilege('anon', x, 'execute') or has_function_privilege('authenticated', x, 'execute') or not has_function_privilege('service_role', x, 'execute');
  insert into lh_live(step, expected, actual, ok) values ('privileges (' || cardinality(S) || ')', 'anon ✗ · authenticated ✗ · service_role ✓', coalesce(bad, 'all ok'), bad is null);
  begin execute 'set local role anon'; perform public.staff_kpis_admin(now() - interval '1 day', now()); execute 'reset role'; err := 'EXECUTED';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('anon → staff_kpis_admin', 'permission denied', err, err ilike '%permission denied%');
  begin execute 'set local role anon'; perform public.clinic_reception_agent_context('01000000000'); execute 'reset role'; err := 'EXECUTED';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('anon → clinic_reception_agent_context (patient by phone)', 'permission denied', err, err ilike '%permission denied%');
  begin execute 'set local role service_role'; perform public.clinic_reception_agent_context('01000000000'); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('service_role (edge clinic-reception-agent) → agent_context', 'not permission denied', err, err not ilike '%permission denied%');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin execute 'set local role authenticated'; perform public.staff_kpis_admin(now() - interval '1 day', now()); execute 'reset role'; err := 'EXECUTED';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('Mazen → staff_kpis_admin (all staff)', 'permission denied', err, err ilike '%permission denied%');
  -- like a real PostgREST call: only request.jwt.claims is set (staff_kpis_admin overrides it inside; a leftover
  -- request.jwt.claim.sub would keep auth.uid() = Mazen and make staff_kpis refuse — a test artefact, not the live path)
  perform set_config('request.jwt.claim.sub', '', true);
  begin execute 'set local role authenticated'; perform public.my_staff_kpis(now() - interval '7 days', now()); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('Mazen → my_staff_kpis (own KPIs)', 'ok (his own rows)', err, err = 'ok');
  -- the Claude mailbox path: a plain postgres session with no JWT at all
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin perform public.staff_kpi_month_data(null); err := 'ok';
  exception when others then err := sqlerrm; end;
  insert into lh_live(step, expected, actual, ok) values ('postgres (Claude mailbox) → staff_kpi_month_data', 'ok', err, err = 'ok');
end $$;
select step, expected, actual, ok from lh_live order by n;
rollback;
