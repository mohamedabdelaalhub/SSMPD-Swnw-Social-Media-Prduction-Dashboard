-- HR: overtime only with an approved request (owner 2026-11-18, against «staying late to make up for lateness»).
-- Owner decisions: every proposal accepted —
--   1) time after the employee's OWN shift end counts only with an approved «طلب ساعات عمل إضافية» (no request → recorded, never paid);
--   2) lateness is never offset by staying late (payroll keeps the late deduction; overtime pays only approved minutes);
--   3) cap = the last doctor appointment of that day (end of the day's clinic work); minutes after it never count;
--   4) a request may be tied to a task; the reviewer writes the task's expected minutes; counted ≤ expected + 20%
--      unless the reviewer writes why more is approved;
--   5) HR report: every stay after the shift, requested or not, with reason / task / approver; unapproved stays over
--      30 minutes are flagged and 3+ in a month are marked for HR to decide (no automatic deduction).
--   Approvers: the employee's direct manager (clinic_people.people.manager_id) or HR (clinic_people.manage()); never self.
--   «صرف الأوفر تايم» switch (super admin / general manager): OFF now — hours stay visible, payroll pays 0 for them.
-- Payroll: public.hr_payroll_calculate is wrapped (not text-patched): overtime_hours becomes the counted hours, the raw
-- figure is kept as overtime_hours_recorded, and allowance / pre_tax_net / salary_deduction are re-derived.
-- Rollback: supabase/rollbacks/20261118010000_hr_overtime_control.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.hr_payroll_calculate(uuid,date)') is null or to_regprocedure('clinic_people.manage()') is null then
    raise exception 'مكونات الموارد البشرية غير موجودة'; end if;
  if to_regclass('clinic_people.overtime_requests') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.overtime_settings (
  id boolean primary key default true check (id),
  pay_enabled boolean not null default false,
  task_tolerance_pct integer not null default 20 check (task_tolerance_pct between 0 and 200),
  alert_minutes integer not null default 30 check (alert_minutes between 5 and 600),
  repeat_count integer not null default 3 check (repeat_count between 1 and 31),
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now()
);
insert into clinic_people.overtime_settings(id) values (true);

create table clinic_people.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references clinic_people.people(id),
  day date not null,
  minutes integer not null check (minutes between 5 and 720),
  reason text not null check (length(trim(reason)) between 3 and 500),
  task_id uuid references public.tasks(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  expected_minutes integer check (expected_minutes is null or expected_minutes between 1 and 720),
  approved_minutes integer check (approved_minutes is null or approved_minutes between 0 and 720),
  extra_reason text,
  review_note text,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.admins(id),
  reviewed_at timestamptz
);
create index overtime_requests_person_day on clinic_people.overtime_requests(person_id, day);
alter table clinic_people.overtime_settings enable row level security;
alter table clinic_people.overtime_requests enable row level security;
revoke all on clinic_people.overtime_settings, clinic_people.overtime_requests from public, anon, authenticated;

-- end of the day's clinic work: the last doctor appointment of that day (live reception), null when none
create or replace function clinic_people.clinic_close_at(p_day date) returns timestamptz language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v timestamptz;
begin
  if to_regclass('clinic_reception.appointments') is null then return null; end if;
  execute 'select max(a.ends_at) from clinic_reception.appointments a join clinic_reception.workspaces w on w.id = a.workspace_id
            where w.mode = ''live'' and a.status not in (''cancelled'',''no_show'') and (a.starts_at at time zone ''Africa/Cairo'')::date = $1' into v using p_day;
  return v;
end $$;

