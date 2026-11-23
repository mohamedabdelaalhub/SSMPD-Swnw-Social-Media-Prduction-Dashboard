-- Rollback of 20261123070000_booking_payer_kind.sql. Quotes / discounts already applied stay on their orders; the payer columns go.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.command_before_payer_kind(uuid,text,jsonb,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('command_before_payer_kind' in pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف أمر الاستقبال — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_payer_kind(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_payer_kind(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop trigger payer_arrival on clinic_reception.orders;
drop function clinic_reception.payer_arrival();
drop function clinic_reception.payer_quote(uuid, uuid);
drop function clinic_reception.set_payer(uuid, uuid, jsonb, uuid);
drop function clinic_reception.payer_link_patient(uuid, uuid, text, uuid);
drop function clinic_reception.payer_union_discount(jsonb);
drop function clinic_reception.payer_contract_check(jsonb, uuid, date);
drop function public.clinic_reception_payer_options(uuid, uuid, date);
drop function clinic_reception.payer_price(uuid, uuid, date);
alter table clinic_reception.appointments drop column payer_kind, drop column payer_contract_id, drop column payer_entity_name,
  drop column payer_coupon_no, drop column payer_auth_ref, drop column payer_coverage_percent, drop column payer_proof_path,
  drop column payer_price, drop column payer_by, drop column payer_at;
commit;
