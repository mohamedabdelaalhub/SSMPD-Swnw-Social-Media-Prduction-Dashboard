-- Shift schedules (تاب «الورديات»): the weekly work times of every administrative employee, so the dashboard can tell who arrived on time, who was late and who did not come.
-- ADDITIVE ONLY: 2 new tables in clinic_people (RLS on, no policies, no direct grants), 1 internal SQL function and 3 new SECURITY DEFINER RPCs. Nothing existing is changed.
-- Model: shift_templates = named work times (start/end, grace minutes; end <= start means the shift crosses midnight). person_shifts = a weekly pattern per person
--   (one row per weekday; template_id NULL = weekly day off; no row = not scheduled yet). Patterns are effective-dated (valid_from/valid_to) so history stays correct.
-- Evaluation (clinic_people.attendance_eval): for a day D and a scheduled person with a device number mapped (device_user_map), the first check-in punch (0/3/4) in
--   [start-3h, end] decides: on_time, or late when it is after start+grace; no punch: upcoming (before start), waiting (inside the grace), absent (after).
--   Approved leave requests -> leave. Approved permission requests excuse a late/absent day (flag excused). Unmapped people -> unmapped (cannot be evaluated).
-- Access: HR managers only (clinic_people.manage()). Cairo time zone everywhere.
-- Rollback: supabase/rollbacks/20261113100000_shift_schedules.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_people.people') is null then raise exception 'جدول الموارد البشرية غير موجود'; end if;
  if to_regclass('clinic_people.device_punches') is null or to_regclass('clinic_people.device_user_map') is null then raise exception 'طبّق live_presence أولًا'; end if;
  if to_regclass('clinic_people.shift_templates') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_people.shift_templates(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 40),
  start_time time not null,
  end_time time not null check (end_time <> start_time),
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  color text not null default '#0F369D' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  unique (name)
);

