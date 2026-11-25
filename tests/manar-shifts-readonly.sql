-- READ-ONLY: منار's shifts since 2026-11-20 (owner wants a clean start). No writes; ends with ROLLBACK. No patient names / phones.
begin read only;
-- 0) who
select a.id, a.name, a.role, a.active from public.admins a where a.id in (select id from public.admins where name like 'منار%' and role = 'reception');
-- 1) finance shifts + current shift_cash
select s.id, r.name register, r.treasury_kind, s.opened_at, s.ended_at, s.closed_at, s.status, s.opening_book, s.end_expected, s.end_counted, s.counted,
       s.denominations, s.end_counts, s.note, (select x.name from public.admins x where x.id = s.reviewed_by) reviewed_by, clinic_finance.shift_cash(s.id) shift_cash_now
  from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
 where s.cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and s.opened_at >= '2026-11-20' order by s.opened_at;
-- 2) treasury transfers from those shifts (all columns)
select to_jsonb(t) from clinic_finance.treasury_transfers t
 where t.from_shift in (select id from clinic_finance.shifts where cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and opened_at >= '2026-11-20') order by t.created_at;
-- 3) cash cases on those shifts (all columns)
select to_jsonb(c) from clinic_finance.cash_cases c
 where c.shift_id in (select id from clinic_finance.shifts where cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and opened_at >= '2026-11-20');
-- 3b) ledger lines on her shifts grouped by entry source (what drives shift_cash)
select e.shift_id, e.source, count(*) n, sum(l.debit) dr, sum(l.credit) cr, min(e.created_at) first_at, max(e.created_at) last_at
  from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
 where e.shift_id in (select id from clinic_finance.shifts where cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and opened_at >= '2026-11-20') and clinic_finance.is_cash_account(l.account)
 group by 1, 2 order by 1, 2;
-- 4) her reception payments since 20-11 (which shift each landed on) + allocations (invoice / amount)
select p.id, p.receipt_no, p.method, p.amount, p.credit_amount, p.shift_id, p.finance_payment_id, p.created_at, p.reference, p.wallet_kind,
       (select jsonb_agg(jsonb_build_object('invoice', al.invoice_id, 'amount', al.amount, 'source', al.source)) from clinic_reception.allocations al where al.payment_id = p.id) allocations
  from clinic_reception.payments p where p.created_by in (select id from public.admins where name like 'منار%' and role = 'reception') and p.created_at >= '2026-11-20' order by p.created_at;
-- 4b) her reception shifts (mirror)
select to_jsonb(rs) from clinic_reception.shifts rs where rs.cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') and rs.opened_at >= '2026-11-20' order by rs.opened_at;
-- 5) her requests since 20-11 (refund / corrections …)
select q.id, q.kind, q.amount, q.status, q.created_at, q.subject_id from clinic_reception.requests q
 where q.created_by in (select id from public.admins where name like 'منار%' and role = 'reception') and q.created_at >= '2026-11-20' order by q.created_at;
-- 6) blockers: any unreviewed finance shift on her or on her registers
select s.id, s.status, s.ended_at, s.opened_at, r.name from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
 where s.status <> 'reviewed' and (s.cashier_id in (select id from public.admins where name like 'منار%' and role = 'reception') or r.assigned_to in (select id from public.admins where name like 'منار%' and role = 'reception'));
rollback;
