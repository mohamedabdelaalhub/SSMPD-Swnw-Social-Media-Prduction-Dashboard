-- Rule 9 live check for 20261126150000 «مهمة خارجية». One transaction, ends in ROLLBACK, writes nothing.
-- Before the migration is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261126150000_hr_external_mission.sql > /tmp/mission_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/mission_body.sql -f tests/hr-external-mission-live-rollback.sql
-- After it is live: -v body=/dev/null.
-- Actors are picked automatically, with no names printed:
--   EMP = an active employee with a login, a direct manager with a login, and a shift in the last 6 days;
--   MGR = that manager;
--   HR  = another active admin with HR access (has_hr_access, super_admin or general_manager).
-- Paste every 'part' row back.
begin;
\i :body
-- actors and two scheduled days of EMP in the last 6 days, with no leave or mission on them
select e.admin_id emp_admin, ea.user_id emp_user, e.id emp_person, ma.id mgr_admin, ma.user_id mgr_user,
  (select a.id from public.admins a where a.active and a.user_id is not null and a.id not in (e.admin_id, ma.id)
     and (a.has_hr_access or a.role in ('super_admin','general_manager')) order by a.has_hr_access desc, a.id limit 1) hr_admin
from clinic_people.people e join public.admins ea on ea.id = e.admin_id and ea.active and ea.user_id is not null
join clinic_people.people m on m.id = e.manager_id and m.status <> 'ended' join public.admins ma on ma.id = m.admin_id and ma.active and ma.user_id is not null
where e.status <> 'ended' and e.kind <> 'doctor'
  and exists (select 1 from generate_series(1, 6) g(k), lateral clinic_people.attendance_eval((now() at time zone 'Africa/Cairo')::date - g.k) x where x.person_id = e.id and x.status <> 'leave')
order by e.id limit 1 \gset
select user_id hr_user from public.admins where id = :'hr_admin' \gset
select min(d) d1, max(d) d2 from (select ((now() at time zone 'Africa/Cairo')::date - g.k) d from generate_series(1, 6) g(k)
  where exists (select 1 from clinic_people.attendance_eval((now() at time zone 'Africa/Cairo')::date - g.k) x where x.person_id = :'emp_person' and x.status <> 'leave')
    and not exists (select 1 from clinic_people.requests q where q.person_id = :'emp_person' and q.status = 'approved' and q.kind in ('leave','mission')
                    and ((now() at time zone 'Africa/Cairo')::date - g.k) between q.from_date and q.to_date)) s \gset
select 'actors' part, json_build_object('emp_is_hr', (select has_hr_access from public.admins where id = :'emp_admin'), 'd1', :'d1', 'd2', :'d2',
  'two_days', :'d1' <> :'d2', 'eval_before_d1', (select status from clinic_people.attendance_eval(:'d1') where person_id = :'emp_person'),
  'eval_before_d2', (select status from clinic_people.attendance_eval(:'d2') where person_id = :'emp_person'))::text;
create temp table mx(k text primary key, v jsonb) on commit drop;
grant all on mx to authenticated;

