-- Rollback 20261128140000_hide_supply_cost: restore the original function under its public name.
begin;
drop function if exists public.clinic_reception_visit_usage(uuid, text, jsonb);
alter function clinic_reception.visit_usage_full(uuid, text, jsonb) rename to clinic_reception_visit_usage;
alter function clinic_reception.clinic_reception_visit_usage(uuid, text, jsonb) set schema public;
revoke all on function public.clinic_reception_visit_usage(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_usage(uuid, text, jsonb) to authenticated;
drop function if exists clinic_reception.strip_cost(jsonb);
drop function if exists clinic_reception.can_see_cost();
commit;
