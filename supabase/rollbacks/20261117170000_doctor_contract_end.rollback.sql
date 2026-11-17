-- Rollback for 20261117170000_doctor_contract_end.sql. Contracts already ended keep their shortened valid_to (that's the approved business decision).
begin;
drop function if exists public.clinic_finance_doctor_contract_end(text, jsonb, uuid);
alter table clinic_finance.doctor_contracts
  drop column if exists end_request_last_day, drop column if exists end_request_reason, drop column if exists end_requested_by,
  drop column if exists end_requested_at, drop column if exists end_request_token, drop column if exists ended_by,
  drop column if exists ended_at, drop column if exists end_reason;
commit;
