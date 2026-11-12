-- Rollback of 20261113110000_attendance_reports.sql (drops only the reports RPC; shifts, presence and punches are untouched).
begin;
drop function if exists public.hr_attendance_range(date, date);
commit;
