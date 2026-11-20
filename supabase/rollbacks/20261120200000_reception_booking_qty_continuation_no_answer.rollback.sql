-- Rollback of 20261120200000_reception_booking_qty_continuation_no_answer.sql. The columns stay (data kept, defaults harmless).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_qty(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_qty(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop trigger if exists booking_order_terms on clinic_reception.orders;
drop function if exists clinic_reception.booking_order_terms();
drop function if exists public.clinic_reception_continuation_candidates(uuid, uuid, uuid);
drop function if exists clinic_reception.continuation_orders(uuid, uuid, uuid);
commit;