-- per attendance row: recorded minutes after the shift, capped minutes, approved minutes, counted minutes
create or replace function clinic_people.overtime_rows(p_from date, p_to date, p_person uuid default null)
returns table(person_id uuid, day date, scheduled_end timestamptz, actual_end timestamptz, close_at timestamptz,
              recorded_min integer, capped_min integer, approved_min integer, counted_min integer, requests jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  with att as (
    select a.person_id, a.day, a.scheduled_end, a.actual_end, clinic_people.clinic_close_at(a.day) close_at
    from clinic_people.attendance a
    where a.day between p_from and p_to and a.status = 'approved' and a.actual_end is not null and a.actual_end > a.scheduled_end
      and (p_person is null or a.person_id = p_person)
  ), req as (
    select r.person_id, r.day, coalesce(sum(r.approved_minutes) filter (where r.status = 'approved'), 0)::int approved,
           jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'minutes', r.minutes, 'reason', r.reason, 'approved_minutes', r.approved_minutes,
             'expected_minutes', r.expected_minutes, 'extra_reason', r.extra_reason, 'review_note', r.review_note,
             'task_id', r.task_id, 'task_title', t.title, 'task_description', left(t.description, 600),
             'reviewed_by', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = r.reviewed_by),
             'created_by', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = r.created_by),
             'created_at', r.created_at) order by r.created_at) list
    from clinic_people.overtime_requests r left join public.tasks t on t.id = r.task_id
    where r.day between p_from and p_to and r.status <> 'cancelled' and (p_person is null or r.person_id = p_person)
    group by r.person_id, r.day
  )
  select a.person_id, a.day, a.scheduled_end, a.actual_end, a.close_at,
    floor(extract(epoch from (a.actual_end - a.scheduled_end)) / 60)::int,
    greatest(0, floor(extract(epoch from (least(a.actual_end, coalesce(a.close_at, a.actual_end)) - a.scheduled_end)) / 60))::int,
    coalesce(q.approved, 0),
    least(greatest(0, floor(extract(epoch from (least(a.actual_end, coalesce(a.close_at, a.actual_end)) - a.scheduled_end)) / 60))::int, coalesce(q.approved, 0)),
    coalesce(q.list, '[]'::jsonb)
  from att a left join req q on q.person_id = a.person_id and q.day = a.day
$$;

create or replace function clinic_people.overtime_counted_hours(p_person uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(x.counted_min), 0) / 60.0 from clinic_people.overtime_rows(p_from, p_to, p_person) x
$$;

