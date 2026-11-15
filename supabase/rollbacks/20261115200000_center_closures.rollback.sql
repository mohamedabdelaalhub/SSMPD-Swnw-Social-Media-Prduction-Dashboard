-- Rollback of 20261115200000_center_closures.sql: restores the previous attendance, booking and snapshot functions.
-- The payroll patch is reverted by re-running the hr_payroll_calculate definition from 20261115100000_hr_pay_guaranteed_minimum.sql
-- (or the latest migration that redefines it) after this file. Holiday records are kept in a backup table.
begin;
drop function if exists public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_closures(uuid, date, date) set schema public;
alter function public.snapshot_before_closures(uuid, date, date) rename to clinic_reception_snapshot;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_closures(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_closures(uuid, text, jsonb, uuid) rename to clinic_reception_command;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists clinic_people.attendance_eval(date, timestamptz);
alter function clinic_people.attendance_eval_before_closures(date, timestamptz) rename to attendance_eval;
drop function if exists public.center_closure_bookings(uuid);
drop function if exists public.center_closure_command(text, jsonb);
drop function if exists public.center_closures(date, date);
drop function if exists clinic_people.closure_reviewer();
create table if not exists clinic_people.center_closures_backup_20261115 as select * from clinic_people.center_closures;
drop function if exists clinic_people.center_closed_on(date) cascade;
drop table clinic_people.center_closures;
commit;
