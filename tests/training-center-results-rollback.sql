-- Training center PR 6: trainee result (no numbers), review requests, candidate view-once result link, final report.
-- Synthetic users/candidates; a decision row is inserted directly (the decision flow itself is PR 5's test). Rolled back.
begin;
do $$
declare
  u_owner uuid := gen_random_uuid(); u_rev uuid := gen_random_uuid(); u_tr uuid := gen_random_uuid(); u_tr2 uuid := gen_random_uuid();
  a_owner uuid; a_rev uuid; a_tr uuid; asg uuid; asg_c uuid; asg_open uuid; r jsonb; tok text; cand jsonb;
begin
  insert into auth.users (id) values (u_owner), (u_rev), (u_tr), (u_tr2);
  insert into public.admins (user_id, email, name, role) values
    (u_owner,'o6@training.test','TEST owner','super_admin'), (u_rev,'r6@training.test','TEST reviewer','reception'),
    (u_tr,'t6@training.test','TEST trainee','reception'), (u_tr2,'t7@training.test','TEST trainee 2','reception');
  select id into a_owner from public.admins where user_id = u_owner;
  select id into a_rev from public.admins where user_id = u_rev;
  select id into a_tr from public.admins where user_id = u_tr;

  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  execute 'set local role authenticated';
  asg := public.training_assign('branch_manager', a_tr, a_rev, null, null);
  asg_open := public.training_assign('team_manager', a_tr, a_rev, null, null);
  cand := public.training_invite_candidate('مرشح ٦','01077777777',null,'branch_manager',a_rev,7);
  asg_c := (cand->>'assignment_id')::uuid;

  -- before a decision
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  r := public.training_my_result(asg);
  if (r->>'decided')::boolean then raise exception 'FAIL: result before decision'; end if;
  begin perform public.training_request_result_review(asg, 'سبب'); raise exception 'FAIL: review before decision';
  exception when invalid_parameter_value then null; end;

  -- decisions (direct insert, as the migration owner)
  execute 'reset role';
  insert into training.decisions (assignment_id, computed, suggested, final, override_reason, message, decided_by)
  values (asg, jsonb_build_object('result', 71.5, 'exam_percent', 66, 'interview_avg', 3.9, 'blocking_flags', 1,
            'weaknesses', jsonb_build_array(jsonb_build_object('code','OPS','name_ar','التشغيل','oral_avg',3.1,'exam_percent',40))),
          'ready_after_training', 'ready_after_training', null, 'رسالة للمتدرب', a_owner),
         (asg_c, jsonb_build_object('result', 85), 'ready', 'ready', null, 'رسالة للمرشح', a_owner);
  update training.assignments set status = 'decided' where id in (asg, asg_c);

  -- trainee: label + learning areas + message; never a number or flag
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  r := public.training_my_result(asg);
  if r->>'label' <> 'جاهز بعد تدريب' or r->>'message' <> 'رسالة للمتدرب' or r->'learning_areas'->>0 <> 'التشغيل' then raise exception 'FAIL: trainee result %', r; end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in ('decided','decision','label','message','decided_at','learning_areas','review'))
     or r::text ~ '(71\.5|3\.9|3\.1)' or r::text ~ '"(result|percent|exam_percent|blocking_flags|risk_flags|oral_avg)"' then raise exception 'FAIL: number/flag leaked to trainee: %', r; end if;
  perform set_config('request.jwt.claim.sub', u_tr2::text, true);
  begin perform public.training_my_result(asg); raise exception 'FAIL: other user read result';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  begin perform public.training_my_result(asg); raise exception 'FAIL: reviewer read trainee result via my_result';
  exception when insufficient_privilege then null; end;

  -- review request: once, with a reason; owner list/close
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  begin perform public.training_request_result_review(asg, ' '); raise exception 'FAIL: empty reason';
  exception when invalid_parameter_value then null; end;
  perform public.training_request_result_review(asg, 'أرى أن تقدير التشغيل منخفض');
  begin perform public.training_request_result_review(asg, 'مرة ثانية'); raise exception 'FAIL: second request';
  exception when invalid_parameter_value then null; end;
  if public.training_my_result(asg)->'review'->>'status' <> 'open' then raise exception 'FAIL: review status'; end if;
  begin perform public.training_result_reviews(); raise exception 'FAIL: trainee listed reviews';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  if jsonb_array_length(public.training_result_reviews()) <> 1 then raise exception 'FAIL: owner review list'; end if;
  begin perform public.training_close_result_review(asg, ''); raise exception 'FAIL: close without response';
  exception when invalid_parameter_value then null; end;
  perform public.training_close_result_review(asg, 'تمت المراجعة والقرار كما هو');
  perform set_config('request.jwt.claim.sub', u_tr::text, true);
  if public.training_my_result(asg)->'review'->>'response' <> 'تمت المراجعة والقرار كما هو' then raise exception 'FAIL: response not shown'; end if;

  -- candidate result link: owner only, decided + candidate only, view-once, reissue revokes the old one
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_issue_result_link(asg, 14); raise exception 'FAIL: link for a trainee assignment';
  exception when invalid_parameter_value then null; end;
  begin perform public.training_issue_result_link(asg_open, 14); raise exception 'FAIL: link without a decision';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  begin perform public.training_issue_result_link(asg_c, 14); raise exception 'FAIL: reviewer issued link';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_issue_result_link(asg_c, 14); tok := r->>'token';
  begin perform public.training_candidate_result(tok); raise exception 'FAIL: authenticated can call public result RPC';
  exception when insufficient_privilege then null; end;
  execute 'reset role'; execute 'set local role service_role';
  begin perform public.training_candidate_result('x' || tok); raise exception 'FAIL: bad token';
  exception when invalid_parameter_value then null; end;
  r := public.training_candidate_result(tok);
  if r->>'label' <> 'جاهز' or r->>'message' <> 'رسالة للمرشح' or r->>'name' <> 'مرشح ٦' then raise exception 'FAIL: candidate result %', r; end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in ('name','label','message','decided_at')) then raise exception 'FAIL: extra data to candidate: %', r; end if;
  begin perform public.training_candidate_result(tok); raise exception 'FAIL: second view';
  exception when invalid_parameter_value then null; end;
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_issue_result_link(asg_c, 14);           -- reissue after viewing
  execute 'reset role'; execute 'set local role service_role';
  perform public.training_candidate_result(r->>'token');       -- the new one works once
  execute 'reset role';
  if (select count(*) from training.result_links where assignment_id = asg_c and revoked_at is not null) <> 1 then raise exception 'FAIL: old link not revoked'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_issue_result_link(asg_c, 1);
  execute 'reset role'; update training.result_links set expires_at = now() - interval '1 minute' where assignment_id = asg_c and viewed_at is null and revoked_at is null;
  execute 'set local role service_role';
  begin perform public.training_candidate_result(r->>'token'); raise exception 'FAIL: expired result link';
  exception when invalid_parameter_value then null; end;

  -- final report: owner only; both subjects
  execute 'reset role'; execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u_rev::text, true);
  begin perform public.training_final_report(asg); raise exception 'FAIL: reviewer read final report';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  r := public.training_final_report(asg);
  if r->>'subject_kind' <> 'trainee' or r->'decision'->>'label' <> 'جاهز بعد تدريب' or (r->'decision'->'computed'->>'result')::numeric <> 71.5
     or r->'review'->>'status' <> 'closed' then raise exception 'FAIL: final report trainee %', r; end if;
  r := public.training_final_report(asg_c);
  if r->>'subject_kind' <> 'candidate' or r->>'subject_name' <> 'مرشح ٦' then raise exception 'FAIL: final report candidate'; end if;

  raise notice 'PASS training results and report';
end $$;
rollback;
