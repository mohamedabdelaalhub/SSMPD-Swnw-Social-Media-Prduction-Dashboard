-- Removes the server-side settlement function and the approved/paid guard (back to browser upsert only).
-- Revert assets/js/contracting-partnerships.js createSettlement() to the previous version at the same time.
begin;
drop trigger if exists contracting_settlement_guard on public.contracting_settlements;
drop function if exists public.contracting_settlement_guard();
drop function if exists public.contracting_create_settlement(uuid, date);
commit;
