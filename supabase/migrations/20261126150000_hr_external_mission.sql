-- HR «مهمة خارجية» (external mission). Owner decision 2026-11-26, relayed by main chat 6:
--   set by HR AND department managers; the employee can request it himself; approved through the same flow as leave
--   requests; a whole day or a number of hours; travel hours are added by the employee himself when he is back (a
--   follow-up entry on the same mission, also approved); counts as worked time (no absence, no lateness, no payroll
--   deduction) and as covered in the department minimum.
-- Defaults until the owner answers (main 6 asked him): a different person always approves (four-eyes, like leave, also
-- when HR or the manager files it); approved travel minutes only extend the mission window over the shift, so they
-- never create overtime (time after the shift still needs an overtime request); a mission can be filed up to 7 days
-- after it started.
--
-- Data: clinic_people.requests gets kind 'mission'. It shows in hr_workspace().requests like every request, and
-- HR can review it in the normal list (hr_command 'request_review'). New columns: from_time / to_time (both null =
-- the whole shift; the same window on every day of a multi-day mission), place, travel_minutes / travel_note /
-- travel_status / travel_reviewed_by / travel_reviewed_at. units is derived: days for a whole-shift mission, hours otherwise.
-- RPC public.hr_mission(action, payload): workspace / create / review / cancel / add_travel / travel_review.
-- Reviewers: HR (clinic_people.manage()) or the person's direct manager (people.manager_id), never the person himself,
-- never the request's creator (clinic_people.overtime_can_review + created_by check).
-- Attendance: clinic_people.attendance_eval is wrapped (the current body is kept as attendance_eval_before_missions):
--   leave stays first; an approved mission that covers the shift start (whole shift, or an hours window that starts at or
--   before shift start + grace and ends, plus approved travel, after the shift start) gives status 'mission', late_min 0,
--   excused true. An hours mission later in the shift does not hide a late arrival.
-- Readers, patched in place on their LIVE bodies (dumped 2026-11-26 15:30Z, relay/36), each fragment must match once:
--   * hr_attendance_from_punches: a 'mission' day gets an attendance row: actual_start = the shift start (or the
--     earlier punch), actual_end = the shift end (or the later exit punch), note «مهمة خارجية», so payroll counts no
--     absence and no lateness;
--   * hr_attendance_today rows and hr_attendance_range rows: + 'mission' (clinic_people.mission_on); range: no
--     early-leave minutes on a mission day.
-- Attendance rows that are already recorded are not rewritten (same as leave approved after the import).
-- Rollback: supabase/rollbacks/20261126150000_hr_external_mission.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_people.attendance_eval_before_missions(date,timestamp with time zone)') is not null then
    raise exception 'تم تطبيق 20261126150000 من قبل'; end if;
  if to_regprocedure('clinic_people.attendance_eval_before_closures(date,timestamp with time zone)') is null
     or to_regprocedure('clinic_people.overtime_can_review(uuid)') is null then
    raise exception 'مكونات الحضور أو الأوفر تايم غير موجودة'; end if;
end $$;

-- 1. data
alter table clinic_people.requests
  add column from_time time,
  add column to_time time,
  add column place text,
  add column travel_minutes integer,
  add column travel_note text,
  add column travel_status text,
  add column travel_reviewed_by uuid references public.admins(id),
  add column travel_reviewed_at timestamptz;
alter table clinic_people.requests drop constraint requests_kind_check;
alter table clinic_people.requests add constraint requests_kind_check
  check (kind in ('leave','permission','training','advance','overtime','leave_credit','holiday_comp','mission'));
alter table clinic_people.requests add constraint requests_mission_fields check (
  kind = 'mission' or (from_time is null and to_time is null and place is null and travel_minutes is null and travel_status is null));
alter table clinic_people.requests add constraint requests_mission_window check (
  (from_time is null) = (to_time is null) and (from_time is null or to_time > from_time));
alter table clinic_people.requests add constraint requests_mission_travel check (
  (travel_minutes is null) = (travel_status is null) and (travel_minutes is null or travel_minutes between 1 and 720)
  and (travel_status is null or travel_status in ('pending','approved','rejected')));
