-- Training center PR 4: candidate one-time link. Synthetic users, candidates and a synthetic bank; everything is rolled back.
-- Covers: owner-only invite, token stored hashed, first-device binding, consent→profile→exam without the course,
-- no key/score to the candidate, submit closes the link, expiry/revoke, trainee entry points closed to candidate
-- assignments, returning-applicant badge, deletion on request (minimal record), service_role-only public RPCs.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  a_rev uuid; r jsonb; r2 jsonb; tok text; tok2 text; asg uuid; asg2 uuid; cid uuid; q jsonb; dev text := 'device-aaaaaaaaaaaaaaaa'; dev2 text := 'device-bbbbbbbbbbbbbbbb';
  bank jsonb := jsonb_build_object('version','TEST-BANK-4','duration_minutes',40,'questions_per_attempt',3,
    'competencies', jsonb_build_array(
      jsonb_build_object('code','TA','name_ar','أ','questions_per_attempt',2),
      jsonb_build_object('code','TB','name_ar','ب','questions_per_attempt',1)),
    'questions', (select jsonb_agg(jsonb_build_object('id','cq'||g,'competency',(array['TA','TB'])[1+(g%2)],'text','س'||g,
       'options', jsonb_build_array(
         jsonb_build_object('id','a','text','x','points',2,'critical_flag',false),
         jsonb_build_object('id','b','text','y','points',1,'critical_flag',false),
         jsonb_build_object('id','c','text','z','points',0,'critical_flag',true),
         jsonb_build_object('id','d','text','w','points',0,'critical_flag',false))))
       from generate_series(1,10) g));
