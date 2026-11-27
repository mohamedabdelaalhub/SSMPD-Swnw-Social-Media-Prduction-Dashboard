-- Rollback of 20261123130000_visit_discount_all_services.sql. Discounts already copied stay on their services.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_visit_discount(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_visit_discount' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_visit_discount(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_visit_discount(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop trigger visit_discount_on_add on clinic_reception.orders;
drop function clinic_reception.visit_discount_on_add();
drop function clinic_reception.apply_visit_discount(uuid, uuid, text);
drop function clinic_reception.visit_discount(uuid);
commit;
