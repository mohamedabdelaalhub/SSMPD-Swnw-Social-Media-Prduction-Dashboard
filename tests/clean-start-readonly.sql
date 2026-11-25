-- READ-ONLY: state check before a clean start on 2026-11-27 (owner asks to "wipe 21-26"; plan = no deletes, clean opening).
-- No writes, no temp objects, ends with ROLLBACK. No patient names / phones.
begin read only;
-- 1) opening batches (one allowed pending/approved): status + dates + line summary
select b.id, b.kind, b.reference, b.status, b.created_at, b.entry_id,
       (select name from public.admins where id = b.created_by) created_by,
       (select jsonb_agg(jsonb_build_object('account', x->>'account', 'debit', x->>'debit', 'credit', x->>'credit')) from jsonb_array_elements(b.payload->'lines') x) lines
  from clinic_finance.manual_batches b where b.kind = 'opening' order by b.created_at;
select d.account, count(*) n, sum(d.debit) dr, sum(d.credit) cr from clinic_finance.opening_details d group by 1 order by 1;
-- 2) cutover / workspace settings
select to_jsonb(s) from clinic_reception.settings s;
select w.id, w.name, w.mode, w.created_at from clinic_reception.workspaces w order by w.created_at;
-- 3a) ledger entries 2026-11-20..26 by business_date + source
select e.business_date, e.source, count(distinct e.id) entries, sum(l.debit) dr
  from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
 where e.business_date between '2026-11-20' and '2026-11-26' group by 1, 2 order by 1, 2;
-- 3b) anything dated before 2026-11-20 (should be empty or opening only)
select e.source, min(e.business_date) first_day, max(e.business_date) last_day, count(*) n
  from clinic_finance.entries e where e.business_date < '2026-11-20' group by 1 order by 1;
-- 3c) balances now: cash accounts, registers, main, bank, card, wallets, doctors, advances, suspense
select l.account, a.name, sum(l.debit - l.credit) balance, count(*) n
  from clinic_finance.lines l left join clinic_finance.accounts a on a.code = l.account
 where clinic_finance.is_cash_account(l.account) or l.account in ('1112','1114','1115','2120','1142','1194','3198','3199')
   or l.account in (select account_code from clinic_finance.registers where account_code is not null)
 group by 1, 2 order by 1;
-- 3d) reception live journal 2120/1194 totals (feeds doctor_balance)
select l.account, sum(l.credit - l.debit) net, count(*) n
  from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id join clinic_reception.workspaces w on w.id = j.workspace_id
 where w.mode = 'live' and l.account in ('2120','1194') group by 1;
-- 3e) per-doctor balances (doctor_key only) + accrual/payout counts since 20-11
select c.doctor_key, clinic_finance.doctor_balance(c.doctor_key) balance,
       (select count(*) from clinic_finance.doctor_accruals x where x.doctor_key = c.doctor_key) accruals,
       (select count(*) from clinic_finance.doctor_payouts x where x.doctor_key = c.doctor_key and x.status = 'approved') payouts,
       (select coalesce(sum(credit - debit), 0) from clinic_finance.opening_details d where d.account = '2120' and d.subject = c.doctor_key) opening
  from (select distinct doctor_key from clinic_finance.doctor_contracts where status = 'active') c order by 2 desc;
-- 4a) every finance shift not reviewed
select s.id, r.name register, r.treasury_kind, (select name from public.admins where id = s.cashier_id) cashier, s.opened_at, s.ended_at, s.closed_at,
       s.status, s.opening_book, s.end_expected, s.end_counted, s.counted, clinic_finance.shift_cash(s.id) shift_cash_now
  from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id where s.status <> 'reviewed' order by s.opened_at;
-- 4b) open cash cases
select c.id, c.shift_id, c.difference, c.status, c.decision, c.updated_at from clinic_finance.cash_cases c where c.status <> 'decided' order by c.updated_at;
-- 4c) pending treasury transfers + pending reception requests (counts)
select t.id, t.from_shift, t.amount, t.status, t.created_at from clinic_finance.treasury_transfers t where t.status = 'pending' order by t.created_at;
select q.kind, q.status, count(*) n, sum(q.amount) amount from clinic_reception.requests q where q.status = 'pending' group by 1, 2 order by 1, 2;
-- 5) doctor_balance definition as live (opening adds to accruals?)
select pg_get_functiondef('clinic_finance.doctor_balance(text)'::regprocedure);
select pg_get_functiondef('clinic_finance.legacy_doctor_balance(text)'::regprocedure);
rollback;
