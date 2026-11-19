-- Rollback of 20261116120000_hr_double_shift_payroll.sql: reverse the three in-place replacements.
begin;
do $$ declare def text; patched text;
  units constant text := '(case when scheduled_end-scheduled_start>interval ''12 hours'' then 2 else 1 end)';
  mid constant text := '(scheduled_start+(scheduled_end-scheduled_start)/2)';
begin
  def := pg_get_functiondef('public.hr_payroll_calculate(uuid,date)'::regprocedure);
  if position('double-shift payroll' in def) = 0 then raise exception 'الملف مش متطبق'; end if;
  patched := replace(def, 'select coalesce(sum(' || units || '),0) /* double-shift payroll */,coalesce(sum(case when actual_start is not null then greatest(0,extract(epoch from(actual_start-'
    || 'case when ' || units || '=2 and actual_start>=' || mid || ' then ' || mid || ' else scheduled_start end))',
    'select count(*),coalesce(sum(case when actual_start is not null then greatest(0,extract(epoch from(actual_start-scheduled_start))');
  patched := replace(patched, 'coalesce(sum(case when actual_start is null then ' || units || ' when ' || units || '=2 and (actual_start>=' || mid || ' or actual_end<=' || mid || ') then 1 else 0 end) filter(where not exists(',
    'count(*) filter(where actual_start is null and not exists(');
  patched := replace(patched, 'and not clinic_people.center_closed_on(clinic_people.attendance.day)),0),coalesce(sum(case when actual_end',
    'and not clinic_people.center_closed_on(clinic_people.attendance.day)),coalesce(sum(case when actual_end');
  if position('double-shift payroll' in patched) > 0 then raise exception 'تعذر الرجوع'; end if;
  execute patched;
end $$;
commit;
