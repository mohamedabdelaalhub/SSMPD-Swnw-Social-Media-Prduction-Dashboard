// Dental external cost (lab invoice) per service line: SQL rehearsal on PGlite. Loads the REAL chain up to the service-lines migration, then applies 20261108260000_dental_external_cost.sql.
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
  // The migration pins the exact PRODUCTION md5s of the functions it wraps. This test loads a partial chain, so it substitutes the md5s of the local definitions for the pins
  // (after asserting the pins are the audited production values) and separately proves that a drifted function is refused.
  const PINS = { e0d8058554453f61b8e2c11a0839e98c: 'clinic_finance.doctor_sync(uuid)', a8aeb2de4795afda4424863bf9170352: 'public.clinic_finance_bill(jsonb,uuid)', '2661fea092b3a191e0099e5b4f2745b9': 'clinic_finance.doctor_bill_base(jsonb,uuid)' };
  const lmig = async (wrong) => { let t = mig('20261108231000_doctor_service_lines.sql'); for (const [pin, sig] of Object.entries(PINS)) { assert(t.includes(pin), 'production pin present: ' + sig); const m = wrong === sig ? '0'.repeat(32) : (await owner('select md5(pg_get_functiondef($1::regprocedure)) m', [sig]))[0].m; t = t.replace(pin, m); } return t; };
  await owner(`do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$`);
  const W = id(900);
  await owner(`insert into clinic_reception.services(workspace_id, code, department) values ($1,'D-1','الاسنان'),($1,'D-2','الاسنان'),($1,'L-1','التحاليل'),($1,'CONS','الكشف')`, [W]);
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
  // production privileges: bill = postgres+authenticated+service_role (no anon); doctor_sync = postgres only. Supabase default privileges would hand every NEW public function to anon too.
  await db.exec("reset role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role; revoke all on function public.clinic_finance_bill(jsonb,uuid) from public, anon; grant execute on function public.clinic_finance_bill(jsonb,uuid) to authenticated, service_role; revoke all on function clinic_finance.doctor_sync(uuid) from public");
  const before = {}; for (const s of SIGS) before[s] = await fn(s);

  // ---- contracts used below (all on the service, no deduction)
  const dept30 = await mkc('DOC-Q', 'قسم:الاسنان', 30), exact40 = await mkc('DOC-Q', 'D-1', 40), cons30 = await mkc('DOC-Q', 'CONS', 30);
  const single50 = await mkc('DOC-S', 'قسم:الاسنان', 50); await mkc('DOC-S', 'CONS', 50);

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
  for (const sig of ['clinic_finance.doctor_bill_base(jsonb,uuid)', 'public.clinic_finance_bill(jsonb,uuid)']) { await assert.rejects(async () => { await db.exec('reset role'); await db.exec(await lmig(sig)); }, /المدقَّقة/, 'a drifted ' + sig + ' is refused'); await db.exec('rollback'); }
  await db.exec('reset role'); await db.exec(await lmig());
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(await lmig()); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  assert.deepEqual(await legacy('2'), legacyBefore, 'invoices WITHOUT lines compute byte-for-byte as before (plain, channel_share, refund, returned_deduction)');
  const aclOf = async sig => (await fn(sig)).acl.replace(/^\{|\}$/g, '').split(',').sort().join(',');
  for (const s of SIGS) assert.equal(await aclOf(s), before[s].acl.replace(/^\{|\}$/g, '').split(',').sort().join(','), 'wrapper has exactly the privileges of the function it wraps: ' + s);
  assert(!(await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.includes('anon='), 'anon never gets the bill wrapper');
  assert.deepEqual((await fn('clinic_finance.doctor_sync(uuid)')).acl.replace(/^\{|\}$/g, '').split(',').map(x => x.split('=')[0]), ['postgres'], 'doctor_sync stays postgres-only');
  await as(2); assert.equal(await call('clinic_finance_lines_enabled'), true, 'capability probe'); await db.exec('reset role');

  const lines = (...l) => ({ doctor_key: 'DOC-Q', service_lines: l.map(([code, amount, kind]) => ({ code, amount, kind })) });

  // ---- APPLY the external-cost migration on top of the lines migration
  const emig = () => fs.readFileSync('supabase/migrations/20261108260000_dental_external_cost.sql', 'utf8');
  const pinOf = emig().match(/md5\(d\) <> '([0-9a-f]{32})'/)[1];
  assert.equal(pinOf, (await owner("select md5(pg_get_functiondef('public.clinic_finance_bill(jsonb,uuid)'::regprocedure)) m"))[0].m, 'the md5 pin equals the wrapper created by 20261108231000');
  const billBefore = await fn('public.clinic_finance_bill(jsonb,uuid)');
  const oldM1 = await bill(2, { reference: 'PRE-1', service_amount: 500, ...lines(['D-1', 300], ['D-2', 200]) }); assert.equal(await earned(oldM1), 180);
  await db.exec('reset role'); await db.exec(emig());
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(emig()); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  assert.equal((await aclOf('public.clinic_finance_bill(jsonb,uuid)')), (await aclOf('clinic_finance.bill_before_external(jsonb,uuid)')), 'wrapper keeps exactly the wrapped function privileges');
  assert(!(await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.includes('anon='), 'anon never gets the bill wrapper');
  await as(2); assert.equal(await call('clinic_finance_external_cost_enabled'), true, 'capability probe'); await db.exec('reset role');
  await as(2); await assert.rejects(() => db.query('select external_cost from clinic_finance.doctor_allocation_lines'), /permission denied/); await db.exec('reset role');
  assert.equal(await earned(oldM1), 180, 'invoices created before keep their fee');

  // contracts: DOC-IMP implants 30% (performed and collected variants use different doctors so each resolves to one contract)
  await mkc('DOC-IMP', 'D-1', 30); await mkc('DOC-COL', 'D-1', 30, { basis: 'collected' }); await mkc('DOC-COL', 'D-2', 30, { basis: 'collected' });
  const ext = (code, amount, external_cost, external_ref, kind) => ({ code, amount, kind, external_cost, external_ref });
  const lineRows = async inv => (await owner('select line_no, amount::float a, external_cost::float e, external_ref r, line_deduction::float d from clinic_finance.doctor_allocation_lines where invoice_id=$1 order by line_no', [inv]));
  const alloc = async inv => (await owner('select original_deduction::float od, earned::float e from clinic_finance.doctor_allocations where invoice_id=$1', [inv]))[0];

  // (A) implants, performed: 30% * (10000 - 3000 lab) = 2100
  const A = await bill(2, { reference: 'EX-A', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 3000, 'LAB-77')] });
  assert.equal(await earned(A), 2100, '30% of (10000 - 3000 lab)');
  assert.deepEqual(await lineRows(A), [{ line_no: 1, a: 10000, e: 3000, r: 'LAB-77', d: 3000 }], 'external cost stored on the line and inside line_deduction');
  assert.equal((await alloc(A)).od, 3000, 'allocation original_deduction re-summed');
  // no external cost: unchanged behaviour (30% of 10000)
  const A0 = await bill(2, { reference: 'EX-A0', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [{ code: 'D-1', amount: 10000 }] });
  assert.equal(await earned(A0), 3000); assert.equal((await lineRows(A0))[0].e, 0);
  // explicit zero needs no reference
  assert.equal(await earned(await bill(2, { reference: 'EX-A1', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 0)] })), 3000);
  // replay with the same token does not double the deduction
  const tk = key(), pay = { reference: 'EX-IDEM', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 3000, 'LAB-78')] };
  const i1 = await bill(2, pay, tk), i2 = await bill(2, pay, tk); assert.equal(i1, i2); assert.equal(await earned(i1), 2100); assert.equal((await lineRows(i1))[0].d, 3000);
  // a lab bigger than the fee base floors the fee at 0 (never negative): lab == amount
  assert.equal(await earned(await bill(2, { reference: 'EX-FLOOR', service_amount: 1000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 1000, 1000, 'LAB-79')] })), 0);
  // refund: the lab invoice is a fixed cost, only the revenue part shrinks: (10000*8000/10000 - 3000)*30% = 1500
  await refund(A, 2000); assert.equal(await earned(A), 1500, 'refund of 2000 keeps the lab deduction fixed');

  // (B) mixed lines on one invoice: D-1 300 with lab 100 @40% (exact) + D-2 200 @30% (department) = 80 + 60
  const B = await bill(2, { reference: 'EX-B', service_amount: 500, ...{ doctor_key: 'DOC-Q', service_lines: [ext('D-1', 300, 100, 'LAB-80'), { code: 'D-2', amount: 200 }] } });
  assert.equal(await earned(B), 140, '(300-100)*40% + 200*30%');

  // (C) implants on the COLLECTED basis (paid in parts): fee follows collected/revenue
  await as(1); const reg = await fin('register', ['خزينة أسنان', 300]), sh = await fin('open_shift', [reg, key()]);
  const pay_ = async (inv, amt) => { await as(1); await fin('collect', [inv, sh, 'cash', amt, 'RC-' + key().slice(0, 8), key()]); };
  const C = await bill(2, { reference: 'EX-C', service_amount: 10000, doctor_key: 'DOC-COL', service_lines: [ext('D-1', 10000, 3000, 'LAB-81')] });
  assert.equal(await earned(C), 0, 'nothing collected yet');
  await pay_(C, 5000); assert.equal(await earned(C), 1050, '30% * (10000-3000) * 5000/10000');
  await pay_(C, 5000); assert.equal(await earned(C), 2100, 'fully paid == performed result');

  // (D) ORTHO on ONE invoice with an installment series (12000, lab 3000, 30%, collected). Lab is spread pro-rata over the payments.
  const D = await bill(2, { reference: 'EX-D', service_amount: 12000, doctor_key: 'DOC-COL', service_lines: [ext('D-1', 12000, 3000, 'LAB-82')] });
  const proportional = [], firstPaymentModel = [], paid = [1000, 3000, 2000, 1000, 5000]; let cum = 0;
  for (const p of paid) { await pay_(D, p); cum += p; proportional.push(await earned(D)); firstPaymentModel.push(Math.max(0, cum - 3000) * 0.3); }
  assert.deepEqual(proportional, [225, 900, 1350, 1575, 2700], 'pro-rata: 30% * 9000 * collected/12000 after each installment');
  assert.deepEqual(firstPaymentModel, [0, 300, 900, 1200, 2700], 'for comparison: lab taken from the FIRST payments (fee stays 0 until 3000 collected)');
  assert.equal(proportional.at(-1), firstPaymentModel.at(-1), 'both models agree once the invoice is fully paid');
  assert.equal((await owner('select count(*)::int n from clinic_finance.payments where invoice_id=$1', [D]))[0].n, paid.length, 'one invoice carries the whole installment series');

  // (E) loud failures leave nothing behind
  const invCount = async () => (await owner('select count(*)::int n from clinic_finance.invoices'))[0].n; const n1 = await invCount();
  await assert.rejects(() => bill(2, { reference: 'EX-E1', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 3000)] }), /رقم فاتورة المعمل/);
  await assert.rejects(() => bill(2, { reference: 'EX-E2', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 10001, 'LAB-1')] }), /أكبر من قيمة السطر/);
  await assert.rejects(() => bill(2, { reference: 'EX-E3', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, -5, 'LAB-1')] }), /غير صالحة/);
  await assert.rejects(() => bill(2, { reference: 'EX-E4', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 100.123, 'LAB-1')] }), /غير صالحة/);
  await assert.rejects(() => bill(2, { reference: 'EX-E5', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 'NaN', 'LAB-1')] }), /غير صالحة/);
  await assert.rejects(() => bill(2, { reference: 'EX-E6', service_amount: 10000, doctor_contract_id: single50, external_cost: 100 }), /داخل service_lines/);
  await assert.rejects(() => bill(2, { reference: 'EX-E7', service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, '', 'LAB-1')] }), /فارغة/);
  assert.equal(await invCount(), n1, 'rejected bills leave no invoice behind');
  await as(4); await assert.rejects(() => fin('bill', [{ reference: 'EX-E8', patient_ref: 'T', description: 'x', items: [], service_amount: 10000, doctor_key: 'DOC-IMP', service_lines: [ext('D-1', 10000, 3000, 'LAB-1')] }, key()]), /صلاحية/, 'permissions unchanged'); await db.exec('reset role');
  // legacy single-contract invoices are untouched by the new wrapper
  assert.deepEqual(await legacy('4'), legacyBefore, 'legacy invoices compute as before');

  // ---- ROLLBACK: wrapper restored byte-for-byte, stored deductions kept, backup table written, columns gone, re-apply possible
  const eA = await earned(A), eC = await earned(C), eD = await earned(D);
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261108260000_dental_external_cost.rollback.sql', 'utf8'));
  const after = await fn('public.clinic_finance_bill(jsonb,uuid)'); assert.equal(after.d, billBefore.d, 'rollback restores the wrapper byte-for-byte'); assert.equal(after.acl, billBefore.acl, 'and its privileges');
  assert.equal((await owner("select count(*)::int n from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_allocation_lines' and column_name in ('external_cost','external_ref')"))[0].n, 0);
  assert((await owner('select count(*)::int n from clinic_finance.doctor_allocation_lines_external_backup'))[0].n >= 5, 'external costs preserved in the backup table');
  await owner('select clinic_finance.doctor_sync($1)', [A]); await owner('select clinic_finance.doctor_sync($1)', [D]);
  assert.equal(await earned(A), eA, 'fee unchanged after rollback + resync (line_deduction kept)'); assert.equal(await earned(D), eD); assert.equal(await earned(C), eC);
  await owner('drop table clinic_finance.doctor_allocation_lines_external_backup'); await db.exec('reset role'); await db.exec(emig());
  console.log('PASS dental external cost SQL: implants 30%*(paid-lab), mixed lines, collected-basis installments on one invoice (ortho), refund, replay, floor at 0, loud failures, legacy parity, byte-identical rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
