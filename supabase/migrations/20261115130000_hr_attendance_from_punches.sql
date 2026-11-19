-- HR: the fingerprint is the basis of payroll attendance (owner decision 2026-11-15: «البصمة تبقى أساس حساب المرتب
-- هي والغيابات والتأخيرات»).
-- Until now the punches + weekly shift schedules fed only the live board and the reports (attendance_eval /
-- hr_attendance_range); payroll reads clinic_people.attendance, which was filled by hand or from an Excel file.
--
-- hr_attendance_from_punches(month) turns every COMPLETED day of the month (up to yesterday, Cairo) into PENDING
-- attendance rows, through the existing governed import (hr_payroll_command 'import_attendance'), so a DIFFERENT HR
-- reviewer approves the month with the existing «مراجعة ورديات الملف» (attendance_import_review), or day by day.
--   * scheduled start/end  = the person's shift template that day (same as the live board)
--   * arrival  = first check-in punch (0/3/4) in [start-3h, end]   → lateness is computed by payroll with the pay rule
--   * leaving  = last check-out punch (1/5) between arrival and end+6h → overtime is computed by payroll
--   * no arrival punch on a scheduled day → absent row (payroll deducts the absence day)
--   * approved leave → no row (never absent); approved permission → lateness / absence excused
--   * arrival but no exit punch → leaving = shift end (no overtime), flagged in the note for the reviewer
--   * days that already have an attendance row are never touched; people without a fingerprint code are listed
-- Nothing is approved or paid here. Additive only: one new RPC.
begin;

do $$ begin
  if to_regprocedure('clinic_people.attendance_eval(date, timestamptz)') is null then raise exception 'طبّق shift_schedules أولًا'; end if;
end $$;

create or replace function public.hr_attendance_from_punches(p_month date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  today date := (now() at time zone 'Africa/Cairo')::date;
  dt date := date_trunc('month', p_month)::date;
  upto date;
  v_rows jsonb; v_import uuid; v_existing integer; v_incomplete integer; v_unmapped jsonb; v_absent integer; v_late integer;
begin
  if me is null then raise exception 'سجل الدخول'; end if;
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if p_month is null then raise exception 'اختر الشهر'; end if;
  upto := least((dt + interval '1 month' - interval '1 day')::date, today - 1);
  if upto < dt then raise exception 'لا توجد أيام مكتملة في هذا الشهر بعد'; end if;

  with ev as (
    select g.d::date as day, e.*
    from generate_series(dt, upto, interval '1 day') g(d), lateral clinic_people.attendance_eval(g.d::date, now()) e),
  x as (
    select ev.*,
      (select max(d.ts) from clinic_people.device_punches d
         join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
        where m.person_id = ev.person_id and d.punch in (1, 5) and ev.first_in is not null
          and d.ts > ev.first_in and d.ts <= ev.exp_end + interval '6 hours') as last_out,
      exists (select 1 from clinic_people.attendance a where a.person_id = ev.person_id and a.day = ev.day) as has_row
    from ev),
  todo as (
    select x.*,
      case when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start
    from x
    where not x.has_row and x.status in ('on_time', 'late', 'absent') and not (x.status = 'absent' and x.excused))
  select
    (select jsonb_agg(jsonb_build_object(
        'person_id', t.person_id, 'day', t.day, 'scheduled_start', t.exp_start, 'scheduled_end', t.exp_end,
        'actual_start', t.a_start,
        'actual_end', case when t.a_start is null then null
                           when t.last_out is not null and t.last_out > t.a_start then t.last_out
                           else greatest(t.exp_end, t.a_start + interval '1 minute') end,
        'note', 'بصمة' || case when t.status = 'absent' then ' — غياب بدون بصمة حضور'
                               when t.last_out is null or t.last_out <= t.a_start then ' — خروج غير مسجل: اعتُبر نهاية الوردية'
                               else '' end
                        || case when t.excused then ' — إذن معتمد' else '' end)
        order by t.day, t.person_id) from todo t),
    (select count(*) from x where x.has_row),
    (select count(*) from todo t where t.a_start is not null and (t.last_out is null or t.last_out <= t.a_start)),
    (select count(*) from todo t where t.status = 'absent'),
    (select count(*) from todo t where t.status = 'late' and not t.excused),
    (select coalesce(jsonb_agg(distinct p.full_name), '[]'::jsonb) from x join clinic_people.people p on p.id = x.person_id where x.status = 'unmapped')
  into v_rows, v_existing, v_incomplete, v_absent, v_late, v_unmapped;

  if v_rows is not null then
    v_import := public.hr_payroll_command('import_attendance', jsonb_build_object(
      'filename', 'بصمات ' || to_char(dt, 'YYYY-MM') || ' حتى ' || upto,
      'checksum', 'punches-' || md5(v_rows::text),
      'rows', v_rows));
  end if;

  return jsonb_build_object('month', dt, 'through', upto, 'import_id', v_import,
    'created', coalesce(jsonb_array_length(v_rows), 0), 'already_recorded', v_existing,
    'absent', v_absent, 'late', v_late, 'missing_exit', v_incomplete, 'unmapped', v_unmapped);
end $$;

revoke all on function public.hr_attendance_from_punches(date) from public, anon;
grant execute on function public.hr_attendance_from_punches(date) to authenticated;

commit;
