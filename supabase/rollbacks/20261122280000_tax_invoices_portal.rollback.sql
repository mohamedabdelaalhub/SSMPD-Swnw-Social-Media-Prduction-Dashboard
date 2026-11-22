-- Rollback of 20261122280000_tax_invoices_portal.sql. Metadata only: no amounts or entries depend on it. The audit rows stay (history).
-- Doctor payouts already made keep their entered withholding (it was always entered on the payout itself).
begin;
drop function public.clinic_finance_doctor_tax_suggest(text, date, date);
drop function public.clinic_finance_tax_report(date, date);
drop function public.clinic_finance_invoice_tax_get(text, uuid[]);
drop function public.clinic_finance_invoice_tax(text, uuid, text, jsonb, uuid);
drop function public.clinic_finance_tax_settings_save(jsonb);
drop function clinic_finance.tax_effective(text, timestamptz, clinic_finance.invoice_tax_status);
drop function clinic_finance.tax_doc(text, uuid);
drop table clinic_finance.invoice_tax_ops;
drop table clinic_finance.invoice_tax_status;
drop table clinic_finance.tax_settings;
commit;
