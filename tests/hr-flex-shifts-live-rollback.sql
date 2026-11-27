-- Rule 9 live check for 20261127130000 «وردية اليوم السريعة» + «حسب تواجد الطبيب». One transaction, ends in ROLLBACK, writes nothing.
-- Before the migration is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127130000_hr_flex_shifts.sql > /tmp/flex_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/flex_body.sql -f tests/hr-flex-shifts-live-rollback.sql
-- After it is live: -v body=/dev/null.
-- Actors are picked automatically, with no names printed:
--   EMP = an active non-doctor employee, preferably with a login and an eligible direct manager (active login, not HR / super / GM);
--   MGR = that manager — when there is none the manager parts print «SKIP (no eligible manager)» and HR adds / cancels the quick shift;
--   HR  = another active admin with HR access (has_hr_access, super_admin or general_manager).
--   D   = the first day in the next 14 days with no shift for EMP (no weekly shift, swap, leave, closure); rest days are fine (extra asked).
--   DR  = a live, active reception doctor with availability in the next 7 days (the doctor link check is skipped when there is none).
-- Paste every 'part' row back.
begin;
\i :body
-- EMP: prefer someone with a login AND an eligible direct manager; fall back to someone with a login, then anyone.
select e.id emp_person, coalesce(ea.id::text, '') emp_admin, coalesce(ea.user_id::text, '') emp_user,
  coalesce(ma.id::text, '') mgr_admin, coalesce(ma.user_id::text, '') mgr_user,
  (ea.user_id is not null)::text has_emp_login, (ma.user_id is not null)::text has_mgr,
  (select a.id from public.admins a where a.active and a.user_id is not null and a.id is distinct from ea.id and a.id is distinct from ma.id
     and (a.has_hr_access or a.role in ('super_admin','general_manager')) order by a.has_hr_access desc, a.id limit 1) hr_admin
from clinic_people.people e
left join public.admins ea on ea.id = e.admin_id and ea.active and ea.user_id is not null
left join clinic_people.people m on m.id = e.manager_id and m.status <> 'ended'
left join public.admins ma on ma.id = m.admin_id and ma.active and ma.user_id is not null
  and not coalesce(ma.has_hr_access, false) and ma.role not in ('super_admin','general_manager') and ea.user_id is not null
where e.status <> 'ended' and e.kind <> 'doctor'
order by (ma.user_id is not null) desc, (ea.user_id is not null) desc, e.id limit 1 \gset
select user_id hr_user from public.admins where id = :'hr_admin' \gset
-- the quick-shift actor: the direct manager when there is one, otherwise HR (both are allowed)
select case when :'has_mgr'::boolean then :'mgr_user' else :'hr_user' end q_user \gset
select coalesce(min(g.x::date)::text, '') d, (min(g.x::date) is not null)::text has_d from generate_series((now() at time zone 'Africa/Cairo')::date + 1, (now() at time zone 'Africa/Cairo')::date + 14, interval '1 day') g(x)
 where not exists (select 1 from clinic_people.weekly_slot(:'emp_person', g.x::date) w where w.scheduled and w.template_id is not null)
   and not exists (select 1 from clinic_people.shift_overrides o where o.person_id = :'emp_person' and o.day = g.x::date and o.active)
   and not exists (select 1 from clinic_people.requests r where r.person_id = :'emp_person' and r.kind = 'leave' and r.status = 'approved' and g.x::date between r.from_date and r.to_date)
   and not clinic_people.center_closed_on(g.x::date) \gset
select coalesce((select (w.scheduled and w.template_id is null)::text from clinic_people.weekly_slot(:'emp_person', nullif(:'d', '')::date) w), 'false') d_is_rest,
       coalesce((select pv.id from clinic_reception.providers pv join clinic_reception.workspaces ws on ws.id = pv.workspace_id and ws.mode = 'live'
         where pv.active and exists (select 1 from clinic_reception.availability a where a.provider_id = pv.id and a.starts_at between now() and now() + interval '7 days' and coalesce(a.source, 'manual') <> 'walk_in')
         order by pv.id limit 1)::text, '') dr \gset
