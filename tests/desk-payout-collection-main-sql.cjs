// Same as desk-payout-from-collection-sql, but with the real treasury layer (a MAIN treasury exists, the drawer is a «collection»
// register): clinic_finance.cash_line_guard must let ONLY the approved desk doctor payout leave the collection drawer (20261118140000).
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const b = await boot(['reception_canonical_catalog']); const { db, as, fin, owner, call, id, key, range } = b;
  const mig = n => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.startsWith(n)), 'utf8');
  try {
    await db.exec('reset role');
    if (!(await db.query("select to_regprocedure('clinic_finance.group_snapshot_base(date,date,integer)') r")).rows[0].r)
      await db.exec('alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance; alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base; create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select clinic_finance.group_snapshot_base(p_from,p_to,p_offset) $$; grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;');
    for (const n of ['20261018005957', '20261108130000', '20261108230000', '20261108231000', '20261108250000', '20261108260000_doctor_payout', '20261108280000', '20261109100000']) await db.exec(mig(n));
    if (!(await db.query("select to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') r")).rows[0].r) await db.exec(mig('20261116150000_finance_shift_movements'));
    await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table if not exists storage.objects(bucket_id text,name text); create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;`);
    await db.exec(mig('20261117230000'));
    await owner("insert into admins(id,name,role) values($1,'Rec2','reception')", [id(8)]);
    const dcmd = (a, p, k) => fin('doctor_command', [a, p, k || key()]);
    await as(2); const c = await dcmd('contract', { doctor_key: 'DOC-C', doctor_name: 'د. كريم', scope: 'كشف', from: range[0], to: range[1], rate: 50, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'C-C' });
    await as(3); await dcmd('contract_review', { id: c, approve: true, note: 'اعتماد اختبار' });
    let n = 0; const bill = async amt => { await as(2); return fin('bill', [{ reference: 'B-C-' + (++n), patient_ref: 'T', description: 'كشف', service_amount: amt, items: [], doctor_contract_id: c }, key()]); };
    await as(1); const freg = await fin('register', ['خزينة اختبار', 100000]); const accShift = await fin('open_shift', [freg, key()]);
    const i1 = await bill(1000); await as(1); await fin('collect', [i1, accShift, 'cash', 1000, 'RC-1', key()]);   // fee 500 payable
    const ws = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id", [id(1)]))[0].id;
    await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing"); await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
    const prov = (await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. كريم','DOC-C','عيادة','حدائق الأهرام') returning id", [ws]))[0].id;
    for (const m of [4, 8]) await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)", [ws, id(m), ['book']]);
    const call2 = (a, p, k) => call('clinic_reception_doctor_payout', [a, Object.assign({ workspace_id: ws }, p || {}), k === undefined ? key() : k]);
    // the reception drawer is a collection register: «استلام فقط»
    await db.exec('reset role'); for (const n of ['20261017212113', '20261018205000', '20261019001000']) await db.exec(mig(n));
    const chart = (a, p) => fin('ledger_command', [a, p, key()]), treasury = (a, p) => fin('treasury_command', [a, p, key()]);
    await as(1); let parent = null; for (let level = 1; level <= 5; level++) { const a = await chart('account_create', { code: '01' + '01'.repeat(level - 1), name: 'مستوى ' + level, kind: 'asset', parent_code: parent, is_postable: level === 5 }); parent = a.code; }
    await chart('account_create', { code: '0101010102', name: 'خزينة استقبال', kind: 'asset', parent_code: '01010101' });
    const mainReg = await treasury('register_save', { name: 'الخزينة الرئيسية', treasury_kind: 'main', account_code: parent, assigned_to: id(3), limit: 1000 });
    const sub = await treasury('register_save', { name: 'dina', treasury_kind: 'collection', account_code: '0101010102', assigned_to: id(4), parent_register_id: mainReg.id }); assert.equal(sub.operation_mode, 'receive');
    await as(4); const recFinShift = await call('clinic_booking_shift', ['open', { register_id: sub.id }, key()]);
    await as(4); await db.exec('reset role'); await db.query("select clinic_finance.post('fund',gen_random_uuid(),'كاش تحصيل اليوم (اختبار)',$1,'1111','1112',3000)", [recFinShift]);
    const rreg = (await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'dina','both') returning id", [ws]))[0].id;
    await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,finance_shift_id) values($1,$2,$3,'open',$4)", [ws, rreg, id(4), recFinShift]);
    const cash = async () => Number((await owner('select clinic_finance.shift_cash($1) c', [recFinShift]))[0].c);

    await as(4); const q = await call2('request', { provider_id: prov }); assert.equal(q.status, 'pending'); assert.equal(Number(q.gross), 500);
    // before this migration the receive-only drawer refuses the payout
    await as(3); await assert.rejects(() => call2('approve', { id: q.id }), /للاستلام فقط/, 'baseline: receive-only blocks the payout');
    await db.exec('reset role'); await db.exec(mig('20261118030000'));
    await as(3); await assert.rejects(() => call2('approve', { id: q.id }), /الصرف من الخزينة الرئيسية فقط/, 'with a main treasury the cash guard still blocks it');
    await db.exec('reset role'); const M = mig('20261118140000'); await db.exec(M);
    await assert.rejects(() => db.exec(M), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    // other payouts from the collection drawer are still refused
    const tryPost = (src, sid) => db.query("select clinic_finance.post($1,$2,'اختبار',$3,'5224','1111',10)", [src, sid, recFinShift]);
    await as(4); await db.exec('reset role');
    await assert.rejects(() => tryPost('expense', null), /للاستلام فقط|الصرف من الخزينة الرئيسية فقط/, 'petty cash still blocked');
    await assert.rejects(() => tryPost('doctor_payment', '00000000-0000-0000-0000-0000000000ff'), /للاستلام فقط/, 'accounting doctor payout still blocked');
    await assert.rejects(() => tryPost('doctor_payment', q.id), /للاستلام فقط/, 'the requester cannot push their own desk payout through');
    // the requester still cannot approve; an approver can
    await as(4); await assert.rejects(() => call2('approve', { id: q.id }), /للمدير المالي أو المدير العام/);
    const before = await cash(); assert.equal(before, 3000);
    await as(3); const a = await call2('approve', { id: q.id }); assert.equal(a.status, 'approved');
    assert.equal(before - await cash(), 500, 'expected drawer cash drops by the payout → no false shortage at close');
    // once approved the exception closes again for that payout (no double payout)
    await as(3); await db.exec('reset role'); await assert.rejects(() => tryPost('doctor_payment', q.id), /للاستلام فقط/);
    // shift report shows the payout as money out
    await as(3); const mv = await call('clinic_finance_shift_movements', [recFinShift, null, null, null, null]);
    const out = mv.movements.filter(r => r.direction === 'out'); assert.equal(out.length, 1); assert.equal(Number(out[0].amount), -500); assert.match(out[0].title, /صرف مستحقات طبيب/);
    // ledger: doctor payable 2120 reduced by 500 with a 1111 credit on the reception shift; payable now 0
    const led = (await owner("select sum(l.debit) d from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='doctor_payment' and e.source_id=$1 and e.shift_id=$2 and l.account='2120'", [q.id, recFinShift]))[0];
    assert.equal(Number(led.d), 500);
    assert.equal(Number((await owner("select clinic_finance.doctor_payable_now('DOC-C') v"))[0].v), 0, 'doctor account closed');
    // proven-cash limit still applies: a payout larger than the drawer is refused
    const i2 = await bill(10000); await as(1); await fin('collect', [i2, accShift, 'cash', 10000, 'RC-2', key()]);   // fee 5000 > 2500 in drawer
    await as(4); const q2 = await call2('request', { provider_id: prov }); await as(3);
    await assert.rejects(() => call2('approve', { id: q2.id }), /أقل من مبلغ الصرف|الكاش المتاح لا يكفي/, 'cannot pay above the drawer cash');
    // rollback restores the strict cash guard
    await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261118140000_desk_payout_cash_line_guard.rollback.sql', 'utf8'));
    assert.equal((await db.query("select position('desk_payout_from_collection' in pg_get_functiondef('clinic_finance.cash_line_guard()'::regprocedure)) p")).rows[0].p, 0);
    console.log('PASS desk payout from collection WITH main treasury + cash guard: receive-only drawer pays only an approved desk doctor payout (maker-checker kept), other payouts still blocked, cash limit kept, shift report + ledger + doctor account correct, rollback restores.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
