-- Rollback of 20261125030000_control_accounts_breakdown.sql: restores the archived leaves, the movements function and drops the
-- breakdown / wallet-kind additions. The 4 loose system accounts stay attached to their parents (harmless metadata; detach by hand
-- only if needed). Wallet kinds already recorded are dropped with the columns.
begin;
update clinic_finance.account_config c set archived = false, active = true, revision = c.revision + 1
  from clinic_finance.breakdown_archived b where c.code = b.code;
drop table clinic_finance.breakdown_archived;
do $$ begin execute (select def from clinic_finance.breakdown_saved_defs where name = 'shift_movements'); end $$;
drop table clinic_finance.breakdown_saved_defs;
drop function public.clinic_finance_account_breakdown(text, date, date);
drop function public.clinic_finance_wallet_kind(text, jsonb, uuid);
drop function clinic_finance.wallet_kind_label(text);
alter table clinic_reception.payments drop column wallet_kind, drop column wallet_kind_pending, drop column wallet_kind_by, drop column wallet_kind_at;
commit;
