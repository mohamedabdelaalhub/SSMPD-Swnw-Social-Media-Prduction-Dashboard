// Per-service-line doctor fee allocation: SQL rehearsal on PGlite with the REAL finance migrations + channels + department contracts.
//
//
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
  await db.exec(mig('20261108130000_channels_discounts_p1.sql'));

  // ---- reception stubs + the original production text of the functions the DEPARTMENT migration re-creates (it is a prerequisite of this one)
  await db.exec(`create schema clinic_reception;
    create function clinic_reception.today() returns date language sql as $$ select (now() at time zone 'Africa/Cairo')::date $$;
    create table clinic_reception.services(workspace_id uuid, code text, department text, active boolean default true);
    create table clinic_reception.providers(workspace_id uuid, id uuid primary key, doctor_key text, department text);
    create table clinic_reception.orders(workspace_id uuid, id uuid primary key, provider_id uuid, snapshot jsonb);
    create table clinic_reception.doctor_agreements(workspace_id uuid, provider_id uuid, service_code text, rate numeric, deduct_material_cost boolean, valid_from date, valid_to date, reference text, status text, created_by uuid, reviewed_by uuid, finance_contract_id uuid);
    create table public.pricing_services(id uuid default gen_random_uuid(), category text, active boolean default true);`);
  const canon = mig('20261017130324_reception_canonical_catalog.sql'), a0 = canon.indexOf('create function clinic_reception.sync_doctor_contract(');
  await db.exec(canon.slice(a0, canon.indexOf('\nend $$;', a0) + 8));
  await db.exec(mig('20261018005957_pricing_doctor_contract_lookup.sql'));
  await db.exec('reset role'); await db.exec(mig('20261108230000_department_contracts.sql'));
  const W = id(900);
  await owner(`insert into clinic_reception.services(workspace_id, code, department) values ($1,'D-1','الاسنان'),($1,'D-2','الاسنان'),($1,'L-1','التحاليل')`, [W]);
  await owner(`insert into public.pricing_services(category) values ('الاسنان'),('التحاليل')`);

  const mkc = async (doctor, scope, rate, extra = {}) => {
    await as(2);
    const cid = await fin('doctor_command', ['contract', { doctor_key: doctor, doctor_name: 'طبيب ' + doctor, scope, from: shift(-30), to: shift(30), rate, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اختبار', ...extra }, key()]);
    await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد اختبار' }, key()]); return cid;
  };
  const bill = async (n, p, tk) => { await as(n); return fin('bill', [{ patient_ref: 'T', description: 'اختبار', items: [], ...p }, tk || key()]); };
  const earned = async inv => Number((await owner('select earned from clinic_finance.doctor_allocations where invoice_id=$1', [inv]))[0].earned);
  const refund = async (inv, amount) => { await owner("insert into clinic_finance.requests(kind,invoice_id,amount,reason,evidence,payload,created_by,token,status,reviewed_by) values('refund',$1,$2,'اختبار','TEST','{}',$3,gen_random_uuid(),'approved',$4)", [inv, amount, id(2), id(3)]); await owner('select clinic_finance.doctor_sync($1)', [inv]); };
  const rule = o => ({ code: 'vezeeta', name: 'فيزيتا', kind: 'external', applies_to: 'consultation', patient_discount_percent: 0, platform_share_percent: 25, payable_kind: 'commission', payable_when: 'آخر الشهر', source_codes: [], valid_from: shift(-5), valid_to: shift(300), notes: '', ...o });
  await as(2); const vez = await fin('channel_command', ['create', rule(), key()]); await as(3); await fin('channel_command', ['review', { id: vez, approve: true, note: 'اعتماد اختبار' }, key()]);
  const fn = async sig => (await owner("select pg_get_functiondef($1::regprocedure) d, coalesce(proacl::text,'') acl from pg_proc where oid=$1::regprocedure", [sig]))[0];
  const SIGS = ['clinic_finance.doctor_sync(uuid)', 'public.clinic_finance_bill(jsonb,uuid)'];
  const before = {}; for (const s of SIGS) before[s] = await fn(s);

  // ---- contracts used below (all on the service, no deduction)
  const dept30 = await mkc('DOC-Q', 'قسم:الاسنان', 30), exact40 = await mkc('DOC-Q', 'D-1', 40), cons30 = await mkc('DOC-Q', 'CONS', 30);
  const single50 = await mkc('DOC-S', 'قسم:الاسنان', 50);

  // ---- LEGACY invoices created BEFORE the lines migration (one contract per invoice, channel, refund) are the reference for byte-identical behaviour
  const legacy = async tag => {
    const a = await bill(2, { reference: 'LG-A' + tag, service_amount: 200, doctor_contract_id: single50 });
    const b = await bill(2, { reference: 'LG-B' + tag, service_amount: 600, channel_id: vez, consultation_gross: 100, services_gross: 500, doctor_contract_id: single50 });
    const c = await bill(2, { reference: 'LG-C' + tag, service_amount: 200, doctor_contract_id: single50 }); await refund(c, 50);
    const d = await bill(2, { reference: 'LG-D' + tag, service_amount: 200, doctor_contract_id: single50 }); await owner('update clinic_finance.doctor_allocations set original_deduction=40, returned_deduction=40, earned=0 where invoice_id=$1', [d]); await owner('select clinic_finance.doctor_sync($1)', [d]);
    return [await earned(a), await earned(b), await earned(c), await earned(d)];
  };
  const legacyBefore = await legacy('1');
  assert.deepEqual(legacyBefore, [100, 287.5, 75, 100], 'reference numbers: plain 100, channel (600-25)*50%, refund 75, returned deduction 100');

  // ---- APPLY
  await db.exec('reset role'); await db.exec(mig('20261108231000_doctor_service_lines.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261108231000_doctor_service_lines.sql')); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  assert.deepEqual(await legacy('2'), legacyBefore, 'invoices WITHOUT lines compute byte-for-byte as before (plain, channel_share, refund, returned_deduction)');
  const aclOf = async sig => (await fn(sig)).acl.replace(/^\{|\}$/g, '').split(',').sort().join(',');
  for (const s of SIGS) assert.equal(await aclOf(s), before[s].acl.replace(/^\{|\}$/g, '').split(',').sort().join(','), 'wrapper has exactly the privileges of the function it wraps: ' + s);

  const lines = (...l) => ({ doctor_key: 'DOC-Q', service_lines: l.map(([code, amount, kind]) => ({ code, amount, kind })) });
  const q = async inv => (await owner('select line_no, service_code, department, amount::float a, contract_id from clinic_finance.doctor_allocation_lines where invoice_id=$1 order by line_no', [inv]));

  // ---- (1) two services, two rates on ONE invoice: D-1 300 @40% (exact), D-2 200 @30% (department)
  const m1 = await bill(2, { reference: 'LN-1', service_amount: 500, ...lines(['D-1', 300], ['D-2', 200]) });
  assert.equal(await earned(m1), 180, '300*40% + 200*30%');
  const ln = await q(m1); assert.deepEqual(ln.map(x => [x.service_code, x.department, x.a, x.contract_id]), [['D-1', 'الاسنان', 300, exact40], ['D-2', 'الاسنان', 200, dept30]]);
  assert.equal((await owner('select earned::float e, original_base::float b from clinic_finance.doctor_allocations where invoice_id=$1', [m1]))[0].b, 500);
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_accruals where invoice_id=$1", [m1]))[0].n, 1, 'one accrual posted');
  // the order of the lines does not matter
  assert.equal(await earned(await bill(2, { reference: 'LN-1B', service_amount: 500, ...lines(['D-2', 200], ['D-1', 300]) })), 180);
  // swapping which service costs more changes the answer (proves the rate is per line, not per invoice)
  assert.equal(await earned(await bill(2, { reference: 'LN-1C', service_amount: 500, ...lines(['D-1', 200], ['D-2', 300]) })), 170);

  // ---- (2) every line on the same contract == the legacy single-contract invoice with the same contract
  const sameL = await bill(2, { reference: 'LN-2', service_amount: 500, doctor_key: 'DOC-S', service_lines: [{ code: 'D-1', amount: 300 }, { code: 'D-2', amount: 200 }] });
  const sameLeg = await bill(2, { reference: 'LN-2L', service_amount: 500, doctor_contract_id: single50 });
  assert.equal(await earned(sameL), await earned(sameLeg)); assert.equal(await earned(sameL), 250);
  await refund(sameL, 100); await refund(sameLeg, 100);
  assert.equal(await earned(sameL), await earned(sameLeg), 'a refund moves the lines invoice exactly like the legacy invoice'); assert.equal(await earned(sameL), 200);
  const sameC = await bill(2, { reference: 'LN-2C', service_amount: 600, channel_id: vez, consultation_gross: 100, services_gross: 500, doctor_key: 'DOC-S', service_lines: [{ code: 'D-1', amount: 300 }, { code: 'D-2', amount: 300 }] });
  const sameCL = await bill(2, { reference: 'LN-2CL', service_amount: 600, channel_id: vez, consultation_gross: 100, services_gross: 500, doctor_contract_id: single50 });
  assert.equal(await earned(sameC), await earned(sameCL)); assert.equal(await earned(sameC), 287.5, 'channel share: same as the legacy invoice with one contract');

  // ---- (3) the owner's platform example with three rates: platform takes 25% of the 100 consultation, the doctor's consultation line is paid 30% of the rest
  const m3 = await bill(2, { reference: 'LN-3', service_amount: 600, channel_id: vez, consultation_gross: 100, services_gross: 500, ...lines(['CONS', 100, 'consultation'], ['D-1', 300], ['D-2', 200]) });
  assert.equal(await earned(m3), 202.5, '(100-25)*30% + 300*40% + 200*30%');
  // voiding the invoice zeroes the fee through the same path
  await owner('update clinic_finance.invoices set voided=true where id=$1', [m3]); await owner('select clinic_finance.doctor_sync($1)', [m3]);
  assert.equal(await earned(m3), 0);

  // ---- (4) errors fail loudly and leave nothing behind
  const invCount = async () => (await owner('select count(*)::int n from clinic_finance.invoices'))[0].n;
  const n0 = await invCount();
  await assert.rejects(() => bill(2, { reference: 'ER-1', service_amount: 500, ...lines(['D-1', 300], ['L-1', 200]) }), /لا يوجد عقد معتمد للطبيب DOC-Q للخدمة L-1/);
  await assert.rejects(() => bill(2, { reference: 'ER-2', service_amount: 500, ...lines(['D-1', 300], ['D-2', 100]) }), /مجموع سطور الخدمات/);
  await assert.rejects(() => bill(2, { reference: 'ER-3', service_amount: 500, doctor_contract_id: dept30, ...lines(['D-1', 500]) }), /لا يمكن الجمع/);
  await assert.rejects(() => bill(2, { reference: 'ER-4', service_amount: 500, ...lines(['D-1', 0], ['D-2', 500]) }), /غير صالحة/);
  await assert.rejects(() => bill(2, { reference: 'ER-5', service_amount: 500, service_lines: [{ code: 'D-1', amount: 500 }] }), /حدد الطبيب/);
  await assert.rejects(() => bill(2, { reference: 'ER-6', service_amount: 500, doctor_key: 'DOC-Q', service_lines: [] }), /من 1 إلى 60/);
  await assert.rejects(() => bill(2, { reference: 'ER-7', service_amount: 500, doctor_key: 'DOC-NONE', service_lines: [{ code: 'D-1', amount: 500 }] }), /لا يوجد عقد معتمد/);
  const coll = await mkc('DOC-R', 'D-1', 20, { basis: 'collected' }); void coll; await mkc('DOC-R', 'D-2', 20);
  await assert.rejects(() => bill(2, { reference: 'ER-8', service_amount: 500, doctor_key: 'DOC-R', service_lines: [{ code: 'D-1', amount: 300 }, { code: 'D-2', amount: 200 }] }), /أساس الاستحقاق/);
  await mkc('DOC-I', 'D-1', 20, { base_scope: 'invoice' });
  await assert.rejects(() => bill(2, { reference: 'ER-9', service_amount: 500, doctor_key: 'DOC-I', service_lines: [{ code: 'D-1', amount: 500 }] }), /على الخدمة دون المستلزمات/);
  assert.equal(await invCount(), n0, 'a rejected bill leaves no invoice behind');
  await as(4); await assert.rejects(() => fin('bill', [{ reference: 'ER-10', patient_ref: 'T', description: 'x', items: [], service_amount: 500, ...lines(['D-1', 500]) }, key()]), /صلاحية/, 'permissions unchanged');
  // idempotent replay with the same token
  const tk = key(), pay = { reference: 'IDEM', service_amount: 500, ...lines(['D-1', 300], ['D-2', 200]) };
  const r1 = await bill(2, pay, tk), r2 = await bill(2, pay, tk); assert.equal(r1, r2);
  assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_allocation_lines where invoice_id=$1', [r1]))[0].n, 2);
  // tables are closed to the API roles
  await as(2); await assert.rejects(() => db.query('select * from clinic_finance.doctor_allocation_lines'), /permission denied/);

  // ---- ROLLBACK (with line rows present): byte-identical functions and privileges; the split data is kept, never dropped
  const rows0 = (await owner('select count(*)::int n from clinic_finance.doctor_allocation_lines'))[0].n; assert(rows0 > 0);
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261108231000_doctor_service_lines.rollback.sql', 'utf8'));
  for (const s of SIGS) { const x = await fn(s); assert.equal(x.d, before[s].d, 'rollback restores ' + s + ' byte-for-byte'); assert.equal(x.acl, before[s].acl, 'and its privileges'); }
  assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_allocation_lines_rolled_back'))[0].n, rows0, 'the stored line splits are kept in a renamed table');
  assert.equal((await owner("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_finance' and p.proname in ('doctor_sync_base','bill_before_lines')"))[0].n, 0, 'helpers gone');
  assert.deepEqual(await legacy('3'), legacyBefore, 'after the rollback the legacy invoices compute as before');
  await db.exec('reset role'); await db.exec(mig('20261108231000_doctor_service_lines.sql')); // can be applied again after a rollback
  console.log('PASS doctor service lines SQL: per-line contract resolution (exact > department), mixed 40%/30% on one invoice, parity with legacy for one contract (refund, channel_share, returned_deduction), platform share on the consultation line, loud failures, idempotency, byte-identical rollback with data kept');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
