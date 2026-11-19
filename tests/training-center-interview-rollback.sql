-- Training center PR 5: interview sheet access, scoring rules and the 40/40/20 decision (ready / after training / not ready).
-- Synthetic users and a synthetic 3-competency bank; everything is rolled back.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_tr uuid := gen_random_uuid();
  u_tr2 uuid := gen_random_uuid();
  a_rev uuid; a_tr uuid; a_tr2 uuid; asg uuid; asg2 uuid; p jsonb; p2 jsonb; q jsonb; m text; i int; d jsonb;
  iv jsonb := '{"version":"TEST-IV","questions":[{"id":"iq1","competency_code":"TA","text":"س"},{"id":"iq2","competency_code":"TB","text":"س"}],"roleplays":[{"id":"rp1","competency_code":"TC","title":"ت","checklist":["أ","ب"]}]}';
  bank jsonb := jsonb_build_object('version','TEST-BANK-5','duration_minutes',40,'questions_per_attempt',5,
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
    (u_owner,'owner5@training.test','TEST owner','super_admin'), (u_rev,'rev5@training.test','TEST reviewer','reception'),
    (u_tr,'tr6@training.test','TEST trainee','reception'), (u_tr2,'tr7@training.test','TEST trainee 2','reception');
  select id into a_rev from public.admins where user_id = u_rev;
  select id into a_tr from public.admins where user_id = u_tr;
  select id into a_tr2 from public.admins where user_id = u_tr2;

  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  perform public.training_import_bank(bank);
  asg := public.training_assign('branch_manager', a_tr, a_rev, null, null);
  asg2 := public.training_assign('team_manager', a_tr2, a_rev, null, null);

  perform public.training_import_interview(iv);
  -- both trainees: course + exam. Trainee 1 all best (100 %), trainee 2: 3 best, 2 critical (6/10 = 60 %, 2 flags)
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  for i in 1..8 loop perform public.training_complete_module(asg, 'm'||i); end loop;
  p := public.training_start_exam(asg);
  for q in select * from jsonb_array_elements(p->'questions') loop perform public.training_save_answer(asg, q->>'id', 'a'); end loop;
  perform public.training_submit_exam(asg);
  begin perform public.training_interview_sheet(asg); raise exception 'FAIL: trainee read interview sheet';
  exception when insufficient_privilege then null; end;
  begin perform public.training_save_interview_score(asg, 'question', 'iq1', 5, null, false, '[]'); raise exception 'FAIL: trainee scored self';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_tr2::text, true);
  for i in 1..8 loop perform public.training_complete_module(asg2, 'm'||i); end loop;
  p := public.training_start_exam(asg2);
  for i in 0..4 loop perform public.training_save_answer(asg2, p->'questions'->i->>'id', (array['a','a','a','c','c'])[i+1]); end loop;
  perform public.training_submit_exam(asg2);

  -- reviewer scores trainee 1: interview 5,5 role-play 5 → 100 → ready
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  p := public.training_interview_sheet(asg);
  if p->'content'->>'version' <> 'TEST-IV' or (p->>'can_score')::boolean is not true then raise exception 'FAIL: sheet %', p; end if;
  begin perform public.training_save_interview_score(asg, 'question', 'nope', 3, null, false, '[]'); raise exception 'FAIL: unknown item';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_save_interview_score(asg, 'question', 'iq1', 6, null, false, '[]'); raise exception 'FAIL: score 6';
  exception when invalid_parameter_value then null; end;
  perform public.training_save_interview_score(asg, 'question', 'iq1', 5, 'جيد', false, '[]');
  perform public.training_save_interview_score(asg, 'question', 'iq2', 5, null, false, '[]');
  d := public.training_save_interview_score(asg, 'roleplay', 'rp1', 5, null, false, '[0,1]');
  if not (d->>'complete')::boolean or (d->>'result')::numeric <> 100 or d->>'suggested' <> 'ready' then raise exception 'FAIL: ready %', d; end if;
  -- trainee 2: interview 5,5 role-play 5 → 60*0.4+40+20 = 84 but 2 exam risk flags → ready_after_training
  perform public.training_save_interview_score(asg2, 'question', 'iq1', 5, null, false, '[]');
  perform public.training_save_interview_score(asg2, 'question', 'iq2', 5, null, false, '[]');
  d := public.training_save_interview_score(asg2, 'roleplay', 'rp1', 5, null, false, '[]');
  if (d->>'result')::numeric <> 84 or d->>'suggested' <> 'ready_after_training' then raise exception 'FAIL: after training %', d; end if;
  if not exists (select 1 from jsonb_array_elements(d->'weaknesses') w where (w->>'exam_percent')::numeric < 60) then raise exception 'FAIL: weakness %', d->'weaknesses'; end if;
  -- reviewer cannot decide
  begin perform public.training_decide(asg, 'ready', null, null); raise exception 'FAIL: reviewer decided';
  exception when insufficient_privilege then null; end;
  -- a blocking flag locks «not ready»
  d := public.training_save_interview_score(asg, 'roleplay', 'rp1', 5, 'تستر', true, '[]');
  if d->>'suggested' <> 'not_ready' then raise exception 'FAIL: blocking %', d; end if;

  -- owner decides: override needs a reason; decided closes scoring
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_decide(asg, 'ready', ' ', null); raise exception 'FAIL: override without reason';
  exception when invalid_parameter_value then null; end;
  d := public.training_decide(asg, 'ready_after_training', 'راجعت الواقعة بنفسي', 'رسالة للمتدرب');
  if d->>'final' <> 'ready_after_training' or d->>'suggested' <> 'not_ready' then raise exception 'FAIL: decide %', d; end if;
  begin perform public.training_save_interview_score(asg, 'question', 'iq1', 1, null, false, '[]'); raise exception 'FAIL: scored after decision';
  exception when invalid_parameter_value then null; end;
  perform public.training_decide(asg2, 'ready_after_training', null, null);
  execute 'reset role';
  if (select status from training.assignments where id = asg2) <> 'decided' then raise exception 'FAIL: status'; end if;
  raise notice 'training center interview/decision rollback test passed';
end $$;
rollback;
