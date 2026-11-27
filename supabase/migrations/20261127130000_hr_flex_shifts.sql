-- HR «ورديات مرنة» + «وردية اليوم السريعة» (owner 2026-11-27, mockup docs/ui-references/mockups/hr-flex-shifts.html — «موافق»).
-- Owner answers (via main chat 7): (1) a quick shift on the weekly rest day → the screen asks, default «إضافي» (paid as an extra
-- day); (2) staff whose shift follows the doctor keep a FIXED monthly salary; (3) a doctor day with two sittings far apart = two periods.
--
-- A) «وردية اليوم السريعة»: one shift for ONE day only (from HH:MI to HH:MI) on a day that has no shift. Set by HR
--    (clinic_people.manage()) or the person's direct manager (clinic_people.overtime_can_review: never for oneself).
--    Today and later (up to 60 days); HR alone may also fix the last 3 days. Refused on approved leave / center closure days
--    and on a day that already has a shift (weekly shift, swap, doctor shift or another quick shift).
--    On the weekly rest day the caller must choose extra=true («يوم إضافي») or false («يوم عادي»).
-- B) «وردية حسب تواجد الطبيب»: clinic_people.flex_links ties a person (HR only) to one or more doctors (reception providers) or a
--    whole department, with minutes before the first sitting / after the last. The weekly pattern is then ignored for those days.
--    Every day the person's periods are computed from the LIVE reception availability of those doctors (walk-in windows excluded;
--    a doctor exception already deletes / replaces availability), merged when the gap is <= split_gap_min (default 120),
--    so a far-apart second sitting is a second period. Results are stored in clinic_people.day_shifts (source 'doctor'),
--    refreshed by: statement triggers on availability (never blocking reception: errors become warnings), a nightly cron, and
--    flex_save / refresh. A stored doctor shift is frozen from 2 hours before its start; after that it only disappears when the
--    doctor's availability is gone AND the person has not clocked in (then it is «مفيش شغل», never absence).
--    No doctor that day → no shift → not absent (fixed salary: no deduction, no pay change).
-- C) Attendance: clinic_people.attendance_eval's innermost layer (attendance_eval_before_closures) is wrapped (old body kept as
--    attendance_eval_before_day_shifts, nothing dropped). Precedence: swap override > quick shift > doctor shift > weekly pattern.
--    Closures / leave / missions keep applying on top (their wrappers are untouched). exp_start = first period start, exp_end = last
--    period end; late_min = lateness at the first period + lateness back from the break at later periods (only when the person
--    clocked out in the break and back in after that period start; counted from the start like the first period). template_id is null for these rows.
-- D) Readers patched in place (each anchor must match exactly once): hr_attendance_today.unscheduled and hr_attendance_range.people
--    count flex / day-shift people as scheduled; hr_shifts_workspace people get 'flex'; nurse_presence 'off' returns the first
--    check-in of the day + person_id + can_quick; clinic_reception_nursing('staff_today') passes them on (new keys only).
-- E) Payroll: public.hr_payroll_calculate is wrapped: every worked (approved attendance with an arrival) quick shift with extra=true
--    adds one day at the person's pay rule absence_day rate to the allowance (extra_days / extra_days_pay in the result).
-- RPC: public.hr_day_shift(action, payload): month / quick_save / quick_cancel / providers / preview / flex_save / flex_stop / refresh.
-- Rollback: supabase/rollbacks/20261127130000_hr_flex_shifts.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_people.attendance_eval_before_closures(date,timestamptz)') is null
     or to_regprocedure('clinic_people.attendance_eval_before_missions(date,timestamptz)') is null then raise exception 'طبّق ملفات الحضور (الأجازات الرسمية والمهمات) أولًا'; end if;
  if to_regprocedure('clinic_people.attendance_eval_before_day_shifts(date,timestamptz)') is not null or to_regclass('clinic_people.day_shifts') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.availability') is null or to_regclass('clinic_reception.providers') is null then raise exception 'جدول مواعيد الأطباء غير موجود'; end if;
  if to_regprocedure('clinic_people.overtime_can_review(uuid)') is null or to_regprocedure('public.hr_payroll_calculate(uuid,date)') is null then raise exception 'طبّق الأوفر تايم والمرتبات أولًا'; end if;
  if to_regprocedure('clinic_reception.nurse_presence(uuid,date)') is null then raise exception 'طبّق حضور التمريض أولًا'; end if;
end $$;

-- 1. data
create table clinic_people.flex_links(
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references clinic_people.people(id),
  provider_ids uuid[] not null default '{}',
  department text,
  before_min integer not null default 30 check (before_min between 0 and 180),
  after_min integer not null default 15 check (after_min between 0 and 180),
  split_gap_min integer not null default 120 check (split_gap_min between 30 and 600),
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  valid_from date not null,
  valid_to date,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from - 1),
  check (cardinality(provider_ids) > 0 or nullif(trim(department), '') is not null));
