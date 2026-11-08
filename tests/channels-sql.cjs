// Phase 1 channels / discounts: SQL rehearsal on PGlite using the REAL finance migrations (cash control, stock/insurance, doctor settlements) + the new one.
// Owner's worked examples (consultation 100): external platform -> doctor 37.5 / platform payable 25; Kafaret -> patient 80 / doctor 35 / cashback 10;
// club -> patient 70 / doctor 35; internal phone booking on a 100 service with a 40% contract -> doctor 30, 25 stays in the center.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('node:assert/strict');
const root = path.resolve('.'), id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0'), key = () => crypto.randomUUID();
(async () => {
  const db = new PGlite();
  const fixture = fs.readFileSync('tests/inventory-locations-sql.cjs', 'utf8');
  const setup = fixture.slice(fixture.indexOf(' await db.exec(`create role'), fixture.indexOf(' for(const [n,role,name]'));
  await new (Object.getPrototypeOf(async function () {}).constructor)('db', 'fs', 'path', 'root', setup)(db, fs, path, root);
  await db.exec(`create table admin_module_permissions(admin_id uuid,module_key text,can_view boolean,can_create boolean,can_update boolean);
    create function finance_module_allowed(m text,a text) returns boolean language sql stable security definer as $$select exists(select 1 from admin_module_permissions where admin_id=my_admin_id() and module_key=m and can_view and case a when 'create' then can_create when 'update' then can_update else true end)$$;`);
  const mig = n => fs.readFileSync('supabase/migrations/' + n, 'utf8');
  for (const n of ['20261017003349_clinic_cash_control.sql', '20261017004849_clinic_stock_insurance_controls.sql', '20261017010341_clinic_doctor_settlements.sql', '20261017011033_clinic_supplier_finance.sql']) await db.exec(mig(n));
  // The real chain wraps the public snapshot ~15 more times (bank, payroll, ..., group matches). The slice cannot load those, so emulate the LAST wrapper (group_snapshot_base) that production has.
  await db.exec('alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance; alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base; create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select clinic_finance.group_snapshot_base(p_from,p_to,p_offset) $$; grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;');
  for (const [n, role] of [[1, 'super_admin'], [2, 'accountant'], [3, 'financial_manager'], [4, 'reception'], [5, 'accountant']]) await db.query('insert into admins(id,name,role) values($1,$2,$3)', [id(n), 'Test ' + n, role]);
  await db.exec(`insert into admin_module_permissions values('${id(2)}','accounting',true,true,true),('${id(3)}','accounting',true,true,true),('${id(5)}','accounting',true,true,true)`);
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); };
  const call = async (fn, args = []) => (await db.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).rows[0].v;
  const fin = (fn, args = []) => call('clinic_finance_' + fn, args);
  const owner = async (q, a = []) => { await db.exec('reset role'); return (await db.query(q, a)).rows; };
  const today = (await owner("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d;
  const shift = d => new Date(Date.parse(today) + d * 864e5).toISOString().slice(0, 10);
  const range = [shift(-40), shift(40)];

  // ---- doctor contracts (50% for consultations, 40% for services), approved by a second person
  const contract = async (doctor, rate) => {
    await as(2);
    const cid = await fin('doctor_command', ['contract', { doctor_key: doctor, doctor_name: 'طبيب ' + doctor, scope: 'كل الخدمات', from: shift(-30), to: shift(30), rate, basis: 'performed', base_scope: 'invoice', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اختبار' }, key()]);
    await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد اختبار' }, key()]);
    return cid;
  };
  const c50 = await contract('DOC-50', 50), c40 = await contract('DOC-40', 40);
  const bill = async (n, p) => { await as(n); return fin('bill', [{ patient_ref: 'T', description: 'اختبار', items: [], ...p }, key()]); };
  const earned = async inv => Number((await owner('select earned from clinic_finance.doctor_allocations where invoice_id=$1', [inv]))[0].earned);
  const refund = async (inv, amount) => { await owner("insert into clinic_finance.requests(kind,invoice_id,amount,reason,evidence,payload,created_by,token,status,reviewed_by) values('refund',$1,$2,'اختبار','TEST','{}',$3,gen_random_uuid(),'approved',$4)", [inv, amount, id(2), id(3)]); await owner('select clinic_finance.doctor_sync($1)', [inv]); };

  // ---- REGRESSION BASELINE: invoices booked and refunded BEFORE the migration
  const oldPlain = await bill(2, { reference: 'OLD-1', service_amount: 200, doctor_contract_id: c50 });
  const oldRefund = await bill(2, { reference: 'OLD-2', service_amount: 200, doctor_contract_id: c50 });
  await refund(oldRefund, 50);
  const oldSimple = await bill(2, { reference: 'OLD-3', service_amount: 80, doctor_contract_id: c40 });
  const before = { plain: await earned(oldPlain), refunded: await earned(oldRefund), simple: await earned(oldSimple) };
  assert.deepEqual(before, { plain: 100, refunded: 75, simple: 32 });
  const accrualsBefore = (await owner('select count(*)::int n from clinic_finance.doctor_accruals'))[0].n;
  const entriesBefore = (await owner('select count(*)::int n from clinic_finance.entries'))[0].n;

  // keep a copy of the CURRENT production doctor_sync (with the returned_deduction patch) to compare against after the migration
  const oldDef = (await owner("select pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure) d"))[0].d;
  assert(oldDef.includes('greatest(0,a.original_deduction-a.returned_deduction)'), 'fixture really carries the supplier-finance patch');
  await db.exec(oldDef.replace('clinic_finance.doctor_sync(', 'clinic_finance.doctor_sync_old('));
  const earnedWith = async (fn, inv, od, rd) => {
    await db.exec('reset role'); await db.exec('begin');
    await db.query('update clinic_finance.doctor_allocations set original_deduction=$2, returned_deduction=$3, earned=0 where invoice_id=$1', [inv, od, rd]);
    await db.query('select clinic_finance.' + fn + '($1)', [inv]);
    const r = Number((await db.query('select earned from clinic_finance.doctor_allocations where invoice_id=$1', [inv])).rows[0].earned);
    await db.exec('rollback'); return r;
  };

  // ---- APPLY the new migration
  await db.exec(mig('20261108130000_channels_discounts_p1.sql'));
  // REGRESSION: old vs new doctor_sync on invoices WITHOUT a channel, including returned_deduction cases, must be identical
  for (const inv of [oldPlain, oldRefund, oldSimple]) for (const [od, rd] of [[0, 0], [30, 0], [30, 10], [30, 50], [0, 5], [250, 250]])
    assert.equal(await earnedWith('doctor_sync', inv, od, rd), await earnedWith('doctor_sync_old', inv, od, rd), 'no-channel parity od=' + od + ' rd=' + rd);
  assert.notEqual(await earnedWith('doctor_sync', oldPlain, 30, 10), await earnedWith('doctor_sync', oldPlain, 30, 0), 'returned_deduction still matters');
  for (const inv of [oldPlain, oldRefund, oldSimple]) await owner('select clinic_finance.doctor_sync($1)', [inv]);
  assert.deepEqual({ plain: await earned(oldPlain), refunded: await earned(oldRefund), simple: await earned(oldSimple) }, before, 'existing invoices compute identically');
  assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_accruals'))[0].n, accrualsBefore, 'no new accrual events for old invoices');
  assert.equal((await owner('select count(*)::int n from clinic_finance.entries'))[0].n, entriesBefore, 'no new ledger entries for old invoices');
  const twin = await bill(2, { reference: 'NEW-TWIN', service_amount: 200, doctor_contract_id: c50 }); await refund(twin, 50);
  assert.equal(await earned(twin), before.refunded, 'a new invoice with no channel equals the same invoice booked before');
  assert.equal((await owner('select count(*)::int n from clinic_finance.channel_allocations'))[0].n, 0);

  // ---- rule management: maker-checker, validation, access
  const rule = (o) => ({ code: 'x', name: 'قاعدة', kind: 'external', applies_to: 'consultation', patient_discount_percent: 0, platform_share_percent: 25, payable_kind: 'commission', payable_when: 'آخر الشهر', source_codes: [], valid_from: shift(-5), valid_to: shift(300), notes: '', ...o });
  const mk = async (o, approve = true) => {
    await as(2); const rid = await fin('channel_command', ['create', rule(o), key()]);
    if (approve) { await as(3); await fin('channel_command', ['review', { id: rid, approve: true, note: 'اعتماد اختبار' }, key()]); }
    return rid;
  };
  await as(4); await assert.rejects(() => fin('channel_command', ['create', rule({ code: 'zz' }), key()]), /صلاحية/);
  const pendingRule = await mk({ code: 'pending_one', name: 'قيد الاعتماد' }, false);
  await as(2); await assert.rejects(() => fin('channel_command', ['review', { id: pendingRule, approve: true, note: 'اعتماد من محاسب' }, key()]), /صلاحية/);
  await as(3); const selfRule = await fin('channel_command', ['create', rule({ code: 'selfie' }), key()]);
  await assert.rejects(() => fin('channel_command', ['review', { id: selfRule, approve: true, note: 'اعتماد ذاتي' }, key()]), /اعتماد قاعدتك/);
  await assert.rejects(() => fin('channel_command', ['review', { id: pendingRule, approve: true, note: '' }, key()]), /اعتماد قاعدتك|غير متاحة/);
  await as(2); await assert.rejects(() => fin('channel_command', ['create', rule({ code: 'too_much', patient_discount_percent: 70, platform_share_percent: 40 }), key()]), /المجموع لا يتجاوز/);
  await assert.rejects(() => fin('channel_command', ['create', rule({ code: 'bad_internal', kind: 'internal' }), key()]), /داخلية/);
  await assert.rejects(() => fin('channel_command', ['create', rule({ code: 'Bad Code!' }), key()]), /check/i);
  const tk = key(); const same = await fin('channel_command', ['create', rule({ code: 'idem' }), tk]);
  assert.equal(await fin('channel_command', ['create', rule({ code: 'idem' }), tk]), same);
  await assert.rejects(() => fin('channel_command', ['create', rule({ code: 'idem', name: 'اسم مختلف' }), tk]), /مفتاح طلب مختلف/);

  const vez = await mk({ code: 'vezeeta', name: 'فيزيتا', source_codes: ['vezeeta'] });
  const kaf = await mk({ code: 'kafaret', name: 'كفارة', kind: 'contracting', patient_discount_percent: 20, platform_share_percent: 10, payable_kind: 'cashback', source_codes: ['kafaret'] });
  const club = await mk({ code: 'ahly_club', name: 'النادي الأهلي', kind: 'contracting', applies_to: 'all', patient_discount_percent: 30, platform_share_percent: 0, payable_kind: 'none', source_codes: ['club'] });
  const phone = await mk({ code: 'phone', name: 'حجز تليفون', kind: 'internal', applies_to: 'all', platform_share_percent: 25, payable_kind: 'none', source_codes: ['phone', 'website', 'whatsapp'] });
  const dup = await mk({ code: 'vezeeta', name: 'فيزيتا جديدة' }, false);
  await as(3); await assert.rejects(() => fin('channel_command', ['review', { id: dup, approve: true, note: 'اعتماد' }, key()]), /تتداخل/);
  assert.equal((await owner('select version from clinic_finance.channel_rules where id=$1', [dup]))[0].version, 2, 'a new rule with an existing code becomes the next version');
  await as(3); await fin('channel_command', ['review', { id: dup, approve: false, note: 'رفض اختبار' }, key()]);
  const expired = await mk({ code: 'old_one', valid_from: shift(-20), valid_to: shift(-10) });

  // ---- the owner's worked examples (consultation = 100)
  const v1 = await bill(2, { reference: 'VEZ-1', service_amount: 100, channel_id: vez, consultation_gross: 100, services_gross: 0, doctor_contract_id: c50 });
  assert.equal(await earned(v1), 37.5, 'external platform: doctor gets 50% of (100 - 25)');
  let al = (await owner('select * from clinic_finance.channel_allocations where invoice_id=$1', [v1]))[0];
  assert.deepEqual([Number(al.platform_share), Number(al.patient_discount), al.payable_kind, al.channel_code], [25, 0, 'commission', 'vezeeta']);
  assert.equal((await owner('select amount from clinic_finance.invoices where id=$1', [v1]))[0].amount, '100.00', 'patient pays the full consultation');

  const k1 = await bill(2, { reference: 'KAF-1', service_amount: 80, channel_id: kaf, consultation_gross: 100, services_gross: 0, doctor_contract_id: c50 });
  assert.equal(Number((await owner('select amount from clinic_finance.invoices where id=$1', [k1]))[0].amount), 80, 'Kafaret: patient pays 80');
  assert.equal(await earned(k1), 35, 'Kafaret: doctor 50% of (80 - 10)');
  al = (await owner('select * from clinic_finance.channel_allocations where invoice_id=$1', [k1]))[0];
  assert.deepEqual([Number(al.platform_share), Number(al.patient_discount), al.payable_kind], [10, 20, 'cashback'], 'Kafaret cashback 10');

  const c1 = await bill(2, { reference: 'CLUB-1', service_amount: 70, channel_id: club, consultation_gross: 100, services_gross: 0, doctor_contract_id: c50 });
  assert.equal(await earned(c1), 35, 'club: patient pays 70, doctor 50% of 70');

  const p1 = await bill(2, { reference: 'PHONE-1', service_amount: 100, channel_id: phone, consultation_gross: 0, services_gross: 100, doctor_contract_id: c40 });
  assert.equal(await earned(p1), 30, 'internal channel on a 100 service at 40%: doctor 40% of (100 - 25) = 30');
  al = (await owner('select * from clinic_finance.channel_allocations where invoice_id=$1', [p1]))[0];
  assert.deepEqual([Number(al.platform_share), al.payable_kind], [25, 'none'], 'internal share is not payable to a third party');
  const noChannel = await bill(2, { reference: 'PHONE-0', service_amount: 100, doctor_contract_id: c40 });
  assert.equal(await earned(noChannel), 40, 'same service without a channel: 40');

  // an external platform covers consultations only: services on the same invoice stay at full price and out of the share
  const mixed = await bill(2, { reference: 'VEZ-MIX', service_amount: 300, channel_id: vez, consultation_gross: 100, services_gross: 200, doctor_contract_id: c50 });
  assert.equal(Number((await owner('select platform_share from clinic_finance.channel_allocations where invoice_id=$1', [mixed]))[0].platform_share), 25);

  // ---- refunds scale the platform share together with the revenue
  await refund(v1, 50);
  assert.equal(await earned(v1), 18.75, 'half refunded: (100*0.5 - 25*0.5) * 50%');

  // ---- snapshot of the rule is frozen on the invoice even when the rule changes later
  const snap = (await owner('select rule from clinic_finance.channel_allocations where invoice_id=$1', [k1]))[0].rule;
  assert.deepEqual([snap.code, Number(snap.patient_discount_percent), Number(snap.platform_share_percent), snap.status], ['kafaret', 20, 10, 'active']);
  await as(3); await fin('channel_command', ['retire', { id: kaf, note: 'إنهاء اختبار' }, key()]);
  assert.equal((await owner('select (rule->>$2)::numeric n from clinic_finance.channel_allocations where invoice_id=$1', [k1, 'platform_share_percent']))[0].n, '10.0000');
  assert.equal(await earned(k1), 35);

  // ---- server-side validation of the bill
  await as(2);
  const bad = (p, re) => assert.rejects(() => fin('bill', [{ patient_ref: 'T', description: 'اختبار', items: [], ...p }, key()]), re);
  await bad({ reference: 'B1', service_amount: 100, channel_id: kaf, consultation_gross: 100, services_gross: 0 }, /غير معتمدة|خارج/);              // retired now
  await bad({ reference: 'B2', service_amount: 100, channel_id: club, consultation_gross: 100, services_gross: 0 }, /لا تطابق قاعدة القناة/);        // forgot the 30% discount
  await bad({ reference: 'B3', service_amount: 100, channel_id: pendingRule, consultation_gross: 100, services_gross: 0 }, /غير معتمدة/);
  await bad({ reference: 'B4', service_amount: 100, channel_id: expired, consultation_gross: 100, services_gross: 0 }, /غير معتمدة/);
  await bad({ reference: 'B5', service_amount: 100, channel_id: vez, consultation_gross: 0, services_gross: 100 }, /الكشف فقط/);
  await bad({ reference: 'B6', service_amount: 100, channel_id: crypto.randomUUID(), consultation_gross: 100, services_gross: 0 }, /غير معتمدة/);
  await bad({ reference: 'B7', service_amount: 100, channel_id: vez, consultation_gross: -5, services_gross: 105 }, /راجع قيمة الكشف/);
  assert.equal((await owner("select count(*)::int n from clinic_finance.invoices where reference like 'B_'"))[0].n, 0, 'rejected bills leave nothing behind');
  const replayKey = key(), payload = { reference: 'REPLAY', patient_ref: 'T', description: 'اختبار', items: [], service_amount: 100, channel_id: vez, consultation_gross: 100, services_gross: 0 };
  const r1 = await fin('bill', [payload, replayKey]);
  assert.equal(await fin('bill', [payload, replayKey]), r1);
  assert.equal((await owner('select count(*)::int n from clinic_finance.channel_allocations where invoice_id=$1', [r1]))[0].n, 1);

  // ---- snapshot: rules, allocations and the month-end payables report
  await as(3);
  const sn = await fin('snapshot', range);
  assert(Array.isArray(sn.channel_rules) && sn.channel_rules.some(r => r.code === 'vezeeta' && r.status === 'active') && !sn.channel_rules.some(r => 'payload' in r || 'token' in r));
  assert(sn.channel_allocations.some(a => a.invoice_reference === 'KAF-1'));
  assert(!sn.channel_allocations.some(a => 'rule' in a));
  const pay = Object.fromEntries(sn.channel_payables.map(p => [p.channel_code, p]));
  assert.equal(Number(pay.vezeeta.share_due), 25 * 0.5 + 25 + 25 + 0 - 0, 'VEZ-1 (half refunded 12.5) + VEZ-MIX 25 + REPLAY 25');
  assert.equal(pay.vezeeta.payable_kind, 'commission');
  assert.equal(Number(pay.kafaret.share_due), 10); assert.equal(pay.kafaret.payable_kind, 'cashback'); assert.equal(Number(pay.kafaret.patient_discount), 20);
  assert.equal(pay.phone.payable_kind, 'none'); assert.equal(Number(pay.phone.share_due), 25);
  assert.equal(Number(pay.ahly_club.patient_discount), 30);
  assert(sn.channel_payables.every(p => /^\d{4}-\d{2}-01$/.test(p.month)));
  await owner('update clinic_finance.invoices set voided=true where id=$1', [mixed]);
  await as(3); const sn2 = await fin('snapshot', range);
  assert.equal(Number(sn2.channel_payables.find(p => p.channel_code === 'vezeeta').share_due), 12.5 + 25, 'a voided invoice leaves the payable');
  await as(4); await assert.rejects(() => fin('snapshot', range), /صلاحية/);

  // ---- anon cannot call anything new
  await db.exec('reset role');
  for (const sig of ['public.clinic_finance_channel_command(text,jsonb,uuid)', 'public.clinic_finance_snapshot(date,date,integer)'])
    assert.equal((await db.query(`select has_function_privilege('anon','${sig}','execute') v`)).rows[0].v, false);
  assert.equal((await db.query("select has_table_privilege('authenticated','clinic_finance.channel_rules','select') v")).rows[0].v, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','clinic_finance.channel_invoice_snapshot()','execute') v")).rows[0].v, false);

  // ---- guard: the migration refuses to run against a doctor_sync it was not written for
  const tamper = new PGlite();
  await tamper.exec("create schema clinic_finance;create function clinic_finance.doctor_sync(p uuid) returns void language sql as $$select 1$$;");
  await assert.rejects(() => tamper.exec(mig('20261108130000_channels_discounts_p1.sql')), /doctor_sync غير مطابقة/);

  // ---- rollback: everything the migration added goes, the old behaviour comes back, data of old invoices is untouched
  await db.exec(fs.readFileSync('supabase/rollbacks/20261108130000_channels_discounts_p1.rollback.sql', 'utf8'));
  assert.equal((await owner("select pg_get_functiondef('clinic_finance.doctor_sync(uuid)'::regprocedure) d"))[0].d, oldDef, 'rollback restores the exact pre-migration doctor_sync');
  assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='clinic_finance' and c.relname like 'channel_%'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('channel_invoice_snapshot','invoice_revenue','clinic_finance_channel_command','channels_snapshot_base')")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='channel_invoice_snapshot'")).rows[0].n, 0);
  await as(3); const sn3 = await fin('snapshot', range);
  assert(!('channel_rules' in sn3) && Array.isArray(sn3.doctor_contracts), 'previous snapshot restored');
  assert.deepEqual({ plain: await earned(oldPlain), refunded: await earned(oldRefund), simple: await earned(oldSimple) }, before);
  await owner('select clinic_finance.doctor_sync($1)', [oldRefund]);
  assert.equal(await earned(oldRefund), 75, 'restored doctor_sync gives the same old result');
  const afterRb = await bill(2, { reference: 'AFTER-RB', service_amount: 100, doctor_contract_id: c50 });
  assert.equal(await earned(afterRb), 50);
  await db.exec(mig('20261108130000_channels_discounts_p1.sql')); // can be applied again after a rollback
  await owner('select clinic_finance.doctor_sync($1)', [oldRefund]);
  assert.equal(await earned(oldRefund), 75);
  console.log('PASS channels SQL: owner examples (37.5 / 35 / 35 / 30), regression on old invoices, maker-checker, validation, payables, snapshot freeze, guard, rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
