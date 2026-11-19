-- Refuses if any correction request exists (approved ones already posted entries; keep them).
do $$begin
 if exists(select 1 from clinic_reception.requests where kind in ('method_fix','service_void')) then raise exception 'Correction requests exist; resolve them before rolling back';end if;
end $$;
drop function if exists public.clinic_finance_my_shift_collections();
drop trigger if exists trg_correction_request_check on clinic_reception.requests;
drop function if exists clinic_reception.correction_request_check();
drop function if exists clinic_reception.review_operation(uuid,jsonb,uuid);
alter function clinic_reception.review_operation_before_corrections(uuid,jsonb,uuid) rename to review_operation;
drop function if exists clinic_reception.method_account(text);
alter table clinic_reception.requests drop constraint requests_kind_check;
alter table clinic_reception.requests add constraint requests_kind_check check(kind in ('claim_correction','claim_submit','claim_contractual','claim_loss','claim_payment','credit_note','package_cancel','refund','doctor_payout','supplier_payout','expense','fund','waste','transfer_loss'));
