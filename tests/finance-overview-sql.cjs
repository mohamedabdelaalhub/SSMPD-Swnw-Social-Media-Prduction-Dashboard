// Accounting home (2026-11-18): public.clinic_finance_overview() on PGlite.
// The finance/reception tables are reduced to the columns the overview reads, and the access helpers (allowed / require_access /
// doctor_accounts) are stubs with the same contract as production; the real gate and numbers are checked by the live BEGIN…ROLLBACK dry run.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('node:assert/strict');
const id = n => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.admins(id uuid primary key, name text, role text, active boolean default true);
      create function public.my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
      create function public.has_role(r text) returns boolean language sql stable as $$select exists(select 1 from public.admins where id=public.my_admin_id() and role=r)$$;
      create schema clinic_finance; create schema clinic_reception;
      create function clinic_finance.allowed(p_action text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
        select public.my_admin_id() is not null and (public.has_role('super_admin') or public.has_role('financial_manager') or (public.has_role('accountant') and p_action<>'review'))$$;
      create function clinic_finance.require_access(p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
        begin if not clinic_finance.allowed(p_action) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode='42501';end if;return public.my_admin_id();end $$;
      create table clinic_finance.registers(id uuid primary key, name text, account_code text);
      create table clinic_finance.shifts(id uuid primary key, register_id uuid, status text);
      create table clinic_finance.entries(id uuid primary key default gen_random_uuid(), business_date date, shift_id uuid);
      create table clinic_finance.lines(entry_id uuid, account text, debit numeric default 0, credit numeric default 0);
      create table clinic_finance.accounts(code text primary key, name text, kind text);
      create table clinic_finance.payments(id uuid primary key default gen_random_uuid(), shift_id uuid, method text, amount numeric, created_at timestamptz default now());
      create table clinic_finance.advance_uses(payment_id uuid);
      create table clinic_finance.advances(method text, amount numeric, shift_id uuid, status text, created_at timestamptz default now());
      create table clinic_finance.insurance_claim_receipts(amount numeric, shift_id uuid, created_at timestamptz default now());
      create table clinic_finance.insurance_actions(kind text, status text, amount numeric, created_at timestamptz default now(), reviewed_at timestamptz, claim_id uuid);
      create table clinic_finance.requests(amount numeric, status text, created_at timestamptz default now());
      create table clinic_finance.doctor_payouts(gross numeric, withheld numeric default 0, status text, created_at timestamptz default now());
      create table clinic_finance.business_requests(kind text, amount numeric, status text, created_at timestamptz default now());
      create table clinic_finance.supplier_actions(kind text, amount numeric, status text, created_at timestamptz default now());
      create table clinic_finance.treasury_transfers(amount numeric, status text);
      create table clinic_finance.cash_cases(difference numeric, status text);
      create table clinic_finance.insurance_claims(id uuid primary key default gen_random_uuid(), amount numeric, created_at timestamptz default now());
      create table clinic_finance.claim_followups(id uuid primary key default gen_random_uuid(), claim_id uuid, due_date date, created_at timestamptz default now());
      create table clinic_finance.bank_statements(status text, to_date date);
      create function clinic_finance.claim_due(p_id uuid) returns numeric language sql stable as $$
        select c.amount-coalesce((select sum(amount) from clinic_finance.insurance_actions where claim_id=c.id and status='approved' and kind in ('contractual','payment')),0)-0 from clinic_finance.insurance_claims c where c.id=p_id$$;
      create table doctor_rows(payable_now numeric);
      create function clinic_finance.doctor_accounts() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
        begin if not (clinic_finance.allowed('create') or clinic_finance.allowed('review')) then raise exception 'ليس لديك صلاحية لهذه العملية المالية' using errcode='42501';end if;
        return jsonb_build_object('doctors',(select coalesce(jsonb_agg(jsonb_build_object('doctor_name','x','payable_now',payable_now)),'[]') from public.doctor_rows));end $$;
      create table clinic_reception.workspaces(id uuid primary key, mode text);
      create table clinic_reception.shifts(id uuid primary key, finance_shift_id uuid);
      create table clinic_reception.payments(id uuid primary key default gen_random_uuid(), workspace_id uuid, method text, amount numeric, shift_id uuid, created_at timestamptz default now(), finance_payment_id uuid);
      create table clinic_reception.requests(id uuid primary key default gen_random_uuid(), workspace_id uuid, kind text, status text, amount numeric, created_at timestamptz default now());
      create table clinic_reception.journal(workspace_id uuid, source text, source_id uuid, created_at timestamptz default now());
      grant usage on schema clinic_finance, clinic_reception to authenticated;`);
    for (const [n, role] of [[1, 'super_admin'], [2, 'accountant'], [3, 'financial_manager'], [4, 'reception']]) await db.query('insert into admins(id,name,role) values($1,$2,$3)', [id(n), 'T' + n, role]);
    const sql = fs.readFileSync('supabase/migrations/20261118050000_finance_overview.sql', 'utf8');
    await db.exec(sql); await db.exec(sql); // idempotent
    const q = (s, a = []) => db.query(s, a).then(r => r.rows);
    const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); };
    const ov = async n => { await as(n); const v = (await q('select public.clinic_finance_overview() v'))[0].v; await db.exec('reset role'); return v; };
    const today = (await q("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d, ago = k => `((now() at time zone 'Africa/Cairo')::date - ${k})`;

    // registers + ledger: R1 gets 500 three days ago and 200 today (minus 50 paid out today), R2 gets 300 yesterday; an unbound register is ignored.
    const R1 = id(11), R2 = id(12), S1 = id(21), S2 = id(22);
    await q("insert into clinic_finance.registers values($1,'رئيسية','0102010101'),($2,'استقبال','0102010102'),($3,'قديمة',null)", [R1, R2, id(13)]);
    await q("insert into clinic_finance.shifts values($1,$2,'open'),($3,$4,'submitted'),($5,$4,'submitted')", [S1, R1, S2, R2, id(23)]);
    const post = async (day, acct, dr, cr, shift = null) => { const e = (await q(`insert into clinic_finance.entries(business_date,shift_id) values(${day},$1) returning id`, [shift]))[0].id; await q('insert into clinic_finance.lines values($1,$2,$3,$4)', [e, acct, dr, cr]); };
    await post(ago(3), '0102010101', 500, 0, S1); await post(ago(0), '0102010101', 200, 0, S1); await post(ago(0), '0102010101', 0, 50, S1);
    await post(ago(1), '0102010102', 300, 0, S2); await post(ago(-3), '0102010101', 999, 0, S1); // a future-dated line is not in today's statement
    await q("insert into clinic_finance.accounts values('5111','أتعاب أطباء','expense'),('5123','كهرباء','expense'),('5200','مرتجع','expense')");
    await post(ago(0), '5111', 480, 0); await post(ago(0), '5123', 10, 0); await post(ago(0), '5200', 0, 5);

    // collections today: reception cash 110 (live), reception pos 40 (live), trial workspace 999 (ignored), finance mirror of a reception receipt (ignored),
    // finance-desk instapay 25, an advance allocation payment (ignored), received advance cash 60, insurer receipt 70, approved insurer action 30, reception entity payment 20.
    const WL = id(31), WT = id(32), RS = id(33);
    await q("insert into clinic_reception.workspaces values($1,'live'),($2,'trial')", [WL, WT]);
    await q('insert into clinic_reception.shifts values($1,$2)', [RS, S2]);
    const mirror = (await q("insert into clinic_finance.payments(shift_id,method,amount) values($1,'cash',110) returning id", [S2]))[0].id;
    await q("insert into clinic_reception.payments(workspace_id,method,amount,shift_id,finance_payment_id) values($1,'cash',110,$2,$3),($1,'pos',40,$2,null),($4,'cash',999,null,null)", [WL, RS, mirror, WT]);
    await q("insert into clinic_reception.payments(workspace_id,method,amount,created_at) values($1,'cash',15,now()-interval '20 days')", [WL]); // outside 14 days
    await q("insert into clinic_finance.payments(shift_id,method,amount) values(null,'instapay',25)");
    const alloc = (await q("insert into clinic_finance.payments(shift_id,method,amount) values($1,'cash',35) returning id", [S1]))[0].id; await q('insert into clinic_finance.advance_uses values($1)', [alloc]);
    await q("insert into clinic_finance.advances(method,amount,shift_id,status) values('cash',60,$1,'received'),('bank',80,null,'pending')", [S1]);
    await q('insert into clinic_finance.insurance_claim_receipts(amount,shift_id) values(70,null)');
    await q("insert into clinic_finance.insurance_actions(kind,status,amount,reviewed_at) values('payment','approved',30,now()),('payment','pending',99,null),('contractual','approved',5,now())");
    const er = (await q("insert into clinic_reception.requests(workspace_id,kind,status,amount) values($1,'claim_payment','approved',20) returning id", [WL]))[0].id;
    await q("insert into clinic_reception.journal values($1,'claim_payment',$2,now())", [WL, er]);
    await q("insert into clinic_reception.payments(workspace_id,method,amount,created_at) values($1,'wallet',12,now()-interval '1 day')", [WL]);

    // requests waiting: refund 100 (2 days old), doctor payout 300-30, salary 1000, supplier 50; decided / other kinds ignored
    await q("insert into clinic_finance.requests(amount,status,created_at) values(100,'pending',now()-interval '2 days'),(5,'approved',now())");
    await q("insert into clinic_finance.doctor_payouts(gross,withheld,status) values(300,30,'pending'),(100,0,'approved')");
    await q("insert into clinic_finance.business_requests(kind,amount,status) values('salary_payment',1000,'pending'),('employment',7,'pending')");
    await q("insert into clinic_finance.supplier_actions(kind,amount,status) values('supplier_payment',50,'pending'),('supplier_return',9,'pending')");
    await q("insert into clinic_finance.treasury_transfers values(400,'pending'),(1,'approved')");
    await q("insert into clinic_finance.cash_cases values(-12,'recorded'),(3,'decided')");
    const c1 = (await q("insert into clinic_finance.insurance_claims(amount,created_at) values(900,now()-interval '40 days') returning id"))[0].id;
    await q("insert into clinic_finance.insurance_claims(amount,created_at) values(500,now())"); // not yet due
    await q("insert into clinic_finance.insurance_actions(kind,status,amount,reviewed_at,claim_id,created_at) values('contractual','approved',100,now()-interval '30 days',$1,now()-interval '30 days')", [c1]);
    await q(`insert into clinic_finance.bank_statements values('approved',${ago(10)})`);
    await q('insert into public.doctor_rows values(150),(0),(75.5)');

    // gate: reception refused like the snapshot; accountant sees only doctor dues; reviewers see everything
    await as(4); await assert.rejects(() => q('select public.clinic_finance_overview()'), /صلاحية/); await db.exec('reset role');
    const acc = await ov(2);
    assert.equal(acc.can_review, false);
    for (const k of ['cash_on_hand', 'today_collections', 'pending_requests', 'collections_14d', 'expenses_month']) assert.equal(acc[k], null, 'accountant: ' + k + ' hidden');
    assert.deepEqual(acc.needs, []); assert.deepEqual(acc.doctor_dues_now, { amount: 225.5, doctors: 2 });

    for (const n of [1, 3]) {
      const v = await ov(n);
      assert.equal(v.can_review, true); assert.equal(v.today, today); assert(v.generated_at);
      assert.deepEqual(v.cash_on_hand, { amount: 950, registers: 2, trend7: [0, 0, 0, 500, 500, 800, 950] });
      assert.deepEqual(v.doctor_dues_now, { amount: 225.5, doctors: 2 });
      // today: 110 cash + 40 pos (reception) + 25 instapay + 60 advance + 70 + 30 + 20 insurance = 355, 7 receipts, registers R2 (reception shift) and R1 (advance)
      assert.deepEqual([v.today_collections.amount, v.today_collections.receipts, v.today_collections.registers], [355, 7, 2]);
      assert.deepEqual(v.today_collections.trend7, [0, 0, 0, 0, 0, 12, 355]);
      assert.equal(v.collections_14d.length, 14); assert.equal(v.collections_14d[13].day, today);
      assert.deepEqual(v.collections_14d[13], { day: today, cash: 170, card: 40, insurance: 120, other: 25 });
      assert.deepEqual(v.collections_14d[12].other, 12);
      assert.deepEqual(v.pending_requests, { count: 4, older_than_day: 1, amount: 1420 });
      assert.deepEqual(v.expenses_month, [{ category: 'أتعاب أطباء', amount: 480 }, { category: 'كهرباء', amount: 10 }]);
      assert.deepEqual(v.needs.map(x => x.kind), ['shift_review', 'handover', 'requests', 'cash_cases', 'insurance_overdue']);
      const by = Object.fromEntries(v.needs.map(x => [x.kind, x]));
      assert.deepEqual([by.shift_review.count, by.shift_review.section], [2, 'shifts']);
      assert.deepEqual([by.handover.count, by.handover.amount, by.handover.section], [1, 400, 'shifts']);
      assert.deepEqual([by.requests.count, by.requests.amount, by.requests.section], [4, 1420, 'requests']);
      assert.deepEqual([by.cash_cases.count, by.cash_cases.amount, by.cash_cases.section], [1, 12, 'cases']);
      assert.deepEqual([by.insurance_overdue.count, by.insurance_overdue.amount, by.insurance_overdue.section], [1, 800, 'insurance']);
      assert(v.needs.every(x => /[؀-ۿ]/.test(x.label) && x.detail), 'Arabic label + detail');
      assert(!/patient|مريض/.test(JSON.stringify(v)), 'no patient data');
    }
    // bank_reconcile appears once fewer needs are open (6th item is cut at 5)
    await q("update clinic_finance.treasury_transfers set status='approved'");
    let v = await ov(1); const bank = v.needs.find(x => x.kind === 'bank_reconcile');
    assert(bank && bank.section === 'bank' && bank.days_since === 10 && bank.count === 0, 'bank reconcile after 10 days');
    await q("insert into clinic_finance.bank_statements values('pending',current_date)"); v = await ov(1);
    assert.equal(v.needs.length, 5);
    // grants
    const g = (await q("select has_function_privilege('anon','public.clinic_finance_overview()','execute') a, has_function_privilege('authenticated','public.clinic_finance_overview()','execute') b"))[0];
    assert.deepEqual([g.a, g.b], [false, true]);
    // rollback drops it
    await db.exec(fs.readFileSync('supabase/rollbacks/20261118050000_finance_overview.rollback.sql', 'utf8'));
    assert.equal((await q("select to_regprocedure('public.clinic_finance_overview()') f"))[0].f, null);
    console.log('PASS finance overview: snapshot gate (reception refused, accountant only doctor dues), cash on hand = treasury statement closing + 7-day EOD trend, today collections by source without mirrors/allocations/trial, 14-day buckets, pending requests, needs order/cap, month expenses, grants, rollback.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
