-- Rollback of 20261109130000_lab_new_service_requests.sql.
-- Drops the two RPCs and the request table. Services already created by approved requests STAY (they are ordinary pricing_services rows),
-- and so do their confirmed links and the proposals in clinic_prices.service_proposals. Export clinic_labs.service_requests first if you need the history.
begin;
drop function if exists public.lab_links_service_command(text, jsonb);
drop function if exists public.lab_links_service_requests();
drop table if exists clinic_labs.service_requests;
commit;
