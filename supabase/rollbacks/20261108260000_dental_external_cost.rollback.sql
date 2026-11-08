-- Rollback of 20261108260000_dental_external_cost.sql: restores public.clinic_finance_bill as created by 20261108231000 (it was only moved/renamed).
-- Invoices that already carry an external cost KEEP their stored line_deduction (so their fee does not jump); only the external_cost / external_ref columns are dropped
-- after being copied to doctor_allocation_lines_external_backup. New bills can no longer take external_cost.
begin;
do $$ begin
  if to_regprocedure('clinic_finance.bill_before_external(jsonb,uuid)') is null then raise exception 'ملف التكلفة الخارجية غير مطبق؛ لا يوجد ما يُتراجع عنه'; end if;
end $$;
drop function if exists public.clinic_finance_external_cost_enabled();
drop function public.clinic_finance_bill(jsonb, uuid);
alter function clinic_finance.bill_before_external(jsonb, uuid) set schema public;
alter function public.bill_before_external(jsonb, uuid) rename to clinic_finance_bill;
create table clinic_finance.doctor_allocation_lines_external_backup as
  select invoice_id, line_no, service_code, amount, external_cost, external_ref, line_deduction from clinic_finance.doctor_allocation_lines where external_cost > 0;
alter table clinic_finance.doctor_allocation_lines drop constraint doctor_allocation_lines_external_ref_ck, drop constraint doctor_allocation_lines_external_cost_ck;
alter table clinic_finance.doctor_allocation_lines drop column external_cost, drop column external_ref;
revoke all on clinic_finance.doctor_allocation_lines_external_backup from public, anon, authenticated;
commit;
