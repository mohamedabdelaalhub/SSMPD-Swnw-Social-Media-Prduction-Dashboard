-- Rollback of 20261120170000_masa_payments.sql (drops the copied Masa payments; nothing in clinic_finance balances depends on them).
begin;
drop function if exists public.clinic_finance_masa_payments(text, jsonb);
do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_payments(text,jsonb)') is not null then
    drop function public.clinic_reception_fallback_api(text, jsonb);
    alter function clinic_reception.fallback_api_before_payments(text, jsonb) set schema public;
    alter function public.fallback_api_before_payments(text, jsonb) rename to clinic_reception_fallback_api;
    revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
    end if;
  end if;
end $$;
drop function if exists clinic_finance.masa_payments_import(jsonb);
drop function if exists clinic_finance.masa_local_ts(text);
drop function if exists clinic_finance.masa_num(jsonb);
drop function if exists clinic_finance.masa_int(jsonb);
drop table if exists clinic_finance.masa_receipt_lines, clinic_finance.masa_receipts, clinic_finance.masa_invoices, clinic_finance.masa_payment_types,
  clinic_finance.masa_cashiers, clinic_finance.masa_safes, clinic_finance.masa_payments_sync;
commit;
