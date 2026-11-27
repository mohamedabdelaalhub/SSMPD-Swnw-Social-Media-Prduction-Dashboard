-- Rollback of 20261123200000_offer_no_other_discount.sql (refused if a newer wrapper sits on top of clinic_reception_command).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_offer_discount(uuid,text,jsonb,uuid)') is null then raise exception 'الملف مش متطبق'; end if;
  if position('command_before_offer_discount' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث فوق clinic_reception_command — ارجع له الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_offer_discount(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_offer_discount(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop trigger if exists offer_order_discount_zero on clinic_reception.orders;
drop trigger if exists offer_discount_request_skip on clinic_reception.discount_requests;
drop function clinic_reception.offer_order_discount_zero();
drop function clinic_reception.offer_discount_request_skip();
drop function clinic_reception.order_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.order_discount_before_offer(uuid, uuid, jsonb, uuid) rename to order_discount;
drop function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.set_booking_discount_before_offer(uuid, uuid, jsonb, uuid) rename to set_booking_discount;
drop function clinic_reception.order_is_offer(uuid);
drop function clinic_reception.service_is_offer(uuid);
commit;
