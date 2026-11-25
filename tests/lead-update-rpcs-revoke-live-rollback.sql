-- Live rollback test for 20261125160000_revoke_lead_update_rpcs.sql. ONE transaction ending in ROLLBACK, as postgres; paste
-- the migration body at the marked spot. Nothing is kept: the service-role calls write the lead's CURRENT values back
-- (no change), and everything is rolled back anyway.
--   anon / authenticated (Mazen) → permission denied on both RPCs;  service_role (the edge functions) → still works.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint rv_live_guard;
-- >>> apply supabase/migrations/20261125160000_revoke_lead_update_rpcs.sql here (without its own begin / commit) <<<
create temp table rv_live(n serial, step text, expected text, actual text, ok boolean);
grant all on rv_live to anon, authenticated, service_role;
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; l public.leads%rowtype; err text; r text; q text;
begin
  select id into me from public.admins where user_id = mazen;
  select * into l from public.leads order by created_at desc limit 1;
  insert into rv_live(step, expected, actual, ok) values ('fixture lead', 'a live lead', coalesce(l.id::text, 'none'), l.id is not null);
  foreach r in array array['anon', 'authenticated'] loop
    if r = 'authenticated' then
      perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', mazen::text, true);
    end if;
    foreach q in array array['rpc_update_lead', 'rpc_update_lead_details'] loop
      begin
        execute 'set local role ' || r;
        if q = 'rpc_update_lead' then perform public.rpc_update_lead(l.id, me, l.current_status);
        else perform public.rpc_update_lead_details(l.id, me, l.customer_name, l.phone_raw, l.phone_normalized, l.source); end if;
        execute 'reset role'; err := 'EXECUTED';
      exception when others then execute 'reset role'; err := sqlerrm; end;
      insert into rv_live(step, expected, actual, ok) values (r || ' → ' || q, 'permission denied', err, err ilike '%permission denied%');
    end loop;
  end loop;
  foreach q in array array['rpc_update_lead', 'rpc_update_lead_details'] loop
    begin
      execute 'set local role service_role';
      if q = 'rpc_update_lead' then perform public.rpc_update_lead(l.id, me, l.current_status);
      else perform public.rpc_update_lead_details(l.id, me, l.customer_name, l.phone_raw, l.phone_normalized, l.source, l.message_text,
        l.interested_service, l.requested_department, l.acquisition_type, l.patient_id, l.patient_type); end if;
      execute 'reset role'; err := 'ok';
    exception when others then execute 'reset role'; err := sqlerrm; end;
    insert into rv_live(step, expected, actual, ok) values ('service_role (edge) → ' || q, 'ok', err, err = 'ok');
  end loop;
  insert into rv_live(step, expected, actual, ok) select 'grants after', 'anon f · authenticated f · service_role t',
    string_agg(p.proname || ': ' || has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute') || '/' || has_function_privilege('service_role', p.oid, 'execute'), ' · ' order by p.proname),
    bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and has_function_privilege('service_role', p.oid, 'execute'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('rpc_update_lead', 'rpc_update_lead_details');
end $$;
select step, expected, actual, ok from rv_live order by n;
rollback;
