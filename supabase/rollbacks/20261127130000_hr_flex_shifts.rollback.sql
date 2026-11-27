-- Rollback of 20261127130000_hr_flex_shifts: restores attendance_eval's innermost layer, the payroll wrapper chain and the 5 patched
-- readers (bodies saved in clinic_people.flex_saved_defs), then drops the RPC, helpers, triggers, cron job and the two tables.
-- WARNING: quick shifts and doctor links stored in clinic_people.day_shifts / flex_links are lost (export them first if needed).
begin;

do $$ begin
  if to_regclass('clinic_people.flex_saved_defs') is null then raise exception 'الملف ده مش متطبق'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = $1' using 'ssmpd-hr-flex-refresh';
  end if;
end $$;

-- shift notices in the home inbox
do $$ begin
  if to_regprocedure('clinic_finance.home_inbox_before_flex_shifts()') is not null then
    if position('home_inbox_before_flex_shifts' in coalesce(pg_get_functiondef(to_regprocedure('clinic_finance.home_inbox_before_unread_daily()')), '')) > 0 then
      drop function clinic_finance.home_inbox_before_unread_daily();
      alter function clinic_finance.home_inbox_before_flex_shifts() rename to home_inbox_before_unread_daily;
    else
      drop function public.personal_home_inbox();
      alter function clinic_finance.home_inbox_before_flex_shifts() set schema public;
      alter function public.home_inbox_before_flex_shifts() rename to personal_home_inbox;
      grant execute on function public.personal_home_inbox() to authenticated;
    end if;
  end if;
end $$;
drop function clinic_people.flex_inbox_merge(jsonb);
drop function clinic_people.flex_notices();

drop trigger if exists flex_avail_ins on clinic_reception.availability;
drop trigger if exists flex_avail_del on clinic_reception.availability;
drop trigger if exists flex_avail_upd on clinic_reception.availability;

-- readers: original bodies
do $$ declare r record; begin
  for r in select def from clinic_people.flex_saved_defs order by saved_at desc loop execute r.def; end loop;
end $$;

-- payroll
drop function public.hr_payroll_calculate(uuid, date);
alter function clinic_people.payroll_before_flex_shifts(uuid, date) rename to hr_payroll_calculate;
alter function clinic_people.hr_payroll_calculate(uuid, date) set schema public;
revoke all on function public.hr_payroll_calculate(uuid, date) from public, anon;
grant execute on function public.hr_payroll_calculate(uuid, date) to authenticated;

-- attendance
drop function clinic_people.attendance_eval_before_closures(date, timestamptz);
alter function clinic_people.attendance_eval_before_day_shifts(date, timestamptz) rename to attendance_eval_before_closures;
revoke all on function clinic_people.attendance_eval_before_closures(date, timestamptz) from public, anon, authenticated;

drop function public.hr_day_shift(text, jsonb);
drop function clinic_people.day_shift_json(clinic_people.day_shifts);
drop function clinic_people.flex_on_availability();
drop function clinic_people.flex_refresh(date, date, uuid);
drop function clinic_people.flex_punched(uuid, timestamptz, timestamptz);
drop function clinic_people.flex_periods(clinic_people.flex_links, date);
drop function clinic_people.flex_link_on(uuid, date);
drop table clinic_people.flex_saved_defs;
drop table clinic_people.day_shifts;
drop table clinic_people.flex_links;

commit;