-- 1. EMP files a whole-day mission for himself on d1
select set_config('request.jwt.claims', json_build_object('sub', :'emp_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx values ('emp_ws', public.hr_mission('workspace', '{}'));
insert into mx values ('m1', public.hr_mission('create', json_build_object('from_date', :'d1', 'place', 'اختبار يرجع', 'note', 'اختبار مهمة يوم كامل')::jsonb));
do $$ begin perform public.hr_mission('review', jsonb_build_object('id', (select v->>'id' from mx where k = 'm1'), 'decision', 'approved', 'note', 'اختبار'));
  raise exception 'FAIL: employee approved his own mission';
exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; insert into mx values ('emp_self_review_refused', to_jsonb(sqlerrm)); end $$;
reset role;

-- 2. MGR sees it in to_review and approves
select set_config('request.jwt.claims', json_build_object('sub', :'mgr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx values ('mgr_ws', public.hr_mission('workspace', '{}'));
insert into mx values ('m1_approved', public.hr_mission('review', jsonb_build_object('id', (select v->>'id' from mx where k = 'm1'), 'decision', 'approved', 'note', 'اختبار موافقة المدير')));
reset role;
insert into mx values ('eval_d1', (select to_jsonb(x) from clinic_people.attendance_eval(:'d1') x where x.person_id = :'emp_person'));

-- 3. HR: today/range show it; HR files an hours mission on d2 (09:00-11:00) for EMP; HR cannot review its own filing
select set_config('request.jwt.claims', json_build_object('sub', :'hr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx values ('today_row', (select r from jsonb_array_elements(public.hr_attendance_today(:'d1')->'rows') r where r->>'person_id' = :'emp_person'));
insert into mx values ('range_row', (select r from jsonb_array_elements(public.hr_attendance_range(:'d1', :'d1')->'rows') r where r->>'person_id' = :'emp_person'));
insert into mx select 'm2', public.hr_mission('create', json_build_object('person_id', :'emp_person', 'from_date', :'d2', 'from_time', '08:00', 'to_time', '11:00',
  'place', 'اختبار يرجع', 'note', 'اختبار مهمة بالساعات')::jsonb) where :'d1' <> :'d2';
do $$ begin perform public.hr_command('request', jsonb_build_object('person_id', (select v->>'person_id' from mx where k = 'm1'), 'kind', 'mission',
    'from_date', (select v->>'from_date' from mx where k = 'm1'), 'to_date', (select v->>'from_date' from mx where k = 'm1'), 'units', 1, 'note', 'اختبار'));
  raise exception 'FAIL: hr_command created a mission without place';
exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; insert into mx values ('hr_command_mission_refused', to_jsonb(sqlerrm)); end $$;
reset role;

-- 4. MGR approves the hours mission; EMP adds 60 travel minutes; HR approves the travel
select set_config('request.jwt.claims', json_build_object('sub', :'mgr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx select 'm2_approved', public.hr_mission('review', jsonb_build_object('id', v->>'id', 'decision', 'approved', 'note', 'اختبار موافقة')) from mx where k = 'm2';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'emp_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx select 'm2_travel', public.hr_mission('add_travel', jsonb_build_object('id', v->>'id', 'minutes', 60, 'note', 'اختبار سفر')) from mx where k = 'm2';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'hr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx select 'm2_travel_approved', public.hr_mission('travel_review', jsonb_build_object('id', v->>'id', 'decision', 'approved', 'note', 'اختبار')) from mx where k = 'm2';
reset role;
insert into mx select 'eval_d2', (select to_jsonb(x) from clinic_people.attendance_eval(:'d2') x where x.person_id = :'emp_person') where :'d1' <> :'d2';

-- results
select 'emp_workspace' part, json_build_object('me_person_ok', v->>'me_person' = :'emp_person', 'can_file_for', jsonb_array_length(v->'can_file_for'))::text from mx where k = 'emp_ws';
select 'm1_created' part, json_build_object('status', v->>'status', 'units', v->>'units', 'can_review', v->>'can_review', 'can_cancel', v->>'can_cancel')::text from mx where k = 'm1';
select 'emp_self_review' part, v::text from mx where k = 'emp_self_review_refused';
select 'mgr_workspace' part, json_build_object('is_manager', v->>'is_manager', 'sees_m1', exists (select 1 from jsonb_array_elements(v->'to_review') t where t->>'id' = (select v->>'id' from mx where k = 'm1')),
  'can_review', (select t->>'can_review' from jsonb_array_elements(v->'to_review') t where t->>'id' = (select v->>'id' from mx where k = 'm1')))::text from mx where k = 'mgr_ws';
select 'm1_approved' part, v->>'status' from mx where k = 'm1_approved';
select 'eval_d1' part, json_build_object('status', v->>'status', 'late_min', v->>'late_min', 'excused', v->>'excused')::text from mx where k = 'eval_d1';
select 'today_row' part, json_build_object('status', v->>'status', 'mission_place', v->'mission'->>'place', 'whole_day', v->'mission'->>'whole_day')::text from mx where k = 'today_row';
select 'range_row' part, json_build_object('status', v->>'status', 'early_leave_min', v->>'early_leave_min', 'mission', v->'mission' is not null)::text from mx where k = 'range_row';
select 'hr_command_mission' part, v::text from mx where k = 'hr_command_mission_refused';
select 'm2' part, json_build_object('created', (select v->>'status' from mx where k = 'm2'), 'hr_can_review_own', (select v->>'can_review' from mx where k = 'm2'),
  'approved', (select v->>'status' from mx where k = 'm2_approved'), 'travel', (select v->'travel'->0->>'status' from mx where k = 'm2_travel'),
  'travel_approved', (select v->'travel'->0->>'status' from mx where k = 'm2_travel_approved'),
  'eval_d2', (select json_build_object('status', v->>'status', 'late_min', v->>'late_min') from mx where k = 'eval_d2'))::text;
select 'audit' part, json_agg(json_build_object(action, n))::text from (select action, count(*) n from clinic_people.audit
  where record_id in (select (v->>'id')::uuid from mx where k in ('m1', 'm2')) group by action) a;
select 'anon_can_execute' part, has_function_privilege('anon', 'public.hr_mission(text,jsonb)', 'execute')::text;
do $$ begin
  if (select v->>'status' from mx where k = 'm1_approved') <> 'approved' then raise exception 'FAIL: manager approval'; end if;
  if (select v->>'status' from mx where k = 'eval_d1') <> 'mission' then raise exception 'FAIL: eval on d1 is not mission'; end if;
  if (select v->>'status' from mx where k = 'today_row') <> 'mission' then raise exception 'FAIL: hr_attendance_today'; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
