-- Rollback of 20261123120000_referring_doctor.sql. The referring doctors recorded on bookings are dropped with their columns.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_referrer(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_referrer' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
  if position('invoice_print_before_referrer' in pg_get_functiondef('public.clinic_reception_invoice_print(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف طباعة الفاتورة — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_referrer(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_referrer(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function public.clinic_reception_invoice_print(uuid, uuid);
alter function clinic_reception.invoice_print_before_referrer(uuid, uuid) set schema public;
alter function public.invoice_print_before_referrer(uuid, uuid) rename to clinic_reception_invoice_print;
revoke all on function public.clinic_reception_invoice_print(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_invoice_print(uuid, uuid) to authenticated;
drop function clinic_reception.set_referrer(uuid, uuid, jsonb, uuid);
alter table clinic_reception.appointments drop constraint appointments_referrer_shape, drop column referrer_kind, drop column referrer_provider_id,
  drop column referrer_name, drop column referrer_specialty, drop column referrer_clinic, drop column referrer_phone, drop column referrer_by, drop column referrer_at;
commit;
