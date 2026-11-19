-- Rollback for 20261118010000_personal_home_charts.sql. The RPC is read-only, so dropping it loses no data.
begin;
drop function if exists public.personal_home_charts();
commit;
