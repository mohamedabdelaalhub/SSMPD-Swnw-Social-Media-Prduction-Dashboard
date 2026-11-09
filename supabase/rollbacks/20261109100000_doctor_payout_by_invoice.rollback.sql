-- Rollback of 20261109100000_doctor_payout_by_invoice.sql. Refuses to drop the link table while it holds rows (the payouts themselves are never touched).
begin;
do $$ begin
  if to_regclass('clinic_finance.doctor_payout_invoices') is not null and exists(select 1 from clinic_finance.doctor_payout_invoices) then
    raise exception 'جدول ربط التسويات بالفواتير فيه بيانات؛ لا يُحذف تلقائيًا';
  end if;
end $$;
drop function if exists public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid);
drop function if exists public.clinic_finance_doctor_dues(text, date, date);
drop function if exists clinic_finance.doctor_dues(text, date, date);
drop table if exists clinic_finance.doctor_payout_invoices;
commit;
