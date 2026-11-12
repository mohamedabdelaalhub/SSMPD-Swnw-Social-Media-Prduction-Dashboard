-- Rollback of 20261113100000_shift_schedules.sql.
-- WARNING: this drops every shift template and every weekly schedule row. Export first if schedules were entered:
--   copy (select * from clinic_people.shift_templates) to ... ; copy (select * from clinic_people.person_shifts) to ... ;
-- The clinic_people.audit rows (actions 'shift_template', 'shift_schedule') are kept on purpose.
begin;
drop function if exists public.hr_attendance_today(date);
drop function if exists public.hr_shifts_command(text, jsonb);
drop function if exists public.hr_shifts_workspace();
drop function if exists clinic_people.attendance_eval(date, timestamptz);
drop table if exists clinic_people.person_shifts;
drop table if exists clinic_people.shift_templates;
commit;
