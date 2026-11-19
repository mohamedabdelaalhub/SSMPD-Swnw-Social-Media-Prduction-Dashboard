-- Training center PR 1: permissions and validation. Synthetic users and a synthetic 2-competency bank only;
-- everything is rolled back. Run on live inside the main chat's BEGIN…ROLLBACK dry-run.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_tr uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  a_owner uuid; a_rev uuid; a_tr uuid; a_other uuid;
  bank jsonb := '{"version":"TEST-BANK","duration_minutes":40,"questions_per_attempt":2,
    "competencies":[{"code":"TA","name_ar":"اختبار أ","questions_per_attempt":1},{"code":"TB","name_ar":"اختبار ب","questions_per_attempt":1}],
    "questions":[
      {"id":"tq1","competency":"TA","text":"س1","options":[{"id":"a","text":"x","points":2,"critical_flag":false},{"id":"b","text":"y","points":0,"critical_flag":true}]},
      {"id":"tq2","competency":"TB","text":"س2","options":[{"id":"a","text":"x","points":1,"critical_flag":false},{"id":"b","text":"y","points":2,"critical_flag":false}]}]}';
  r jsonb; v_id uuid; ok boolean;
begin
  if exists (select 1 from training.bank_meta) then
    raise notice 'a real bank is loaded; this test re-imports a synthetic one inside the rolled-back transaction';
  end if;
  insert into auth.users (id) values (u_owner), (u_rev), (u_tr), (u_other);
  insert into public.admins (user_id, email, name, role) values
    (u_owner, 'owner@training.test', 'TEST owner', 'super_admin'),
    (u_rev,   'rev@training.test',   'TEST reviewer', 'reception'),
    (u_tr,    'tr@training.test',    'TEST trainee', 'reception'),
    (u_other, 'other@training.test', 'TEST other', 'reception');
  select id into a_owner from public.admins where user_id = u_owner;
  select id into a_rev from public.admins where user_id = u_rev;
  select id into a_tr from public.admins where user_id = u_tr;
  select id into a_other from public.admins where user_id = u_other;

  -- direct table access is closed for authenticated users
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  begin
    perform 1 from training.question_options limit 1;
    raise exception 'FAIL: direct read of the answer key was allowed';
  exception when insufficient_privilege then null;
  end;

  -- owner: import validation
  begin
    perform public.training_import_bank(jsonb_set(bank, '{questions_per_attempt}', '3'));
    raise exception 'FAIL: quota mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
  r := public.training_import_bank(bank);
  if (r->>'questions')::int <> 2 or r ? 'questions_detail' or r::text like '%points%' then
    raise exception 'FAIL: import result %', r;
  end if;
  r := public.training_bank_summary();
  if r::text like '%critical%' or r::text like '%"points"%' or jsonb_array_length(r->'competencies') < 2 then
    raise exception 'FAIL: summary leaks key or is incomplete: %', r;
  end if;

  -- owner: assignment rules (no self review)
  begin
    perform public.training_assign('branch_manager', a_tr, a_tr, null, null);
    raise exception 'FAIL: self review accepted';
  exception when invalid_parameter_value then null;
  end;
  v_id := public.training_assign('branch_manager', a_tr, a_rev, now() + interval '7 days', 'ملاحظة المالك');

  -- trainee: sees own assignment, no owner note, cannot assign or import
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  r := public.training_assignments();
  if jsonb_array_length(r) <> 1 or r->0->>'relation' <> 'trainee' or r->0->>'note' is not null then
    raise exception 'FAIL: trainee view %', r;
  end if;
  begin
    perform public.training_assign('team_manager', a_other, a_rev, null, null);
    raise exception 'FAIL: trainee could assign';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.training_import_bank(bank);
    raise exception 'FAIL: trainee could import bank';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.training_bank_summary();
    raise exception 'FAIL: trainee could read bank summary';
  exception when insufficient_privilege then null;
  end;

  -- reviewer sees it as reviewer; an unrelated user sees nothing
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  r := public.training_assignments();
  if jsonb_array_length(r) <> 1 or r->0->>'relation' <> 'reviewer' then raise exception 'FAIL: reviewer view %', r; end if;
  perform set_config('request.jwt.claim.sub', u_other::text, true);
  if jsonb_array_length(public.training_assignments()) <> 0 then raise exception 'FAIL: unrelated user sees assignment'; end if;

  -- owner: cannot move the review onto the trainee; cancel needs a reason; audit trail written
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin
    perform public.training_update_assignment(v_id, a_tr, null, null);
    raise exception 'FAIL: reviewer changed to trainee';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.training_cancel_assignment(v_id, ' ');
    raise exception 'FAIL: cancel without reason';
  exception when invalid_parameter_value then null;
  end;
  perform public.training_cancel_assignment(v_id, 'اختبار');
  execute 'reset role';
  select count(*) = 3 into ok from training.audit_log where assignment_id = v_id or (assignment_id is null and details->>'version' = 'TEST-BANK');
  if not ok then raise exception 'FAIL: audit rows missing'; end if;
  raise notice 'training center schema rollback test passed';
end $$;
rollback;