create index flex_links_person on clinic_people.flex_links(person_id, valid_from desc);

create table clinic_people.day_shifts(
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references clinic_people.people(id),
  day date not null,
  period smallint not null default 1 check (period between 1 and 6),
  start_at timestamptz not null,
  end_at timestamptz not null,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  source text not null check (source in ('quick', 'doctor')),
  extra boolean not null default false,
  provider_ids uuid[] not null default '{}',
  note text check (note is null or length(note) <= 300),
  active boolean not null default true,
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.admins(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (end_at > start_at and end_at - start_at <= interval '18 hours'),
  check (source = 'quick' or not extra));
create unique index day_shifts_one_active on clinic_people.day_shifts(person_id, day, source, period) where active;
create index day_shifts_day on clinic_people.day_shifts(day) where active;

alter table clinic_people.flex_links enable row level security;
alter table clinic_people.day_shifts enable row level security;
revoke all on clinic_people.flex_links, clinic_people.day_shifts from public, anon, authenticated;

-- 2. helpers
create function clinic_people.flex_link_on(p_person uuid, p_day date) returns clinic_people.flex_links
language sql stable security definer set search_path = pg_catalog, public as $$
  select l.* from clinic_people.flex_links l
   where l.person_id = p_person and l.valid_from <= p_day and (l.valid_to is null or l.valid_to >= p_day)
   order by l.valid_from desc, l.created_at desc limit 1
$$;

-- the periods one link gives on one day (live reception availability; walk-in windows excluded)
create function clinic_people.flex_periods(p_link clinic_people.flex_links, p_day date)
returns table(period integer, start_at timestamptz, end_at timestamptz, provider_ids uuid[], names text)
language sql stable security definer set search_path = pg_catalog, public as $$
  with av as (
    select a.starts_at s, a.ends_at e, a.provider_id pid, pv.name
      from clinic_reception.availability a
      join clinic_reception.providers pv on pv.id = a.provider_id and pv.active
      join clinic_reception.workspaces w on w.id = a.workspace_id and w.mode = 'live'
     where (a.starts_at at time zone 'Africa/Cairo')::date = p_day and coalesce(a.source, 'manual') <> 'walk_in'
       and (a.provider_id = any(p_link.provider_ids) or (nullif(trim(p_link.department), '') is not null and pv.department = p_link.department))),
  o as (select av.*, max(av.e) over (order by av.s, av.e rows between unbounded preceding and 1 preceding) prev_end from av),
  g as (select o.*, sum(case when o.prev_end is null or o.s - o.prev_end > make_interval(mins => p_link.split_gap_min) then 1 else 0 end)
                     over (order by o.s, o.e rows unbounded preceding) grp from o)
  select g.grp::int, min(g.s) - make_interval(mins => p_link.before_min), max(g.e) + make_interval(mins => p_link.after_min),
         array_agg(distinct g.pid), string_agg(distinct g.name, ' · ')
    from g group by g.grp order by g.grp
$$;

-- does the person clock in (any check-in punch) between two moments
create function clinic_people.flex_punched(p_person uuid, p_from timestamptz, p_to timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_people.device_punches d join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
                  where m.person_id = p_person and d.punch in (0, 3, 4) and d.ts between p_from and p_to)
$$;

-- rebuild the stored doctor shifts of [p_from, p_to] (one person or everybody linked); returns rows changed
create function clinic_people.flex_refresh(p_from date, p_to date, p_person uuid default null) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d date; r record; lk clinic_people.flex_links; n integer := 0; cur jsonb; nxt jsonb; frozen boolean; fst timestamptz;
begin
  if p_to < p_from or p_to - p_from > 92 then raise exception 'المدة لازم تكون من 1 لـ 93 يوم'; end if;
  for r in select distinct l.person_id from clinic_people.flex_links l join clinic_people.people p on p.id = l.person_id and p.status <> 'ended'
            where (p_person is null or l.person_id = p_person) and l.valid_from <= p_to and (l.valid_to is null or l.valid_to >= p_from)
           union
           select distinct s.person_id from clinic_people.day_shifts s where s.source = 'doctor' and s.active and s.day between p_from and p_to and (p_person is null or s.person_id = p_person) loop
    for d in select generate_series(p_from, p_to, interval '1 day')::date loop
      lk := clinic_people.flex_link_on(r.person_id, d);
      select coalesce(jsonb_agg(jsonb_build_array(s.start_at, s.end_at) order by s.period), '[]'::jsonb), min(s.start_at) into cur, fst
        from clinic_people.day_shifts s where s.person_id = r.person_id and s.day = d and s.source = 'doctor' and s.active;
      if lk.id is null or exists (select 1 from clinic_people.day_shifts q where q.person_id = r.person_id and q.day = d and q.source = 'quick' and q.active) then
        nxt := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(jsonb_build_array(f.start_at, f.end_at) order by f.period), '[]'::jsonb) into nxt from clinic_people.flex_periods(lk, d) f;
      end if;
      if cur = nxt then continue; end if;
      frozen := fst is not null and now() >= fst - interval '2 hours';
      if frozen then
        -- frozen: only a cancelled doctor day (nothing left) for someone who has not clocked in is removed
        if nxt <> '[]'::jsonb or clinic_people.flex_punched(r.person_id, fst - interval '3 hours', now()) then continue; end if;
      end if;
      update clinic_people.day_shifts set active = false, cancelled_at = now(), cancel_reason = case when nxt = '[]'::jsonb then 'doctor_off' else 'doctor_changed' end
       where person_id = r.person_id and day = d and source = 'doctor' and active;
      if nxt <> '[]'::jsonb then
        insert into clinic_people.day_shifts(person_id, day, period, start_at, end_at, grace_minutes, source, provider_ids, note)
        select r.person_id, d, f.period, f.start_at, f.end_at, lk.grace_minutes, 'doctor', f.provider_ids, left(f.names, 300) from clinic_people.flex_periods(lk, d) f;
      end if;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- reception availability changed → refresh the affected days (never blocks reception)
