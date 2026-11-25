-- Live rollback test for 20261125150000_leads_archive_grant_all.sql (owner 2026-11-25 «الليدز تشوف كلها», rule 9).
-- ONE transaction ending in ROLLBACK, as postgres; paste the migration body at the marked spot if it is not applied. Nothing is kept.
-- Acts as the grant holder (Zeina Badr's account: active, has_leads_archive_access, customer_service but not manager/reception):
--   RLS: she reads ALL leads + attempts (before: only assigned); she updates the status of a lead assigned to someone else;
--   the edge path: rpc_update_lead with p_caller_id = her (what leads-update-status calls after its scope check) works.
-- A plain customer_service account without the grant (if one exists) still reads only its assigned leads.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint la_live_guard;
create temp table la_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare z record; cs record; total int; seen int; att int; att_seen int; before_seen int; lid uuid; st text; n int; err text;
begin
  select a.id, a.user_id, a.name into z from public.admins a
   where a.active and a.user_id is not null and a.has_leads_archive_access is true and a.role not in ('super_admin', 'general_manager', 'reception')
     and not exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('super_admin', 'general_manager', 'reception'))
   order by (a.name ilike '%زين%' or a.name ilike '%zein%') desc, a.name limit 1;
  insert into la_live(step, expected, actual, ok) values ('grant holder', 'an active non-manager with the grant', coalesce(z.name, 'none'), z.id is not null);
  select count(*) into total from public.leads;
  select count(*) into att from public.lead_attempts;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', z.user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', z.user_id::text, true);
  execute 'set local role authenticated'; select count(*) into before_seen from public.leads; execute 'reset role';
  insert into la_live(step, expected, actual, ok) values ('before (current policies)', 'her view today', before_seen || ' of ' || total, true);
end $$;
-- >>> apply supabase/migrations/20261125150000_leads_archive_grant_all.sql here (without its own begin / commit) if not applied yet <<<
do $$
declare z record; cs record; total int; seen int; att int; att_seen int; lid uuid; st text; n int; err text; assigned int;
begin
  select a.id, a.user_id, a.name into z from public.admins a
   where a.active and a.user_id is not null and a.has_leads_archive_access is true and a.role not in ('super_admin', 'general_manager', 'reception')
     and not exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('super_admin', 'general_manager', 'reception'))
   order by (a.name ilike '%زين%' or a.name ilike '%zein%') desc, a.name limit 1;
  select count(*) into total from public.leads;
  select count(*) into att from public.lead_attempts;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', z.user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', z.user_id::text, true);
  execute 'set local role authenticated';
  select count(*) into seen from public.leads; select count(*) into att_seen from public.lead_attempts;
  execute 'reset role';
  insert into la_live(step, expected, actual, ok) values ('after: her leads (archive list)', 'all leads', seen || ' of ' || total, seen = total);
  insert into la_live(step, expected, actual, ok) values ('after: her lead attempts', 'all attempts', att_seen || ' of ' || att, att_seen = att);
  -- a «new» lead not assigned to her → «in_progress»
  select l.id into lid from public.leads l where l.current_status = 'new' and l.assigned_to is distinct from z.id order by l.created_at desc limit 1;
  begin
    execute 'set local role authenticated';
    update public.leads set current_status = 'in_progress' where id = lid; get diagnostics n = row_count;
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; n := 0; end;
  select current_status into st from public.leads where id = lid;
  insert into la_live(step, expected, actual, ok) values ('her status update (RLS) on a lead not assigned to her', '1 row · in_progress', err || ' · ' || n || ' · ' || coalesce(st, '?'), n = 1 and st = 'in_progress');
  -- the edge path (leads-update-status → rpc_update_lead as her, service role)
  begin
    perform public.rpc_update_lead(lid, z.id, 'no_response', null, false, null, null, null, now(), false); err := 'ok';
  exception when others then err := sqlerrm; end;
  select current_status into st from public.leads where id = lid;
  insert into la_live(step, expected, actual, ok) values ('edge path rpc_update_lead as her', 'no_response', err || ' · ' || coalesce(st, '?'), st = 'no_response');
  select count(*) into n from public.lead_status_log s where s.lead_id = lid and s.changed_at >= now() - interval '1 minute';
  insert into la_live(step, expected, actual, ok) values ('status log rows for that lead', '≥ 1 (trigger)', n::text, n >= 1);
  -- plain customer service without the grant (if any): still assigned-only
  select a.id, a.user_id, a.name into cs from public.admins a
   where a.active and a.user_id is not null and a.has_leads_archive_access is not true and a.role not in ('super_admin', 'general_manager', 'reception')
     and (a.role = 'customer_service' or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role = 'customer_service'))
     and not exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('super_admin', 'general_manager', 'reception')) limit 1;
  if cs.id is null then
    insert into la_live(step, expected, actual, ok) values ('plain customer service (no grant)', 'none on live — skipped', 'none', true);
  else
    select count(*) into assigned from public.leads where assigned_to = cs.id;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', cs.user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', cs.user_id::text, true);
    execute 'set local role authenticated'; select count(*) into seen from public.leads; execute 'reset role';
    insert into la_live(step, expected, actual, ok) values ('plain customer service (no grant)', 'no more than before (not all)', cs.name || ': ' || seen || ' (assigned ' || assigned || ')', seen < total or total = assigned);
  end if;
end $$;
select step, expected, actual, ok from la_live order by n;
rollback;
