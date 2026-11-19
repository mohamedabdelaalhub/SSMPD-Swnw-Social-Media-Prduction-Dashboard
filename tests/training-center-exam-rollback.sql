-- Training center PR 2: course gate, exam draw, no key exposure, resume, single attempt, deadline auto-submit.
-- Synthetic users and a synthetic 3-competency bank; everything is rolled back.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_tr uuid := gen_random_uuid();
  u_tr2 uuid := gen_random_uuid();
  a_rev uuid; a_tr uuid; a_tr2 uuid; asg uuid; asg2 uuid; p jsonb; p2 jsonb; q jsonb; m text; i int;
  bank jsonb := jsonb_build_object('version','TEST-BANK-2','duration_minutes',40,'questions_per_attempt',5,
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
    (u_owner,'owner2@training.test','TEST owner','super_admin'), (u_rev,'rev2@training.test','TEST reviewer','reception'),
    (u_tr,'tr2@training.test','TEST trainee','reception'), (u_tr2,'tr3@training.test','TEST trainee 2','reception');
  select id into a_rev from public.admins where user_id = u_rev;
  select id into a_tr from public.admins where user_id = u_tr;
  select id into a_tr2 from public.admins where user_id = u_tr2;

  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  perform public.training_import_bank(bank);
  asg := public.training_assign('branch_manager', a_tr, a_rev, null, null);
  asg2 := public.training_assign('team_manager', a_tr2, a_rev, null, null);

  -- trainee: exam is gated on the course
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  begin perform public.training_start_exam(asg); raise exception 'FAIL: exam before course';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_complete_module(asg2, 'm1'); raise exception 'FAIL: completed someone else''s module';
  exception when insufficient_privilege then null; end;
  for i in 1..8 loop perform public.training_complete_module(asg, 'm'||i); end loop;
  if (select count(*) from jsonb_object_keys((public.training_course_progress(asg))->'completed')) <> 8 then raise exception 'FAIL: progress'; end if;

  p := public.training_start_exam(asg);
  if (p->>'total')::int <> 5 or jsonb_array_length(p->'questions') <> 5 then raise exception 'FAIL: draw size %', p->>'total'; end if;
  if p::text like '%points%' or p::text like '%critical%' then raise exception 'FAIL: key leaked to trainee'; end if;
  -- fixed competency split
  execute 'reset role';
  if (select count(*) from jsonb_array_elements(p->'questions') x join training.questions qq on qq.id = x->>'id' where qq.competency = 'TA') <> 2
  then raise exception 'FAIL: competency quota'; end if;
  execute 'set local role authenticated';

  q := p->'questions'->0;
  perform public.training_save_answer(asg, q->>'id', q->'options'->0->>'id');
  perform public.training_save_answer(asg, q->>'id', q->'options'->1->>'id');   -- change answer
  begin perform public.training_save_answer(asg, 'not-in-attempt', 'a'); raise exception 'FAIL: foreign question accepted';
  exception when invalid_parameter_value then null; end;
  perform public.training_record_blur(asg);

  -- resume returns the same questions and the saved answer
  p2 := public.training_start_exam(asg);
  if p2->'questions' <> p->'questions' or p2->'answers'->>(q->>'id') <> q->'options'->1->>'id' then
    raise exception 'FAIL: resume changed state';
  end if;

  -- reviewer cannot answer for the trainee
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  begin perform public.training_save_answer(asg, q->>'id', 'a'); raise exception 'FAIL: reviewer answered';
  exception when insufficient_privilege then null; end;

  -- manual submit closes the attempt; no second attempt, no more answers
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  p := public.training_submit_exam(asg);
  if p->>'status' <> 'submitted' or p->'questions' <> 'null'::jsonb or (p->>'auto_submitted')::boolean then
    raise exception 'FAIL: submit state %', p;
  end if;
  begin perform public.training_save_answer(asg, q->>'id', 'a'); raise exception 'FAIL: answer after submit';
  exception when invalid_parameter_value then null; end;
  if (public.training_start_exam(asg))->>'status' <> 'submitted' then raise exception 'FAIL: second attempt'; end if;

  -- deadline: trainee 2 starts, the clock runs out, the list auto-submits
  perform set_config('request.jwt.claim.sub', u_tr2::text, true);
  for i in 1..8 loop perform public.training_complete_module(asg2, 'm'||i); end loop;
  perform public.training_start_exam(asg2);
  execute 'reset role';
  update training.attempts set started_at = now() - interval '41 minutes', deadline_at = now() - interval '1 minute'
   where assignment_id = asg2;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  p := (select x from jsonb_array_elements(public.training_assignments()) x where x->>'id' = asg2::text);
  if p->>'status' <> 'submitted' or not (p->>'exam_auto_submitted')::boolean then raise exception 'FAIL: auto submit %', p; end if;
  execute 'reset role';
  if (select blur_count from training.attempts where assignment_id = asg) <> 1 then raise exception 'FAIL: blur'; end if;
  raise notice 'training center exam rollback test passed';
end $$;
rollback;
