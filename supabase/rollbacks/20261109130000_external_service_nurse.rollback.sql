-- Rollback of 20261109130000_external_service_nurse.sql: restores clinic_finance_bill (moved, not edited) and doctor_extra_sync exactly as the fixed-fee migration created them.
-- REFUSED while invoices that used the external-service amount or a nurse option exist (their amount/accruals depend on the new code): void/refund them first.
begin;
do $$ begin
  if to_regprocedure('clinic_finance.bill_before_external_service(jsonb,uuid)') is null then raise exception 'ملف الخدمة الخارجية/التمريض غير مطبق؛ لا يوجد ما يُتراجع عنه'; end if;
  if exists (select 1 from clinic_finance.invoice_external) then raise exception 'توجد فواتير بخدمة خارجية أو خيار تمريض؛ لا يمكن التراجع'; end if;
end $$;
drop function public.clinic_finance_external_service_enabled();
drop function public.clinic_finance_bill(jsonb, uuid);
alter function clinic_finance.bill_before_external_service(jsonb, uuid) set schema public;
alter function public.bill_before_external_service(jsonb, uuid) rename to clinic_finance_bill;
create or replace function clinic_finance.doctor_extra_sync(p_invoice uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare x clinic_finance.doctor_extra_allocations%rowtype; i clinic_finance.invoices%rowtype; m record; g record; target numeric; delta numeric; event_id uuid;
begin
  select * into i from clinic_finance.invoices where id = p_invoice;
  select * into m from clinic_finance.doctor_invoice_money(p_invoice);
  for x in select * from clinic_finance.doctor_extra_allocations where invoice_id = p_invoice order by doctor_key for update loop
    target := 0;
    for g in
      select e.contract_id, max(k.fee_kind) kind, max((e.terms->>'rate')::numeric) rate, sum(least(k.fixed_amount, l.amount)) fixed,
             count(*) n, sum(l.amount) base, sum(e.line_deduction) ded
      from clinic_finance.doctor_extra_lines e join clinic_finance.doctor_allocation_lines l on l.invoice_id = e.invoice_id and l.line_no = e.line_no
           join clinic_finance.doctor_contracts k on k.id = e.contract_id
      where e.invoice_id = p_invoice and e.doctor_key = x.doctor_key group by e.contract_id
    loop
      if g.kind = 'fixed' then target := target + g.fixed * m.revenue / m.amount;   -- g.fixed = sum over the lines of least(fixed amount, line price)
      else target := target + greatest(0, g.base * m.revenue / m.amount - g.ded) * g.rate / 100; end if;
    end loop;
    if x.basis = 'collected' then target := case when m.revenue > 0 then target * least(1, m.collected / m.revenue) else 0 end; end if;
    target := round(target, 2); delta := target - x.earned;
    if delta <> 0 then
      insert into clinic_finance.doctor_accruals(invoice_id, doctor_key, delta) values (p_invoice, x.doctor_key, delta) returning id into event_id;
      perform clinic_finance.post('doctor_accrual', event_id, 'استحقاق أو تسوية أتعاب '||x.doctor_name||' — '||i.reference, null, case when delta > 0 then '5111' else '2120' end, case when delta > 0 then '2120' else '5111' end, abs(delta));
      update clinic_finance.doctor_extra_allocations set earned = target where invoice_id = p_invoice and doctor_key = x.doctor_key;
    end if;
  end loop;
end $$;

drop table clinic_finance.invoice_external;
commit;
