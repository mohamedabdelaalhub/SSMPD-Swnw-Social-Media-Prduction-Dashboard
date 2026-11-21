// «سجلات تجريبية» learns type 'patient_credit' (20261121210000): a TEST reception payment that became «رصيد لصالح المريض» can be flagged then deleted by the owner,
// with its finance entry + lines, its reception journal event + lines, its proof rows and the payment. Then type «خزينة» deletes the test drawer with its ENDED-but-open shift.
// PGlite with the REAL finance / advances / treasury migrations + the test-record tool (20261109130000) and its 'advance' (20261118190000) and 'register' (20261118210000) types.
// Mirrors production: «dina» drawer (own account 902), shift ended with a count of 1000, a 1000 patient credit (event 175 in production), the handover to the main treasury REJECTED.
const boot = require('./helpers/clinic-finance.cjs'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const { db, as, fin, key, id, owner, call } = await boot(['clinic_doctor_settlements', 'clinic_supplier_finance', 'clinic_bank_insurance', 'clinic_payroll_assets_tax', 'clinic_opening_reports', 'clinic_booking_advances', 'clinic_legacy_assets', 'clinic_register_directions_payments']);
  const mig = n => fs.readFileSync('supabase/migrations/' + n, 'utf8');
  const M = '20261121210000_test_tool_patient_credit.sql', R = 'supabase/rollbacks/20261121210000_test_tool_patient_credit.rollback.sql';
  const ddl = async q => { await db.exec('reset role'); await db.exec(q); };
  const cnt = async (q, a = []) => Number((await owner(q, a))[0].n);
  const snapshot = async (tbl, col, vals) => (await owner(`select to_jsonb(t) r from ${tbl} t where t.${col}::text = any($1)`, [vals])).map(x => JSON.stringify(x.r)).sort();
  for (const p of ['20261017212113_clinic_ledger_chart_actions.sql', '20261018205000_accountant_chart_treasury.sql']) await db.exec(mig(p));
  for (const n of [5, 6]) await owner("insert into admins(id,name,role) values($1,$2,'reception')", [id(n), 'Rec ' + n]);

  // ---- drawers + shifts through the real RPCs, then bound to their own accounts (nothing to move: no binding entry)
  const reg = async name => (await owner('insert into clinic_finance.registers(name,petty_limit,created_by) values($1,1000,$2) returning *', [name, id(1)]))[0];
  const dina = await reg('خزينة دينا (تجريبية)'), real = await reg('real');
  const open = async (n, r) => { await as(n); return call('clinic_booking_shift', ['open', { register_id: r.id }, key()]); };
  const S1 = await open(4, dina), S3 = await open(6, real);
  await db.exec('reset role'); await db.exec(mig('20261019001000_treasury_shift_handover.sql'));
  await as(1); for (const code of ['901', '902', '904']) await fin('ledger_command', ['account_create', { code, name: 'حساب ' + code, kind: 'asset' }, key()]);
  const main = await fin('treasury_command', ['register_save', { name: 'الخزينة الرئيسية', treasury_kind: 'main', account_code: '901' }, key()]);
  const bind = (r, code, who) => fin('treasury_command', ['register_save', { id: r.id, revision: r.revision, name: r.name, treasury_kind: 'collection', account_code: code, assigned_to: id(who), parent_register_id: main.id }, key()]);
  await bind(dina, '902', 4); await bind(real, '904', 6);
  assert.equal(await cnt("select count(*)::int n from clinic_finance.entries where source='treasury_binding'"), 0);

  // ---- reception tables as in production (only the columns this tool reads) + the bridge rows
  await ddl(`create schema if not exists clinic_reception;
    create table clinic_reception.registers(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text not null, direction text not null default 'receive', finance_register_id uuid references clinic_finance.registers(id));
    create table clinic_reception.shifts(id uuid primary key default gen_random_uuid(), workspace_id uuid, register_id uuid not null references clinic_reception.registers(id), cashier_id uuid, status text not null default 'open', finance_shift_id uuid references clinic_finance.shifts(id));
    create table clinic_reception.patients(id uuid primary key default gen_random_uuid(), workspace_id uuid, file_no text not null, name text not null);
    create table clinic_reception.payments(id uuid primary key default gen_random_uuid(), workspace_id uuid, patient_id uuid not null references clinic_reception.patients(id), method text not null, shift_id uuid references clinic_reception.shifts(id),
      amount numeric(14,2) not null, credit_amount numeric(14,2) not null default 0, reference text not null, created_at timestamptz not null default now(), receipt_no text, proof_path text);
    create table clinic_reception.allocations(id uuid primary key default gen_random_uuid(), invoice_id uuid, payment_id uuid references clinic_reception.payments(id), source text, amount numeric);
    create table clinic_reception.requests(id uuid primary key default gen_random_uuid(), kind text, subject_id uuid, amount numeric);
    create table clinic_reception.payment_proofs(id uuid primary key default gen_random_uuid(), path text, payment_id uuid references clinic_reception.payments(id));
    create table clinic_reception.journal(id uuid primary key default gen_random_uuid(), workspace_id uuid, source text not null, source_id uuid not null, description text not null, dimensions jsonb not null default '{}', actor_id uuid, created_at timestamptz not null default now(), finance_entry_id uuid);
    create table clinic_reception.journal_lines(entry_id uuid not null references clinic_reception.journal(id), account text not null, debit numeric(14,2) not null, credit numeric(14,2) not null);
    create table clinic_finance.doctor_payout_invoices(payout_id uuid, invoice_id uuid, doctor_key text, fee numeric);
    create table clinic_finance.advance_proofs(advance_id uuid primary key references clinic_finance.advances(id), provider text not null, terminal_code text not null default '', rrn text not null default '', reference text not null, evidence_url text not null default '', recorded_by uuid not null references public.admins(id), updated_at timestamptz not null default now());
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;`);
  const WS = id(900);
  const bridge = async (r, s) => { const rr = (await owner("insert into clinic_reception.registers(workspace_id,name,finance_register_id) values($1,$2,$3) returning id", [WS, r.name, r.id]))[0].id; await owner('insert into clinic_reception.shifts(id,workspace_id,register_id,finance_shift_id) values($1,$2,$3,$1)', [s, WS, rr]); return rr; };
  const RR1 = await bridge(dina, S1), RR3 = await bridge(real, S3);
  const patient = async (no, name) => (await owner('insert into clinic_reception.patients(workspace_id,file_no,name) values($1,$2,$3) returning id', [WS, no, name]))[0].id;
  const P1 = await patient('F-77', 'مريض تجربة'), P2 = await patient('F-88', 'مريض حقيقي');
  // exactly what clinic_reception.payment_operation 'collect' + the bridge post write for a payment that is all credit
  const event = async (source, sourceId, dims, dr, cr, amt, shift) => {
    const j = (await owner('insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions,actor_id) values($1,$2,$3,$4,$5,$6) returning id', [WS, source, sourceId, source, dims, id(4)]))[0].id;
    await owner('insert into clinic_reception.journal_lines values($1,$2,$3,0),($1,$4,0,$3)', [j, dr, amt, cr]);
    const e = (await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id', ['reception_' + source, j, source, shift, id(4)]))[0].id;
    await owner('insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,$2,$3,0),($1,$4,0,$3)', [e, dr, amt, cr]);
    await owner('update clinic_reception.journal set finance_entry_id=$1 where id=$2', [e, j]); return { j, e };
  };
  const credit = async (pid, amt, shift, ref) => {
    const p = (await owner("insert into clinic_reception.payments(workspace_id,patient_id,method,shift_id,amount,credit_amount,reference,receipt_no) values($1,$2,'cash',$3,$4,$4,$5,$6) returning id", [WS, pid, shift, amt, ref, 'RC-' + ref]))[0].id;
    return { p, ...(await event('patient_credit', p, { patient_id: pid, payment_id: p, shift_id: shift }, '1111', '2150', amt, shift)) };
  };
  const C1 = await credit(P1, 1000, S1, '5001'), C2 = await credit(P2, 500, S3, '5002');
  const bal = async code => Number((await owner('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines where account=$1', [code]))[0].n);
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('904'), await bal('2150')], [0, 1000, 500, -1500], 'the treasury trigger moved the 1111 lines to the drawer accounts');
  // dina ended her shift with a count of 1000 and asked to hand it to the main treasury; that handover was REJECTED (no ledger entry)
  await owner('update clinic_finance.shifts set ended_at=now(), end_counted=1000 where id=$1', [S1]);
  const T1 = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by,status) values($1,$2,1000,'TR-D','تسليم',$3,'rejected') returning id", [S1, main.id, id(4)]))[0].id;

  await db.exec(mig('20261109130000_test_record_delete.sql')); await db.exec(mig('20261118190000_test_tool_booking_advance.sql')); await db.exec(mig('20261118210000_test_tool_register.sql'));
  const defs = async () => (await owner("select md5(pg_get_functiondef('clinic_finance.test_plan(text,text)'::regprocedure)) m, md5(pg_get_functiondef('public.clinic_finance_test_find(text,text)'::regprocedure)) f"))[0];
  const before = await defs();
  await db.exec('reset role'); await db.exec(mig(M));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(M)); }, /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_flags') + await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0, 'applying flags / deletes nothing');

  const tf = async (n, fn, ...a) => { await as(n); return call('clinic_finance_test_' + fn, a); };
  const flagIt = (t, k) => tf(1, 'flag', t, k, 'سجل تجربة من المالك', 'تجريبي');
  const delIt = (t, k, reason = 'تنظيف بيانات التجربة') => tf(1, 'delete', t, k, reason, 'حذف');
  const scan = k => tf(1, 'scan', 'patient_credit', k);
  const codes = async k => (await scan(k)).blockers.map(b => b.code).sort();
  const eventNo = (await owner('select event_no n from clinic_finance.entries where id=$1', [C1.e]))[0].n;

  // ---- 1. owner only; the other types still answer through the untouched previous functions
  for (const n of [2, 3, 4]) for (const [fn, ...a] of [['find', 'patient_credit', 'مريض'], ['scan', 'patient_credit', C1.j], ['flag', 'patient_credit', C1.j, 'سبب تجربة', 'تجريبي'], ['delete', 'patient_credit', C1.j, 'سبب تجربة', 'حذف']])
    await assert.rejects(tf(n, fn, ...a), /للمالك فقط/, `admin ${n} refused: ${fn}`);
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['patient_credit', '']), /permission denied/); await db.exec('reset role');
  await as(1); await assert.rejects(db.query("select clinic_finance.test_plan('patient_credit', $1)", [C1.j]), /permission denied/, 'the plan is not callable directly');
  assert.deepEqual(await tf(1, 'find', 'invoice', 'zzz'), []); assert.equal((await tf(1, 'find', 'register', 'دينا'))[0].key, dina.id, 'register search still works');
  await assert.rejects(scan('not-a-uuid'), /غير صالح/); assert.equal((await scan(id(778))).exists, false); await assert.rejects(flagIt('patient_credit', id(778)), /غير موجود/);

  // ---- 2. search by patient name, file no, receipt no, entry number
  let f = await tf(1, 'find', 'patient_credit', 'تجربة'); assert.equal(f.length, 1); assert.equal(f[0].key, C1.j); assert.equal(f[0].label, 'رصيد لصالح المريض مريض تجربة — 1000.00 ج');
  assert.match(f[0].sub, new RegExp('ملف F-77 — إيصال RC-5001 — خزينة خزينة دينا \\(تجريبية\\) — قيد رقم ' + eventNo + '$')); assert.equal(f[0].flagged, false);
  for (const q of ['F-77', 'RC-5001', String(eventNo), 'دينا']) assert.deepEqual((await tf(1, 'find', 'patient_credit', q)).map(x => x.key), [C1.j], 'found by ' + q);

  // ---- 3. refusals on the REAL credit, one at a time (each undone)
  assert.deepEqual(await codes(C2.j), []);
  const blocked = async (code, rx) => { assert((await codes(C2.j)).includes(code), 'blocker ' + code); await assert.rejects(flagIt('patient_credit', C2.j), rx); };
  const use = await event('credit_apply', id(901), { patient_id: P2, invoice_id: id(901) }, '2150', '1122', 200, null);
  await blocked('credit_used', /رصيد المريض استُخدم/);
  await owner('delete from clinic_finance.lines where entry_id=$1', [use.e]); await owner('delete from clinic_finance.entries where id=$1', [use.e]); await owner('delete from clinic_reception.journal_lines where entry_id=$1', [use.j]); await owner('delete from clinic_reception.journal where id=$1', [use.j]);
  await owner("insert into clinic_reception.allocations(payment_id,source,amount) values($1,'payment',1)", [C2.p]); await blocked('allocations', /موزعة على فاتورة/); await owner('delete from clinic_reception.allocations');
  await owner("insert into clinic_reception.requests(kind,subject_id,amount) values('refund',$1,100)", [C2.p]); await blocked('requests', /طلب استرداد/); await owner('delete from clinic_reception.requests');
  await owner('update clinic_reception.payments set credit_amount=300 where id=$1', [C2.p]); await blocked('partial', /لم تتحول كلها لرصيد/); await owner('update clinic_reception.payments set credit_amount=500 where id=$1', [C2.p]);
  await owner("update clinic_reception.payments set method='pos' where id=$1", [C2.p]); await blocked('non_cash', /ليست نقدية/); await owner("update clinic_reception.payments set method='cash' where id=$1", [C2.p]);
  await ddl('create table clinic_reception.zz_ref(payment_id uuid references clinic_reception.payments(id))'); await owner('insert into clinic_reception.zz_ref values($1)', [C2.p]);
  await blocked('payment_refs', /مستخدمة في بيانات أخرى/); await ddl('drop table clinic_reception.zz_ref');
  const raw = async (q, a) => { await db.exec('reset role'); await db.exec("set session_replication_role = replica"); await db.query(q, a); await db.exec("set session_replication_role = origin"); };   // fixture only: skip the shift guards
  await raw("update clinic_finance.shifts set status='submitted', closed_at=now() where id=$1", [S3]); await blocked('shift_closed', /أُقفلت/); await raw("update clinic_finance.shifts set status='open', closed_at=null where id=$1", [S3]);
  const pend = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values($1,$2,5,'TR-R','تسليم',$3) returning id", [S3, main.id, id(6)]))[0].id;
  await blocked('transfers', /تسليم نقدية معلّق أو مُنفَّذ/); await owner('delete from clinic_finance.treasury_transfers where id=$1', [pend]);
  await owner('insert into clinic_finance.periods(closed_through, created_by) values (current_date + 2, $1)', [id(1)]); await blocked('closed_period', /فترة مالية مقفلة/); await owner('delete from clinic_finance.periods');
  await owner("update clinic_finance.lines set debit=499 where entry_id=$1 and account='904'", [C2.e]); await blocked('entry_shape', /ليس بالشكل المتوقع/); await owner("update clinic_finance.lines set debit=500 where entry_id=$1 and account='904'", [C2.e]);
  // a journal event that is not a patient credit
  const other = await event('invoice_payment', C2.p, { patient_id: P2, payment_id: C2.p }, '1111', '1122', 1, S3);
  assert((await codes(other.j)).includes('not_credit')); assert((await codes(C2.j)).includes('other_events'), 'another event on the same payment blocks');
  for (const t of [['clinic_finance.lines', 'entry_id', other.e], ['clinic_finance.entries', 'id', other.e], ['clinic_reception.journal_lines', 'entry_id', other.j], ['clinic_reception.journal', 'id', other.j]]) await owner(`delete from ${t[0]} where ${t[1]}=$1`, [t[2]]);
  assert.deepEqual(await codes(C2.j), [], 'all refusals undone');

  // ---- 4. THE DINA PATH: before, the drawer is blocked by the credit; delete the credit, then the drawer with its ended shift and rejected handover
  const scR = async k => tf(1, 'scan', 'register', k);
  assert.deepEqual((await scR(dina.id)).blockers.map(b => b.code).sort(), ['account_lines', 'entries', 'reception_payments']);
  let sc = await scan(C1.j);
  assert.equal(sc.deletable, true); assert.deepEqual(sc.blockers, []);
  assert.equal(sc.label, 'رصيد لصالح المريض مريض تجربة — ملف F-77 — 1000.00 — إيصال RC-5001 — خزينة خزينة دينا (تجريبية) — قيد رقم ' + eventNo);
  const cCounts = { 'clinic_finance.lines': 2, 'clinic_finance.entries': 1, 'clinic_reception.journal_lines': 2, 'clinic_reception.journal': 1, 'clinic_reception.payments': 1 };
  assert.deepEqual(sc.counts, cCounts); assert.deepEqual((await scan(C1.j.toUpperCase())).counts, cCounts, 'an upper-case id plans the same rows');
  await assert.rejects(delIt('patient_credit', C1.j), /غير مُعلَّم/, 'never deletable while not flagged');
  const keep = async () => ({ p: await snapshot('clinic_reception.payments', 'id', [C2.p]), j: await snapshot('clinic_reception.journal', 'id', [C2.j]), e: await snapshot('clinic_finance.entries', 'id', [C2.e]),
    l: await snapshot('clinic_finance.lines', 'entry_id', [C2.e]), pt: await snapshot('clinic_reception.patients', 'id', [P1, P2]), r: await snapshot('clinic_finance.registers', 'id', [main.id, real.id]), rr: await snapshot('clinic_reception.registers', 'id', [RR3]) });
  const kept = await keep();
  await flagIt('patient_credit', C1.j); assert.equal((await tf(1, 'find', 'patient_credit', 'F-77'))[0].flagged, true);
  const full = { l: await snapshot('clinic_finance.lines', 'entry_id', [C1.e]), e: await snapshot('clinic_finance.entries', 'id', [C1.e]), jl: await snapshot('clinic_reception.journal_lines', 'entry_id', [C1.j]), j: await snapshot('clinic_reception.journal', 'id', [C1.j]), p: await snapshot('clinic_reception.payments', 'id', [C1.p]) };
  // atomicity: an unknown dependent of the entry rolls back archive + deletes
  await ddl('create table clinic_finance.zz_dep(entry_id uuid references clinic_finance.entries(id))'); await owner('insert into clinic_finance.zz_dep values($1)', [C1.e]);
  await assert.rejects(delIt('patient_credit', C1.j), /مرتبط ببيانات أخرى لا يجوز حذفها/); await ddl('drop table clinic_finance.zz_dep');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows'), 0); assert.equal(await cnt('select count(*)::int n from clinic_reception.journal where id=$1', [C1.j]), 1);
  const del1 = await delIt('patient_credit', C1.j, 'رصيد تجربة على خزينة دينا');
  const arch = await owner('select source_table, row_data from clinic_finance.test_deletion_rows where deletion_id=$1', [del1]), by = t => arch.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual({ l: by('clinic_finance.lines'), e: by('clinic_finance.entries'), jl: by('clinic_reception.journal_lines'), j: by('clinic_reception.journal'), p: by('clinic_reception.payments') }, full, 'archive holds the FULL rows');
  assert.deepEqual((await owner('select row_counts c from clinic_finance.test_deletions where id=$1', [del1]))[0].c, cCounts);
  assert.deepEqual([await bal('902'), await bal('904'), await bal('2150')], [0, 500, -500], 'the test money is gone from the drawer and from 2150; the real credit stays');
  assert.equal(await cnt('select count(*)::int n from clinic_reception.patients where id=$1', [P1]), 1, 'the patient file stays');
  // now the drawer: the existing «خزينة» rule accepts it with its ENDED (still open) shift and the rejected handover
  sc = await scR(dina.id); assert.equal(sc.deletable, true, JSON.stringify(sc.blockers));
  const dCounts = { 'clinic_reception.shifts': 1, 'clinic_reception.registers': 1, 'clinic_finance.treasury_transfers': 1, 'clinic_finance.shifts': 1, 'clinic_finance.registers': 1, 'clinic_finance.cash_accounts': 1, 'clinic_finance.account_config': 1, 'clinic_finance.accounts': 1 };
  assert.deepEqual(sc.counts, dCounts);
  await flagIt('register', dina.id); await delIt('register', dina.id, 'خزينة دينا التجريبية');
  for (const [t, c, v] of [['clinic_finance.registers', 'id', dina.id], ['clinic_finance.shifts', 'id', S1], ['clinic_finance.accounts', 'code', '902'], ['clinic_finance.treasury_transfers', 'id', T1], ['clinic_reception.registers', 'id', RR1], ['clinic_reception.shifts', 'id', S1]])
    assert.equal(await cnt(`select count(*)::int n from ${t} where ${c}::text=$1`, [v]), 0, t + ' deleted');
  assert.deepEqual(await keep(), kept, 'the real credit, both patients, the main and the real drawer are untouched');
  assert.equal(await cnt('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines'), 0, 'the journal still balances');
  await assert.rejects(delIt('patient_credit', C1.j), /غير مُعلَّم/); await assert.rejects(flagIt('patient_credit', C1.j), /غير موجود/);
  const ov = await tf(1, 'overview'); assert.equal(ov.flags.length, 0); assert.deepEqual(ov.deletions.slice(0, 2).map(d => d.type), ['register', 'patient_credit']);

  // ---- 5. rollback script: refuses while a credit is flagged; restores the previous functions byte for byte; re-apply works
  await flagIt('patient_credit', C2.j);
  await db.exec('reset role'); await assert.rejects(db.exec(fs.readFileSync(R, 'utf8')), /أرصدة مرضى مُعلَّمة «تجريبي»/); await db.exec('rollback');
  await tf(1, 'unflag', 'patient_credit', C2.j, 'رصيد حقيقي — تراجعت');
  await db.exec('reset role'); await db.exec(fs.readFileSync(R, 'utf8'));
  assert.deepEqual(await defs(), before, 'the previous functions are back byte for byte');
  assert.equal(await cnt("select count(*)::int n from pg_proc where proname in ('test_plan_pre_patient_credit','test_find_pre_patient_credit')"), 0);
  await assert.rejects(scan(C2.j), /غير مدعوم/); assert.equal((await scR(real.id)).exists, true, 'register type still served');
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['invoice', '']), /permission denied/); await db.exec('reset role');
  await assert.rejects(owner("insert into clinic_finance.test_flags(record_type,record_key,label,reason,flagged_by) values('patient_credit','x','x','سبب كافي',$1)", [id(1)]), /test_flags_record_type_check/);
  assert.equal(await cnt("select count(*)::int n from clinic_finance.test_deletions where record_type='patient_credit'"), 1, 'history kept');
  await db.exec(mig(M)); assert.equal((await scan(C2.j)).deletable, true, 're-applied');
  await db.close();
  console.log('PASS test-tool patient credit SQL: owner-only, search by name / file / receipt / entry no, refusals (credit used, allocation, request, partial, non-cash, other refs, other events, not a credit, closed shift, handover, closed period, entry shape), dina path (credit then drawer with its ended shift + rejected handover), full archive, others untouched, atomic on FK error, rollback script');
})().catch(e => { console.error(e.message, e.where || '', e.stack); process.exitCode = 1; });
