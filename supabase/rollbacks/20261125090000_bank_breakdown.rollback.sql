-- Rollback of 20261125090000_bank_breakdown.sql: restores the breakdown function without the 1112 branch.
begin;
do $$ begin execute (select def from clinic_finance.bank_breakdown_saved_defs where name = 'account_breakdown'); end $$;
drop table clinic_finance.bank_breakdown_saved_defs;
commit;
