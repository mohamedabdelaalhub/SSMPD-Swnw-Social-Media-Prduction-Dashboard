-- Training center: owner-only bank pages and job-bank import. Synthetic users and banks; everything rolled back.
begin;
do $$
declare u_owner uuid := gen_random_uuid(); u_x uuid := gen_random_uuid(); r jsonb;
  jb jsonb := '{"version":"TEST-JOBS","sources":[{"title":"t"}],"tracks":{"cleaning":{"name":"نظافة","description":"د"},"cashier":{"name":"خزنة"}},
   "questions":[{"id":"tj1","track":"cleaning","competency":"OPS","difficulty":"easy","question":"س","rationale":"ش",
      "options":[{"text":"a","points":2,"critical_flag":false},{"text":"b","points":1,"critical_flag":false},{"text":"c","points":0,"critical_flag":true},{"text":"d","points":0,"critical_flag":false}]},
     {"id":"tj2","track":"cashier","competency":"ETHICS","question":"س٢",
      "options":[{"id":"a","text":"a","points":0},{"id":"b","text":"b","points":2},{"id":"c","text":"c","points":1},{"id":"d","text":"d","points":0}]}],
   "lessons":{"cleaning":[{"id":"tl1","title":"درس","duration_minutes":4}]}}';
begin
  insert into auth.users (id) values (u_owner), (u_x);
  insert into public.admins (user_id, email, name, role) values (u_owner,'o9@training.test','TEST owner','super_admin'), (u_x,'x9@training.test','TEST x','general_manager');
  perform set_config('request.jwt.claim.sub', u_x::text, true);
  execute 'set local role authenticated';
  begin perform public.training_bank_view('manager'); raise exception 'FAIL: non-owner read the manager key';
  exception when insufficient_privilege then null; end;
  begin perform public.training_import_job_bank(jb); raise exception 'FAIL: non-owner imported';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', u_owner::text, true);
  begin perform public.training_import_job_bank(jsonb_set(jb, '{questions,1,options,2,points}', '2')); raise exception 'FAIL: two best options accepted';
  exception when invalid_parameter_value then null; end;
  r := public.training_import_job_bank(jb);
  if (r->>'questions')::int <> 2 or (r->>'lessons')::int <> 1 then raise exception 'FAIL: import %', r; end if;
  r := public.training_bank_view('jobs');
  if jsonb_array_length(r->'groups') <> 2 or r->'groups'->0->>'code' <> 'cleaning'
     or r->'groups'->0->'questions'->0->'options'->2->>'critical' <> 'true'
     or r->'groups'->0->'questions'->0->'options'->0->>'id' <> 'a'
     or r->'groups'->0->'lessons'->0->>'title' <> 'درس' then raise exception 'FAIL: jobs view %', r; end if;
  r := public.training_bank_view('manager');
  if r->>'bank' <> 'manager' then raise exception 'FAIL: manager view'; end if;
  begin perform public.training_bank_view('x'); raise exception 'FAIL: unknown bank';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  if (select count(*) from training.audit_log where action = 'bank_viewed' and actor_admin_id = (select id from public.admins where user_id = u_owner)) <> 2 then raise exception 'FAIL: audit'; end if;
  raise notice 'training center bank view rollback test passed';
end $$;
rollback;
