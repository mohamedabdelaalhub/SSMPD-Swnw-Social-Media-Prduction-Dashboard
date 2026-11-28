-- Rollback of 20261128180000_duplicate_service_warn.sql: drops the two wrappers and the «again» RPC, puts the previous functions back
-- (same signatures, same grants). Services already added twice on purpose stay (they are normal orders / appointments).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_dup_service(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_dup_service(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists public.clinic_reception_journey_request_service_again(uuid, uuid, uuid, uuid);
drop function if exists public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid);
alter function clinic_reception.journey_request_service_before_dup(uuid, uuid, uuid, uuid) set schema public;
alter function public.journey_request_service_before_dup(uuid, uuid, uuid, uuid) rename to clinic_reception_journey_request_service;
revoke all on function public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_journey_request_service(uuid, uuid, uuid, uuid) to authenticated;
drop function if exists public.clinic_reception_duplicate_service_check(uuid, jsonb);
drop function if exists clinic_reception.dup_service_refuse(jsonb, boolean);
drop function if exists clinic_reception.dup_service_message(jsonb, boolean);
drop function if exists clinic_reception.dup_service_find(uuid, uuid, uuid, uuid, date);
drop function if exists clinic_reception.dup_service_clock(timestamptz);
drop function if exists clinic_reception.dup_service_day(timestamptz);
commit;
