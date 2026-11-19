// «سجلات تجريبية» learns type 'register' (20261118210000): a TEST cash register that never held real money can be flagged then deleted by the owner, with its shifts,
// its reception bridge rows, its pending / rejected handovers and its empty cash account. Its audit history stays.
// PGlite with the REAL finance / advances / treasury migrations + the test-record tool (20261109130000) and its 'advance' type (20261118190000). Mirrors production:
// «dina» (a test cash advance 99999 taken before the drawer got its own account) and «mahmoud» (no activity, a pending 600 handover to the main treasury).
const boot = require('./helpers/clinic-finance.cjs'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const { db, as, fin, key, id, owner, call } = await boot(['clinic_doctor_settlements', 'clinic_supplier_finance', 'clinic_bank_insurance', 'clinic_payroll_assets_tax', 'clinic_opening_reports', 'clinic_booking_advances', 'clinic_legacy_assets', 'clinic_register_directions_payments']);
  const mig = n => fs.readFileSync('supabase/migrations/' + n, 'utf8');
  const M = '20261118210000_test_tool_register.sql', R = 'supabase/rollbacks/20261118210000_test_tool_register.rollback.sql';
  const ddl = async q => { await db.exec('reset role'); await db.exec(q); };
  const cnt = async (q, a = []) => Number((await owner(q, a))[0].n);
  const snapshot = async (tbl, col, vals) => (await owner(`select to_jsonb(t) r from ${tbl} t where t.${col}::text = any($1)`, [vals])).map(x => JSON.stringify(x.r)).sort();
  for (const p of ['20261017212113_clinic_ledger_chart_actions.sql', '20261018205000_accountant_chart_treasury.sql']) await db.exec(mig(p));
  for (const n of [5, 6, 7]) await owner("insert into admins(id,name,role) values($1,$2,'reception')", [id(n), 'Rec ' + n]);

  // ---- before the drawers get their own accounts: unconfigured drawers, shifts opened through the real reception RPC
  const reg = async name => (await owner('insert into clinic_finance.registers(name,petty_limit,created_by) values($1,1000,$2) returning *', [name, id(1)]))[0];
  const dina = await reg('dina'), mahmoud = await reg('mahmoud'), real = await reg('real'), moved = await reg('moved');
  const open = async (n, r) => { await as(n); return call('clinic_booking_shift', ['open', { register_id: r.id }, key()]); };
  const S1 = await open(4, dina), S2 = await open(5, mahmoud), S3 = await open(6, real), S4 = await open(7, moved);
  await as(4); const A1 = await call('clinic_booking_command', ['receive', { legacy: false, booking_id: null, amount: '1000', method: 'cash', shift_id: S1, reference: '99999', patient_ref: '99999' }, key()]);
  // the real drawer collected a real invoice payment
  const inv = (await owner("insert into clinic_finance.invoices(reference,description,amount,created_by,token) values('INV-R1','كشف',300,$1,gen_random_uuid()) returning id", [id(6)]))[0].id;
  await owner("insert into clinic_finance.payments(invoice_id,shift_id,method,amount,reference,created_by,token) values($1,$2,'cash',300,'PAY-R1',$3,gen_random_uuid())", [inv, S3, id(6)]);
  const pe = (await owner("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('payment',$1,'تحصيل',$2,$3) returning id", [inv, S3, id(6)]))[0].id;
  await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',300,0),($1,'4110',0,300)", [pe]);

  // ---- the drawers are bound: main 901, dina 902 (binding entry moves the advance 1111 -> 902), mahmoud 903 (nothing to move), real 904, moved 905
  await db.exec('reset role'); await db.exec(mig('20261019001000_treasury_shift_handover.sql'));
  await as(1); for (const code of ['901', '902', '903', '904', '905']) await fin('ledger_command', ['account_create', { code, name: 'حساب ' + code, kind: 'asset' }, key()]);
  const main = await fin('treasury_command', ['register_save', { name: 'الخزينة الرئيسية', treasury_kind: 'main', account_code: '901' }, key()]);
  const bind = (r, code, who) => fin('treasury_command', ['register_save', { id: r.id, revision: r.revision, name: r.name, treasury_kind: 'collection', account_code: code, assigned_to: id(who), parent_register_id: main.id }, key()]);
  await bind(dina, '902', 4); await bind(mahmoud, '903', 5); await bind(real, '904', 6); await bind(moved, '905', 7);
  const bal = async code => Number((await owner('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines where account=$1', [code]))[0].n);
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('903'), await bal('904'), await bal('2150')], [0, 1000, 0, 300, -1000], 'production picture after the binding');
  assert.equal(await cnt("select count(*)::int n from clinic_finance.cash_accounts where code in ('902','903')"), 2);
  // mahmoud ended his shift and asked to hand 600 to the main treasury (pending, no ledger entry); «moved» already handed money over (approved)
  await owner('update clinic_finance.shifts set ended_at=now(), end_counted=600 where id=$1', [S2]);
  const T2 = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values($1,$2,600,'TR-M','تسليم',$3) returning id", [S2, main.id, id(5)]))[0].id;
  const T2r = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by,status) values($1,$2,50,'TR-M0','تسليم',$3,'rejected') returning id", [S2, main.id, id(5)]))[0].id;
  await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by,status) values($1,$2,10,'TR-X','تسليم',$3,'approved')", [S4, main.id, id(7)]);

  // ---- reception bridge rows (production: one reception register per finance register, reception shift id = finance shift id) + the test-record tool and its 'advance' type
  await ddl(`create schema if not exists clinic_reception;
    create table if not exists clinic_reception.registers(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text not null, direction text not null default 'receive', finance_register_id uuid references clinic_finance.registers(id));
    create table if not exists clinic_reception.shifts(id uuid primary key default gen_random_uuid(), workspace_id uuid, register_id uuid not null references clinic_reception.registers(id), cashier_id uuid, status text not null default 'open', finance_shift_id uuid references clinic_finance.shifts(id));
    create table if not exists clinic_reception.payments(id uuid primary key default gen_random_uuid(), shift_id uuid references clinic_reception.shifts(id), amount numeric(14,2) not null);
    create table clinic_finance.doctor_payout_invoices(payout_id uuid, invoice_id uuid, doctor_key text, fee numeric);
    create table clinic_finance.advance_proofs(advance_id uuid primary key references clinic_finance.advances(id), provider text not null, terminal_code text not null default '', rrn text not null default '', reference text not null, evidence_url text not null default '', recorded_by uuid not null references public.admins(id), updated_at timestamptz not null default now());
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;`);
  const bridge = async (r, s) => { const rr = (await owner("insert into clinic_reception.registers(name,finance_register_id) values($1,$2) returning id", [r.name, r.id]))[0].id; await owner('insert into clinic_reception.shifts(id,register_id,finance_shift_id) values($1,$2,$1)', [s, rr]); return rr; };
  const RR1 = await bridge(dina, S1), RR2 = await bridge(mahmoud, S2), RR3 = await bridge(real, S3);
  await db.exec(mig('20261109130000_test_record_delete.sql')); await db.exec(mig('20261118190000_test_tool_booking_advance.sql'));
  const defs = async () => (await owner("select md5(pg_get_functiondef('clinic_finance.test_plan(text,text)'::regprocedure)) m, md5(pg_get_functiondef('public.clinic_finance_test_find(text,text)'::regprocedure)) f"))[0];
  const before = await defs();
  await db.exec('reset role'); await db.exec(mig(M));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(M)); }, /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_flags') + await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0, 'applying flags / deletes nothing');

  const tf = async (n, fn, ...a) => { await as(n); return call('clinic_finance_test_' + fn, a); };
  const flagIt = (t, k) => tf(1, 'flag', t, k, 'سجل تجربة من المالك', 'تجريبي');
  const delIt = (t, k, reason = 'تنظيف بيانات التجربة') => tf(1, 'delete', t, k, reason, 'حذف');
  const scan = k => tf(1, 'scan', 'register', k);
  const codes = async k => (await scan(k)).blockers.map(b => b.code).sort();

  // ---- 1. owner only; the other types still answer through the untouched previous functions
  for (const n of [2, 3, 4, 5]) for (const [fn, ...a] of [['find', 'register', 'dina'], ['scan', 'register', mahmoud.id], ['flag', 'register', mahmoud.id, 'سبب تجربة', 'تجريبي'], ['delete', 'register', mahmoud.id, 'سبب تجربة', 'حذف']])
    await assert.rejects(tf(n, fn, ...a), /للمالك فقط/, `admin ${n} refused: ${fn}`);
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['register', '']), /permission denied/); await db.exec('reset role');
  await as(1); await assert.rejects(db.query("select clinic_finance.test_plan('register', $1)", [mahmoud.id]), /permission denied/, 'the plan is not callable directly');
  assert.deepEqual(await tf(1, 'find', 'invoice', 'zzz'), []); assert.equal((await tf(1, 'find', 'advance', '99999'))[0].key, A1, 'advance search still works');
  await assert.rejects(scan('not-a-uuid'), /غير صالح/); assert.equal((await scan(id(778))).exists, false); await assert.rejects(flagIt('register', id(778)), /غير موجود/);

  // ---- 2. search by name
  const f = await tf(1, 'find', 'register', 'mahm'); assert.equal(f.length, 1); assert.equal(f[0].key, mahmoud.id); assert.equal(f[0].label, 'خزينة mahmoud'); assert.equal(f[0].sub, 'تحصيل — حساب 903 — Rec 5 — 1 وردية'); assert.equal(f[0].flagged, false);

  // ---- 3. refusals: main treasury, a drawer with a real payment, an executed handover, money on the account, another drawer's account use, closed period
  assert.deepEqual(await codes(main.id), ['children', 'executed_transfers', 'incoming_transfers', 'main'], 'the main treasury: refused, and it received real handovers'); await assert.rejects(flagIt('register', main.id), /الخزينة الرئيسية لا تُحذف/);
  assert.deepEqual(await codes(real.id), ['account_lines', 'entries', 'payments']); await assert.rejects(flagIt('register', real.id), /دفعات تحصيل على ورديات الخزينة \(1\)/);
  await owner('insert into clinic_reception.payments(shift_id,amount) values($1,5)', [S3]); assert((await codes(real.id)).includes('reception_payments')); await owner('delete from clinic_reception.payments');
  assert.deepEqual(await codes(moved.id), ['executed_transfers']); await assert.rejects(flagIt('register', moved.id), /تسليمات نقدية مُنفَّذة من الخزينة أو إليها \(1\)/);
  // dina BEFORE the advance is deleted: the advance, its receipt + binding entries and the money on 902 block it — and the text says to delete the advance first
  let sc = await scan(dina.id); assert.deepEqual(sc.blockers.map(b => b.code).sort(), ['account_lines', 'advances', 'entries']);
  assert.match(sc.blockers.find(b => b.code === 'account_lines').label, /^على حساب الخزينة 902 سطور قيود في الدفاتر — احذف مقدم الحجز التجريبي أولًا من نوع «مقدم حجز»/);
  await assert.rejects(flagIt('register', dina.id), /احذف مقدم الحجز التجريبي أولًا من نوع «مقدم حجز»/); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_flags'), 0);
  // mahmoud refusals one at a time (each undone)
  const blocked = async (code, rx) => { assert((await codes(mahmoud.id)).includes(code), 'blocker ' + code); await assert.rejects(flagIt('register', mahmoud.id), rx); };
  await ddl('create table clinic_finance.zz_ref(account text references clinic_finance.accounts(code))'); await owner("insert into clinic_finance.zz_ref values('903')");
  await blocked('account_refs', /حساب الخزينة مستخدم في بيانات أخرى/); await ddl('drop table clinic_finance.zz_ref');
  await owner('insert into clinic_finance.periods(closed_through, created_by) values (current_date + 2, $1)', [id(1)]); await blocked('closed_period', /فترة مالية مقفلة/); await owner('delete from clinic_finance.periods');
  const child = (await owner("insert into clinic_finance.registers(name,petty_limit,created_by,parent_register_id) values('child',0,$1,$2) returning id", [id(1), mahmoud.id]))[0].id;
  await blocked('children', /خزن أخرى تابعة لهذه الخزينة/); await owner('delete from clinic_finance.registers where id=$1', [child]);
  const pend = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values($1,$2,5,'TR-IN','تسليم',$3) returning id", [S3, mahmoud.id, id(6)]))[0].id;
  await blocked('incoming_transfers', /تسليم نقدية معلّق من خزينة أخرى/); await owner('delete from clinic_finance.treasury_transfers where id=$1', [pend]);
  await owner('update clinic_finance.treasury_transfers set status=$1 where id=$2', ['approved', T2]); await blocked('executed_transfers', /مُنفَّذة/); await owner("update clinic_finance.treasury_transfers set status='pending' where id=$1", [T2]);
  assert.deepEqual(await codes(mahmoud.id), [], 'all refusals undone');

  // ---- 4. THE DINA PATH: delete the test advance first (existing type), then the register
  const books = async () => [await bal('1111'), await bal('902'), await bal('903'), await bal('904'), await bal('2150')];
  const keep = async () => ({ r: await snapshot('clinic_finance.registers', 'id', [main.id, real.id, moved.id]), s: await snapshot('clinic_finance.shifts', 'register_id', [main.id, real.id, moved.id]),
    a: await snapshot('clinic_finance.accounts', 'code', ['901', '904', '905', '1111']), rr: await snapshot('clinic_reception.registers', 'id', [RR3]), t: await snapshot('clinic_finance.treasury_transfers', 'reference', ['TR-X']) });
  const kept = await keep();
  await flagIt('advance', A1); await delIt('advance', A1, 'مقدم تجربة 99999');
  assert.deepEqual(await books(), [0, 0, 0, 300, 0], 'advance + receipt + binding entry gone: 1111, 902 and 2150 back to zero');
  sc = await scan(dina.id);
  assert.equal(sc.deletable, true); assert.deepEqual(sc.blockers, []); assert.equal(sc.label, 'خزينة dina — تحصيل — حساب 902 (+ حساب الخزينة الفارغ 902)');
  const dinaCounts = { 'clinic_reception.shifts': 1, 'clinic_reception.registers': 1, 'clinic_finance.shifts': 1, 'clinic_finance.registers': 1, 'clinic_finance.cash_accounts': 1, 'clinic_finance.account_config': 1, 'clinic_finance.accounts': 1 };
  assert.deepEqual(sc.counts, dinaCounts);
  assert.deepEqual((await scan(dina.id.toUpperCase())).counts, dinaCounts, 'an upper-case id plans the same rows');
  await assert.rejects(delIt('register', dina.id), /غير مُعلَّم/, 'never deletable while not flagged');
  await flagIt('register', dina.id); assert.equal((await tf(1, 'find', 'register', 'dina'))[0].flagged, true);
  // atomicity: an unknown dependent rolls back archive + deletes
  const full = { reg: await snapshot('clinic_finance.registers', 'id', [dina.id]), sh: await snapshot('clinic_finance.shifts', 'id', [S1]), acc: await snapshot('clinic_finance.accounts', 'code', ['902']), cfg: await snapshot('clinic_finance.account_config', 'code', ['902']), rr: await snapshot('clinic_reception.registers', 'id', [RR1]), rs: await snapshot('clinic_reception.shifts', 'id', [S1]) };
  await ddl('create table clinic_finance.zz_dep(register_id uuid references clinic_finance.registers(id))'); await owner('insert into clinic_finance.zz_dep values($1)', [dina.id]);
  await assert.rejects(delIt('register', dina.id), /مرتبط ببيانات أخرى لا يجوز حذفها/); await ddl('drop table clinic_finance.zz_dep');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows where source_table like $1', ['%registers']), 0);
  const audBefore = await cnt('select count(*)::int n from clinic_finance.audit where entity_id::text = any($1)', [[dina.id, S1]]); assert(audBefore >= 2);
  const del1 = await delIt('register', dina.id, 'خزينة تجربة dina');
  for (const [t, c, v] of [['clinic_finance.registers', 'id', dina.id], ['clinic_finance.shifts', 'id', S1], ['clinic_finance.accounts', 'code', '902'], ['clinic_finance.account_config', 'code', '902'], ['clinic_finance.cash_accounts', 'code', '902'], ['clinic_reception.registers', 'id', RR1], ['clinic_reception.shifts', 'id', S1]])
    assert.equal(await cnt(`select count(*)::int n from ${t} where ${c}::text=$1`, [v]), 0, t + ' deleted');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.audit where entity_id::text = any($1)', [[dina.id, S1]]), audBefore, 'the register history (audit) is kept');
  const arch = await owner('select source_table, row_data from clinic_finance.test_deletion_rows where deletion_id=$1', [del1]), by = t => arch.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual({ reg: by('clinic_finance.registers'), sh: by('clinic_finance.shifts'), acc: by('clinic_finance.accounts'), cfg: by('clinic_finance.account_config'), rr: by('clinic_reception.registers'), rs: by('clinic_reception.shifts') }, full, 'archive holds the FULL rows');
  assert.equal(arch.length, 7);
  assert.deepEqual((await owner('select row_counts c from clinic_finance.test_deletions where id=$1', [del1]))[0].c, dinaCounts);

  // ---- 5. THE MAHMOUD PATH: the pending (and a rejected) handover go with it
  sc = await scan(mahmoud.id); assert.equal(sc.deletable, true);
  const mCounts = { 'clinic_reception.shifts': 1, 'clinic_reception.registers': 1, 'clinic_finance.treasury_transfers': 2, 'clinic_finance.shifts': 1, 'clinic_finance.registers': 1, 'clinic_finance.cash_accounts': 1, 'clinic_finance.account_config': 1, 'clinic_finance.accounts': 1 };
  assert.deepEqual(sc.counts, mCounts);
  await flagIt('register', mahmoud.id); const del2 = await delIt('register', mahmoud.id);
  assert.equal(await cnt('select count(*)::int n from clinic_finance.treasury_transfers where id::text = any($1)', [[T2, T2r]]), 0);
  assert.equal(await cnt("select count(*)::int n from clinic_finance.registers where id = any($1::uuid[])", [[mahmoud.id, dina.id]]), 0);
  assert.deepEqual((await owner('select row_counts c from clinic_finance.test_deletions where id=$1', [del2]))[0].c, mCounts);
  assert.deepEqual(await keep(), kept, 'main treasury, the real drawers, their shifts, accounts and transfers are untouched');
  assert.deepEqual(await books(), [0, 0, 0, 300, 0]); assert.equal(await cnt('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines'), 0, 'the journal still balances');
  await assert.rejects(delIt('register', mahmoud.id), /غير مُعلَّم/); await assert.rejects(flagIt('register', mahmoud.id), /غير موجود/);
  const ov = await tf(1, 'overview'); assert.equal(ov.flags.length, 0); assert.deepEqual(ov.deletions.slice(0, 3).map(d => d.type), ['register', 'register', 'advance']);
  // the freed account codes can be created and bound again
  await as(1); await fin('ledger_command', ['account_create', { code: '902', name: 'حساب جديد', kind: 'asset' }, key()]);

  // ---- 6. rollback script: refuses while a register is flagged; restores the previous functions byte for byte; re-apply works
  const empty = await reg('empty'); sc = await scan(empty.id); assert.equal(sc.label, 'خزينة empty — غير مربوطة'); assert.deepEqual(sc.counts, { 'clinic_finance.registers': 1 });
  await flagIt('register', empty.id);
  await db.exec('reset role'); await assert.rejects(db.exec(fs.readFileSync(R, 'utf8')), /خزن مُعلَّمة «تجريبي»/); await db.exec('rollback');
  await tf(1, 'unflag', 'register', empty.id, 'تراجعت عن التعليم');
  await db.exec('reset role'); await db.exec(fs.readFileSync(R, 'utf8'));
  assert.deepEqual(await defs(), before, 'the previous functions are back byte for byte');
  assert.equal(await cnt("select count(*)::int n from pg_proc where proname in ('test_plan_pre_register','test_find_pre_register')"), 0);
  await assert.rejects(scan(empty.id), /غير مدعوم/); assert.deepEqual(await tf(1, 'find', 'invoice', 'zzz'), []);
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['invoice', '']), /permission denied/); await db.exec('reset role');
  await assert.rejects(owner("insert into clinic_finance.test_flags(record_type,record_key,label,reason,flagged_by) values('register','x','x','سبب كافي',$1)", [id(1)]), /test_flags_record_type_check/);
  assert.equal(await cnt("select count(*)::int n from clinic_finance.test_deletions where record_type='register'"), 2, 'history kept');
  await db.exec(mig(M)); assert.equal((await scan(empty.id)).deletable, true, 're-applied');
  await db.close();
  console.log('PASS test-tool register SQL: owner-only, search by name, refusals (main, children, real payment, reception payment, executed / incoming handover, money on the account incl. the «delete the advance first» text, other references, closed period), dina path (advance then register, books back to zero), mahmoud path (pending + rejected handover removed), audit kept, others untouched, atomic on FK error, rollback script');
})().catch(e => { console.error(e.message, e.where || '', e.stack); process.exitCode = 1; });
