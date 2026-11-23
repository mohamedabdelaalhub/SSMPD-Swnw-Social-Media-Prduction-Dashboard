-- Rollback of 20261123060000_booking_discount_everywhere.sql. Discounts already recorded stay on their bookings / services.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_discount_everywhere(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_discount_everywhere' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_discount_everywhere(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_discount_everywhere(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function clinic_reception.order_discount(uuid, uuid, jsonb, uuid);
commit;