create or replace function clinic_people.overtime_can_review(p_person uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null
     and not exists (select 1 from clinic_people.people p where p.id = p_person and p.admin_id = public.my_admin_id())
     and (clinic_people.manage() or exists (select 1 from clinic_people.people p join clinic_people.people m on m.id = p.manager_id
                                             where p.id = p_person and m.admin_id = public.my_admin_id() and m.status <> 'ended'))
$$;

create or replace function public.hr_overtime(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); mine uuid; pid uuid; st clinic_people.overtime_settings%rowtype; r clinic_people.overtime_requests%rowtype;
  mfrom date; mto date; mins int; exp int; hr boolean; team uuid[]; v uuid;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select * into st from clinic_people.overtime_settings where id;
  select p.id into mine from clinic_people.people p where p.admin_id = me and p.status <> 'ended' limit 1;
  hr := clinic_people.manage();
  select coalesce(array_agg(p.id), '{}') into team from clinic_people.people p join clinic_people.people m on m.id = p.manager_id
   where m.admin_id = me and p.status <> 'ended';

  if p_action = 'workspace' then
    mfrom := date_trunc('month', coalesce(nullif(p_payload->>'month', '')::date, (now() at time zone 'Africa/Cairo')::date))::date;
    mto := (mfrom + interval '1 month' - interval '1 day')::date;
    return jsonb_build_object('is_hr', hr, 'can_settings', public.has_role('super_admin') or public.has_role('general_manager'),
      'settings', to_jsonb(st) - 'id', 'me_person', mine, 'month', mfrom,
      'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'department', p.department) order by p.full_name)
                          from clinic_people.people p where p.status <> 'ended' and (hr or p.id = any(team) or p.id = mine)), '[]'::jsonb),
      'my_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.created_at desc) from (
                     select t2.id, t2.title, t2.created_at from public.tasks t2 where t2.assignee_id = me order by t2.created_at desc limit 40) t), '[]'::jsonb),
      'mine', coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('task_title', (select title from public.tasks where id = q.task_id)) order by q.created_at desc)
                        from clinic_people.overtime_requests q where q.person_id = mine and q.day >= mfrom - 31), '[]'::jsonb),
      'to_review', coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('person_name', p.full_name, 'task_title', t.title, 'task_description', left(t.description, 600)) order by q.created_at)
                        from clinic_people.overtime_requests q join clinic_people.people p on p.id = q.person_id left join public.tasks t on t.id = q.task_id
                        where q.status = 'pending' and (hr or q.person_id = any(team)) and p.admin_id is distinct from me), '[]'::jsonb),
      'report', case when hr or cardinality(team) > 0 then coalesce((select jsonb_agg(jsonb_build_object('person_id', x.person_id, 'name', p.full_name, 'day', x.day,
                        'scheduled_end', x.scheduled_end, 'actual_end', x.actual_end, 'close_at', x.close_at, 'recorded_min', x.recorded_min, 'capped_min', x.capped_min,
                        'approved_min', x.approved_min, 'counted_min', x.counted_min, 'requests', x.requests,
                        'flag', x.approved_min = 0 and x.capped_min >= st.alert_minutes) order by x.day desc, p.full_name)
                        from clinic_people.overtime_rows(mfrom, mto, null) x join clinic_people.people p on p.id = x.person_id
                        where hr or x.person_id = any(team)), '[]'::jsonb) else '[]'::jsonb end,
      'repeaters', case when hr then coalesce((select jsonb_agg(jsonb_build_object('person_id', y.person_id, 'name', p.full_name, 'times', y.n) order by y.n desc)
                        from (select x.person_id, count(*) n from clinic_people.overtime_rows(mfrom, mto, null) x
                              where x.approved_min = 0 and x.capped_min >= st.alert_minutes group by x.person_id having count(*) >= st.repeat_count) y
                        join clinic_people.people p on p.id = y.person_id), '[]'::jsonb) else '[]'::jsonb end);

  elsif p_action = 'request' then
    pid := coalesce(nullif(p_payload->>'person_id', '')::uuid, mine);
    if pid is null then raise exception 'حسابك مش مربوط بملف موظف؛ كلّم الموارد البشرية'; end if;
    if pid <> coalesce(mine, '00000000-0000-0000-0000-000000000000'::uuid) and not (hr or pid = any(team)) then raise exception 'تقدر تطلب لنفسك أو لفريقك بس' using errcode = '42501'; end if;
    mins := (p_payload->>'minutes')::int;
    if mins is null or mins < 5 or mins > 720 then raise exception 'اكتب المدة بالدقايق (من 5 لـ 720)'; end if;
    if length(trim(coalesce(p_payload->>'reason', ''))) < 3 then raise exception 'اكتب السبب أو المهمة'; end if;
    if nullif(p_payload->>'task_id', '') is not null and not exists (select 1 from public.tasks where id = (p_payload->>'task_id')::uuid) then raise exception 'المهمة غير موجودة'; end if;
    insert into clinic_people.overtime_requests(person_id, day, minutes, reason, task_id, created_by)
    values (pid, coalesce(nullif(p_payload->>'day', '')::date, (now() at time zone 'Africa/Cairo')::date), mins, trim(p_payload->>'reason'),
            nullif(p_payload->>'task_id', '')::uuid, me) returning * into r;
    return to_jsonb(r);

  elsif p_action = 'review' then
    select * into r from clinic_people.overtime_requests where id = (p_payload->>'id')::uuid for update;
    if not found then raise exception 'الطلب غير موجود'; end if;
    if r.status <> 'pending' then return to_jsonb(r); end if;
    if not clinic_people.overtime_can_review(r.person_id) then raise exception 'الموافقة للمدير المباشر أو الموارد البشرية (ومش على طلبك إنت)' using errcode = '42501'; end if;
    if (p_payload->>'approve')::boolean is not true then
      if length(trim(coalesce(p_payload->>'note', ''))) < 3 then raise exception 'اكتب سبب الرفض'; end if;
      update clinic_people.overtime_requests set status = 'rejected', review_note = trim(p_payload->>'note'), reviewed_by = me, reviewed_at = now() where id = r.id returning * into r;
      return to_jsonb(r);
    end if;
    mins := coalesce(nullif(p_payload->>'approved_minutes', '')::int, r.minutes);
    exp := nullif(p_payload->>'expected_minutes', '')::int;
    if mins < 0 or mins > 720 then raise exception 'الدقايق المعتمدة غير صالحة'; end if;
    if r.task_id is not null and exp is null then raise exception 'اكتب الوقت المتوقع للمهمة بالدقايق'; end if;
    if exp is not null and mins > ceil(exp * (1 + st.task_tolerance_pct / 100.0)) and length(trim(coalesce(p_payload->>'extra_reason', ''))) < 3 then
      raise exception 'المعتمد أكبر من وقت المهمة المتوقع + %٪ (%) — اكتب سبب الزيادة', st.task_tolerance_pct, ceil(exp * (1 + st.task_tolerance_pct / 100.0));
    end if;
    update clinic_people.overtime_requests set status = 'approved', approved_minutes = mins, expected_minutes = exp,
      extra_reason = nullif(trim(coalesce(p_payload->>'extra_reason', '')), ''), review_note = nullif(trim(coalesce(p_payload->>'note', '')), ''),
      reviewed_by = me, reviewed_at = now() where id = r.id returning * into r;
    return to_jsonb(r);

  elsif p_action = 'cancel' then
    update clinic_people.overtime_requests set status = 'cancelled' where id = (p_payload->>'id')::uuid and created_by = me and status = 'pending' returning * into r;
    if not found then raise exception 'الطلب مش متاح للإلغاء'; end if;
    return to_jsonb(r);

  elsif p_action = 'settings' then
    if not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'الإعدادات للسوبر أدمن أو المدير العام' using errcode = '42501'; end if;
    update clinic_people.overtime_settings set
      pay_enabled = coalesce((p_payload->>'pay_enabled')::boolean, pay_enabled),
      task_tolerance_pct = coalesce((p_payload->>'task_tolerance_pct')::int, task_tolerance_pct),
      alert_minutes = coalesce((p_payload->>'alert_minutes')::int, alert_minutes),
      repeat_count = coalesce((p_payload->>'repeat_count')::int, repeat_count),
      updated_by = me, updated_at = now() where id returning * into st;
    return to_jsonb(st) - 'id';
  end if;
  raise exception 'إجراء غير معروف';