create index requests_mission_person_day on clinic_people.requests(person_id, from_date, to_date) where kind = 'mission';

create or replace function clinic_people.mission_rules() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if new.kind <> 'mission' then return new; end if;
  new.place := nullif(btrim(coalesce(new.place, '')), '');
  if new.place is null or length(new.place) > 200 then raise exception 'سجل المهمة الخارجية من شاشة المهمة واكتب مكانها'; end if;
  if new.to_date - new.from_date > 30 then raise exception 'المهمة الخارجية لا تزيد عن 31 يومًا'; end if;
  if tg_op = 'INSERT' and new.from_date < today - 7 then raise exception 'المهمة الخارجية تتسجل لحد 7 أيام بعد ما تبدأ'; end if;
  new.units := case when new.from_time is null then new.to_date - new.from_date + 1
                    else round((new.to_date - new.from_date + 1) * extract(epoch from (new.to_time - new.from_time)) / 3600.0, 2) end;
  return new;
end $$;
create trigger requests_mission_rules before insert or update on clinic_people.requests
  for each row when (new.kind = 'mission') execute function clinic_people.mission_rules();

-- the approved mission of a person on a day (null when none)
create or replace function clinic_people.mission_on(p_person uuid, p_day date) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', r.id, 'whole_day', r.from_time is null,
    'from', case when r.from_time is not null then (p_day + r.from_time) at time zone 'Africa/Cairo' end,
    'to', case when r.to_time is not null then (p_day + r.to_time) at time zone 'Africa/Cairo' end,
    'to_with_travel', case when r.to_time is not null then ((p_day + r.to_time) at time zone 'Africa/Cairo')
                             + make_interval(mins => case when r.travel_status = 'approved' then r.travel_minutes else 0 end) end,
    'from_time', r.from_time, 'to_time', r.to_time, 'place', r.place, 'note', r.note,
    'mission_minutes', case when r.from_time is not null then floor(extract(epoch from (r.to_time - r.from_time)) / 60)::int end,
    'travel_minutes', case when r.travel_status = 'approved' then r.travel_minutes else 0 end, 'travel_status', r.travel_status)
  from clinic_people.requests r
  where r.person_id = p_person and r.kind = 'mission' and r.status = 'approved' and p_day between r.from_date and r.to_date
  order by r.from_time nulls first, r.created_at desc limit 1
$$;
revoke all on function clinic_people.mission_on(uuid, date) from public, anon, authenticated;

-- 2. attendance: wrap the evaluator
alter function clinic_people.attendance_eval(date, timestamptz) rename to attendance_eval_before_missions;
revoke all on function clinic_people.attendance_eval_before_missions(date, timestamptz) from public, anon, authenticated;
create function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
 returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
               device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.person_id, e.template_id, e.template_name, e.color, e.grace, e.exp_start, e.exp_end, e.device_user_id, e.first_in,
    case when e.status = 'leave' then 'leave' when mc.covers then 'mission' else e.status end,
    case when e.status <> 'leave' and mc.covers then 0 else e.late_min end,
    e.since_start,
    case when e.status <> 'leave' and mc.covers then true else e.excused end
  from clinic_people.attendance_eval_before_missions(p_day, p_now) e
  cross join lateral (select exists (
      select 1 from clinic_people.requests r
      where r.person_id = e.person_id and r.kind = 'mission' and r.status = 'approved' and p_day between r.from_date and r.to_date
        and (r.from_time is null
             or (((p_day + r.from_time) at time zone 'Africa/Cairo') <= e.exp_start + make_interval(mins => coalesce(e.grace, 0))
                 and ((p_day + r.to_time) at time zone 'Africa/Cairo')
                     + make_interval(mins => case when r.travel_status = 'approved' then r.travel_minutes else 0 end) > e.exp_start))) as covers) mc
$$;
revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;

