-- READ-ONLY (2026-11-25 late): (A) RC-2026-000013 / P-2026-001619 final state after the credit note; (B) Manar's drawer and shifts.
-- No writes, ends with ROLLBACK. File numbers and staff names only.
begin read only;
-- A1) credit note + invoice
select q.id, q.status, q.amount, q.payload->>'scope' scope, (select name from public.admins where id = q.reviewed_by) reviewed_by
  from clinic_reception.requests q where q.kind = 'credit_note' and q.subject_id = (select invoice_id from clinic_reception.allocations where payment_id = (select id from clinic_reception.payments where receipt_no = 'RC-2026-000013'));
select i.amount, i.credit_amount, clinic_reception.due(i.id) due, o.price, o.doctor_fee
  from clinic_reception.invoices i left join clinic_reception.orders o on o.id = i.order_id
 where i.id = (select invoice_id from clinic_reception.allocations where payment_id = (select id from clinic_reception.payments where receipt_no = 'RC-2026-000013'));
-- A2) every journal row touching that invoice / receipt (source, accounts, amount)
select j.source, l.account, l.debit, l.credit, j.created_at at time zone 'Africa/Cairo' at_cairo
  from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
 where j.dimensions->>'invoice_id' = (select invoice_id::text from clinic_reception.allocations where payment_id = (select id from clinic_reception.payments where receipt_no = 'RC-2026-000013'))
    or j.dimensions->>'payment_id' = (select id::text from clinic_reception.payments where receipt_no = 'RC-2026-000013')
 order by j.created_at, l.debit desc;
-- A3) patient credit left for the file (should be 0)
select clinic_reception.balance(p.workspace_id, '2150', 'patient_id', p.patient_id::text) patient_credit_2150
  from clinic_reception.payments p where p.receipt_no = 'RC-2026-000013';
-- B1) Manar's finance shifts since 22-11 + live book
select s.id, r.name register, s.opened_at at time zone 'Africa/Cairo' opened, s.ended_at at time zone 'Africa/Cairo' ended, s.status, s.opening_book, s.end_counted, s.end_expected,
       clinic_finance.shift_cash(s.id) book_now, s.note, (select name from public.admins where id = s.reviewed_by) reviewed_by
  from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
 where s.cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and s.opened_at >= '2026-11-22' order by s.opened_at;
select r.name, clinic_finance.treasury_balance(r.id) register_balance from clinic_finance.registers r
 where r.assigned_to in (select id from public.admins where name like 'منار%' and role = 'reception');
-- B2) her cash cases
select c.id, c.shift_id, c.difference, c.status, c.responsibility, c.decision, c.settle_status from clinic_finance.cash_cases c
 where c.shift_id in (select id from clinic_finance.shifts where cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception'));
-- B3) her receipts since 22-11 by day and method, and her handovers
select (p.created_at at time zone 'Africa/Cairo')::date day, p.method, count(*) n, sum(p.amount) total
  from clinic_reception.payments p where p.created_by in (select id from public.admins where name like 'منار%' and role = 'reception') and p.created_at >= '2026-11-22' group by 1, 2 order by 1, 2;
select t.amount, t.status, t.created_at at time zone 'Africa/Cairo' at_cairo, (select name from public.admins where id = t.reviewed_by) by_, t.review_note
  from clinic_finance.treasury_transfers t where t.from_shift in (select id from clinic_finance.shifts where cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception')) order by t.created_at;
-- B4) her shift expenses
select q.amount, q.payload->>'item_label' item, q.post_review, q.created_at at time zone 'Africa/Cairo' at_cairo from clinic_finance.requests q
 where q.kind = 'expense' and q.payload->>'source' = 'shift_allowance' and q.created_by in (select id from public.admins where name like 'منار%' and role = 'reception') order by q.created_at;
rollback;