create function clinic_people.flex_on_availability() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a date; b date; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not exists (select 1 from clinic_people.flex_links) then return null; end if;
  if tg_op = 'INSERT' then select min((starts_at at time zone 'Africa/Cairo')::date), max((starts_at at time zone 'Africa/Cairo')::date) into a, b from flex_new;
  elsif tg_op = 'DELETE' then select min((starts_at at time zone 'Africa/Cairo')::date), max((starts_at at time zone 'Africa/Cairo')::date) into a, b from flex_old;
  else select min(x), max(x) into a, b from (select (starts_at at time zone 'Africa/Cairo')::date x from flex_new union all select (starts_at at time zone 'Africa/Cairo')::date from flex_old) u;
  end if;
  if a is null then return null; end if;
  a := greatest(a, today); b := least(b, today + 92);
  if b >= a then
    begin perform clinic_people.flex_refresh(a, b);
    exception when others then raise warning 'flex_refresh skipped: %', sqlerrm; end;
  end if;
  return null;
end $$;
create trigger flex_avail_ins after insert on clinic_reception.availability referencing new table as flex_new for each statement execute function clinic_people.flex_on_availability();
create trigger flex_avail_del after delete on clinic_reception.availability referencing old table as flex_old for each statement execute function clinic_people.flex_on_availability();
create trigger flex_avail_upd after update on clinic_reception.availability referencing new table as flex_new old table as flex_old for each statement execute function clinic_people.flex_on_availability();

