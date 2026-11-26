-- Rollback of 20261126090000_entity_service_names.sql: payer_quote back to its previous body, the entity services RPC and the
-- name helper go. Quotes already made keep their entity_service_name / entity_service_code keys (harmless extra snapshot data).
do $$ begin
  if to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('payer_quote_before_entity_names' in pg_get_functiondef('clinic_reception.payer_quote(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف payer_quote — رجّعه الأول'; end if;
end $$;

begin;
drop function clinic_reception.payer_quote(uuid, uuid);
alter function clinic_reception.payer_quote_before_entity_names(uuid, uuid) rename to payer_quote;
revoke all on function clinic_reception.payer_quote(uuid, uuid) from public, anon, authenticated;
drop function public.clinic_reception_entity_services(uuid, uuid, date);
drop function clinic_reception.entity_service_name(uuid, uuid, date);
notify pgrst, 'reload schema';
commit;
