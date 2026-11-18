-- Rollback of 20261117230000_reception_doctor_payout_desk.sql. Payout rows created from reception stay (they are ordinary
-- clinic_finance.doctor_payouts with ledger entries); only the desk layer is removed. Receipt files stay in the bucket.
begin;
drop policy if exists doctor_payout_receipts_insert on storage.objects;
drop policy if exists doctor_payout_receipts_select on storage.objects;
drop function if exists public.clinic_reception_doctor_payout(text, jsonb, uuid);
drop function if exists public.doctor_payout_receipt_allowed(text, boolean);
drop function if exists clinic_finance.desk_payout_json(clinic_finance.doctor_payouts);
drop function if exists clinic_finance.desk_row(clinic_reception.providers, date);
drop function if exists clinic_finance.desk_held(text);
drop function if exists clinic_finance.desk_payable(text);
drop function if exists clinic_finance.desk_approver();
drop table if exists clinic_finance.desk_payouts;
drop trigger if exists guard_doctor_payout_grant on public.admins;
drop function if exists public.guard_doctor_payout_grant();
alter table public.admins drop column if exists can_approve_doctor_payouts;
commit;
