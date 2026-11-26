-- Rollback of 20261126050000_doctor_uncovered_without_contract.sql: restores doctor_statement_detail (section only for doctors with an active contract).
begin;
do $$ begin execute (select def from clinic_finance.doctor_uncovered_saved_defs where name = 'doctor_statement_detail'); end $$;
drop table clinic_finance.doctor_uncovered_saved_defs;
commit;
