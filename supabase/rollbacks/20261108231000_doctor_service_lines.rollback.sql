-- Rollback of 20261108231000_doctor_service_lines.sql: restores the original public.clinic_finance_bill and clinic_finance.doctor_sync byte-for-byte (they were only renamed/moved).
-- The per-line splits already stored are NOT deleted: the table is renamed to doctor_allocation_lines_rolled_back (or dropped when empty).
-- Invoices that were split by lines fall back to the single contract stored on their doctor_allocations row (the first line's contract) until they are fixed by hand.
begin;

do $$ begin
  if to_regprocedure('clinic_finance.doctor_sync_base(uuid)') is null or to_regprocedure('clinic_finance.bill_before_lines(jsonb,uuid)') is null then
    raise exception 'ملف توزيع الخدمات على السطور غير مطبق؛ لا يوجد ما يُتراجع عنه';
  end if;
end $$;

drop function if exists public.clinic_finance_lines_enabled();
drop function public.clinic_finance_bill(jsonb, uuid);
alter function clinic_finance.bill_before_lines(jsonb, uuid) set schema public;
alter function public.bill_before_lines(jsonb, uuid) rename to clinic_finance_bill;

drop function clinic_finance.doctor_sync(uuid);
alter function clinic_finance.doctor_sync_base(uuid) rename to doctor_sync;

do $$ begin
  if exists (select 1 from clinic_finance.doctor_allocation_lines) then
    alter table clinic_finance.doctor_allocation_lines rename to doctor_allocation_lines_rolled_back;
    alter index clinic_finance.doctor_allocation_lines_pkey rename to doctor_allocation_lines_rolled_back_pkey;
    alter index clinic_finance.doctor_allocation_lines_contract rename to doctor_allocation_lines_rolled_back_contract;
    raise notice 'تم الاحتفاظ بتقسيمات السطور المخزنة في doctor_allocation_lines_rolled_back';
  else
    drop table clinic_finance.doctor_allocation_lines;
  end if;
end $$;

commit;
