-- Accounting home (owner-approved mockup, 2026-11-18): one read-only summary RPC for the finance overview page.
--   public.clinic_finance_overview() -> jsonb. No writes, no patient data (no names, ids or file numbers).
-- Gate: exactly the clinic_finance_snapshot gate (clinic_finance.require_access('view')).
-- Visibility follows the snapshot: clinic-wide totals (register balances, everyone's receipts and requests, trial balance)
-- are reviewer-only there, so they are null here for non-reviewers; doctor dues follow clinic_finance.doctor_accounts()
-- (create or review). The UI hides any tile whose value is null.
-- Days are Africa/Cairo days. Everything is reused from the existing ledger/functions:
--   * cash_on_hand      = sum over registers of the «كشف الخزينة» closing (clinic_finance_account_statement with p_register:
--                         lines on the register's account_code, business_date <= today).
--   * doctor_dues_now   = sum(payable_now) of clinic_finance.doctor_accounts() — the «مستحق للصرف الآن» card.
--   * pending_requests  = pending rows of the snapshot's «disbursements» list (section requests).
--   * collections       = money received: live reception receipts, finance-desk receipts not mirrored from reception and not
--                         advance allocations, received booking advances, insurer/entity collections (gross, before refunds).
begin;

create or replace function public.clinic_finance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  me uuid := clinic_finance.require_access('view');
  reviewer boolean := clinic_finance.allowed('review');
  dues_ok boolean := clinic_finance.allowed('create') or clinic_finance.allowed('review');
  today date := (now() at time zone 'Africa/Cairo')::date;
  since timestamptz := ((now() at time zone 'Africa/Cairo')::date - 13)::timestamp at time zone 'Africa/Cairo';
  v_cash jsonb;
  v_today jsonb;
  v_14 jsonb;
  v_dues jsonb;
  v_req jsonb;
  v_needs jsonb := '[]'::jsonb;
  v_exp jsonb;
  d jsonb;
  n integer;
  amt numeric;
  days_since integer;
begin
  if reviewer then
    -- Cash on hand: the treasury statement closing of every register, and its end-of-day value for the last 7 days.
    with codes as (select distinct r.account_code code from clinic_finance.registers r where r.account_code is not null),
    moves as (select e.business_date as day, l.debit - l.credit amount from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id
              where l.account in (select code from codes) and e.business_date <= today)
    select jsonb_build_object(
      'amount', round(coalesce((select sum(amount) from moves), 0), 2),
      'registers', (select count(*) from clinic_finance.registers r where r.account_code is not null),
      'trend7', (select jsonb_agg(round(coalesce((select sum(m.amount) from moves m where m.day <= g.day::date), 0), 2) order by g.day)
                 from generate_series((today - 6)::timestamp, today::timestamp, interval '1 day') g(day)))
    into v_cash;

    -- Collections of the last 14 days, by bucket: cash, card (pos), insurance (insurer/entity collections), other (bank/instapay/wallet).
    with rec as (
      select (p.created_at at time zone 'Africa/Cairo')::date as day,
             case p.method when 'cash' then 'cash' when 'pos' then 'card' else 'other' end bucket, p.amount, fs.register_id
      from clinic_reception.payments p
      join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
      left join clinic_reception.shifts rs on rs.id = p.shift_id
      left join clinic_finance.shifts fs on fs.id = rs.finance_shift_id
      where p.created_at >= since
      union all
      select (fp.created_at at time zone 'Africa/Cairo')::date,
             case fp.method when 'cash' then 'cash' when 'pos' then 'card' else 'other' end, fp.amount, fs.register_id
      from clinic_finance.payments fp
      left join clinic_finance.shifts fs on fs.id = fp.shift_id
      where fp.created_at >= since
        and not exists (select 1 from clinic_reception.payments rp where rp.finance_payment_id = fp.id)
        and not exists (select 1 from clinic_finance.advance_uses u where u.payment_id = fp.id)
      union all
      select (a.created_at at time zone 'Africa/Cairo')::date,
             case a.method when 'cash' then 'cash' when 'pos' then 'card' else 'other' end, a.amount, fs.register_id
      from clinic_finance.advances a
      left join clinic_finance.shifts fs on fs.id = a.shift_id
      where a.status = 'received' and a.created_at >= since
      union all
      select (r.created_at at time zone 'Africa/Cairo')::date, 'insurance', r.amount, fs.register_id
      from clinic_finance.insurance_claim_receipts r
      left join clinic_finance.shifts fs on fs.id = r.shift_id
      where r.created_at >= since
      union all
      select (coalesce(x.reviewed_at, x.created_at) at time zone 'Africa/Cairo')::date, 'insurance', x.amount, null::uuid
      from clinic_finance.insurance_actions x
      where x.kind = 'payment' and x.status = 'approved' and coalesce(x.reviewed_at, x.created_at) >= since
      union all
      select (coalesce(j.created_at, q.created_at) at time zone 'Africa/Cairo')::date, 'insurance', q.amount, null::uuid
      from clinic_reception.requests q
      join clinic_reception.workspaces w on w.id = q.workspace_id and w.mode = 'live'
      left join lateral (select min(jj.created_at) created_at from clinic_reception.journal jj
                         where jj.workspace_id = q.workspace_id and jj.source = 'claim_payment' and jj.source_id = q.id) j on true
      where q.kind = 'claim_payment' and q.status = 'approved' and coalesce(j.created_at, q.created_at) >= since
    ), days as (
      select g.day::date as day from generate_series((today - 13)::timestamp, today::timestamp, interval '1 day') g(day)
    ), per as (
      select dd.day,
             round(coalesce(sum(r.amount) filter (where r.bucket = 'cash'), 0), 2) cash,
             round(coalesce(sum(r.amount) filter (where r.bucket = 'card'), 0), 2) card,
             round(coalesce(sum(r.amount) filter (where r.bucket = 'insurance'), 0), 2) insurance,
             round(coalesce(sum(r.amount) filter (where r.bucket = 'other'), 0), 2) other,
             round(coalesce(sum(r.amount), 0), 2) total
      from days dd left join rec r on r.day = dd.day group by dd.day
    )
    select jsonb_build_object(
      'today', jsonb_build_object(
        'amount', (select total from per where day = today),
        'receipts', (select count(*) from rec where day = today),
        'registers', (select count(distinct register_id) from rec where day = today),
        'trend7', (select jsonb_agg(total order by day) from per where day > today - 7)),
      'days', (select jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'cash', cash, 'card', card, 'insurance', insurance, 'other', other) order by day) from per))
    into d;
    v_today := d -> 'today';
    v_14 := d -> 'days';

    -- Disbursement / refund requests waiting for review: the pending rows of the snapshot's «disbursements» list.
    with q as (
      select r.amount, r.created_at from clinic_finance.requests r where r.status = 'pending'
      union all select p.gross - p.withheld, p.created_at from clinic_finance.doctor_payouts p where p.status = 'pending'
      union all select b.amount, b.created_at from clinic_finance.business_requests b where b.kind = 'salary_payment' and b.status = 'pending'
      union all select s.amount, s.created_at from clinic_finance.supplier_actions s where s.kind = 'supplier_payment' and s.status = 'pending'
    )
    select jsonb_build_object('count', count(*), 'older_than_day', count(*) filter (where created_at < now() - interval '1 day'),
                              'amount', round(coalesce(sum(amount), 0), 2))
    into v_req from q;

    -- Top expense accounts this month (posted ledger, same lines as the trial balance).
    select coalesce(jsonb_agg(jsonb_build_object('category', x.name, 'amount', x.amount) order by x.amount desc, x.name), '[]'::jsonb)
    into v_exp
    from (select a.name, round(sum(l.debit - l.credit), 2) amount
          from clinic_finance.lines l join clinic_finance.entries e on e.id = l.entry_id join clinic_finance.accounts a on a.code = l.account
          where a.kind = 'expense' and e.business_date between date_trunc('month', today)::date and today
          group by a.code, a.name having sum(l.debit - l.credit) > 0
          order by 2 desc, a.name limit 5) x;

    -- What needs attention, most important first (at most 5).
    select count(*) into n from clinic_finance.shifts where status = 'submitted';
    if n > 0 then
      v_needs := v_needs || jsonb_build_object('kind', 'shift_review', 'section', 'shifts', 'count', n,
        'label', 'ورديات مستنية مراجعة', 'detail', n || ' وردية اتقفلت ومستنية مراجعة الجرد');
    end if;

    select count(*), coalesce(sum(amount), 0) into n, amt from clinic_finance.treasury_transfers where status = 'pending';
    if n > 0 then
      v_needs := v_needs || jsonb_build_object('kind', 'handover', 'section', 'shifts', 'count', n, 'amount', round(amt, 2),
        'label', 'تسليمات نقدية مستنية استلام', 'detail', 'استلم النقد فعليًا واعتمد التسليم للخزينة الرئيسية');
    end if;

    if (v_req ->> 'count')::integer > 0 then
      v_needs := v_needs || jsonb_build_object('kind', 'requests', 'section', 'requests', 'count', (v_req ->> 'count')::integer,
        'amount', (v_req -> 'amount'), 'label', 'طلبات صرف مستنية مراجعة',
        'detail', case when (v_req ->> 'older_than_day')::integer > 0 then (v_req ->> 'older_than_day') || ' منهم عدى عليهم أكتر من يوم' else 'كل طلب محتاج مراجعة شخص تاني' end);
    end if;

    select count(*), coalesce(sum(abs(difference)), 0) into n, amt from clinic_finance.cash_cases where status <> 'decided';
    if n > 0 then
      v_needs := v_needs || jsonb_build_object('kind', 'cash_cases', 'section', 'cases', 'count', n, 'amount', round(amt, 2),
        'label', 'فروق خزينة مفتوحة', 'detail', 'فروق جرد لسه ماتقفلش قرارها');
    end if;

    -- Same rule as the snapshot's «claim_tracking»: due > 0 and the follow-up / claim date has passed.
    select count(*), coalesce(sum(t.due), 0) into n, amt
    from (select clinic_finance.claim_due(c.id) due,
                 coalesce(f.due_date, (c.created_at at time zone 'Africa/Cairo')::date) due_date
          from clinic_finance.insurance_claims c
          left join lateral (select fu.due_date from clinic_finance.claim_followups fu where fu.claim_id = c.id order by fu.created_at desc, fu.id desc limit 1) f on true) t
    where t.due > 0 and t.due_date < today;
    if n > 0 then
      v_needs := v_needs || jsonb_build_object('kind', 'insurance_overdue', 'section', 'insurance', 'count', n, 'amount', round(amt, 2),
        'label', 'مطالبات تأمين متأخرة', 'detail', 'مستحقات عند جهات التأمين عدى معادها');
    end if;

    select count(*) filter (where status = 'pending'), today - max(to_date) into n, days_since from clinic_finance.bank_statements;
    if n > 0 or days_since > 7 then
      v_needs := v_needs || jsonb_build_object('kind', 'bank_reconcile', 'section', 'bank', 'count', n, 'days_since', days_since,
        'label', 'مطابقة البنك', 'detail', case when n > 0 then n || ' كشف بنك مستني مطابقة' else 'آخر كشف بنك متطابق من ' || days_since || ' يوم' end);
    end if;

    select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_needs
    from jsonb_array_elements(v_needs) with ordinality t(x, o) where o <= 5;
  end if;

  if dues_ok then
    d := clinic_finance.doctor_accounts();
    select jsonb_build_object('amount', round(coalesce(sum((x ->> 'payable_now')::numeric), 0), 2),
                              'doctors', count(*) filter (where (x ->> 'payable_now')::numeric > 0))
    into v_dues from jsonb_array_elements(coalesce(d -> 'doctors', '[]'::jsonb)) x;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'today', to_char(today, 'YYYY-MM-DD'),
    'can_review', reviewer,
    'cash_on_hand', v_cash,
    'today_collections', v_today,
    'doctor_dues_now', v_dues,
    'pending_requests', v_req,
    'collections_14d', v_14,
    'needs', v_needs,
    'expenses_month', v_exp);
end
$function$;

revoke all on function public.clinic_finance_overview() from public, anon;
grant execute on function public.clinic_finance_overview() to authenticated;

commit;
