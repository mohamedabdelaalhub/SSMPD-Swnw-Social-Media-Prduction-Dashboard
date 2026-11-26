-- Rollback of 20261126110000_month_end_accounts.sql: drops the functions. Approved settlements stay in the ledger; the three tables are
-- KEPT (renamed) so the history is never lost. Accounts 5233 / 5234 / 5235 / 4121 stay.
begin;
drop function public.clinic_finance_month_end(text, jsonb);
drop function clinic_finance.month_end_lines(text, date, date);
alter table clinic_finance.month_end_settlements rename to month_end_settlements_rolled_back;
alter table clinic_finance.month_end_items rename to month_end_items_rolled_back;
alter table clinic_finance.month_end_parties rename to month_end_parties_rolled_back;
commit;
