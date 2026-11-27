-- READ-ONLY: «خزينة مريم» surplus 1,090 / 2,280 (shift 24-11 cc5b0398…). Totals by shift and source only — no patient data.
begin read only;
with sh as (
  select s.* from clinic_finance.shifts s
  where s.register_id = (select register_id from clinic_finance.shifts where id::text like 'cc5b0398%')
    and s.opened_at >= timestamptz '2026-11-20 00:00+02'
)
select 'shift' k, to_char(sh.opened_at at time zone 'Africa/Cairo','DD-MM HH24:MI') at_, left(sh.id::text,8) id, sh.status,
       sh.opening_book, sh.end_expected, sh.end_counted, sh.end_counted - sh.end_expected end_diff,
       clinic_finance.shift_cash(sh.id) shift_cash_now,
       (select sum(l.debit-l.credit) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id
         where e.shift_id=sh.id and clinic_finance.is_cash_account(l.account) and e.source<>'treasury_transfer_out') moves_excl_handover,
       (select string_agg(t.status||' '||t.amount, ', ') from clinic_finance.treasury_transfers t where t.from_shift=sh.id) handovers,
       (select c.difference||' '||c.status||' settle='||coalesce(c.settle_status,'-') from clinic_finance.cash_cases c where c.shift_id=sh.id) cash_case
from sh order by sh.opened_at;

-- movements per shift by source (count + net cash), no names
select to_char(s.opened_at at time zone 'Africa/Cairo','DD-MM') shift_day, e.source, count(*) n, sum(l.debit-l.credit) net_cash,
       min(to_char(e.created_at at time zone 'Africa/Cairo','DD-MM HH24:MI')) first_at, max(to_char(e.created_at at time zone 'Africa/Cairo','DD-MM HH24:MI')) last_at
from clinic_finance.shifts s join clinic_finance.entries e on e.shift_id=s.id join clinic_finance.lines l on l.entry_id=e.id and clinic_finance.is_cash_account(l.account)
where s.register_id = (select register_id from clinic_finance.shifts where id::text like 'cc5b0398%') and s.opened_at >= timestamptz '2026-11-20 00:00+02'
group by 1, 2 order by 1, 2;

select 'book_now' k, clinic_finance.treasury_balance(r.id) treasury_balance, clinic_finance.case_settle_book(r.id) closed_shifts_book
from clinic_finance.registers r where r.id = (select register_id from clinic_finance.shifts where id::text like 'cc5b0398%');
rollback;
