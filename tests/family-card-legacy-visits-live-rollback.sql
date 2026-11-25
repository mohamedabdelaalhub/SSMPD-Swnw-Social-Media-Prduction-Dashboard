-- Live rollback test for 20261125140000_family_card_legacy_visits.sql (rule 9). ONE transaction ending in ROLLBACK, as postgres;
-- paste the migration body at the marked spot if it is not applied. Nothing is kept.
-- Mazen (reception) enters 7 old-system family-card visits on a real live patient → pending (not counted); Mazen cannot approve and
-- sees no approvals; another active super admin / financial manager approves → counted (family_visits + 7, percent follows the
-- cycle); Mazen changes it to 3 → pending again while 7 stays in force; the approver rejects with a reason. Audit rows checked.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block (also when the file is sent as one query
-- without «begin;»), and then nothing in this file runs and nothing is kept
savepoint fl_live_guard;
select set_config('fl_live.in_txn', 'yes', true);
-- >>> apply supabase/migrations/20261125140000_family_card_legacy_visits.sql here (without its own begin / commit) if not applied yet <<<
create temp table fl_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; appr uuid; appr_name text; ws uuid; pid uuid; base int; r jsonb; req uuid; err text;
  procedure_as constant text := 'set local role authenticated';
begin
  if current_setting('fl_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction';
  end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  insert into fl_live(step, expected, actual, ok) values ('migration applied', 'family_legacy_visits exists',
    coalesce(to_regclass('clinic_reception.family_legacy_visits')::text, 'missing'), to_regclass('clinic_reception.family_legacy_visits') is not null);
  -- a real live patient with a recent appointment
  select a.patient_id into pid from clinic_reception.appointments a where a.workspace_id = ws order by a.starts_at desc limit 1;
  base := clinic_reception.family_visits(pid, null);
  insert into fl_live(step, expected, actual, ok) values ('fixture patient', 'a live patient', coalesce(pid::text, 'none') || ' · family visits now ' || coalesce(base::text, '?'), pid is not null);
  select a.user_id, coalesce(nullif(btrim(to_jsonb(a)->>'name'), ''), to_jsonb(a)->>'email') into appr, appr_name from public.admins a
   where a.active and a.user_id is not null and a.user_id <> mazen and a.role in ('financial_manager', 'super_admin') order by (a.role = 'financial_manager') desc limit 1;
  insert into fl_live(step, expected, actual, ok) values ('approver', 'another super admin / FM', coalesce(appr_name, 'none'), appr is not null);

  -- 1) Mazen enters 7
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin execute procedure_as;
    r := public.clinic_reception_family_legacy(ws, 'status', jsonb_build_object('patient_id', pid)); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  insert into fl_live(step, expected, actual, ok) values ('Mazen status', 'can_request true · 0 old', err || ' · ' || coalesce(r->>'can_request', '?') || ' · ' || coalesce(r->>'legacy_visits', '?'),
    (r->>'can_request')::boolean and (r->>'legacy_visits')::int = 0);
  begin execute procedure_as;
    r := public.clinic_reception_family_legacy(ws, 'request', jsonb_build_object('patient_id', pid, 'visits', '7', 'reason', 'تجربة تراجع — كارت قديم', 'proof_note', 'تجربة تراجع — دفتر الاستقبال'));
    execute 'reset role'; err := 'ok'; req := (r->'entries'->0->>'id')::uuid;
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  insert into fl_live(step, expected, actual, ok) values ('Mazen «ابعت للاعتماد» (request 7)', 'pending · not counted', err || ' · ' || coalesce(r->'entries'->0->>'status', '?') || ' · used ' || coalesce(r->>'used', '?'),
    r->'entries'->0->>'status' = 'pending' and (r->>'used')::int = base);
  begin execute procedure_as; r := public.clinic_reception_family_legacy_pending(); execute 'reset role';
  exception when others then execute 'reset role'; r := jsonb_build_object('error', sqlerrm); end;
  insert into fl_live(step, expected, actual, ok) values ('Mazen approvals card', 'can_review false (card hidden)', r::text, r->>'can_review' = 'false');
  begin execute procedure_as; perform public.clinic_reception_family_legacy_review(req, true, null); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into fl_live(step, expected, actual, ok) values ('Mazen approves', 'refused', err, err <> 'accepted');

  -- 2) the approver
  perform set_config('request.jwt.claims', jsonb_build_object('sub', appr, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', appr::text, true);
  begin execute procedure_as; r := public.clinic_reception_family_legacy_pending(); execute 'reset role';
  exception when others then execute 'reset role'; r := jsonb_build_object('error', sqlerrm); end;
  insert into fl_live(step, expected, actual, ok) values ('approver card', 'can_review · the request is listed', coalesce(r->>'can_review', r->>'error'),
    (r->>'can_review')::boolean and exists (select 1 from jsonb_array_elements(r->'pending') x where (x->>'id')::uuid = req));
  begin execute procedure_as; r := public.clinic_reception_family_legacy_review(req, true, null); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  insert into fl_live(step, expected, actual, ok) values ('approver «اعتمد»', 'approved · used base+7 · percent of the cycle',
    err || ' · ' || coalesce(r->>'status', '?') || ' · used ' || coalesce(r->>'used', '?') || ' · ' || coalesce(r->>'next_percent', '?') || '%',
    r->>'status' = 'approved' and (r->>'used')::int = base + 7 and (r->>'next_percent')::numeric = clinic_reception.family_percent(base + 7));

  -- 3) Mazen changes it to 3 → pending again, 7 still in force; the approver rejects
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin execute procedure_as;
    r := public.clinic_reception_family_legacy(ws, 'request', jsonb_build_object('patient_id', pid, 'visits', '3', 'reason', 'تجربة تراجع — تعديل', 'proof_note', 'تجربة تراجع — دفتر الاستقبال'));
    execute 'reset role'; err := 'ok'; select (x->>'id')::uuid into req from jsonb_array_elements(r->'entries') x where x->>'status' = 'pending';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  insert into fl_live(step, expected, actual, ok) values ('Mazen «تعديل الزيارات السابقة» (3)', 'pending · 7 still counted', err || ' · ' || coalesce((select x->>'status' || ' ' || (x->>'visits') from jsonb_array_elements(r->'entries') x where (x->>'id')::uuid = req), '?') || ' · old ' || coalesce(r->>'legacy_visits', '?'),
    req is not null and (r->>'legacy_visits')::int = 7);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', appr, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', appr::text, true);
  begin execute procedure_as; r := public.clinic_reception_family_legacy_review(req, false, 'تجربة تراجع — رفض'); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; r := null; end;
  insert into fl_live(step, expected, actual, ok) values ('approver «ارفض (بسبب)»', 'rejected · still base+7', err || ' · ' || coalesce(r->>'status', '?') || ' · used ' || clinic_reception.family_visits(pid, null),
    r->>'status' = 'rejected' and clinic_reception.family_visits(pid, null) = base + 7);
  insert into fl_live(step, expected, actual, ok) select 'audit', 'request 2 · approve 1 · reject 1',
    string_agg(action || ' ' || n, ' · ' order by action), string_agg(action || ' ' || n, ' · ' order by action) = 'family_legacy_approve 1 · family_legacy_reject 1 · family_legacy_request 2'
    from (select action, count(*) n from clinic_reception.audit where action like 'family_legacy_%' and (detail->>'patient_id')::uuid = pid group by action) x;
end $$;
select step, expected, actual, ok from fl_live order by n;
rollback;