select 'actors' part, json_build_object('has_emp_login', :'has_emp_login', 'has_mgr', :'has_mgr', 'quick_actor', case when :'has_mgr'::boolean then 'direct manager' else 'HR' end, 'd', :'d', 'd_is_rest', :'d_is_rest', 'has_doctor', :'dr' <> '', 'hr_is_other', :'hr_admin' <> '',
  'flex_links_before', (select count(*) from clinic_people.flex_links), 'day_shifts_before', (select count(*) from clinic_people.day_shifts))::text;
create temp table mx(k text primary key, v jsonb) on commit drop;
grant all on mx to authenticated;
select set_config('flex.d', :'d', true), set_config('flex.emp', :'emp_person', true), set_config('flex.rest', coalesce(:'d_is_rest', 'false'), true), set_config('flex.dr', :'dr', true);

-- 1. the employee himself is refused
\if :has_emp_login
select set_config('request.jwt.claims', json_build_object('sub', :'emp_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.hr_day_shift('quick_save', jsonb_build_object('person_id', current_setting('flex.emp'), 'day', current_setting('flex.d'), 'start', '10:00', 'end', '14:00', 'extra', true));
  raise exception 'FAIL: employee set his own quick shift';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; insert into mx values ('emp_refused', to_jsonb(sqlerrm)); end $$;
reset role;
\else
select 'employee' part, 'SKIP (no employee with a login)';
\endif

-- 2. the quick-shift actor (direct manager, or HR when there is no eligible manager): month, quick shift, duplicate refused, attendance row, cancel
\if :has_d
select set_config('request.jwt.claims', json_build_object('sub', :'q_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx values ('mgr_month', public.hr_day_shift('month', jsonb_build_object('person_id', current_setting('flex.emp'))));
insert into mx values ('q1', public.hr_day_shift('quick_save', jsonb_build_object('person_id', current_setting('flex.emp'), 'day', current_setting('flex.d'), 'start', '10:00', 'end', '14:00', 'note', 'اختبار يرجع')
  || case when current_setting('flex.rest')::boolean then jsonb_build_object('extra', true) else '{}'::jsonb end));
do $$ begin perform public.hr_day_shift('quick_save', jsonb_build_object('person_id', current_setting('flex.emp'), 'day', current_setting('flex.d'), 'start', '15:00', 'end', '18:00', 'extra', false));
  raise exception 'FAIL: second quick shift on the same day';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; insert into mx values ('dup_refused', to_jsonb(sqlerrm)); end $$;
reset role;
insert into mx select 'eval_d', to_jsonb(x) from clinic_people.attendance_eval(current_setting('flex.d')::date, ((current_setting('flex.d')::date + time '10:30') at time zone 'Africa/Cairo')) x where x.person_id = current_setting('flex.emp')::uuid;
set local role authenticated;
insert into mx values ('q1_cancel', public.hr_day_shift('quick_cancel', jsonb_build_object('id', (select v->>'id' from mx where k = 'q1'))));
reset role;
\else
select 'quick' part, 'SKIP (no empty day in the next 14 days for this employee)';
\endif
-- 2b. the direct manager may not link to a doctor
\if :has_mgr
select set_config('request.jwt.claims', json_build_object('sub', :'mgr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.hr_day_shift('flex_save', jsonb_build_object('person_id', current_setting('flex.emp'), 'department', 'x'));
  raise exception 'FAIL: manager linked to a doctor';
exception when others then if sqlerrm like 'FAIL%' then raise; end if; insert into mx values ('mgr_flex_refused', to_jsonb(sqlerrm)); end $$;
reset role;
\else
select 'manager' part, 'SKIP (no eligible manager)';
\endif

-- 3. HR: providers, preview, doctor link, month, stop; readers; payroll
select set_config('request.jwt.claims', json_build_object('sub', :'hr_user', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into mx values ('providers', public.hr_day_shift('providers', '{}'));
do $$ begin if current_setting('flex.dr') <> '' then
  insert into mx values ('preview', public.hr_day_shift('preview', jsonb_build_object('provider_ids', jsonb_build_array(current_setting('flex.dr')))));
  insert into mx values ('flex', public.hr_day_shift('flex_save', jsonb_build_object('person_id', current_setting('flex.emp'), 'provider_ids', jsonb_build_array(current_setting('flex.dr')), 'before_min', 30, 'after_min', 15)));
  insert into mx values ('flex_month', public.hr_day_shift('month', jsonb_build_object('person_id', current_setting('flex.emp'), 'from', (now() at time zone 'Africa/Cairo')::date, 'to', (now() at time zone 'Africa/Cairo')::date + 7)));
  insert into mx values ('flex_stop', public.hr_day_shift('flex_stop', jsonb_build_object('person_id', current_setting('flex.emp'), 'from', (now() at time zone 'Africa/Cairo')::date)));
end if; end $$;
insert into mx values ('today', public.hr_attendance_today((now() at time zone 'Africa/Cairo')::date));
insert into mx values ('shifts_ws', public.hr_shifts_workspace());
-- payroll refuses months without an approved attendance sheet («لا يوجد جدول ورديات وحضور معتمد للشهر»): SKIP then, the subtransaction keeps the test alive
do $$ begin
  insert into mx values ('payroll', public.hr_payroll_calculate(current_setting('flex.emp')::uuid, date_trunc('month', now() at time zone 'Africa/Cairo')::date));
exception when others then insert into mx values ('payroll_skip', to_jsonb(sqlerrm)); end $$;
reset role;
insert into mx select 'nurse_presence', clinic_reception.nurse_presence(nullif(:'emp_admin', '')::uuid, (now() at time zone 'Africa/Cairo')::date) where :'emp_admin' <> '';

select 'refusals' part, json_build_object('employee', (select v from mx where k = 'emp_refused'), 'duplicate', (select v from mx where k = 'dup_refused'), 'manager_flex', (select v from mx where k = 'mgr_flex_refused'))::text;
select 'quick_shift' part, json_build_object('actor', case when :'has_mgr'::boolean then 'direct manager' else 'HR' end, 'month_can_quick', (select v->'can_quick' from mx where k = 'mgr_month'), 'q1', (select v - 'created_by_name' from mx where k = 'q1'),
  'eval', (select json_build_object('status', v->>'status', 'name', v->>'template_name', 'late_min', v->>'late_min', 'exp_start', v->>'exp_start') from mx where k = 'eval_d'),
  'cancelled', (select v->>'active' from mx where k = 'q1_cancel'))::text;
select 'hr' part, json_build_object('doctors', jsonb_array_length((select v->'doctors' from mx where k = 'providers')),
  'preview_days_with_shift', (select count(*) from jsonb_array_elements((select v->'days' from mx where k = 'preview')) x where jsonb_array_length(x->'periods') > 0),
  'flex_days', (select jsonb_array_length(v->'flex_days') from mx where k = 'flex_month'), 'doctor_shifts', (select jsonb_array_length(v->'shifts') from mx where k = 'flex_month'),
  'stopped', (select v from mx where k = 'flex_stop'))::text;
select 'readers' part, json_build_object('unscheduled', (select v->'unscheduled' from mx where k = 'today'), 'today_rows', (select jsonb_array_length(v->'rows') from mx where k = 'today'),
  'shifts_ws_has_flex_key', (select bool_and(p ? 'flex') from mx, jsonb_array_elements(v->'people') p where k = 'shifts_ws'),
  'payroll_extra_days', (select v->'extra_days' from mx where k = 'payroll'), 'payroll_error', (select v->'error' from mx where k = 'payroll'),
  'nurse_presence_state', (select v->>'state' from mx where k = 'nurse_presence'))::text;
select 'payroll' part, case when exists (select 1 from mx where k = 'payroll_skip') then 'SKIP (month not approved): ' || (select v #>> '{}' from mx where k = 'payroll_skip')
  else json_build_object('extra_days', (select v->'extra_days' from mx where k = 'payroll'), 'extra_days_pay', (select v->'extra_days_pay' from mx where k = 'payroll'))::text end;
select 'anon_can_execute' part, has_function_privilege('anon', 'public.hr_day_shift(text,jsonb)', 'execute')::text;
do $$ begin
  if exists (select 1 from mx where k = 'q1') then
    if (select v->>'start' from mx where k = 'q1') <> '10:00' then raise exception 'FAIL: quick shift not saved'; end if;
    if coalesce((select v->>'template_name' from mx where k = 'eval_d'), '') not like 'وردية اليوم%' then raise exception 'FAIL: attendance_eval does not see the quick shift'; end if;
    if (select v->>'active' from mx where k = 'q1_cancel') <> 'false' then raise exception 'FAIL: cancel'; end if;
  end if;
  if (select v->>'unscheduled' from mx where k = 'today') is null then raise exception 'FAIL: hr_attendance_today'; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