end $$;

-- payroll: pay only counted (approved, capped) overtime, and only while «صرف الأوفر تايم» is on
alter function public.hr_payroll_calculate(uuid, date) set schema clinic_people;
alter function clinic_people.hr_payroll_calculate(uuid, date) rename to payroll_before_overtime_control;
create function public.hr_payroll_calculate(p_person uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare b jsonb; rate numeric; raw numeric; counted numeric; pay_on boolean; dt date; old_allow numeric; new_allow numeric; base numeric; old_ded numeric; gross numeric; ded numeric;
begin
  b := clinic_people.payroll_before_overtime_control(p_person, p_month);
  dt := (b->>'month')::date;
  select coalesce(r.overtime_hour, 0) into rate from clinic_people.pay_rules r where r.id = (b->>'rule_id')::uuid;
  raw := coalesce((b->>'overtime_hours')::numeric, 0);
  counted := round(clinic_people.overtime_counted_hours(p_person, dt, (dt + interval '1 month' - interval '1 day')::date), 2);
  select pay_enabled into pay_on from clinic_people.overtime_settings where id;
  old_allow := coalesce((b->>'allowance')::numeric, 0);
  new_allow := round(old_allow - raw * coalesce(rate, 0) + case when pay_on then counted * coalesce(rate, 0) else 0 end, 2);
  base := coalesce((b->>'base')::numeric, 0);
  old_ded := coalesce((b->>'salary_deduction')::numeric, 0);
  gross := base + new_allow;
  ded := least(old_ded, gross);
  return b || jsonb_build_object('overtime_hours_recorded', raw, 'overtime_hours', counted, 'overtime_pay_enabled', coalesce(pay_on, false),
    'overtime_pay', case when pay_on then round(counted * coalesce(rate, 0), 2) else 0 end,
    'allowance', new_allow, 'salary_deduction', ded, 'pre_tax_net', gross - ded);
end $$;

revoke all on function clinic_people.clinic_close_at(date), clinic_people.overtime_rows(date, date, uuid), clinic_people.overtime_counted_hours(uuid, date, date),
  clinic_people.overtime_can_review(uuid), clinic_people.payroll_before_overtime_control(uuid, date) from public, anon, authenticated;
revoke all on function public.hr_overtime(text, jsonb), public.hr_payroll_calculate(uuid, date) from public, anon;
grant execute on function public.hr_overtime(text, jsonb), public.hr_payroll_calculate(uuid, date) to authenticated;
commit;
