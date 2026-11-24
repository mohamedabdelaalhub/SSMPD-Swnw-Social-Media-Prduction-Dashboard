-- Rollback of 20261125050000_cash_case_settle_cap.sql: restores clinic_finance_case_settle as it was and drops the helpers.
begin;
do $$ begin execute (select def from clinic_finance.case_settle_cap_saved_defs where name = 'clinic_finance_case_settle'); end $$;
drop table clinic_finance.case_settle_cap_saved_defs;
drop function clinic_finance.case_settle_amount(uuid);
drop function clinic_finance.case_settle_book(uuid);
commit;
