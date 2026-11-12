-- Attendance reports (تاب «التقارير»): per person, per day verdicts over a date range, for the HR reports screen.
-- ADDITIVE ONLY: 1 new SECURITY DEFINER RPC (public.hr_attendance_range). No table or existing function is changed.
-- It reuses clinic_people.attendance_eval(day, now) for every day of the range (generate_series), so the verdicts (on_time / late / absent / waiting / upcoming /
-- leave / unmapped, excused) are exactly those of the live board, and adds from the same punches: last_out (the last exit punch between the first arrival and
-- 6 hours after the shift end), early_leave_min (left before the shift end), overtime_min (stayed after the shift end) and incomplete (arrival with no exit punch
-- although the shift is over). Days a person is not scheduled (weekly day off, no pattern yet) simply have no row. The range is clamped to today (Cairo).
-- Access: HR managers only (clinic_people.manage()); at most 366 days per call. Cairo time zone everywhere.
-- Rollback: supabase/rollbacks/20261113110000_attendance_reports.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_people.attendance_eval(date, timestamptz)') is null then raise exception 'طبّق shift_schedules أولًا'; end if;
  if to_regprocedure('public.hr_attendance_range(date, date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.hr_attendance_range(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare today date := (now() at time zone 'Africa/Cairo')::date; v_now timestamptz := now(); v_to date;
begin
  if public.my_admin_id() is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'راجع تاريخ البداية والنهاية'; end if;
  if p_to - p_from > 365 then raise exception 'الفترة لا تزيد عن 366 يومًا'; end if;
  v_to := least(p_to, today);
  return jsonb_build_object(
    'from', p_from, 'to', v_to, 'today', today, 'now', v_now,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'full_name', p.full_name, 'department', p.department, 'job_title', p.job_title) order by p.department nulls last, p.full_name), '[]'::jsonb)
      from clinic_people.people p
      where p.status <> 'ended' and p.kind <> 'doctor'
        and exists (select 1 from clinic_people.person_shifts s where s.person_id = p.id and s.valid_from <= v_to and (s.valid_to is null or s.valid_to >= p_from))),
    'rows', (
      with ev as (
        select g.d::date as day, e.person_id, e.template_name, e.color, e.exp_start, e.exp_end, e.first_in, e.status, e.late_min, e.excused
        from generate_series(p_from, v_to, interval '1 day') g(d), lateral clinic_people.attendance_eval(g.d::date, v_now) e),
      x as (
        select ev.*, (select max(d.ts) from clinic_people.device_punches d
            join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
            where m.person_id = ev.person_id and d.punch in (1, 5) and ev.first_in is not null
              and d.ts >= ev.first_in and d.ts <= ev.exp_end + interval '6 hours') as last_out
        from ev)
      select coalesce(jsonb_agg(jsonb_build_object(
          'day', x.day, 'person_id', x.person_id, 'status', x.status, 'late_min', x.late_min, 'excused', x.excused,
          'template_name', x.template_name, 'color', x.color, 'first_in', x.first_in, 'last_out', x.last_out,
          'early_leave_min', case when x.last_out is not null and x.last_out < x.exp_end then floor(extract(epoch from (x.exp_end - x.last_out)) / 60)::integer else 0 end,
          'overtime_min', case when x.last_out is not null and x.last_out > x.exp_end then floor(extract(epoch from (x.last_out - x.exp_end)) / 60)::integer else 0 end,
          'incomplete', x.first_in is not null and x.last_out is null and x.exp_end < v_now)
        order by x.day, x.person_id), '[]'::jsonb)
      from x));
end $$;

revoke all on function public.hr_attendance_range(date, date) from public, anon;
grant execute on function public.hr_attendance_range(date, date) to authenticated;

commit;
