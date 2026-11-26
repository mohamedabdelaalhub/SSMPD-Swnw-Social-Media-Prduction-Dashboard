-- Rollback of 20261126180000_platform_audit.sql. Restores the previous public.clinic_finance_month_end and month_end_lines.
-- Approved audits and settlements stay in the ledger (2112 / 4122 entries are never deleted — reverse them with a manual entry if
-- needed); the audits table is KEPT (renamed). كفارة وسلامتك stays as a party row (the old lines function ignores it) and the four
-- platform percents go back to empty, so nothing accrues for platforms until the FM sets them again.
begin;
drop function public.clinic_finance_month_end(text, jsonb);
alter function clinic_finance.clinic_finance_month_end_before_audit(text, jsonb) set schema public;
alter function public.clinic_finance_month_end_before_audit(text, jsonb) rename to clinic_finance_month_end;
revoke all on function public.clinic_finance_month_end(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_month_end(text, jsonb) to authenticated;
do $$ begin execute (select def from clinic_finance.platform_audit_saved_defs where name = 'month_end_lines'); end $$;
revoke all on function clinic_finance.month_end_lines(text, date, date) from public, anon, authenticated;
drop function clinic_finance.platform_balances();
drop function clinic_finance.platform_dest_ok(text, text);
alter table clinic_finance.platform_audits rename to platform_audits_rolled_back;
update clinic_finance.month_end_parties set percent = null, updated_at = now() where key in ('vezeeta', 'clinidu', 'akshef', 'kafaret');
drop table clinic_finance.platform_audit_saved_defs;
commit;
