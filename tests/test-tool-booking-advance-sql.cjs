// «سجلات تجريبية» learns type 'advance' (20261118190000): an UNUSED test booking advance can be flagged then deleted by the owner, with its receipt entry —
// and, for a receipt taken before the drawer was bound to its own cash account, the treasury binding entry that carried exactly that money — so the books net to zero.
// PGlite with the REAL finance / advances / treasury migrations. The scenario mirrors production: unconfigured drawer -> cash advance -> drawer bound later.
const boot = require('./helpers/clinic-finance.cjs'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const { db, as, fin, key, id, owner, call } = await boot(['clinic_doctor_settlements', 'clinic_supplier_finance', 'clinic_bank_insurance', 'clinic_payroll_assets_tax', 'clinic_opening_reports', 'clinic_booking_advances', 'clinic_legacy_assets', 'clinic_register_directions_payments']);
  const mig = n => fs.readFileSync('supabase/migrations/' + n, 'utf8');
  const M = '20261118190000_test_tool_booking_advance.sql', R = 'supabase/rollbacks/20261118190000_test_tool_booking_advance.rollback.sql';
  const ddl = async q => { await db.exec('reset role'); await db.exec(q); };
  const cnt = async (q, a = []) => Number((await owner(q, a))[0].n);
  const snapshot = async (tbl, col, vals) => (await owner(`select to_jsonb(t) r from ${tbl} t where t.${col}::text = any($1)`, [vals])).map(x => JSON.stringify(x.r)).sort();
  for (const p of ['20261017212113_clinic_ledger_chart_actions.sql', '20261018205000_accountant_chart_treasury.sql']) await db.exec(mig(p));
  await owner("insert into admins(id,name,role) values($1,'Rec Two','reception')", [id(5)]);

  // ---- BEFORE the drawers get their own accounts (production, 17 Oct): two unconfigured drawers, cash advances received through the real reception RPC
  const reg = async name => (await owner('insert into clinic_finance.registers(name,petty_limit,created_by) values($1,1000,$2) returning *', [name, id(1)]))[0];
  const dina = await reg('dina'), mixed = await reg('mixed');
  await as(4); const S1 = await call('clinic_booking_shift', ['open', { register_id: dina.id }, key()]);
  await as(5); const S2 = await call('clinic_booking_shift', ['open', { register_id: mixed.id }, key()]);
  const receive = async (n, p) => { await as(n); return call('clinic_booking_command', ['receive', { legacy: false, booking_id: null, ...p }, key()]); };
  const A1 = await receive(4, { amount: '1000', method: 'cash', shift_id: S1, reference: '99999', patient_ref: '99999' });           // the production case
  const A2 = await receive(5, { amount: '700', method: 'cash', shift_id: S2, reference: 'MIX-1', patient_ref: 'P-MIX' });            // its drawer also collected real cash before the binding
  const collect = async (shift, amt, who) => { const e = (await owner('insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values($1,$2,$3,$4,$5) returning id', ['fixture', key(), 'تحصيل حقيقي', shift, id(who)]))[0].id; await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1111',$2,0),($1,'4110',0,$2)", [e, amt]); return e; };
  await collect(S2, 500, 5);
  const E1 = (await owner("select id from clinic_finance.entries where source='advance_receipt' and source_id=$1", [A1]))[0].id;
  assert.deepEqual((await owner('select account, debit::float d, credit::float c from clinic_finance.lines where entry_id=$1 order by account', [E1])), [{ account: '1111', d: 1000, c: 0 }, { account: '2150', d: 0, c: 1000 }], 'receipt before binding sits on the legacy account 1111');

  // ---- the drawers are bound (production, 19 Oct): ONE shift-less binding entry per drawer moves its whole balance 1111 -> own account
  await db.exec('reset role'); await db.exec(mig('20261019001000_treasury_shift_handover.sql'));
  await as(1); for (const code of ['901', '902', '903']) await fin('ledger_command', ['account_create', { code, name: 'حساب ' + code, kind: 'asset' }, key()]);
  const main = await fin('treasury_command', ['register_save', { name: 'الخزينة الرئيسية', treasury_kind: 'main', account_code: '901' }, key()]);
  await fin('treasury_command', ['register_save', { id: dina.id, revision: dina.revision, name: 'dina', treasury_kind: 'collection', account_code: '902', assigned_to: id(4), parent_register_id: main.id }, key()]);
  await fin('treasury_command', ['register_save', { id: mixed.id, revision: mixed.revision, name: 'mixed', treasury_kind: 'collection', account_code: '903', assigned_to: id(5), parent_register_id: main.id }, key()]);
  const B1 = (await owner("select id from clinic_finance.entries where source='treasury_binding' and source_id=$1", [dina.id]))[0].id;
  const bal = async code => Number((await owner('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines where account=$1', [code]))[0].n);
  const ops = async (r, s) => { const x = (await owner('select clinic_finance.treasury_balance($1)::float t, clinic_finance.cash_limit($2)::float l, clinic_finance.shift_cash($2)::float c', [r, s]))[0]; return [x.t, x.l, x.c]; };
  // exactly the production picture: the ledger says the drawer account holds the money, 1111 is back to its other balances, 2150 owes the patient
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('903'), await bal('2150')], [0, 1000, 1200, -1700]);
  assert.deepEqual(await ops(dina.id, S1), [1000, 1000, 1000]);

  // ---- the test-record tool (20261109130000) + stubs of production tables this slice does not load, then THIS migration
  await ddl(`create table clinic_finance.doctor_payout_invoices(payout_id uuid, invoice_id uuid, doctor_key text, fee numeric);
    create table clinic_finance.advance_proofs(advance_id uuid primary key references clinic_finance.advances(id), provider text not null, terminal_code text not null default '', rrn text not null default '', reference text not null, evidence_url text not null default '', recorded_by uuid not null references public.admins(id), updated_at timestamptz not null default now());
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;`);
  await db.exec(mig('20261109130000_test_record_delete.sql'));
  const planBefore = (await owner("select md5(pg_get_functiondef('clinic_finance.test_plan(text,text)'::regprocedure)) m, md5(pg_get_functiondef('public.clinic_finance_test_find(text,text)'::regprocedure)) f"))[0];
  await db.exec('reset role'); await db.exec(mig(M));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(M)); }, /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');
  await db.exec('reset role');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_flags') + await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0, 'applying flags / deletes nothing');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.advances'), 2);

  const tf = async (n, fn, ...a) => { await as(n); return call('clinic_finance_test_' + fn, a); };
  const flagIt = (k, reason = 'مقدم تجربة من المالك') => tf(1, 'flag', 'advance', k, reason, 'تجريبي');
  const delIt = (k, reason = 'تنظيف بيانات التجربة') => tf(1, 'delete', 'advance', k, reason, 'حذف');
  const scan = k => tf(1, 'scan', 'advance', k);
  const codes = async k => (await scan(k)).blockers.map(b => b.code).sort();
  const archive = async del => owner('select source_table, row_data from clinic_finance.test_deletion_rows where deletion_id=$1', [del]);

  // ---- 1. owner only; the other record types still go through the untouched base
  for (const n of [2, 3, 4, 5]) for (const [fn, ...a] of [['find', 'advance', '999'], ['scan', 'advance', A1], ['flag', 'advance', A1, 'سبب تجربة', 'تجريبي'], ['delete', 'advance', A1, 'سبب تجربة', 'حذف']])
    await assert.rejects(tf(n, fn, ...a), /للمالك فقط/, `admin ${n} refused: ${fn}`);
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['advance', '']), /permission denied/, 'anon cannot execute the search'); await db.exec('reset role');
  await as(1); await assert.rejects(db.query("select clinic_finance.test_plan('advance', $1)", [A1]), /permission denied/, 'the plan is not callable directly');
  assert.deepEqual(await tf(1, 'find', 'invoice', 'zzz'), [], 'base search still answers the other types');
  assert.equal((await tf(1, 'scan', 'invoice', id(777))).exists, false);
  await assert.rejects(tf(1, 'scan', 'nonsense', A1), /غير مدعوم/); await assert.rejects(scan('not-a-uuid'), /غير صالح/);
  assert.equal((await scan(id(778))).exists, false); await assert.rejects(flagIt(id(778)), /غير موجود/);

  // ---- 2. search + scan of the production case: receipt AND the binding entry that carried exactly this money
  const found = await tf(1, 'find', 'advance', '9999'); assert.equal(found.length, 1); assert.equal(found[0].key, A1); assert.equal(found[0].label, 'مقدم حجز 99999'); assert.match(found[0].sub, /^1000\.00 ج — نقدي — \d{4}-\d\d-\d\d$/); assert.equal(found[0].flagged, false);
  let sc = await scan(A1);
  assert.equal(sc.deletable, true); assert.deepEqual(sc.blockers, []); assert.equal(sc.label, 'مقدم حجز 99999 — 1000.00 (+ قيد ربط عهدة الخزينة 1000.00)');
  assert.deepEqual(sc.counts, { 'clinic_finance.lines': 4, 'clinic_finance.entries': 2, 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 });
  assert.deepEqual((await scan(A1.toUpperCase())).counts, sc.counts, 'an upper-case id plans exactly the same rows (never the entries without the advance)');
  await assert.rejects(delIt(A1), /غير مُعلَّم/, 'never deletable while not flagged');
  await assert.rejects(tf(1, 'flag', 'advance', A1, 'سبب كافي', 'غلط'), /«تجريبي»/); await assert.rejects(tf(1, 'flag', 'advance', A1, 'x', 'تجريبي'), /٥ حروف/);

  // ---- 3. every refusal, one at a time (each undone afterwards). A blocked advance can not even be flagged.
  const blocked = async (rx, code, msg) => { assert((await codes(A1)).includes(code), 'blocker ' + code); await assert.rejects(flagIt(A1), rx, msg); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_flags'), 0); };
  const use = (kind, status) => owner("insert into clinic_finance.advance_uses(advance_id,kind,amount,reference,payload,created_by,token,status) values($1,$2,100,$3,'{}',$4,gen_random_uuid(),$5)", [A1, kind, 'U-' + kind + status, id(4), status]);
  await use('allocate', 'approved'); await blocked(/مستخدم على فاتورة أو عليه طلب استرداد \(1\)/, 'uses', 'applied to an invoice'); await owner('delete from clinic_finance.advance_uses');
  await use('refund', 'rejected'); await blocked(/مستخدم على فاتورة أو عليه طلب استرداد/, 'uses', 'even a rejected refund request is history'); await owner('delete from clinic_finance.advance_uses');
  await use('refund', 'pending'); await blocked(/طلب استرداد للمقدم ما زال معلّقًا \(1\)/, 'refund_pending', 'pending refund'); await owner('delete from clinic_finance.advance_uses');
  await owner("insert into public.customer_bookings(id,booking_request_id,status) values($1,'BK-1','confirmed')", [id(600)]); await owner('update clinic_finance.advances set booking_id=$1 where id=$2', [id(600), A1]);
  await blocked(/مربوط بحجز مريض/, 'booking', 'linked to a booking'); await owner('update clinic_finance.advances set booking_id=null where id=$1', [A1]);
  await owner('update clinic_finance.shifts set ended_at=now() where id=$1', [S1]); await blocked(/وردية المقدم انتهت أو أُقفلت/, 'shift_closed', 'shift ended (counted)'); await owner('update clinic_finance.shifts set ended_at=null where id=$1', [S1]);
  const later = (await owner("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book,status,opened_at) values($1,$2,gen_random_uuid(),1000,'reviewed',now()+interval '1 minute') returning id", [dina.id, id(4)]))[0].id;
  await blocked(/وردية أخرى على نفس الخزينة/, 'later_shifts', 'a later shift carried the money in its opening balance'); await owner('delete from clinic_finance.shifts where id=$1', [later]);
  const tr = (await owner("insert into clinic_finance.treasury_transfers(from_shift,to_register,amount,reference,reason,created_by) values($1,$2,300,'TR-1','تسليم',$3) returning id", [S1, main.id, id(4)]))[0].id;
  await blocked(/تسليم نقدية معلّق أو مُنفَّذ \(1\)/, 'transfers', 'pending handover to the main treasury');
  await owner("update clinic_finance.treasury_transfers set status='rejected' where id=$1", [tr]); assert.deepEqual(await codes(A1), [], 'a rejected handover moved nothing');
  await ddl(`create table clinic_finance.peer_handovers(id uuid primary key default gen_random_uuid(), from_shift uuid not null, to_shift uuid not null, amount numeric(14,2) not null, status text not null default 'pending')`);   // (20261118160000, not loaded by this slice)
  await owner('insert into clinic_finance.peer_handovers(from_shift,to_shift,amount) values($1,$2,200)', [S1, S2]); await blocked(/تسليم نقدية معلّق أو مُنفَّذ \(1\)/, 'transfers', 'pending handover to a colleague');
  await owner("update clinic_finance.peer_handovers set status='cancelled'"); assert.deepEqual(await codes(A1), []);
  await owner('insert into clinic_finance.peer_handovers(from_shift,to_shift,amount) values($1,$2,200)', [S2, S1]); assert.deepEqual(await codes(A1), [], 'cash coming IN from a colleague does not block'); await owner('delete from clinic_finance.peer_handovers');
  const out = (await owner("insert into clinic_finance.entries(source,source_id,description,shift_id,created_by) values('treasury_transfer_out',$1,'تسليم',$2,$3) returning id", [key(), S1, id(4)]))[0].id;
  await db.query("insert into clinic_finance.lines(entry_id,account,debit,credit) values($1,'1119',400,0),($1,'1111',0,400)", [out]);
  await blocked(/نقدية المقدم ليست كاملة في الخزينة/, 'cash_short', 'part of the cash already left the drawer'); await owner('delete from clinic_finance.lines where entry_id=$1', [out]); await owner('delete from clinic_finance.entries where id=$1', [out]);
  await owner('insert into clinic_finance.periods(closed_through, created_by) values (current_date + 2, $1)', [id(1)]); await blocked(/فترة مالية مقفلة \(2\)/, 'closed_period', 'closed period (receipt + binding entry)'); await owner('delete from clinic_finance.periods');
  await owner("insert into clinic_finance.manual_batches(kind,reference,note,payload,created_by,token) values('reversal','REV-1','عكس',$1,$2,gen_random_uuid())", [{ entry_id: E1 }, id(2)]);
  await blocked(/قيود تصحيح أو عكس على قيد المقدم/, 'journal_corrections', 'a reversal request on the receipt'); await owner('delete from clinic_finance.manual_batches');
  await owner("insert into clinic_finance.entries(source,source_id,description,created_by) values('advance_refund',$1,'x',$2)", [A1, id(2)]); await blocked(/قيود أخرى مرتبطة بالمقدم/, 'other_entries', 'another entry of the advance'); await owner("delete from clinic_finance.entries where source='advance_refund'");
  await owner('update clinic_finance.advances set amount=999 where id=$1', [A1]); await blocked(/ليس بالشكل المتوقع/, 'receipt_shape', 'receipt does not match the advance'); await owner('update clinic_finance.advances set amount=1000 where id=$1', [A1]);
  // the binding entry carried OTHER money too -> refused, the tool never edits an entry
  assert.deepEqual(await tf(1, 'scan', 'advance', A2).then(s => s.blockers.map(b => b.code)), ['binding_mixed']);
  await assert.rejects(tf(1, 'flag', 'advance', A2, 'مقدم تجربة', 'تجريبي'), /قيد ربط عهدة الخزينة يشمل حركات نقدية أخرى/, 'mixed binding is refused');
  // a binding entry that is not exactly drawer-account debit / 1111 credit for the amount -> refused as well
  await owner("update clinic_finance.lines set debit=1001 where entry_id=$1 and account='902'", [B1]); await blocked(/قيد ربط عهدة الخزينة/, 'binding_mixed', 'binding amount differs'); await owner("update clinic_finance.lines set debit=1000 where entry_id=$1 and account='902'", [B1]);
  // posted non-cash advances are out of scope; one that never reached the books is fine
  const POS = await receive(4, { amount: '50', method: 'pos', shift_id: S1, reference: 'POS-1', patient_ref: 'P-POS' });
  assert.deepEqual((await scan(POS)).blockers.map(b => [b.code, b.count]), [['non_cash_posted', 1]]); await assert.rejects(flagIt(POS), /مُرحَّل في الدفاتر/);
  const BANK = await receive(4, { amount: '80', method: 'bank', reference: 'BNK-1', patient_ref: 'P-BNK' });
  sc = await scan(BANK); assert.equal(sc.deletable, true); assert.deepEqual(sc.counts, { 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 }, 'pending bank advance: no ledger rows');
  assert.match((await tf(1, 'find', 'advance', 'BNK'))[0].sub, /تحويل بنكي — .* — في انتظار التحقق$/);
  await flagIt(BANK);
  await as(3); await call('clinic_booking_command', ['verify', { id: BANK, approve: true, note: 'وصل التحويل' }, key()]);   // verified AFTER the flag -> now posted to the bank account
  await assert.rejects(delIt(BANK), /مرفوض.*مُرحَّل في الدفاتر.*\(1\)/, 'a flag does not survive real activity'); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows'), 0);
  await tf(1, 'unflag', 'advance', BANK, 'اتحقق منه، بقى حقيقي');

  // ---- 4. a receipt taken AFTER the binding is already on the drawer account: only its own entry goes
  const A3 = await receive(4, { amount: '250', method: 'cash', shift_id: S1, reference: 'AFTER-1', patient_ref: 'P-AFT' });
  await owner("insert into clinic_finance.advance_proofs(advance_id,provider,reference,recorded_by) values($1,'cash','PR-1',$2)", [A3, id(4)]);
  const E3 = (await owner("select id from clinic_finance.entries where source='advance_receipt' and source_id=$1", [A3]))[0].id;
  assert.deepEqual((await owner('select account from clinic_finance.lines where entry_id=$1 order by account', [E3])).map(x => x.account), ['2150', '902']);
  sc = await scan(A3); assert.equal(sc.label, 'مقدم حجز AFTER-1 — P-AFT — 250.00'); assert.deepEqual(sc.counts, { 'clinic_finance.lines': 2, 'clinic_finance.entries': 1, 'clinic_finance.advance_proofs': 1, 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 });
  assert.deepEqual(await codes(A1), [], 'later cash in the same drawer does not turn the binding into a mixed one');

  // ---- 5. atomicity: an unknown dependent (FK) and a failing trigger roll back archive + deletes
  await flagIt(A1); assert.equal((await tf(1, 'find', 'advance', '99999'))[0].flagged, true); await assert.rejects(flagIt(A1), /بالفعل/);
  const full = { adv: await snapshot('clinic_finance.advances', 'id', [A1]), ent: await snapshot('clinic_finance.entries', 'id', [E1, B1]), lines: await snapshot('clinic_finance.lines', 'entry_id', [E1, B1]), aud: await snapshot('clinic_finance.audit', 'entity_id', [A1]) };
  assert.equal(full.ent.length, 2); assert.equal(full.lines.length, 4); assert.equal(full.aud.length, 1);
  await ddl('create table clinic_finance.zz_dep(advance_id uuid references clinic_finance.advances(id))'); await owner('insert into clinic_finance.zz_dep values($1)', [A1]);
  await assert.rejects(delIt(A1), /مرتبط ببيانات أخرى لا يجوز حذفها/, 'unknown dependents are caught by the foreign keys'); await ddl('drop table clinic_finance.zz_dep');
  await ddl(`create function clinic_finance.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$; create trigger zz_boom before delete on clinic_finance.advances for each row execute function clinic_finance.zz_boom()`);
  await assert.rejects(delIt(A1), /boom/); await ddl('drop trigger zz_boom on clinic_finance.advances; drop function clinic_finance.zz_boom()');
  assert.deepEqual({ adv: await snapshot('clinic_finance.advances', 'id', [A1]), ent: await snapshot('clinic_finance.entries', 'id', [E1, B1]), lines: await snapshot('clinic_finance.lines', 'entry_id', [E1, B1]), aud: await snapshot('clinic_finance.audit', 'entity_id', [A1]) }, full, 'everything restored');
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows') + await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0, 'archive rolled back with the deletes');
  // real activity after the flag blocks the deletion
  await use('refund', 'pending'); await assert.rejects(delIt(A1), /مرفوض.*طلب استرداد للمقدم ما زال معلّقًا/); await owner('delete from clinic_finance.advance_uses');

  // ---- 6. THE DELETION (production case). Books before: 1111 = 0, drawer 902 = 1000 + 250, 2150 = -(1000 + 700 + 250)
  const others = { e: await snapshot('clinic_finance.entries', 'source_id', [A2, A3, mixed.id]), a: await snapshot('clinic_finance.advances', 'id', [A2, A3, POS, BANK]), l903: await bal('903') };
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('2150')], [0, 1250, -2080]); assert.deepEqual(await ops(dina.id, S1), [1250, 1250, 1250]);
  const del = await delIt(A1, 'مقدم تجربة 99999');
  for (const [t, c, v] of [['advances', 'id', A1], ['entries', 'id', E1], ['entries', 'id', B1], ['lines', 'entry_id', E1], ['lines', 'entry_id', B1], ['audit', 'entity_id', A1]])
    assert.equal(await cnt(`select count(*)::int n from clinic_finance.${t} where ${c}::text='${v}'`), 0, t + ' deleted');
  // the drawer nets to exactly what it would be had the test advance never existed: nothing left on 1111 or on the drawer account for it, no liability
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('2150')], [0, 250, -1080], 'ledger: 1111 untouched at 0 (not -1000), drawer account holds only the other advance (not +1000), liability gone');
  assert.deepEqual(await ops(dina.id, S1), [250, 250, 250], 'operational drawer figures agree with the ledger');
  assert.equal(await cnt('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines'), 0, 'the journal still balances');
  const arch = await archive(del), by = t => arch.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual(by('clinic_finance.advances'), full.adv, 'archive holds the FULL advance row'); assert.deepEqual(by('clinic_finance.entries'), full.ent, 'receipt + binding entry'); assert.deepEqual(by('clinic_finance.lines'), full.lines); assert.deepEqual(by('clinic_finance.audit'), full.aud);
  assert.equal(arch.length, 8);
  const hdr = (await owner('select * from clinic_finance.test_deletions where id=$1', [del]))[0];
  assert.equal(hdr.record_type, 'advance'); assert.equal(hdr.record_key, A1); assert.equal(hdr.deleted_by, id(1)); assert.equal(hdr.reason, 'مقدم تجربة 99999'); assert.equal(hdr.flag_reason, 'مقدم تجربة من المالك');
  assert.deepEqual(hdr.row_counts, { 'clinic_finance.lines': 4, 'clinic_finance.entries': 2, 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 }); assert(hdr.label.includes('قيد ربط عهدة الخزينة'));
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.audit where action='test_record_deleted' and entity_id='${del}'`), 1, 'the deletion itself is audited');
  assert.equal(await cnt("select count(*)::int n from clinic_finance.audit where action='treasury_first_binding' and entity_id=$1", [dina.id]), 1, "the drawer's own binding audit row stays (history)");
  assert.deepEqual({ e: await snapshot('clinic_finance.entries', 'source_id', [A2, A3, mixed.id]), a: await snapshot('clinic_finance.advances', 'id', [A2, A3, POS, BANK]), l903: await bal('903') }, others, 'other advances, the other drawer and its binding entry are untouched');
  await assert.rejects(delIt(A1), /غير مُعلَّم/, 'cannot delete twice'); await assert.rejects(flagIt(A1), /غير موجود/);
  const ov = await tf(1, 'overview'); assert.equal(ov.flags.length, 0); assert.equal(ov.deletions[0].id, del); assert.equal(ov.deletions[0].type, 'advance'); assert.equal(ov.deletions[0].counts['clinic_finance.entries'], 2);
  // the cashier can keep working on the same shift
  const A4 = await receive(4, { amount: '10', method: 'cash', shift_id: S1, reference: 'AFTER-2', patient_ref: 'P-AFT' }); assert.deepEqual(await ops(dina.id, S1), [260, 260, 260]); assert(A4);

  // ---- 7. the post-binding advance: its own entry + proof only; drawer account nets by itself
  await flagIt(A3); const d3 = await delIt(A3);
  assert.deepEqual((await owner('select row_counts c from clinic_finance.test_deletions where id=$1', [d3]))[0].c, { 'clinic_finance.lines': 2, 'clinic_finance.entries': 1, 'clinic_finance.advance_proofs': 1, 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 });
  assert.deepEqual([await bal('1111'), await bal('902'), await bal('2150')], [0, 10, -840]); assert.deepEqual(await ops(dina.id, S1), [10, 10, 10]);
  // an advance that never reached the books
  const WAL = await receive(4, { amount: '60', method: 'wallet', reference: 'WAL-1', patient_ref: 'P-WAL' }); await flagIt(WAL); const dw = await delIt(WAL);
  assert.deepEqual((await owner('select row_counts c from clinic_finance.test_deletions where id=$1', [dw]))[0].c, { 'clinic_finance.audit': 1, 'clinic_finance.advances': 1 }); assert.equal(await cnt('select coalesce(sum(debit-credit),0)::float n from clinic_finance.lines'), 0);

  // ---- 8. rollback script: refuses while an advance is still flagged; keeps the history of deleted advances; restores the original functions; re-apply works
  await flagIt(A4);
  await db.exec('reset role'); await assert.rejects(db.exec(fs.readFileSync(R, 'utf8')), /مُعلَّمة «تجريبي»/); await db.exec('rollback');
  await tf(1, 'unflag', 'advance', A4, 'تراجعت عن التعليم');
  await db.exec('reset role'); await db.exec(fs.readFileSync(R, 'utf8'));
  assert.deepEqual((await owner("select md5(pg_get_functiondef('clinic_finance.test_plan(text,text)'::regprocedure)) m, md5(pg_get_functiondef('public.clinic_finance_test_find(text,text)'::regprocedure)) f"))[0], planBefore, 'the 20261109130000 functions are back byte for byte');
  assert.equal(await cnt("select count(*)::int n from pg_proc where proname in ('test_plan_base','test_find_base')"), 0);
  await assert.rejects(tf(1, 'scan', 'advance', A4), /غير مدعوم/); await assert.rejects(tf(1, 'find', 'advance', ''), /غير مدعوم/); assert.deepEqual(await tf(1, 'find', 'invoice', 'zzz'), []);
  await db.exec('reset role'); await db.exec('set role anon'); await assert.rejects(call('clinic_finance_test_find', ['invoice', '']), /permission denied/); await db.exec('reset role');
  await assert.rejects(owner("insert into clinic_finance.test_flags(record_type,record_key,label,reason,flagged_by) values('advance','x','x','سبب كافي',$1)", [id(1)]), /test_flags_record_type_check/, 'no new advance flags after the rollback');
  assert.equal(await cnt("select count(*)::int n from clinic_finance.test_flags where record_type='advance'"), 5, 'history of advance flags is kept'); assert.equal(await cnt("select count(*)::int n from clinic_finance.test_deletions where record_type='advance'"), 3);
  await db.exec(mig(M)); assert.equal((await scan(A4)).deletable, true, 're-applied');
  await db.close();
  console.log('PASS test-tool booking advance SQL: owner-only, flag -> delete with archive + audit, refusals (use, refund, booking, ended/later shift, handovers, cash left the drawer, closed period, reversal, other entries, receipt shape, mixed binding, posted non-cash), pre-binding receipt removed WITH its binding entry (1111 / drawer account / 2150 net to zero, operational figures agree), post-binding and unposted advances, atomic rollback on error, rollback script');
})().catch(e => { console.error(e.message, e.where || '', e.stack); process.exitCode = 1; });
