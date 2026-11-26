-- Rollback of 20261126160000_unit_provider_no_doctor_fee.sql: restores the previous sync_doctor_contract.
-- The 0% unit agreements it created stay (rejected here so they no longer match; executed orders keep their snapshot).
begin;
do $$ begin
  if to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') is null then raise exception 'not applied'; end if;
end $$;
drop function clinic_reception.sync_doctor_contract(uuid, uuid, uuid);
alter function clinic_reception.sync_doctor_contract_before_units(uuid, uuid, uuid) rename to sync_doctor_contract;
revoke all on function clinic_reception.sync_doctor_contract(uuid, uuid, uuid) from public, anon, authenticated;
update clinic_reception.doctor_agreements set status = 'rejected'
 where status = 'active' and reference = 'وحدة بدون طبيب — بدون أتعاب (20261126160000)'
   and not exists (select 1 from clinic_reception.orders o where o.agreement_id = doctor_agreements.id);
commit;
