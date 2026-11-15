-- HR payroll: a «يوم كامل» (one scheduled row longer than 12 hours, e.g. 08:00–00:00) counts as TWO shifts.
-- Owner decision 2026-11-15 («دي بتتحسب شفتين مش شفت واحد… موافق للكل»):
--   * absent the whole day           → 2 absences deducted (2 × absence_day);
--   * worked only one half           → 1 absence deducted (arrived at/after the midpoint, or left at/before it);
--   * worked the whole day           → 2 shifts, no absence;
--   * arrived only for the second half → lateness is measured from the midpoint, not from the morning start.
-- 'approved_shifts' now counts a full day as 2. Ordinary shifts are unchanged.
-- Implementation: patches the LIVE body of public.hr_payroll_calculate in place (same technique as 20261115230000), and
-- refuses to apply if the expected fragments are not found (so a drifted body is never half-patched).
begin;

do $$ declare def text; patched text;
  units constant text := '(case when scheduled_end-scheduled_start>interval ''12 hours'' then 2 else 1 end)';
  mid constant text := '(scheduled_start+(scheduled_end-scheduled_start)/2)';
begin
  if to_regprocedure('public.hr_payroll_calculate(uuid,date)') is null then raise exception 'hr_payroll_calculate غير موجودة'; end if;
  def := pg_get_functiondef('public.hr_payroll_calculate(uuid,date)'::regprocedure);
  if position('double-shift payroll' in def) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  patched := def;
  -- 1) shifts: a full day counts 2
  patched := replace(patched, 'select count(*),coalesce(sum(case when actual_start is not null then greatest(0,extract(epoch from(actual_start-scheduled_start))',
    'select coalesce(sum(' || units || '),0) /* double-shift payroll */,coalesce(sum(case when actual_start is not null then greatest(0,extract(epoch from(actual_start-'
    || 'case when ' || units || '=2 and actual_start>=' || mid || ' then ' || mid || ' else scheduled_start end))');
  -- 2) absences: weighted by shift units, a half-worked full day is one absence
  patched := replace(patched, 'count(*) filter(where actual_start is null and not exists(',
    'coalesce(sum(case when actual_start is null then ' || units || ' when ' || units || '=2 and (actual_start>=' || mid || ' or actual_end<=' || mid || ') then 1 else 0 end) filter(where not exists(');
  patched := replace(patched, 'and not clinic_people.center_closed_on(clinic_people.attendance.day)),coalesce(sum(case when actual_end',
    'and not clinic_people.center_closed_on(clinic_people.attendance.day)),0),coalesce(sum(case when actual_end');
  if patched = def or position('double-shift payroll' in patched) = 0 or position('else 0 end) filter(where not exists(' in patched) = 0
     or position('center_closed_on(clinic_people.attendance.day)),0),coalesce' in patched) = 0 then
    raise exception 'جسم hr_payroll_calculate اتغير — راجعه قبل التطبيق';
  end if;
  execute patched;
end $$;

commit;
