-- Training center PR 3: server grading (strong / medium / weak, risk flags, per competency) and result access.
-- Synthetic users and a synthetic 3-competency bank; everything is rolled back.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_tr uuid := gen_random_uuid();
  u_tr2 uuid := gen_random_uuid();
  a_rev uuid; a_tr uuid; a_tr2 uuid; asg uuid; asg2 uuid; p jsonb; p2 jsonb; q jsonb; m text; i int;
  bank jsonb := jsonb_build_object('version','TEST-BANK-3','duration_minutes',40,'questions_per_attempt',5,
    'competencies', jsonb_build_array(
      jsonb_build_object('code','TA','name_ar','أ','questions_per_attempt',2),
      jsonb_build_object('code','TB','name_ar','ب','questions_per_attempt',2),
      jsonb_build_object('code','TC','name_ar','ج','questions_per_attempt',1)),
    'questions', (select jsonb_agg(jsonb_build_object('id','tq'||g,'competency',(array['TA','TB','TC'])[1+(g%3)],'text','س'||g,
       'options', jsonb_build_array(
         jsonb_build_object('id','a','text','x','points',2,'critical_flag',false),
         jsonb_build_object('id','b','text','y','points',1,'critical_flag',false),
         jsonb_build_object('id','c','text','z','points',0,'critical_flag',true),
         jsonb_build_object('id','d','text','w','points',0,'critical_flag',false))))
       from generate_series(1,12) g));
begin
  insert into auth.users (id) values (u_owner), (u_rev), (u_tr), (u_tr2);
  insert into public.admins (user_id, email, name, role) values
    (u_owner,'owner3@training.test','TEST owner','super_admin'), (u_rev,'rev3@training.test','TEST reviewer','reception'),
    (u_tr,'tr4@training.test','TEST trainee','reception'), (u_tr2,'tr5@training.test','TEST trainee 2','reception');
  select id into a_rev from public.admins where user_id = u_rev;
  select id into a_tr from public.admins where user_id = u_tr;
  select id into a_tr2 from public.admins where user_id = u_tr2;

  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  perform public.training_import_bank(bank);
  asg := public.training_assign('branch_manager', a_tr, a_rev, null, null);
  asg2 := public.training_assign('team_manager', a_tr2, a_rev, null, null);

  -- trainee 1: all best answers → 100 %, strong
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  for i in 1..8 loop perform public.training_complete_module(asg, 'm'||i); end loop;
  p := public.training_start_exam(asg);
  for q in select * from jsonb_array_elements(p->'questions') loop perform public.training_save_answer(asg, q->>'id', 'a'); end loop;
  p := public.training_submit_exam(asg);
  if p::text like '%percent%' or p::text like '%grade%' then raise exception 'FAIL: trainee sees score'; end if;
  begin perform public.training_exam_result(asg); raise exception 'FAIL: trainee read own result';
  exception when insufficient_privilege then null; end;
  if (select x->>'exam_grade' from jsonb_array_elements(public.training_assignments()) x where x->>'id' = asg::text) is not null then
    raise exception 'FAIL: trainee list shows grade'; end if;

  -- trainee 2: 3 best (6) + 1 partial (1) + 1 critical (0) = 7/10 = 70 %, one risk flag → medium
  perform set_config('request.jwt.claim.sub', u_tr2::text, true);
  for i in 1..8 loop perform public.training_complete_module(asg2, 'm'||i); end loop;
  p := public.training_start_exam(asg2);
  for i in 0..4 loop
    perform public.training_save_answer(asg2, p->'questions'->i->>'id', (array['a','a','a','b','c'])[i+1]);
  end loop;
  perform public.training_submit_exam(asg2);

  -- reviewer reads both; result carries drawn questions only, choice vs best
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  p := public.training_exam_result(asg);
  if p->>'grade' <> 'strong' or (p->>'percent')::numeric <> 100 or (p->>'risk_flags')::int <> 0 then raise exception 'FAIL: strong case %', p; end if;
  if jsonb_array_length(p->'questions') <> 5 or jsonb_array_length(p->'by_competency') <> 3 then raise exception 'FAIL: result shape'; end if;
  p2 := public.training_exam_result(asg2);
  if p2->>'grade' <> 'medium' or (p2->>'percent')::numeric <> 70 or (p2->>'risk_flags')::int <> 1 then raise exception 'FAIL: medium case %', p2; end if;
  if p2->'questions'->4->'chosen'->>'critical' <> 'true' or p2->'questions'->4->'best'->>0 <> 'x' then raise exception 'FAIL: detail row'; end if;
  if (select x->>'exam_grade' from jsonb_array_elements(public.training_assignments()) x where x->>'id' = asg2::text) <> 'medium' then
    raise exception 'FAIL: reviewer list grade'; end if;

  -- weak: re-grade trainee 2 with 2 critical choices (still 60 %+ would need ≤ 1 flag)
  execute 'reset role';
  update training.attempt_answers set option_id = 'c'
   where attempt_id = (select id from training.attempts where assignment_id = asg2)
     and question_id = (select question_ids[1] from training.attempts where assignment_id = asg2);
  perform training.grade_attempt((select id from training.attempts where assignment_id = asg2));
  if (select grade from training.attempt_results r join training.attempts t on t.id = r.attempt_id where t.assignment_id = asg2) <> 'weak' then
    raise exception 'FAIL: weak case'; end if;

  -- an unrelated user cannot read results
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  if public.training_exam_result(asg)->>'grade' <> 'strong' then raise exception 'FAIL: owner read'; end if;
  raise notice 'training center grading rollback test passed';
end $$;
rollback;