begin
  insert into auth.users (id) values (u_owner), (u_rev), (u_other);
  insert into public.admins (user_id, email, name, role) values
    (u_owner,'owner4@training.test','TEST owner','super_admin'), (u_rev,'rev4@training.test','TEST reviewer','reception'),
    (u_other,'oth4@training.test','TEST other','reception');
  select id into a_rev from public.admins where user_id = u_rev;

  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  perform public.training_import_bank(bank);

  -- owner-only invite + validation
  perform set_config('request.jwt.claim.sub', u_other::text, true);
  begin perform public.training_invite_candidate('مرشح تجريبي','01012345678',null,'branch_manager',a_rev,7); raise exception 'FAIL: non-owner invited';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_invite_candidate('م','010',null,'branch_manager',a_rev,7); raise exception 'FAIL: short name';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_invite_candidate('مرشح تجريبي',null,null,'nope',a_rev,7); raise exception 'FAIL: bad track';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_invite_candidate('مرشح تجريبي',null,null,'branch_manager',a_rev,90); raise exception 'FAIL: validity cap';
  exception when invalid_parameter_value then null; end;

  r := public.training_invite_candidate('مرشح تجريبي','0101 234 5678','c@test.test','branch_manager',a_rev,7);
  tok := r->>'token'; asg := (r->>'assignment_id')::uuid; cid := (r->>'candidate_id')::uuid;
  if length(tok) < 60 or (r->>'returning_applicant')::boolean then raise exception 'FAIL: invite result'; end if;

  -- public RPCs are service_role only
  begin perform public.training_candidate_open(tok, dev); raise exception 'FAIL: authenticated can call public candidate RPC';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if exists (select 1 from training.candidate_invites where token_hash = tok) then raise exception 'FAIL: raw token stored'; end if;
  if not exists (select 1 from training.candidate_invites where token_hash = encode(sha256(convert_to(tok,'UTF8')),'hex')) then raise exception 'FAIL: hash'; end if;
  if (select candidate_id from training.assignments where id = asg) <> cid or (select trainee_admin_id from training.assignments where id = asg) is not null
  then raise exception 'FAIL: candidate assignment shape'; end if;

  execute 'set local role service_role';
  begin perform public.training_candidate_open('x'||tok, dev); raise exception 'FAIL: bad token accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_candidate_consent(tok, dev, 'v1'); raise exception 'FAIL: used before open';
  exception when invalid_parameter_value then null; end;
  r := public.training_candidate_open(tok, dev);
  if r->>'stage' <> 'consent' then raise exception 'FAIL: stage after open %', r->>'stage'; end if;
  begin perform public.training_candidate_open(tok, dev2); raise exception 'FAIL: second device accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.training_candidate_start(tok, dev); raise exception 'FAIL: exam before consent';
  exception when invalid_parameter_value then null; end;
  r := public.training_candidate_consent(tok, dev, 'draft-1');
  if r->>'stage' <> 'profile' then raise exception 'FAIL: stage after consent'; end if;
  begin perform public.training_candidate_profile(tok, dev, null, null, '', ''); raise exception 'FAIL: empty profile';
  exception when invalid_parameter_value then null; end;
  r := public.training_candidate_profile(tok, dev, null, 'c2@test.test', 'خبرة في إدارة الفرق', 'بكالوريوس');
  if r->>'stage' <> 'ready' then raise exception 'FAIL: stage after profile %', r->>'stage'; end if;

  -- exam without the course; no key in the payload; resume from the same device
  r := public.training_candidate_start(tok, dev);
  if r->>'stage' <> 'exam' or jsonb_array_length(r->'exam'->'questions') <> 3 then raise exception 'FAIL: draw'; end if;
  if r::text like '%points%' or r::text like '%critical%' or r::text like '%grade%' then raise exception 'FAIL: key/score leaked to candidate'; end if;
  q := r->'exam'->'questions'->0;
  perform public.training_candidate_save(tok, dev, q->>'id', q->'options'->0->>'id');
  perform public.training_candidate_save(tok, dev, q->>'id', q->'options'->1->>'id');
  begin perform public.training_candidate_save(tok, dev, 'not-in-attempt', 'a'); raise exception 'FAIL: foreign question';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_candidate_save(tok, dev2, q->>'id', 'a'); raise exception 'FAIL: other device saved';
  exception when insufficient_privilege then null; end;
  perform public.training_candidate_blur(tok, dev);
  r2 := public.training_candidate_start(tok, dev);
  if (r2->'exam'->>'answered')::int <> 1 or (r2->'exam'->'attempt_id') <> (r->'exam'->'attempt_id') then raise exception 'FAIL: resume'; end if;

  -- trainee entry points never open a candidate assignment
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  begin perform public.training_start_exam(asg); raise exception 'FAIL: reviewer opened candidate exam';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_start_exam(asg); raise exception 'FAIL: owner opened candidate exam as trainee';
  exception when insufficient_privilege then null; end;
  perform public.training_assignments();                       -- owner list still works with candidate rows present

  -- submit closes the link; nothing but «done» comes back
  execute 'reset role'; execute 'set local role service_role';
  r := public.training_candidate_submit(tok, dev);
  if r->>'stage' <> 'done' or r ? 'exam' and r->'exam' is not null and r->>'exam' <> '' and jsonb_typeof(r->'exam') <> 'null' then raise exception 'FAIL: submit state %', r; end if;
  if r::text like '%points%' or r::text like '%grade%' then raise exception 'FAIL: score at submit'; end if;
  r := public.training_candidate_open(tok, dev);
  if r->>'stage' <> 'done' then raise exception 'FAIL: reopen after submit'; end if;
  r := public.training_candidate_save(tok, dev, q->>'id', 'a');
  if (r->>'saved')::boolean then raise exception 'FAIL: saved after submit'; end if;
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_exam_result(asg);                        -- owner sees the candidate's graded result
  if r->>'status' <> 'submitted' or r->>'grade' is null then raise exception 'FAIL: owner result for candidate %', r; end if;
  perform set_config('request.jwt.claim.sub', u_other::text, true);
  begin perform public.training_exam_result(asg); raise exception 'FAIL: unrelated admin read candidate result';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select status from training.assignments where id = asg) <> 'submitted' or (select status from training.candidate_invites where assignment_id = asg) <> 'submitted'
  then raise exception 'FAIL: statuses after submit'; end if;

  -- expiry before first open; revoke; returning applicant
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_invite_candidate('مرشح تجريبي','+20 10 1234 5678',null,'team_manager',a_rev,1);
  if not (r->>'returning_applicant')::boolean then raise exception 'FAIL: returning applicant flag'; end if;
  tok2 := r->>'token'; asg2 := (r->>'assignment_id')::uuid;
  execute 'reset role';
  update training.candidate_invites set expires_at = now() - interval '1 minute' where assignment_id = asg2;
  execute 'set local role service_role';
  begin perform public.training_candidate_open(tok2, dev); raise exception 'FAIL: expired link opened';
  exception when invalid_parameter_value then null; end;
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_revoke_candidate_invite(asg2, 'x'); raise exception 'FAIL: short reason';
  exception when invalid_parameter_value then null; end;
  perform public.training_revoke_candidate_invite(asg2, 'تم الإلغاء');
  execute 'reset role'; execute 'set local role service_role';
  begin perform public.training_candidate_open(tok2, dev); raise exception 'FAIL: revoked link opened';
  exception when invalid_parameter_value then null; end;

  -- lists: owner sees both, reviewer sees theirs, an unrelated admin sees none; badge on both
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  if jsonb_array_length(public.training_candidates()) <> 2 then raise exception 'FAIL: owner list'; end if;
  if not (public.training_candidates()->0->>'returning_applicant')::boolean then raise exception 'FAIL: badge'; end if;
  perform set_config('request.jwt.claim.sub', u_other::text, true);
  if jsonb_array_length(public.training_candidates()) <> 0 then raise exception 'FAIL: other admin sees candidates'; end if;
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  if jsonb_array_length(public.training_candidates()) <> 2 or (public.training_candidates()->0) ? 'owner_notes' and (public.training_candidates()->0->>'owner_notes') is not null
  then raise exception 'FAIL: reviewer list'; end if;

  -- notes + deletion on request keep a minimal record
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  perform public.training_candidate_note(cid, 'ملاحظة');
  begin perform public.training_delete_candidate_data(cid, ''); raise exception 'FAIL: delete without reason';
  exception when invalid_parameter_value then null; end;
  perform public.training_delete_candidate_data(cid, 'طلب المرشح');
  execute 'reset role';
  if exists (select 1 from training.candidates where id = cid and (email is not null or experience is not null or owner_notes is not null))
     or not exists (select 1 from training.candidates where id = cid and minimal_after_purge and full_name is not null and phone is not null)
  then raise exception 'FAIL: minimal record'; end if;
  if not exists (select 1 from training.audit_log where action = 'candidate_data_deleted') then raise exception 'FAIL: audit'; end if;
  if training.purge_expired_candidates() <> 0 then raise exception 'FAIL: purge nothing due'; end if;
  update training.candidates set purge_after = now() - interval '1 day' where phone_normalized = '1012345678' and not minimal_after_purge;
  if training.purge_expired_candidates() <> 1 then raise exception 'FAIL: purge due'; end if;

  raise notice 'PASS training candidate link';
end $$;
rollback;
