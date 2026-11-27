-- Rollback of 20261127140000_review_before_money.sql: drops the collect review, puts the previous doctor payout and drawer request
-- functions back (same signatures and grants). Payouts / drawer payments already made stay as they are (their amounts are real money);
-- the review notes are kept in the audit log (desk_payout_request_review / drawer_pay_less) before the two tables are dropped.
begin;
drop function if exists public.clinic_reception_collect_review(uuid, uuid);

drop function if exists public.clinic_reception_doctor_payout(text, jsonb, uuid);
alter function clinic_finance.doctor_payout_before_review(text, jsonb, uuid) set schema public;
alter function public.doctor_payout_before_review(text, jsonb, uuid) rename to clinic_reception_doctor_payout;
revoke all on function public.clinic_reception_doctor_payout(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_doctor_payout(text, jsonb, uuid) to authenticated;
drop function if exists clinic_finance.desk_review_merge(jsonb);
drop table if exists clinic_finance.desk_payout_review;

drop function if exists public.clinic_finance_drawer_request(text, jsonb);
alter function clinic_finance.drawer_request_before_pay_less(text, jsonb) set schema public;
alter function public.drawer_request_before_pay_less(text, jsonb) rename to clinic_finance_drawer_request;
revoke all on function public.clinic_finance_drawer_request(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_drawer_request(text, jsonb) to authenticated;
drop function if exists clinic_finance.drawer_row_merge(jsonb);
drop table if exists clinic_finance.drawer_pay_less;
commit;
