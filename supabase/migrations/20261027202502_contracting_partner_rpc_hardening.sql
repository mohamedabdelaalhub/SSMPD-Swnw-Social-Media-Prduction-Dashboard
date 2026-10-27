-- Harden partner RPC execution and pin search paths on the invoker helpers.
revoke execute on function public.contracting_partner_claim_access() from public, anon;
grant execute on function public.contracting_partner_claim_access() to authenticated;

revoke execute on function public.contracting_partner_staff_dashboard() from public, anon;
grant execute on function public.contracting_partner_staff_dashboard() to authenticated;

alter function public.contracting_partner_snapshot(uuid) set search_path = pg_catalog, public;
alter function public.contracting_progressive_incentive(numeric, uuid, text) set search_path = pg_catalog, public;