-- 3. attendance: wrap the innermost layer
alter function clinic_people.attendance_eval_before_closures(date, timestamptz) rename to attendance_eval_before_day_shifts;
revoke all on function clinic_people.attendance_eval_before_day_shifts(date, timestamptz) from public, anon, authenticated;
create function clinic_people.attendance_eval_before_closures(p_day date, p_now timestamptz default now())
returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
  device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with swp as (select o.person_id from clinic_people.shift_overrides o where o.day = p_day and o.active),
  act as (
    select s.* from clinic_people.day_shifts s join clinic_people.people p on p.id = s.person_id and p.status <> 'ended' and p.kind <> 'doctor'
     where s.day = p_day and s.active and s.person_id not in (select swp.person_id from swp)),
  plan as (  -- a quick shift wins over the doctor shift of the same day
    select a.* from act a where a.source = 'quick' or not exists (select 1 from act q where q.person_id = a.person_id and q.source = 'quick')),
  flexp as (
    select distinct l.person_id from clinic_people.flex_links l
     where l.valid_from <= p_day and (l.valid_to is null or l.valid_to >= p_day) and l.person_id not in (select swp.person_id from swp)),
  hd as (
    select pl.person_id, min(pl.source) src, min(pl.start_at) exp_start, max(pl.end_at) exp_end, max(pl.grace_minutes) grace, bool_or(pl.extra) extra,
           string_agg(distinct pl.note, ' · ') notes from plan pl group by pl.person_id),
  j as (
    select hd.*, m.device_id, m.device_user_id,
      (select min(d.ts) from clinic_people.device_punches d where d.device_id = m.device_id and d.device_user_id = m.device_user_id and d.punch in (0, 3, 4)
          and d.ts between hd.exp_start - interval '3 hours' and hd.exp_end) first_in
    from hd left join clinic_people.device_user_map m on m.person_id = hd.person_id),
  later as (  -- back late from the break: clocked out in the gap, clocked in after the next period's start
    select pl.person_id, sum(greatest(0, floor(extract(epoch from (bk.back - pl.start_at)) / 60)))::int mins
      from plan pl join j on j.person_id = pl.person_id
      cross join lateral (select max(o.ts) out_at from clinic_people.device_punches o
                           where o.device_id = j.device_id and o.device_user_id = j.device_user_id and o.punch in (1, 5)
                             and o.ts between (select max(p2.end_at) from plan p2 where p2.person_id = pl.person_id and p2.period < pl.period) - interval '30 minutes' and pl.start_at) ot
      cross join lateral (select min(i.ts) back from clinic_people.device_punches i
                           where ot.out_at is not null and i.device_id = j.device_id and i.device_user_id = j.device_user_id and i.punch in (0, 3, 4)
                             and i.ts > ot.out_at and i.ts <= pl.end_at) bk
     where pl.period > (select min(p3.period) from plan p3 where p3.person_id = pl.person_id)
       and bk.back is not null and bk.back > pl.start_at
     group by pl.person_id),
  lv as (
    select r.person_id, bool_or(r.kind = 'leave') as leave, bool_or(r.kind = 'permission') as perm
      from clinic_people.requests r
     where r.status = 'approved' and r.kind in ('leave', 'permission') and p_day between r.from_date and r.to_date group by r.person_id)
  select e.person_id, e.template_id, e.template_name, e.color, e.grace, e.exp_start, e.exp_end, e.device_user_id, e.first_in, e.status, e.late_min, e.since_start, e.excused
    from clinic_people.attendance_eval_before_day_shifts(p_day, p_now) e
   where e.person_id not in (select hd.person_id from hd) and e.person_id not in (select flexp.person_id from flexp)
  union all
  select j.person_id, null::uuid,
    case when j.src = 'quick' then 'وردية اليوم' || case when j.extra then ' (إضافي)' else '' end else 'حسب الطبيب' end,
    case when j.src = 'quick' then '#F15A22' else '#0F369D' end,
    j.grace, j.exp_start, j.exp_end, j.device_user_id, j.first_in,
    case
      when coalesce(lv.leave, false) then 'leave'
      when j.device_user_id is null then 'unmapped'
      when j.first_in is not null then case when j.first_in > j.exp_start + make_interval(mins => j.grace) then 'late' else 'on_time' end
      when p_now < j.exp_start then 'upcoming'
      when p_now <= j.exp_start + make_interval(mins => j.grace) then 'waiting'
      else 'absent' end,
    (case when j.first_in is not null and j.first_in > j.exp_start then floor(extract(epoch from (j.first_in - j.exp_start)) / 60)::integer else 0 end) + coalesce(lt.mins, 0),
    case when p_now > j.exp_start then floor(extract(epoch from (p_now - j.exp_start)) / 60)::integer else null end,
    coalesce(lv.perm, false)
  from j left join lv on lv.person_id = j.person_id left join later lt on lt.person_id = j.person_id
$$;
revoke all on function clinic_people.attendance_eval_before_closures(date, timestamptz) from public, anon, authenticated;

-- 4. readers: anchored in-place patches of the live definitions
create function pg_temp.flex_patch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $p$
declare def text := pg_get_functiondef(p_fn); i int; n int;
begin
  insert into clinic_people.flex_saved_defs(fn, def) values (p_fn::text, def);
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    n := (length(def) - length(replace(def, p_pairs[2*i-1], ''))) / length(p_pairs[2*i-1]);
    if n <> 1 then raise exception 'مقطع % من % موجود % مرة (المتوقع مرة واحدة)؛ الدالة اتغيرت على السيرفر', i, p_fn, n; end if;
    def := replace(def, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  execute def;
end $p$;
create table clinic_people.flex_saved_defs(fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table clinic_people.flex_saved_defs enable row level security;
revoke all on clinic_people.flex_saved_defs from public, anon, authenticated;

select pg_temp.flex_patch('public.hr_attendance_today(date)', array[
  $a$and not exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id)),$a$,
  $a$and not exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id) and not exists (select 1 from clinic_people.flex_links fl where fl.person_id = p.id and (fl.valid_to is null or fl.valid_to >= d))),$a$]);

select pg_temp.flex_patch('public.hr_attendance_range(date,date)', array[
  $a$and exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id and s.valid_from <= v_to and (s.valid_to is null or s.valid_to >= p_from))),$a$,
  $a$and (exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id and s.valid_from <= v_to and (s.valid_to is null or s.valid_to >= p_from))
             or exists (select 1 from clinic_people.flex_links fl where fl.person_id = p.id and fl.valid_from <= v_to and (fl.valid_to is null or fl.valid_to >= p_from))
             or exists (select 1 from clinic_people.day_shifts ds where ds.person_id = p.id and ds.active and ds.day between p_from and v_to))),$a$]);