-- 3. readers: anchored in-place patches of the live definitions
create function pg_temp.mission_patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $p$
declare def text := pg_get_functiondef(p_fn); i int; n int;
begin
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    n := (length(def) - length(replace(def, p_pairs[2*i-1], ''))) / length(p_pairs[2*i-1]);
    if n <> 1 then raise exception 'مقطع % من % موجود % مرة (المتوقع مرة واحدة)؛ الدالة اتغيرت على السيرفر', i, p_fn, n; end if;
    def := replace(def, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  execute def;
end $p$;

select pg_temp.mission_patch('public.hr_attendance_from_punches(date)', array[
  $a$where not x.has_row and x.status in ('on_time', 'late', 'absent')$a$,
  $a$where not x.has_row and x.status in ('on_time', 'late', 'absent', 'mission')$a$,
  $a$case when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start$a$,
  $a$case when x.status = 'mission' then least(coalesce(x.first_in, x.exp_start), x.exp_start) when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start$a$,
  $a$and (x.status = 'absent' or x.last_out is not null or x.exp_end + interval '10 hours' <= now()))$a$,
  $a$and (x.status in ('absent', 'mission') or x.last_out is not null or x.exp_end + interval '10 hours' <= now()))$a$,
  $a$'actual_end', case when t.a_start is null then null$a$,
  $a$'actual_end', case when t.status = 'mission' then greatest(t.exp_end, coalesce(t.last_out, t.exp_end)) when t.a_start is null then null$a$,
  $a$'note', 'بصمة' || case when t.status = 'absent' and t.sick_wait is false$a$,
  $a$'note', 'بصمة' || case when t.status = 'mission' then ' — مهمة خارجية' when t.status = 'absent' and t.sick_wait is false$a$,
  $a$|| case when t.excused then ' — إذن معتمد' else '' end)$a$,
  $a$|| case when t.excused and t.status <> 'mission' then ' — إذن معتمد' else '' end)$a$]);

select pg_temp.mission_patch('public.hr_attendance_today(date)', array[
  $a$'excused', e.excused, 'late_week'$a$,
  $a$'excused', e.excused, 'mission', clinic_people.mission_on(e.person_id, d), 'late_week'$a$]);

select pg_temp.mission_patch('public.hr_attendance_range(date,date)', array[
  $a$'day', x.day, 'person_id', x.person_id, 'status', x.status, 'late_min', x.late_min, 'excused', x.excused,$a$,
  $a$'day', x.day, 'person_id', x.person_id, 'status', x.status, 'late_min', x.late_min, 'excused', x.excused, 'mission', case when x.status = 'mission' then clinic_people.mission_on(x.person_id, x.day) end,$a$,
  $a$'early_leave_min', case when x.last_out is not null and x.last_out < x.exp_end$a$,
  $a$'early_leave_min', case when x.status = 'mission' then 0 when x.last_out is not null and x.last_out < x.exp_end$a$]);

-- 4. the RPC
create or replace function clinic_people.mission_json(r clinic_people.requests, p_me uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', r.id, 'person_id', r.person_id, 'person_name', p.full_name, 'department', p.department,
    'from_date', r.from_date, 'to_date', r.to_date, 'from_time', r.from_time, 'to_time', r.to_time, 'whole_day', r.from_time is null,
    'units', r.units, 'place', r.place, 'note', r.note, 'status', r.status, 'review_note', r.review_note, 'created_at', r.created_at,
    'created_by_name', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = r.created_by),
    'reviewed_by_name', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = r.reviewed_by),
    'travel', case when r.travel_status is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'id', r.id, 'minutes', r.travel_minutes, 'note', r.travel_note, 'status', r.travel_status, 'reviewed_at', r.travel_reviewed_at,
        'reviewed_by_name', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = r.travel_reviewed_by),
        'can_review', r.travel_status = 'pending' and clinic_people.overtime_can_review(r.person_id))) end,
    'can_review', r.status = 'pending' and r.created_by <> p_me and clinic_people.overtime_can_review(r.person_id),
    'can_cancel', r.status = 'pending' and (r.created_by = p_me or p.admin_id = p_me or clinic_people.manage()),
    'can_add_travel', r.status = 'approved' and p.admin_id = p_me and coalesce(r.travel_status, 'rejected') = 'rejected'
                      and now() >= (r.from_date + coalesce(r.from_time, time '00:00')) at time zone 'Africa/Cairo')
  from clinic_people.people p where p.id = r.person_id
$$;
revoke all on function clinic_people.mission_json(clinic_people.requests, uuid) from public, anon, authenticated;

