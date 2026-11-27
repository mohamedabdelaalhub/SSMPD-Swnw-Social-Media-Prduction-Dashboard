-- Rollback for 20261127150000_snapshot_shift_ended.sql: drop the wrapper and put the previous snapshot back.
begin;
drop function public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_shift_ended(uuid, date, date) set schema public;
alter function public.snapshot_before_shift_ended(uuid, date, date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated, service_role;
commit;