select pg_temp.flex_patch('public.hr_shifts_workspace()', array[
  $a$'since', cur.since, 'days', coalesce(cur.days, '{}'::jsonb))$a$,
  $a$'since', cur.since, 'days', coalesce(cur.days, '{}'::jsonb), 'flex', exists (select 1 from clinic_people.flex_links fl where fl.person_id = p.id and (fl.valid_to is null or fl.valid_to >= (now() at time zone 'Africa/Cairo')::date)))$a$]);

select pg_temp.flex_patch('clinic_reception.nurse_presence(uuid,date)', array[
  $a$if not found then return jsonb_build_object('state', 'off'); end if;$a$,
  $a$if not found then
    return jsonb_build_object('state', 'off', 'person_id', pid, 'can_quick', clinic_people.overtime_can_review(pid),
      'punch_in', (select min(dp.ts) from clinic_people.device_punches dp join clinic_people.device_user_map mp on mp.device_id = dp.device_id and mp.device_user_id = dp.device_user_id
                    where mp.person_id = pid and dp.punch in (0, 3, 4) and (dp.ts at time zone 'Africa/Cairo')::date = p_day));
  end if;$a$]);

-- staff_today lives in whichever nursing layer still holds it (20261125210000 moved it to clinic_reception.nursing_before_vitals)
do $$ declare f regprocedure; n int; begin
  select count(*), min(p.oid::regprocedure::text)::regprocedure into n, f from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'clinic_reception') and p.prokind = 'f' and (p.proname = 'clinic_reception_nursing' or p.proname like 'nursing\_before\_%')
     and pg_get_functiondef(p.oid) like '%''late_min'', case when mgr or public.has_role(''head_nursing'') or ns.id = me then (ns.pr->>''late_min'')::int end,%';
  if n <> 1 then raise exception 'لوحة التمريض staff_today موجودة في % دالة (المتوقع واحدة)', n; end if;
  perform pg_temp.flex_patch(f, array[
  $a$'late_min', case when mgr or public.has_role('head_nursing') or ns.id = me then (ns.pr->>'late_min')::int end,$a$,
  $a$'late_min', case when mgr or public.has_role('head_nursing') or ns.id = me then (ns.pr->>'late_min')::int end,
            'punch_in', ns.pr->'punch_in', 'person_id', case when coalesce((ns.pr->>'can_quick')::boolean, false) then ns.pr->'person_id' end, 'can_quick', coalesce((ns.pr->>'can_quick')::boolean, false),$a$]);
end $$;

-- 5. payroll: worked extra quick days are paid at the absence_day rate
alter function public.hr_payroll_calculate(uuid, date) set schema clinic_people;
alter function clinic_people.hr_payroll_calculate(uuid, date) rename to payroll_before_flex_shifts;
revoke all on function clinic_people.payroll_before_flex_shifts(uuid, date) from public, anon, authenticated;
create function public.hr_payroll_calculate(p_person uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare b jsonb; dt date; rate numeric; days integer; pay numeric; allow numeric; base numeric; ded numeric; gross numeric;
begin
  b := clinic_people.payroll_before_flex_shifts(p_person, p_month);
  dt := (b->>'month')::date;
  if dt is null then return b; end if;
  select count(distinct s.day) into days from clinic_people.day_shifts s
   where s.person_id = p_person and s.source = 'quick' and s.extra and s.active and s.day between dt and (dt + interval '1 month' - interval '1 day')::date
     and exists (select 1 from clinic_people.attendance a where a.person_id = p_person and a.day = s.day and a.status = 'approved' and a.actual_start is not null);
  if coalesce(days, 0) = 0 then return b || jsonb_build_object('extra_days', 0, 'extra_days_pay', 0); end if;
  select coalesce(r.absence_day, 0) into rate from clinic_people.pay_rules r where r.id = (b->>'rule_id')::uuid;
  pay := round(days * coalesce(rate, 0), 2);
  allow := coalesce((b->>'allowance')::numeric, 0) + pay;
  base := coalesce((b->>'base')::numeric, 0);
  gross := base + allow;
  ded := least(coalesce((b->>'salary_deduction')::numeric, 0), gross);
  return b || jsonb_build_object('extra_days', days, 'extra_days_pay', pay, 'allowance', allow, 'salary_deduction', ded, 'pre_tax_net', gross - ded);
end $$;

-- 6. the RPC
create function clinic_people.day_shift_json(s clinic_people.day_shifts) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('id', s.id, 'day', s.day, 'period', s.period, 'source', s.source, 'extra', s.extra,
    'start', to_char(s.start_at at time zone 'Africa/Cairo', 'HH24:MI'), 'end', to_char(s.end_at at time zone 'Africa/Cairo', 'HH24:MI'),
    'start_at', s.start_at, 'end_at', s.end_at, 'grace', s.grace_minutes, 'note', s.note, 'active', s.active, 'cancel_reason', s.cancel_reason,
    'created_by_name', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = s.created_by), 'created_at', s.created_at)
