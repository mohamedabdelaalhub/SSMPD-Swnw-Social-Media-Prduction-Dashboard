-- Rollback of 20261120320000_masa_payouts_net.sql (drops the copied payouts and the account classification).
begin;
drop function if exists public.clinic_finance_masa_net(text, jsonb);
do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_payouts(text,jsonb)') is not null then
    drop function public.clinic_reception_fallback_api(text, jsonb);
    alter function clinic_reception.fallback_api_before_payouts(text, jsonb) set schema public;
    alter function public.fallback_api_before_payouts(text, jsonb) rename to clinic_reception_fallback_api;
    revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
    end if;
  end if;
end $$;
drop function if exists clinic_finance.masa_payouts_import(jsonb);
drop function if exists clinic_finance.masa_account_kind(text);
drop table if exists clinic_finance.masa_payout_lines, clinic_finance.masa_payout_accounts, clinic_finance.masa_payouts, clinic_finance.masa_account_kinds;
commit;
