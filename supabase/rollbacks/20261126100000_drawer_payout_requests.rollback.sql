-- Rollback of 20261126100000_drawer_payout_requests.sql: restores post() and cash_line_guard (collection registers can no longer pay
-- 'drawer_payout') and drops the request function. Paid requests stay in the ledger (entries / business_requests / supplier_actions);
-- the request table is KEPT (renamed) so the history is never lost. Account 5212 stays.
begin;
do $$ begin
  execute (select def from clinic_finance.drawer_saved_defs where name = 'post');
  execute (select def from clinic_finance.drawer_saved_defs where name = 'cash_line_guard');
end $$;
drop function public.clinic_finance_drawer_request(text, jsonb);
drop function clinic_finance.drawer_row(clinic_finance.drawer_requests);
drop function clinic_finance.drawer_payout_ok(uuid, uuid, numeric);
alter table clinic_finance.drawer_requests rename to drawer_requests_rolled_back;
drop table clinic_finance.drawer_saved_defs;
commit;
