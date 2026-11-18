-- Rollback of 20261118010000_hr_overtime_control.sql: restore the previous payroll function, drop the overtime layer.
begin;
drop function if exists public.hr_payroll_calculate(uuid, date);
alter function clinic_people.payroll_before_overtime_control(uuid, date) rename to hr_payroll_calculate;
alter function clinic_people.hr_payroll_calculate(uuid, date) set schema public;
revoke all on function public.hr_payroll_calculate(uuid, date) from public, anon;
grant execute on function public.hr_payroll_calculate(uuid, date) to authenticated;
drop function if exists public.hr_overtime(text, jsonb);
drop function if exists clinic_people.overtime_can_review(uuid);
drop function if exists clinic_people.overtime_counted_hours(uuid, date, date);
drop function if exists clinic_people.overtime_rows(date, date, uuid);
drop function if exists clinic_people.clinic_close_at(date);
drop table if exists clinic_people.overtime_requests;
drop table if exists clinic_people.overtime_settings;
commit;
