-- Rollback for 20261127210000_consult_no_approval.sql
begin;
drop function clinic_reception.payer_contract_check(jsonb, uuid, date);
drop function clinic_reception.is_consultation(uuid);
alter function clinic_reception.payer_contract_check_before_consult(jsonb, uuid, date) rename to payer_contract_check;
revoke all on function clinic_reception.payer_contract_check(jsonb, uuid, date) from public, anon, authenticated;
commit;