$$;

create function public.hr_day_shift(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); hr boolean; today date := (now() at time zone 'Africa/Cairo')::date;
  pid uuid; d date; d2 date; st time; en time; sa timestamptz; ea timestamptz; gr integer; ws record; s clinic_people.day_shifts; lk clinic_people.flex_links;
  provs uuid[]; dep text; bm integer; am integer; sg integer; vf date; nt text; ex boolean; res jsonb;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  hr := clinic_people.manage();
  pid := nullif(p_payload->>'person_id', '')::uuid;

  if p_action = 'month' then
    if pid is null then raise exception 'اختار الموظف'; end if;
    if not (hr or clinic_people.overtime_can_review(pid) or exists (select 1 from clinic_people.people p where p.id = pid and p.admin_id = me)) then
      raise exception 'مش مسموح تشوف ورديات الموظف ده' using errcode = '42501'; end if;
    d := coalesce(nullif(p_payload->>'from', '')::date, date_trunc('month', today)::date);
    d2 := coalesce(nullif(p_payload->>'to', '')::date, (d + interval '1 month' - interval '1 day')::date);
    if d2 < d or d2 - d > 62 then raise exception 'المدة كبيرة'; end if;
    lk := clinic_people.flex_link_on(pid, greatest(d, least(today, d2)));
    return jsonb_build_object('today', today, 'can_quick', clinic_people.overtime_can_review(pid), 'can_fix_past', hr, 'can_flex', hr,
      'flex', case when lk.id is null then null else jsonb_build_object('id', lk.id, 'provider_ids', to_jsonb(lk.provider_ids), 'department', lk.department,
        'before_min', lk.before_min, 'after_min', lk.after_min, 'split_gap_min', lk.split_gap_min, 'grace', lk.grace_minutes, 'valid_from', lk.valid_from, 'valid_to', lk.valid_to,
        'doctors', (select coalesce(jsonb_agg(pv.name order by pv.name), '[]'::jsonb) from clinic_reception.providers pv where pv.id = any(lk.provider_ids))) end,
      'flex_days', (select coalesce(jsonb_agg(g.x::date order by g.x), '[]'::jsonb) from generate_series(d, d2, interval '1 day') g(x)
                     where (clinic_people.flex_link_on(pid, g.x::date)).id is not null),
      'shifts', (select coalesce(jsonb_agg(clinic_people.day_shift_json(x) order by x.day, x.period), '[]'::jsonb) from clinic_people.day_shifts x
                  where x.person_id = pid and x.day between d and d2 and (x.active or x.cancel_reason = 'doctor_off')));

  elsif p_action = 'quick_save' then
    if pid is null then raise exception 'اختار الموظف'; end if;
    if not exists (select 1 from clinic_people.people p where p.id = pid and p.status <> 'ended' and p.kind <> 'doctor') then raise exception 'الموظف غير موجود'; end if;
    if not clinic_people.overtime_can_review(pid) then raise exception 'وردية اليوم للموارد البشرية أو المدير المباشر (ومش لنفسك)' using errcode = '42501'; end if;
    begin d := (p_payload->>'day')::date; st := (p_payload->>'start')::time; en := (p_payload->>'end')::time;
    exception when others then raise exception 'راجع اليوم والساعات'; end;
    if d is null or st is null or en is null then raise exception 'اكتب اليوم ومن الساعة وللساعة'; end if;
    if d > today + 60 then raise exception 'تقدر تحط وردية لحد 60 يوم قدام بس'; end if;
    if d < today and not hr then raise exception 'الأيام اللي فاتت للموارد البشرية بس'; end if;
    if d < today - 3 then raise exception 'مينفعش تحط وردية لأكتر من 3 أيام فاتوا'; end if;
    if st = en then raise exception 'وقت البداية والنهاية لازم يختلفوا'; end if;
    sa := (d + st) at time zone 'Africa/Cairo';
    ea := ((d + case when en <= st then 1 else 0 end) + en) at time zone 'Africa/Cairo';
    if ea - sa < interval '1 hour' or ea - sa > interval '16 hours' then raise exception 'الوردية لازم تكون من ساعة لـ 16 ساعة'; end if;
    gr := coalesce(nullif(p_payload->>'grace', '')::int, 10);
    if gr < 0 or gr > 120 then raise exception 'السماح من 0 لـ 120 دقيقة'; end if;
    nt := nullif(trim(coalesce(p_payload->>'note', '')), '');
    if nt is not null and length(nt) > 300 then raise exception 'السبب طويل (300 حرف بالكتير)'; end if;
    perform pg_advisory_xact_lock(hashtext('hr_day_shift:' || pid::text || d::text));
    if clinic_people.center_closed_on(d) then raise exception 'المركز مقفول اليوم ده (أجازة رسمية)'; end if;
    if exists (select 1 from clinic_people.requests r where r.person_id = pid and r.kind = 'leave' and r.status = 'approved' and d between r.from_date and r.to_date) then
      raise exception 'الموظف عنده إجازة معتمدة اليوم ده'; end if;
    if exists (select 1 from clinic_people.shift_overrides o where o.person_id = pid and o.day = d and o.active) then raise exception 'اليوم ده فيه تبديل وردية'; end if;
    if exists (select 1 from clinic_people.day_shifts x where x.person_id = pid and x.day = d and x.active) then raise exception 'اليوم ده فيه وردية بالفعل'; end if;
    lk := clinic_people.flex_link_on(pid, d);
    select w.scheduled, w.template_id into ws from clinic_people.weekly_slot(pid, d) w;
    if lk.id is null and ws.scheduled and ws.template_id is not null then raise exception 'اليوم ده فيه وردية أسبوعية بالفعل'; end if;
    ex := false;
    if lk.id is null and ws.scheduled and ws.template_id is null then
      if p_payload->'extra' is null or jsonb_typeof(p_payload->'extra') <> 'boolean' then raise exception 'ده يوم إجازته الأسبوعية — اختار: يوم إضافي ولا يوم عادي'; end if;
      ex := (p_payload->>'extra')::boolean;
    end if;
    insert into clinic_people.day_shifts(person_id, day, period, start_at, end_at, grace_minutes, source, extra, note, created_by)
    values (pid, d, 1, sa, ea, gr, 'quick', ex, nt, me) returning * into s;
    return clinic_people.day_shift_json(s);

  elsif p_action = 'quick_cancel' then
    select * into s from clinic_people.day_shifts where id = nullif(p_payload->>'id', '')::uuid and source = 'quick' and active for update;
    if not found then raise exception 'الوردية مش موجودة'; end if;
    if not clinic_people.overtime_can_review(s.person_id) then raise exception 'الإلغاء للموارد البشرية أو المدير المباشر' using errcode = '42501'; end if;
    if not hr and s.day < today then raise exception 'إلغاء وردية يوم فات للموارد البشرية بس'; end if;
    if not hr and now() >= s.start_at and clinic_people.flex_punched(s.person_id, s.start_at - interval '3 hours', s.end_at) then
      raise exception 'الموظف بصم في الوردية دي — الإلغاء للموارد البشرية بس'; end if;
    update clinic_people.day_shifts set active = false, cancelled_by = me, cancelled_at = now(), cancel_reason = coalesce(nullif(trim(coalesce(p_payload->>'reason', '')), ''), 'cancelled')
     where id = s.id returning * into s;
    perform clinic_people.flex_refresh(s.day, s.day, s.person_id);
    return clinic_people.day_shift_json(s);

  elsif p_action = 'providers' then
    if not hr then raise exception 'تحتاج إدارة الموارد البشرية' using errcode = '42501'; end if;
    return jsonb_build_object(
      'doctors', (select coalesce(jsonb_agg(jsonb_build_object('id', pv.id, 'name', pv.name, 'department', pv.department) order by pv.department, pv.name), '[]'::jsonb)
                  from clinic_reception.providers pv join clinic_reception.workspaces w on w.id = pv.workspace_id and w.mode = 'live' where pv.active),
      'departments', (select coalesce(jsonb_agg(distinct pv.department), '[]'::jsonb)
                  from clinic_reception.providers pv join clinic_reception.workspaces w on w.id = pv.workspace_id and w.mode = 'live' where pv.active));

  elsif p_action in ('preview', 'flex_save') then
    if not hr then raise exception 'ربط الوردية بالطبيب للموارد البشرية بس' using errcode = '42501'; end if;
    if pid is null and p_action = 'flex_save' then raise exception 'اختار الموظف'; end if;
    select coalesce(array_agg(x::uuid), '{}') into provs from jsonb_array_elements_text(coalesce(p_payload->'provider_ids', '[]'::jsonb)) x;
    dep := nullif(trim(coalesce(p_payload->>'department', '')), '');
    if cardinality(provs) = 0 and dep is null then raise exception 'اختار طبيب واحد على الأقل أو قسم'; end if;
    if exists (select 1 from unnest(provs) u where not exists (select 1 from clinic_reception.providers pv where pv.id = u and pv.active)) then raise exception 'طبيب غير موجود'; end if;
    bm := coalesce(nullif(p_payload->>'before_min', '')::int, 30); am := coalesce(nullif(p_payload->>'after_min', '')::int, 15);
    sg := coalesce(nullif(p_payload->>'split_gap_min', '')::int, 120); gr := coalesce(nullif(p_payload->>'grace', '')::int, 10);
    if bm not between 0 and 180 or am not between 0 and 180 then raise exception 'الهامش من 0 لـ 180 دقيقة'; end if;
    if sg not between 30 and 600 then raise exception 'فرق الفترتين من 30 لـ 600 دقيقة'; end if;
    if gr not between 0 and 120 then raise exception 'السماح من 0 لـ 120 دقيقة'; end if;
    vf := coalesce(nullif(p_payload->>'valid_from', '')::date, today);
    lk := row(gen_random_uuid(), pid, provs, dep, bm, am, sg, gr, vf, null, me, now())::clinic_people.flex_links;
    if p_action = 'preview' then
      return jsonb_build_object('days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.x::date,
          'periods', (select coalesce(jsonb_agg(jsonb_build_object('start', to_char(f.start_at at time zone 'Africa/Cairo', 'HH24:MI'), 'end', to_char(f.end_at at time zone 'Africa/Cairo', 'HH24:MI'), 'doctors', f.names) order by f.period), '[]'::jsonb)
                      from clinic_people.flex_periods(lk, g.x::date) f)) order by g.x), '[]'::jsonb)
        from generate_series(vf, vf + 6, interval '1 day') g(x)));
    end if;
    if not exists (select 1 from clinic_people.people p where p.id = pid and p.status <> 'ended' and p.kind <> 'doctor') then raise exception 'الموظف غير موجود'; end if;
    if vf < today then raise exception 'الربط يبدأ من النهارده أو بعده'; end if;
    perform pg_advisory_xact_lock(hashtext('hr_flex:' || pid::text));
    update clinic_people.flex_links set valid_to = vf - 1 where person_id = pid and (valid_to is null or valid_to >= vf) and valid_from < vf;
    delete from clinic_people.flex_links where person_id = pid and valid_from >= vf;
    insert into clinic_people.flex_links(person_id, provider_ids, department, before_min, after_min, split_gap_min, grace_minutes, valid_from, created_by)
    values (pid, provs, dep, bm, am, sg, gr, vf, me) returning * into lk;
    perform clinic_people.flex_refresh(vf, vf + 28, pid);
    return jsonb_build_object('id', lk.id, 'valid_from', lk.valid_from);

  elsif p_action = 'flex_stop' then
    if not hr then raise exception 'تحتاج إدارة الموارد البشرية' using errcode = '42501'; end if;
    vf := coalesce(nullif(p_payload->>'from', '')::date, today);
    if vf < today then raise exception 'الإيقاف من النهارده أو بعده'; end if;
    if pid is null or (clinic_people.flex_link_on(pid, vf)).id is null then raise exception 'الموظف مش مربوط بطبيب'; end if;
    update clinic_people.flex_links set valid_to = vf - 1 where person_id = pid and (valid_to is null or valid_to >= vf) and valid_from < vf;
    delete from clinic_people.flex_links where person_id = pid and valid_from >= vf;
    perform clinic_people.flex_refresh(vf, vf + 28, pid);
    return jsonb_build_object('stopped_from', vf);

  elsif p_action = 'refresh' then
    if not hr then raise exception 'تحتاج إدارة الموارد البشرية' using errcode = '42501'; end if;
    return jsonb_build_object('changed', clinic_people.flex_refresh(today, today + 28, pid));
  end if;
  raise exception 'إجراء غير معروف';
end $$;

revoke all on function clinic_people.flex_link_on(uuid, date), clinic_people.flex_periods(clinic_people.flex_links, date), clinic_people.flex_punched(uuid, timestamptz, timestamptz),
  clinic_people.flex_refresh(date, date, uuid), clinic_people.flex_on_availability(), clinic_people.day_shift_json(clinic_people.day_shifts) from public, anon, authenticated;
revoke all on function public.hr_payroll_calculate(uuid, date), public.hr_day_shift(text, jsonb) from public, anon;
grant execute on function public.hr_payroll_calculate(uuid, date), public.hr_day_shift(text, jsonb) to authenticated;

-- 7. nightly refresh (next 28 days)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ssmpd-hr-flex-refresh', '20 0 * * *', $c$select clinic_people.flex_refresh((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date + 28);$c$);
  end if;
end $$;

commit;
