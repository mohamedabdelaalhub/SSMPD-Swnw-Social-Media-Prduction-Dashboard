-- Rollback of 20261126120000_partner_accounts.sql: drops the functions. Approved moves stay in the ledger (accounts 331x stay);
-- the two tables are KEPT (renamed) so the history is never lost.
begin;
drop function public.clinic_finance_partner(text, jsonb);
drop function clinic_finance.partner_balance(text);
alter table clinic_finance.partner_moves rename to partner_moves_rolled_back;
alter table clinic_finance.partners rename to partners_rolled_back;
commit;
