-- Rollback of 20261124190000_cash_case_settlement.sql. Settlement entries already approved stay in the books (history; reverse them with
-- a manual correction if needed). The guards and the RPC go back; the case columns and the two accounts are kept (data).
begin;
drop function public.clinic_finance_case_settle(text, jsonb, uuid);
do $$ begin
  execute (select def from clinic_finance.case_settle_saved_defs where name = 'cash_line_guard');
  execute (select def from clinic_finance.case_settle_saved_defs where name = 'ended_shift_entry_guard');
end $$;
drop table clinic_finance.case_settle_saved_defs;
commit;
