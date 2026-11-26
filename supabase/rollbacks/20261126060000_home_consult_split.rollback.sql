-- Rollback of 20261126060000_home_consult_split.sql. Posted home_nurse_fee / home_nurse_adjust journal entries STAY (they are money
-- already owed to / paid to nurses); only the automatic posting, the exact-contract guard and the follow-ups stop. The two tables are
-- renamed (kept for audit), not dropped; appointments.travel_minutes is kept (booked trips keep their length). The booking /
-- snapshot wrappers are removed and the previous functions put back with their privileges. The ops data is not touched here.
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_home_split(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_home_split(uuid, text, jsonb, uuid) rename to clinic_reception_command;
drop function if exists public.clinic_reception_snapshot(uuid, date, date);
alter function clinic_reception.snapshot_before_home_split(uuid, date, date) set schema public;
alter function public.snapshot_before_home_split(uuid, date, date) rename to clinic_reception_snapshot;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid), public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid), public.clinic_reception_snapshot(uuid, date, date) to authenticated;
drop trigger if exists home_split_contract_guard on clinic_reception.orders;
drop trigger if exists home_nurse_on_order on clinic_reception.orders;
drop trigger if exists home_nurse_follow_credit on clinic_reception.invoices;
drop trigger if exists home_nurse_follow_contractual on clinic_reception.claims;
drop trigger if exists home_nurse_retry_provider on clinic_reception.providers;
drop function if exists clinic_reception.home_split_contract_guard();
drop function if exists clinic_reception.home_nurse_on_order();
drop function if exists clinic_reception.home_nurse_follow_cut();
drop function if exists clinic_reception.home_nurse_retry_provider();
drop function if exists clinic_reception.home_nurse_try(uuid);
drop function if exists clinic_reception.home_nurse_sync(uuid);
drop function if exists clinic_reception.home_nurse_booked(uuid);
drop function if exists clinic_reception.home_nurse_provider(uuid, uuid);
alter table clinic_reception.home_nurse_issues rename to home_nurse_issues_rolled_back;
alter table clinic_reception.home_visit_split rename to home_visit_split_rolled_back;
commit;