create table clinic_people.person_shifts(
  id bigint generated always as identity primary key,
  person_id uuid not null references clinic_people.people(id),
  dow smallint not null check (dow between 0 and 6),
  template_id uuid references clinic_people.shift_templates(id),
  valid_from date not null,
  valid_to date,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index person_shifts_lookup on clinic_people.person_shifts(person_id, dow, valid_from desc);

alter table clinic_people.shift_templates enable row level security;
alter table clinic_people.person_shifts enable row level security;
revoke all on clinic_people.shift_templates, clinic_people.person_shifts from public, anon, authenticated;
revoke all on sequence clinic_people.person_shifts_id_seq from public, anon, authenticated;

create function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
  device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with pat as (
    select distinct on (ps.person_id) ps.person_id, ps.template_id
    from clinic_people.person_shifts ps
    join clinic_people.people p on p.id = ps.person_id and p.status <> 'ended' and p.kind <> 'doctor'
    where ps.dow = extract(dow from p_day)::int and ps.valid_from <= p_day and (ps.valid_to is null or ps.valid_to >= p_day)
    order by ps.person_id, ps.valid_from desc, ps.id desc),
  sched as (
    select pat.person_id, t.id as template_id, t.name as template_name, t.color, t.grace_minutes as grace,
      ((p_day + t.start_time) at time zone 'Africa/Cairo') as exp_start,
      ((p_day + t.end_time + case when t.end_time <= t.start_time then interval '1 day' else interval '0' end) at time zone 'Africa/Cairo') as exp_end
    from pat join clinic_people.shift_templates t on t.id = pat.template_id),
  joined as (
    select s.*, m.device_user_id,
      (select min(d.ts) from clinic_people.device_punches d
        where d.device_id = m.device_id and d.device_user_id = m.device_user_id and d.punch in (0, 3, 4)
          and d.ts between s.exp_start - interval '3 hours' and s.exp_end) as first_in
    from sched s left join clinic_people.device_user_map m on m.person_id = s.person_id),
  lv as (
    select r.person_id, bool_or(r.kind = 'leave') as leave, bool_or(r.kind = 'permission') as perm
    from clinic_people.requests r
    where r.status = 'approved' and r.kind in ('leave', 'permission') and p_day between r.from_date and r.to_date
    group by r.person_id)
  select j.person_id, j.template_id, j.template_name, j.color, j.grace, j.exp_start, j.exp_end, j.device_user_id, j.first_in,
    case
      when coalesce(lv.leave, false) then 'leave'
      when j.device_user_id is null then 'unmapped'
      when j.first_in is not null then case when j.first_in > j.exp_start + make_interval(mins => j.grace) then 'late' else 'on_time' end
      when p_now < j.exp_start then 'upcoming'
      when p_now <= j.exp_start + make_interval(mins => j.grace) then 'waiting'
      else 'absent' end,
    case when j.first_in is not null and j.first_in > j.exp_start then floor(extract(epoch from (j.first_in - j.exp_start)) / 60)::integer else 0 end,
    case when p_now > j.exp_start then floor(extract(epoch from (p_now - j.exp_start)) / 60)::integer else null end,
    coalesce(lv.perm, false)
  from joined j left join lv on lv.person_id = j.person_id
$$;

create function public.hr_shifts_workspace() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  return jsonb_build_object(
    'can_manage', true,
    'today', (now() at time zone 'Africa/Cairo')::date,
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'start_time', to_char(t.start_time, 'HH24:MI'), 'end_time', to_char(t.end_time, 'HH24:MI'),
        'grace_minutes', t.grace_minutes, 'color', t.color, 'active', t.active, 'overnight', t.end_time <= t.start_time) order by t.start_time, t.name), '[]'::jsonb) from clinic_people.shift_templates t),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name, 'department', p.department, 'job_title', p.job_title,
        'since', cur.since, 'days', coalesce(cur.days, '{}'::jsonb)) order by p.department nulls last, p.full_name), '[]'::jsonb)
      from clinic_people.people p
      left join lateral (
        select max(x.valid_from) as since, jsonb_object_agg(x.dow::text, x.template_id) as days
        from (select distinct on (ps.dow) ps.dow, ps.template_id, ps.valid_from from clinic_people.person_shifts ps
              where ps.person_id = p.id and ps.valid_from <= (now() at time zone 'Africa/Cairo')::date and (ps.valid_to is null or ps.valid_to >= (now() at time zone 'Africa/Cairo')::date)
              order by ps.dow, ps.valid_from desc, ps.id desc) x) cur on true
      where p.status <> 'ended' and p.kind <> 'doctor'));
end $$;

