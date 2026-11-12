-- Rollback of 20261112100000_live_presence.sql.
-- WARNING: this drops every stored device punch and every device-user mapping. The punches can be re-imported from the server spool
-- (~/claude-work/attendance-ingest/data/punches.db) and from the device itself; the mappings must be re-entered from the dashboard.
-- The clinic_people.audit rows (action 'presence_map') are kept on purpose.
begin;
drop function if exists public.hr_presence_map(text, integer, uuid);
drop function if exists public.hr_presence_snapshot(integer);
drop table if exists clinic_people.device_user_map;
drop table if exists clinic_people.device_punches;
commit;