create or replace function public.hr_mission(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); hr boolean := clinic_people.manage(); mine uuid; team uuid[]; pid uuid;
  r clinic_people.requests%rowtype; prior jsonb; v uuid; mfrom date; mto date; ft time; tt time; v_note text;
  today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  select p.id into mine from clinic_people.people p where p.admin_id = me and p.status <> 'ended' limit 1;
  select coalesce(array_agg(p.id), '{}') into team from clinic_people.people p join clinic_people.people m on m.id = p.manager_id
   where m.admin_id = me and m.status <> 'ended' and p.status <> 'ended';
  v_note := btrim(coalesce(p_payload->>'note', ''));

  if p_action = 'workspace' then
    mfrom := date_trunc('month', coalesce(nullif(p_payload->>'month', '')::date, today))::date;
    mto := (mfrom + interval '1 month' - interval '1 day')::date;
    return jsonb_build_object('is_hr', hr, 'me_person', mine, 'month', mfrom, 'is_manager', cardinality(team) > 0,
      'can_file_for', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'department', p.department) order by p.full_name)
          from clinic_people.people p where p.status <> 'ended' and p.kind <> 'doctor' and (hr or p.id = any(team) or p.id = mine)), '[]'::jsonb),
      'mine', coalesce((select jsonb_agg(clinic_people.mission_json(q, me) order by q.from_date desc, q.created_at desc) from clinic_people.requests q
          where q.kind = 'mission' and q.person_id = mine and (q.status = 'pending' or q.travel_status = 'pending' or q.to_date >= mfrom - 31)), '[]'::jsonb),
      'to_review', coalesce((select jsonb_agg(clinic_people.mission_json(q, me) order by q.created_at) from clinic_people.requests q
          where q.kind = 'mission' and (q.status = 'pending' and q.created_by <> me or q.travel_status = 'pending')
            and q.person_id is distinct from mine and (hr or q.person_id = any(team))), '[]'::jsonb),
      'team', coalesce((select jsonb_agg(clinic_people.mission_json(q, me) order by q.from_date desc, q.created_at desc) from clinic_people.requests q
          where q.kind = 'mission' and q.person_id is distinct from mine and (hr or q.person_id = any(team))
            and q.from_date <= mto and q.to_date >= mfrom), '[]'::jsonb));

  elsif p_action = 'create' then
    pid := coalesce(nullif(p_payload->>'person_id', '')::uuid, mine);
    if pid is null or not exists (select 1 from clinic_people.people where id = pid and status <> 'ended') then raise exception 'ملف الموظف غير متاح'; end if;
    if not (pid = mine or hr or pid = any(team)) then raise exception 'تسجيل المهمة لنفسك أو لفريقك أو من الموارد البشرية'; end if;
    mfrom := (p_payload->>'from_date')::date; mto := coalesce(nullif(p_payload->>'to_date', '')::date, mfrom);
    ft := nullif(p_payload->>'from_time', '')::time; tt := nullif(p_payload->>'to_time', '')::time;
    if mfrom is null or mto < mfrom then raise exception 'راجع تاريخ المهمة'; end if;
    if (ft is null) <> (tt is null) or tt <= ft then raise exception 'اكتب وقت البداية والنهاية (النهاية بعد البداية) أو سيبهم فاضيين ليوم كامل'; end if;
    if length(v_note) < 3 then raise exception 'اكتب سبب المهمة'; end if;
    perform 1 from clinic_people.people where id = pid for update;
    if exists (select 1 from clinic_people.requests q where q.person_id = pid and q.kind = 'leave' and q.status = 'approved'
               and daterange(q.from_date, q.to_date, '[]') && daterange(mfrom, mto, '[]')) then raise exception 'الموظف عنده إجازة معتمدة في الفترة دي'; end if;
    if exists (select 1 from clinic_people.requests q where q.person_id = pid and q.kind = 'mission' and q.status in ('pending', 'approved')
               and daterange(q.from_date, q.to_date, '[]') && daterange(mfrom, mto, '[]')
               and (q.from_time is null or ft is null or (q.from_time < tt and ft < q.to_time))) then raise exception 'فيه مهمة خارجية متداخلة في نفس الوقت'; end if;
    insert into clinic_people.requests(person_id, kind, from_date, to_date, units, note, created_by, from_time, to_time, place)
      values (pid, 'mission', mfrom, mto, 1, v_note, me, ft, tt, p_payload->>'place') returning * into r;
    v := r.id;

  elsif p_action in ('review', 'travel_review', 'cancel', 'add_travel') then
    select * into r from clinic_people.requests where id = nullif(p_payload->>'id', '')::uuid and kind = 'mission' for update;
    if not found then raise exception 'المهمة غير موجودة'; end if;
    prior := to_jsonb(r); v := r.id;
    if p_action = 'review' then
      if r.status <> 'pending' or r.created_by = me or not clinic_people.overtime_can_review(r.person_id) then
        raise exception 'المراجعة للموارد البشرية أو المدير المباشر، ومن غير اللي سجل الطلب'; end if;
      if p_payload->>'decision' not in ('approved', 'rejected') or length(v_note) < 3 then raise exception 'اختار القرار واكتب سببه'; end if;
      if p_payload->>'decision' = 'approved' and exists (select 1 from clinic_people.requests q where q.person_id = r.person_id and q.kind = 'leave'
           and q.status = 'approved' and daterange(q.from_date, q.to_date, '[]') && daterange(r.from_date, r.to_date, '[]')) then
        raise exception 'الموظف عنده إجازة معتمدة في الفترة دي'; end if;
      update clinic_people.requests set status = p_payload->>'decision', reviewed_by = me, review_note = v_note where id = r.id returning * into r;
    elsif p_action = 'cancel' then
      if r.status = 'pending' and (r.created_by = me or hr or exists (select 1 from clinic_people.people where id = r.person_id and admin_id = me)) then
        update clinic_people.requests set status = 'cancelled', review_note = nullif(v_note, '') where id = r.id returning * into r;
      elsif r.status = 'approved' and r.travel_status = 'pending' and exists (select 1 from clinic_people.people where id = r.person_id and admin_id = me) then
        update clinic_people.requests set travel_minutes = null, travel_note = null, travel_status = null where id = r.id returning * into r;
      else raise exception 'الإلغاء متاح للطلب اللي لسه مستني موافقة بس'; end if;
    elsif p_action = 'add_travel' then
      if not exists (select 1 from clinic_people.people where id = r.person_id and admin_id = me) then raise exception 'ساعات السفر يسجلها صاحب المهمة بنفسه'; end if;
      if r.status <> 'approved' or coalesce(r.travel_status, 'rejected') <> 'rejected'
         or now() < (r.from_date + coalesce(r.from_time, time '00:00')) at time zone 'Africa/Cairo' then
        raise exception 'ساعات السفر بتتسجل بعد ما المهمة تتعتمد وتبدأ، مرة واحدة'; end if;
      if (p_payload->>'minutes')::int is null or (p_payload->>'minutes')::int not between 1 and 720 then raise exception 'دقائق السفر من 1 لـ 720'; end if;
      update clinic_people.requests set travel_minutes = (p_payload->>'minutes')::int, travel_note = nullif(v_note, ''), travel_status = 'pending',
        travel_reviewed_by = null, travel_reviewed_at = null where id = r.id returning * into r;
    else
      if r.travel_status is distinct from 'pending' or not clinic_people.overtime_can_review(r.person_id) then
        raise exception 'مراجعة ساعات السفر للموارد البشرية أو المدير المباشر'; end if;
      if p_payload->>'decision' not in ('approved', 'rejected') or length(v_note) < 3 then raise exception 'اختار القرار واكتب سببه'; end if;
      update clinic_people.requests set travel_status = p_payload->>'decision', travel_reviewed_by = me, travel_reviewed_at = now(),
        travel_note = concat_ws(' — ', travel_note, v_note) where id = r.id returning * into r;
    end if;
  else
    raise exception 'إجراء غير متاح';
  end if;

  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data) values (me, 'mission_' || p_action, v, prior, to_jsonb(r));
  return clinic_people.mission_json(r, me);
end $$;
revoke all on function public.hr_mission(text, jsonb) from public, anon;
grant execute on function public.hr_mission(text, jsonb) to authenticated;
commit;