create function public.hr_shifts_command(p_action text, p_payload jsonb) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); tid uuid; pid uuid; today date := (now() at time zone 'Africa/Cairo')::date; from_d date; k text; v text; nm text; st time; en time; gr integer; colr text;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  perform pg_advisory_xact_lock(712261113);
  if p_action = 'template_save' then
    nm := trim(coalesce(p_payload->>'name', ''));
    if length(nm) < 2 or length(nm) > 40 then raise exception 'اكتب اسم الوردية (2 إلى 40 حرفًا)'; end if;
    begin st := (p_payload->>'start_time')::time; en := (p_payload->>'end_time')::time; exception when others then raise exception 'راجع وقت البداية والنهاية'; end;
    if st is null or en is null or st = en then raise exception 'وقت البداية والنهاية لازم يختلفوا'; end if;
    gr := coalesce(nullif(p_payload->>'grace_minutes', '')::integer, 10);
    if gr < 0 or gr > 120 then raise exception 'السماح من 0 إلى 120 دقيقة'; end if;
    colr := coalesce(nullif(p_payload->>'color', ''), '#0F369D');
    if colr !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'لون غير صالح'; end if;
    tid := nullif(p_payload->>'id', '')::uuid;
    if tid is null then
      insert into clinic_people.shift_templates(name, start_time, end_time, grace_minutes, color, created_by) values (nm, st, en, gr, colr, me) returning id into tid;
    else
      update clinic_people.shift_templates set name = nm, start_time = st, end_time = en, grace_minutes = gr, color = colr,
        active = coalesce((p_payload->>'active')::boolean, active) where id = tid;
      if not found then raise exception 'الوردية غير موجودة'; end if;
    end if;
    insert into clinic_people.audit(actor_id, action, record_id, after_data) values (me, 'shift_template', tid, p_payload);
    return tid;
  elsif p_action = 'schedule_save' then
    pid := (p_payload->>'person_id')::uuid;
    if not exists (select 1 from clinic_people.people where id = pid and status <> 'ended' and kind <> 'doctor') then raise exception 'اختر موظفًا إداريًا مستمرًا'; end if;
    from_d := coalesce(nullif(p_payload->>'valid_from', '')::date, today);
    if from_d < today - 31 then raise exception 'لا يمكن تعديل جدول أقدم من 31 يومًا'; end if;
    if jsonb_typeof(p_payload->'days') <> 'object' then raise exception 'راجع أيام الأسبوع'; end if;
    for k in select g::text from generate_series(0, 6) g loop
      if not (p_payload->'days' ? k) then raise exception 'يجب تحديد كل أيام الأسبوع (الراحة = فارغ)'; end if;
      v := nullif(p_payload->'days'->>k, '');
      if v is not null and not exists (select 1 from clinic_people.shift_templates where id = v::uuid and active) then raise exception 'وردية غير موجودة أو متوقفة'; end if;
    end loop;
    update clinic_people.person_shifts set valid_to = from_d - 1 where person_id = pid and valid_from < from_d and (valid_to is null or valid_to >= from_d);
    delete from clinic_people.person_shifts where person_id = pid and valid_from >= from_d;
    for k in select g::text from generate_series(0, 6) g loop
      insert into clinic_people.person_shifts(person_id, dow, template_id, valid_from, created_by) values (pid, k::smallint, nullif(p_payload->'days'->>k, '')::uuid, from_d, me);
    end loop;
    insert into clinic_people.audit(actor_id, action, record_id, after_data) values (me, 'shift_schedule', pid, p_payload);
    return pid;
  else raise exception 'إجراء غير متاح';
  end if;
end $$;

create function public.hr_attendance_today(p_day date default null) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Cairo')::date);
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  return jsonb_build_object(
    'day', d, 'now', now(),
    'has_schedule', exists (select 1 from clinic_people.person_shifts),
    'unscheduled', (select count(*) from clinic_people.people p where p.status <> 'ended' and p.kind <> 'doctor' and not exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id)),
    'rows', (
      with weekly as (
        select e.person_id, count(*) filter (where e.status = 'late') as late_week, count(*) filter (where e.status = 'absent') as absent_week
        from generate_series(d - 6, d - 1, interval '1 day') g(x), lateral clinic_people.attendance_eval(g.x::date, now()) e group by e.person_id)
      select coalesce(jsonb_agg(jsonb_build_object(
        'person_id', e.person_id, 'full_name', p.full_name, 'code', p.code, 'department', p.department, 'job_title', p.job_title,
        'template_id', e.template_id, 'template_name', e.template_name, 'color', e.color, 'grace', e.grace,
        'exp_start', e.exp_start, 'exp_end', e.exp_end, 'first_in', e.first_in, 'status', e.status, 'late_min', e.late_min, 'since_start', e.since_start,
        'excused', e.excused, 'late_week', coalesce(w.late_week, 0), 'absent_week', coalesce(w.absent_week, 0))
        order by case e.status when 'absent' then 0 when 'late' then 1 when 'waiting' then 2 when 'on_time' then 3 when 'upcoming' then 4 when 'leave' then 5 else 6 end,
          e.since_start desc nulls last, p.full_name), '[]'::jsonb)
      from clinic_people.attendance_eval(d, now()) e join clinic_people.people p on p.id = e.person_id left join weekly w on w.person_id = e.person_id));
end $$;

revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;
revoke all on function public.hr_shifts_workspace(), public.hr_shifts_command(text, jsonb), public.hr_attendance_today(date) from public, anon;
grant execute on function public.hr_shifts_workspace(), public.hr_shifts_command(text, jsonb), public.hr_attendance_today(date) to authenticated;

commit;
