-- READ-ONLY diagnostic for «خزينة مازن» (register 3b39cfc5…, cashier f81b3cf7…): where does the phantom negative opening come from?
-- Writes nothing (READ ONLY transaction, ROLLBACK). Prints amounts / sources / receipt numbers only — no patient names.
begin;
set transaction read only;
do $$
declare reg uuid; r record; s record; n int;
begin
  select id into reg from clinic_finance.registers where id::text like '3b39cfc5%';
  if reg is null then raise exception 'register 3b39cfc5 not found'; end if;
  raise notice '== register balance now (all lines on the drawer): %', clinic_finance.treasury_balance(reg);
  -- 1) every shift of this drawer since 2026-11-20: opening snapshot, book, count, handover, case
  for s in
    select sh.*, clinic_finance.shift_cash(sh.id) book,
           (select coalesce(sum(l.credit - l.debit), 0) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
             where e.shift_id = sh.id and e.source in ('treasury_transfer_out', 'treasury_binding') and clinic_finance.is_cash_account(l.account)) handed,
           c.difference case_diff, c.status case_status, c.settle_status, c.settle_kind
      from clinic_finance.shifts sh left join clinic_finance.cash_cases c on c.shift_id = sh.id
     where sh.register_id = reg and sh.opened_at >= timestamptz '2026-11-20 00:00 Africa/Cairo' order by sh.opened_at
  loop
    raise notice '-- shift % | opened % | ended % | status % | opening_book % | book now % | end_expected % | end_counted % | counted % | handed over % | case diff % (% / settle % %)',
      left(s.id::text, 8), (s.opened_at at time zone 'Africa/Cairo')::text, coalesce((s.ended_at at time zone 'Africa/Cairo')::text, '-'), s.status,
      s.opening_book, s.book, s.end_expected, s.end_counted, s.counted, s.handed, s.case_diff, s.case_status, s.settle_status, s.settle_kind;
    for r in
      select e.source, count(*) n, sum(l.debit) dr, sum(l.credit) cr
        from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id
       where e.shift_id = s.id and clinic_finance.is_cash_account(l.account) group by e.source order by e.source
    loop
      raise notice '      drawer lines: % × % | in % | out %', r.n, r.source, r.dr, r.cr;
    end loop;
  end loop;
  -- 2) reception CASH receipts taken by this cashier 2026-11-20 … now, by Cairo day: on this drawer's finance shift, on another shift, or not posted
  for r in
    select (p.created_at at time zone 'Africa/Cairo')::date d, count(*) n, sum(p.amount) amt,
           count(*) filter (where fs.register_id = reg) on_drawer, coalesce(sum(p.amount) filter (where fs.register_id = reg), 0) amt_on_drawer,
           count(*) filter (where fs.id is not null and fs.register_id <> reg) other_drawer,
           count(*) filter (where fs.id is null) no_finance_shift,
           string_agg(p.receipt_no, ' ' order by p.created_at) filter (where fs.id is null or fs.register_id <> reg) odd_receipts
      from clinic_reception.payments p
      join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
      left join clinic_reception.shifts rs on rs.id = p.shift_id
      left join clinic_finance.shifts fs on fs.id = rs.finance_shift_id
     where p.method = 'cash' and p.created_by::text like 'f81b3cf7%' and p.created_at >= timestamptz '2026-11-20 00:00 Africa/Cairo'
     group by 1 order by 1
  loop
    raise notice '== % cash receipts by Mazen: % = % | on this drawer % (%) | other drawer % | no finance shift % | odd: %',
      r.d, r.n, r.amt, r.on_drawer, r.amt_on_drawer, r.other_drawer, r.no_finance_shift, coalesce(r.odd_receipts, '-');
  end loop;
  -- 3) receipts whose reception cash posting has no finance mirror on a shift (money in the drawer the book never saw)
  select count(*) into n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '1111' and l.debit > 0
   where j.actor_id::text like 'f81b3cf7%' and j.created_at >= timestamptz '2026-11-20 00:00 Africa/Cairo'
     and not exists (select 1 from clinic_finance.entries e where e.id = j.finance_entry_id and e.shift_id is not null);
  raise notice '== reception cash postings by Mazen since 20-11 with no finance entry on a shift: %', n;
  -- 4) drawer payouts / shift expenses / employee-debt converts on this drawer since 20-11
  for r in
    select e.source, (e.business_date)::text d, sum(l.credit - l.debit) out_amt, count(distinct e.id) n
      from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id join clinic_finance.shifts sh on sh.id = e.shift_id
     where sh.register_id = reg and clinic_finance.is_cash_account(l.account) and l.credit > 0 and e.business_date >= date '2026-11-20'
     group by 1, 2 order by 2, 1
  loop
    raise notice '== out of the drawer % on %: % (% entries)', r.source, r.d, r.out_amt, r.n;
  end loop;
end $$;
rollback;
