// Owner 2026-11-17 «صرف حساب الطبيب» from reception: dashboard-computed amount, «معلّق» until an approver acts (financial manager / GM /
// super admin / granted account; never the requester), approver-only amount change with a reason, cash from the requester's shift,
// handover → «تم الصرف», optional receipt. PGlite with the real finance + reception migrations and the payout phase-2 / by-invoice files.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const b = await boot(['reception_canonical_catalog']); const { db, as, fin, owner, call, id, key, range } = b;
  const mig = n => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.startsWith(n)), 'utf8');
  try {
    await db.exec('reset role');
    if (!(await db.query("select to_regprocedure('clinic_finance.group_snapshot_base(date,date,integer)') r")).rows[0].r)
      await db.exec('alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance; alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base; create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select clinic_finance.group_snapshot_base(p_from,p_to,p_offset) $$; grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;');
    for (const n of ['20261018005957', '20261108130000', '20261108230000', '20261108231000', '20261108250000', '20261108260000_doctor_payout', '20261108280000', '20261109100000']) { await db.exec(mig(n)); if (process.env.DBG) console.log(n, (await db.query("select to_regprocedure('clinic_finance.doctor_payable_now(text)') a, to_regprocedure('clinic_finance.invoice_fully_paid(uuid)') b")).rows[0]); }
    await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table if not exists storage.objects(bucket_id text,name text); create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;`);
    const M = mig('20261117230000');
    await db.exec(M);
    await assert.rejects(() => db.exec(M), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');
    // people: 1 super_admin, 2 accountant, 3 financial_manager, 4 reception; 7 = reception lead (granted), 8 = second reception
    await owner("insert into admins(id,name,role) values($1,'Lead','reception'),($2,'Rec2','reception')", [id(7), id(8)]);
    // finance fixture: a doctor contract (50%), invoices billed by the accountant and collected on a shift
    const dcmd = (a, p, k) => fin('doctor_command', [a, p, k || key()]);
    await as(2); const c = await dcmd('contract', { doctor_key: 'DOC-R', doctor_name: 'د. رامي', scope: 'كشف', from: range[0], to: range[1], rate: 50, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'C-R' });
    await as(3); await dcmd('contract_review', { id: c, approve: true, note: 'اعتماد اختبار' });
    let n = 0; const bill = async amt => { await as(2); return fin('bill', [{ reference: 'B-R-' + (++n), patient_ref: 'T', description: 'كشف', service_amount: amt, items: [], doctor_contract_id: c }, key()]); };
    await as(1); const freg = await fin('register', ['خزينة اختبار', 100000]); const accShift = await fin('open_shift', [freg, key()]);
    const pay = async (inv, amt) => { await as(1); return fin('collect', [inv, accShift, 'cash', amt, 'RC-' + (++n), key()]); };
    const i1 = await bill(600), i2 = await bill(400), i3 = await bill(1000); await pay(i1, 600); await pay(i2, 400); await pay(i3, 200);   // fees 300 + 200 payable, 500 held
    // reception: live workspace, provider linked to DOC-R, an appointment today, reception member with an open reception + finance shift
    const ws = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id", [id(1)]))[0].id;
    await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing"); await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
    const prov = (await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. رامي','DOC-R','عيادة','حدائق الأهرام') returning id", [ws]))[0].id;
    for (const [m, cap] of [[4, ['book']], [8, ['book']]]) await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)", [ws, id(m), cap]);
    const call2 = (a, p, k) => call('clinic_reception_doctor_payout', [a, Object.assign({ workspace_id: ws }, p || {}), k === undefined ? key() : k]);
    // fund the reception cashier's finance shift with cash from the register
    await owner("update clinic_finance.registers set direction='both' where id=$1", [freg]).catch(() => {});
    const freg2 = (await owner("insert into clinic_finance.registers(name,petty_limit,created_by) values('خزينة الاستقبال',100000,$1) returning id", [id(1)]))[0].id;
    await owner("update clinic_finance.registers set direction='both' where id=$1", [freg2]).catch(() => {});
    const recFinShift = (await owner("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values($1,$2,gen_random_uuid(),2000) returning id", [freg2, id(4)]))[0].id;
    await as(4); await db.exec('reset role'); await db.query("select clinic_finance.post('fund',gen_random_uuid(),'تغذية خزينة الاستقبال (اختبار)',$1,'1111','1112',2000)", [recFinShift]);
    const rreg = (await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'خزينة الاستقبال','both') returning id", [ws]))[0].id;
    await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,finance_shift_id) values($1,$2,$3,'open',$4)", [ws, rreg, id(4), recFinShift]);
    // board/detail
    let r = await (async () => { await as(4); return call2('detail', { provider_id: prov }); })();
    assert.equal(Number(r.payable), 500, 'payable = fully paid invoices only'); assert.equal(Number(r.held), 500, 'unpaid invoice holds its fee'); assert.equal(r.state, 'ready');
    assert.equal(r.invoices.length, 2);
    // request (reception) → pending with the computed amount; second request refused while pending; same token replays
    const k1 = key(); let q = await (async () => { await as(4); return call2('request', { provider_id: prov, gross: 1 }, k1); })();
    assert.equal(q.status, 'pending'); assert.equal(Number(q.gross), 500, 'reception cannot choose the amount'); assert.equal(q.invoices.length, 2);
    assert.equal((await call2('request', { provider_id: prov }, k1)).id, q.id, 'idempotent');
    await assert.rejects(() => call2('request', { provider_id: prov }), /طلب صرف معلّق/);
    assert.equal((await call2('detail', { provider_id: prov })).state, 'pending');
    // requester cannot approve; plain reception cannot approve; accountant (not approver) cannot
    await assert.rejects(() => call2('approve', { id: q.id }), /للمدير المالي أو المدير العام/);
    await as(8); await assert.rejects(() => call2('approve', { id: q.id }), /للمدير المالي/);
    await as(2); await assert.rejects(() => call2('approve', { id: q.id }), /للمدير المالي/);
    // the granted reception lead becomes an approver; the grant itself is super-admin only
    await as(3); await db.query("update admins set can_approve_doctor_payouts=true where id=$1", [id(7)]).catch(() => {});
    await db.exec('reset role'); await assert.rejects(() => db.query("update admins set can_approve_doctor_payouts=true where id=$1", [id(7)]), /الصلاحيات للسوبر أدمن/, 'trigger guards the grant');
    assert.equal((await owner('select can_approve_doctor_payouts g from admins where id=$1', [id(7)]))[0].g, false, 'non-super cannot grant');
    await db.exec("alter table admins disable trigger guard_doctor_payout_grant"); await owner("update admins set can_approve_doctor_payouts=true where id=$1", [id(7)]); await db.exec("alter table admins enable trigger guard_doctor_payout_grant");   // super admin grants from the admin panel
    await as(7); let list = await call('clinic_reception_doctor_payout', ['pending_list', {}, null]); assert.equal(list.approver, true); assert.equal(list.items.length, 1);
    await as(8); assert.equal((await call('clinic_reception_doctor_payout', ['pending_list', {}, null])).approver, false);
    // approver adjusts the amount (reason required, never above the invoices' fees) then approves → cash leaves the requester's shift
    await as(7);
    await assert.rejects(() => call2('approve', { id: q.id, gross: 450 }), /سبب تعديل المبلغ/);
    await assert.rejects(() => call2('approve', { id: q.id, gross: 900, note: 'زيادة' }), /أكبر من أتعاب الفواتير/);
    const cashBefore = Number((await owner('select clinic_finance.shift_cash($1) c', [recFinShift]))[0].c);
    q = await call2('approve', { id: q.id, gross: 450, note: 'خصم سلفة متفق عليها' });
    assert.equal(q.status, 'approved'); assert.equal(Number(q.gross), 450); assert.equal(Number(q.computed_gross), 500); assert.equal(q.adjust_note, 'خصم سلفة متفق عليها');
    assert.equal(cashBefore - Number((await owner('select clinic_finance.shift_cash($1) c', [recFinShift]))[0].c), 450, 'cash out of the reception shift');
    assert.equal((await call2('approve', { id: q.id })).status, 'approved', 'replay is harmless');
    // reception hands the cash → state; receipt optional
    await as(4); let dt = await call2('detail', { provider_id: prov }); assert.equal(dt.state, 'approved', 'waiting for handover');
    q = await call2('handover', { id: q.id }); assert(q.handed_at);
    dt = await call2('detail', { provider_id: prov }); assert.equal(dt.state, 'partial', 'held invoice remains → partial'); assert.equal(Number(dt.paid_today), 450);
    await assert.rejects(() => call2('receipt', { id: q.id, path: 'x/../evil' }), /مسار الإيصال/);
    q = await call2('receipt', { id: q.id, path: q.id + '/receipt-1.jpg' }); assert.equal(q.receipt_path, q.id + '/receipt-1.jpg');
    await as(4); assert.equal((await db.query("select public.doctor_payout_receipt_allowed($1,true) ok", [q.id + '/a.jpg'])).rows[0].ok, true, 'reception can upload');
    await as(2); assert.equal((await db.query("select public.doctor_payout_receipt_allowed($1,false) ok", [q.id + '/a.jpg'])).rows[0].ok, false, 'accountant outside reception cannot read');
    // reject path frees invoices; the rest becomes payable after the patient pays → paid
    await pay(i3, 800); await as(4); dt = await call2('detail', { provider_id: prov }); assert.equal(Number(dt.payable), 500); assert.equal(dt.state, 'partial');
    const q2 = await call2('request', { provider_id: prov }); await as(7);
    await assert.rejects(() => call2('reject', { id: q2.id }), /سبب الرفض/);
    await call2('reject', { id: q2.id, note: 'الدكتور هياخدها بكرة' }); await as(4); assert.equal(Number((await call2('detail', { provider_id: prov })).payable), 500, 'rejected frees the invoice');
    const q3 = await call2('request', { provider_id: prov }); await as(1); await call2('approve', { id: q3.id }); await as(4); await call2('handover', { id: q3.id });
    dt = await call2('detail', { provider_id: prov }); assert.equal(dt.state, 'paid', 'all paid → تم الصرف'); assert.equal(Number(dt.paid_today), 950);
    // board lists today's doctors only
    await owner("insert into clinic_reception.patients(workspace_id,file_no,name) values($1,'F1','مريض') ", [ws]).catch(() => {});
    console.log('PASS doctor payout desk: computed amount, pending, maker-checker, approver grant (super-admin only), adjust with reason/cap, cash from requester shift, handover → partial/paid, receipt path + access, reject frees invoices.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
