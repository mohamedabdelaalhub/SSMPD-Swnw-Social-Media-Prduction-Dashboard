-- «مراجعة كل المعلّق» (help 310): live rollback proof for the global approve-all button.
-- ONE transaction, ends in ROLLBACK, run as postgres. Creates 3 PENDING contracts for 2 existing doctors (far-future dates, no overlap), then:
--   1) the UI's ids source (clinic_finance_snapshot -> doctor_contracts, status pending, not own) returns exactly those 3 for the reviewer;
--   2) the creator reviewing its own contracts through contract_review_batch is refused;
--   3) a DIFFERENT reviewer approves all 3 in one contract_review_batch call -> all 3 become 'active'.
-- Prints counts only (no names, no ids).
begin;
do $$
declare a1 uuid; a2 uuid; a1_admin uuid; a2_admin uuid; ka text; kb text; na text; nb text;
  ref text := 'TEST-RB-' || gen_random_uuid()::text; ids uuid[] := '{}'; v uuid; refused boolean := false;
  seen_creator int; seen_reviewer int; active_n int; snap jsonb; d date := (now() at time zone 'Africa/Cairo')::date;
  base jsonb;
begin
  select user_id, id into a1, a1_admin from public.admins where role = 'super_admin' and active and user_id is not null order by id limit 1;
  select user_id, id into a2, a2_admin from public.admins where active and user_id is not null and user_id <> a1 and role in ('general_manager', 'super_admin') order by (role = 'general_manager') desc, id limit 1;
  if a1 is null or a2 is null then raise exception 'Two different existing manager accounts are required'; end if;
  select doctor_key, max(doctor_name) into ka, na from clinic_finance.doctor_contracts group by doctor_key order by doctor_key limit 1;
  select doctor_key, max(doctor_name) into kb, nb from clinic_finance.doctor_contracts where doctor_key <> ka group by doctor_key order by doctor_key limit 1;
  if ka is null or kb is null then raise exception 'Two existing doctors are required'; end if;
  base := jsonb_build_object('from', '2099-01-01', 'to', '2099-12-31', 'rate', 11, 'basis', 'performed', 'base_scope', 'service', 'deduction', 'none', 'refund_policy', 'proportional_revenue', 'reference', ref);

  -- creator: 3 pending contracts for 2 doctors
  perform set_config('request.jwt.claim.sub', a1::text, true); execute 'set local role authenticated';
  v := public.clinic_finance_doctor_command('contract', base || jsonb_build_object('doctor_key', ka, 'doctor_name', na, 'scope', ref || '-A1'), gen_random_uuid()); ids := ids || v;
  v := public.clinic_finance_doctor_command('contract', base || jsonb_build_object('doctor_key', ka, 'doctor_name', na, 'scope', ref || '-A2'), gen_random_uuid()); ids := ids || v;
  v := public.clinic_finance_doctor_command('contract', base || jsonb_build_object('doctor_key', kb, 'doctor_name', nb, 'scope', ref || '-B1'), gen_random_uuid()); ids := ids || v;
  if array_length(ids, 1) <> 3 then raise exception 'expected 3 contract ids, got %', array_length(ids, 1); end if;

  -- 2) the creator cannot review its own contracts (the batch is refused as a whole)
  begin
    perform public.clinic_finance_doctor_command('contract_review_batch', jsonb_build_object('ids', to_jsonb(ids), 'approve', true, 'note', 'اختبار مراجعة ذاتية'), gen_random_uuid());
  exception when others then refused := true;
  end;
  if not refused then raise exception 'creator was allowed to review its own contracts'; end if;
  -- the creator's own view must not offer them as reviewable: pending + created_by = me
  snap := public.clinic_finance_snapshot(d, d);
  if snap->>'me' is null then raise exception 'snapshot has no me (the UI compares created_by with it)'; end if;
  select count(*) into seen_creator from jsonb_array_elements(snap->'doctor_contracts') x
   where (x->>'id')::uuid = any(ids) and x->>'status' = 'pending' and x->>'created_by' <> coalesce(snap->>'me', '');
  if seen_creator <> 0 then raise exception 'creator sees % of its own contracts as reviewable', seen_creator; end if;

  -- 1) the reviewer's snapshot (the UI ids source) lists exactly those 3 as pending and reviewable
  perform set_config('request.jwt.claim.sub', a2::text, true);
  snap := public.clinic_finance_snapshot(d, d);
  select count(*) into seen_reviewer from jsonb_array_elements(snap->'doctor_contracts') x
   where (x->>'id')::uuid = any(ids) and x->>'status' = 'pending' and x->>'created_by' <> coalesce(snap->>'me', '');
  if seen_reviewer <> 3 then raise exception 'reviewer snapshot lists % of 3 pending contracts', seen_reviewer; end if;

  -- 3) one batch call approves all 3
  perform public.clinic_finance_doctor_command('contract_review_batch', jsonb_build_object('ids', to_jsonb(ids), 'approve', true, 'note', 'اختبار اعتماد الكل'), gen_random_uuid());
  execute 'reset role';
  select count(*) into active_n from clinic_finance.doctor_contracts where id = any(ids) and status = 'active';
  if active_n <> 3 then raise exception 'only % of 3 contracts became active', active_n; end if;
  raise notice 'review-batch live check: created=3 reviewer_sees=% creator_sees_reviewable=% creator_batch_refused=% activated=%', seen_reviewer, seen_creator, refused, active_n;
end $$;
rollback;
select jsonb_build_object('test', 'doctor contracts review-batch rollback passed',
  'remaining_test_contracts', (select count(*) from clinic_finance.doctor_contracts where reference like 'TEST-RB-%')) as result;
