-- Rollback of 20261122290000_doctor_dues_reception_invoices.sql: back to the finance-invoice-only screen. Reception lines already paid
-- through it stay recorded in clinic_finance.desk_payout_rx (the desk keeps honouring them).
begin;
drop function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid);
drop function clinic_finance.doctor_dues(text, date, date);
drop function clinic_finance.rx_dues(text);
alter function clinic_finance.clinic_finance_doctor_payout_invoices_before_rx(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) set schema public;
alter function public.clinic_finance_doctor_payout_invoices_before_rx(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) rename to clinic_finance_doctor_payout_invoices;
alter function clinic_finance.doctor_dues_before_rx(text, date, date) rename to doctor_dues;
revoke all on function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_payout_invoices(text, uuid[], numeric, numeric, text, uuid, text, date, date, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
