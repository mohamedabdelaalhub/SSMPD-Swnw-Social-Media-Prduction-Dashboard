// Fixed-amount doctor fees + extra performers on one invoice (20261108270000): SQL rehearsal on PGlite. Loads the REAL chain (departments, service lines, dental external cost, revisions, statement) then applies the migration.
// Percent contracts must compute byte-for-byte as before; fixed fee per service line; refund/void/collected; contract_revise; overlap; extra performers (doctor + nurse); guards; rollback.

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
  const billBefore = await fn('public.clinic_finance_bill(jsonb,uuid)'), syncBefore = await fn('clinic_finance.doctor_sync(uuid)'), collBefore = await fn('public.clinic_finance_collect(uuid,uuid,text,numeric,text,uuid)');
  const oldM1 = await bill(2, { reference: 'PRE-1', service_amount: 500, ...lines(['D-1', 300], ['D-2', 200]) }); assert.equal(await earned(oldM1), 180);
  await db.exec('reset role'); await db.exec(emig());
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(emig()); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  assert.equal((await aclOf('public.clinic_finance_bill(jsonb,uuid)')), (await aclOf('clinic_finance.bill_before_external(jsonb,uuid)')), 'wrapper keeps exactly the wrapped function privileges');
  assert(!(await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.includes('anon='), 'anon never gets the bill wrapper');
  await as(2); assert.equal(await call('clinic_finance_external_cost_enabled'), true, 'capability probe'); await db.exec('reset role');
  await as(2); await assert.rejects(() => db.query('select external_cost from clinic_finance.doctor_allocation_lines'), /permission denied/); await db.exec('reset role');
  assert.equal(await earned(oldM1), 180, 'invoices created before keep their fee');



  // ---- the rest of the chain that this migration reads / patches: revisions (contract_revise) and the statement
  await db.exec('reset role'); await db.exec(mig('20261108240000_contract_revisions.sql'));
  await db.exec('reset role'); await db.exec(mig('20261108250000_doctor_statement.sql'));
  let payout2 = true; try { await db.exec('reset role'); await db.exec(mig('20261108260000_doctor_payout_phase2.sql')); } catch (e) { payout2 = false; console.log('NOTE payout phase 2 not loadable in this partial chain (' + e.message.slice(0, 80) + '): held-fees branch not exercised here'); }
  await owner(`insert into clinic_reception.services(workspace_id, code, department) values ($1,'HV','الزيارات'),($1,'HV2','الزيارات'),($1,'EXT','الزيارات')`, [W]);

  // ---- percent scenarios: the SAME numbers must come out before and after the migration
  let sc = 0;
  const mkp = async (doctor, scope, rate, extra = {}) => mkc(doctor, scope, rate, extra);
  await mkp('DOC-P', 'D-1', 30); await mkp('DOC-P', 'D-2', 40); await mkp('DOC-PC', 'D-1', 30, { basis: 'collected' });
  await as(1); const reg = await fin('register', ['خزينة ثابت', 300]), sh = await fin('open_shift', [reg, key()]);
  const pay_ = async (inv, amt) => { await as(1); await fin('collect', [inv, sh, 'cash', amt, 'RC-' + key().slice(0, 8), key()]); };
  const scen = async () => {
    const t = 'S' + (++sc), out = [];
    const a = await bill(2, { reference: t + 'a', service_amount: 500, doctor_key: 'DOC-P', service_lines: [{ code: 'D-1', amount: 300 }, { code: 'D-2', amount: 200 }] }); out.push(await earned(a));        // 90 + 80
    const b = await bill(2, { reference: t + 'b', service_amount: 200, doctor_contract_id: single50 }); out.push(await earned(b)); await refund(b, 50); out.push(await earned(b));                         // 100, 75
    const c = await bill(2, { reference: t + 'c', service_amount: 10000, doctor_key: 'DOC-PC', service_lines: [{ code: 'D-1', amount: 10000, external_cost: 3000, external_ref: 'LAB-' + t }] }); out.push(await earned(c));
    await pay_(c, 5000); out.push(await earned(c)); await pay_(c, 5000); out.push(await earned(c));                                                                                                    // 0, 1050, 2100
    return out;
  };
  const snapshot = async () => ({
    contracts: await owner("select id, doctor_key, service_scope, valid_from::text, valid_to::text, rate::float, basis, base_scope, deduction, status, reference from clinic_finance.doctor_contracts order by id"),
    bal: await owner("select doctor_key, clinic_finance.doctor_balance(doctor_key)::float b from (select distinct doctor_key from clinic_finance.doctor_contracts) k order by 1")
  });
  const accN = async () => (await owner('select count(*)::int n, coalesce(sum(delta),0)::float s from clinic_finance.doctor_accruals'))[0];
  const scenBefore = await scen(); assert.deepEqual(scenBefore, [170, 100, 75, 0, 1050, 2100], 'reference numbers (percent only)');
  const snapBefore = await snapshot(), accBefore = await accN();
  const SIG3 = ['clinic_finance.doctor_sync(uuid)', 'public.clinic_finance_bill(jsonb,uuid)', 'public.clinic_finance_doctor_command(text,jsonb,uuid)', 'clinic_finance.doctor_statement(text,date,date)'];
  const defBefore = {}; for (const s of SIG3) defBefore[s] = await fn(s);
  const pre = await db.dumpDataDir();   // for the rollback rehearsal on a clone

  // ---- APPLY
  const fmig = () => fs.readFileSync('supabase/migrations/20261108270000_doctor_fixed_fee.sql', 'utf8');
  await db.exec('reset role'); await db.exec(fmig());
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(fmig()); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  for (const s of SIG3.slice(0, 3)) assert.equal(await aclOf(s), defBefore[s].acl.replace(/^\{|\}$/g, '').split(',').sort().join(','), 'wrapper has exactly the privileges of the function it wraps: ' + s);
  assert(!(await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.includes('anon='), 'anon never gets the bill wrapper');
  assert(!(await fn('public.clinic_finance_doctor_command(text,jsonb,uuid)')).acl.includes('anon='), 'anon never gets the command wrapper');
  assert.deepEqual((await fn('clinic_finance.doctor_sync(uuid)')).acl.replace(/^\{|\}$/g, '').split(',').map(x => x.split('=')[0]), ['postgres'], 'doctor_sync stays postgres-only');
  await as(2); assert.equal(await call('clinic_finance_fixed_fee_enabled'), true, 'capability probe');
  await assert.rejects(() => db.query('select * from clinic_finance.doctor_extra_allocations'), /permission denied/, 'extra tables are not readable by the app roles'); await db.exec('reset role');

  // ---- PERCENT PARITY
  assert.deepEqual(await scen(), scenBefore, 'percent invoices (lines, legacy, refund, external cost, collected) give byte-identical fees after the migration');
  assert.deepEqual(await legacy('9'), legacyBefore, 'legacy invoices (channel, refund, returned deduction) unchanged');
  const a1 = await accN(); const snapAfter = await snapshot();
  assert.deepEqual(snapAfter.contracts, snapBefore.contracts, 'existing contracts unchanged');
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where fee_kind <> 'percent' or fixed_amount is not null"))[0].n, 0, 'all existing contracts are percent');
  for (const inv of (await owner('select invoice_id from clinic_finance.doctor_allocations')).map(r => r.invoice_id)) await owner('select clinic_finance.doctor_sync($1)', [inv]);
  assert.equal((await accN()).n, a1.n, 're-syncing every existing invoice posts no new accrual');

  // ---- FIXED CONTRACTS: creation + validation
  const base = (doctor, scope, extra = {}) => ({ doctor_key: doctor, doctor_name: 'ممرض ' + doctor, scope, from: shift(-30), to: shift(30), basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اتفاق ثابت', ...extra });
  const cmd = async (n, a, p, tk) => { await as(n); return fin('doctor_command', [a, p, tk || key()]); };
  const approve = async cid => { await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد' }, key()]); return cid; };
  const mkf = async (doctor, scope, amount, extra = {}) => approve(await cmd(2, 'contract', base(doctor, scope, { fee_kind: 'fixed', fixed_amount: amount, ...extra })));
  const row = async cid => (await owner('select fee_kind, fixed_amount::float f, rate::float r, deduction, status from clinic_finance.doctor_contracts where id=$1', [cid]))[0];
  const hv = await mkf('EMP-N', 'HV', 100);
  assert.deepEqual(await row(hv), { fee_kind: 'fixed', f: 100, r: 0, deduction: 'none', status: 'active' }, 'fixed contract stored: kind, amount, rate 0');
  const bad = async (p, re) => { await assert.rejects(() => cmd(2, 'contract', base('EMP-BAD', 'HV2', p)), re); };
  await bad({ fee_kind: 'fixed' }, /اكتب المبلغ/); await bad({ fee_kind: 'fixed', fixed_amount: 0 }, /غير صالح/); await bad({ fee_kind: 'fixed', fixed_amount: -5 }, /غير صالح/);
  await bad({ fee_kind: 'fixed', fixed_amount: 100.123 }, /غير صالح/); await bad({ fee_kind: 'fixed', fixed_amount: 'NaN' }, /غير صالح/); await bad({ fee_kind: 'fixed', fixed_amount: 100001 }, /غير صالح/);
  await bad({ fee_kind: 'fixed', fixed_amount: 100, deduction: 'sale' }, /لا يخصم مستلزمات/); await bad({ fee_kind: 'zzz', rate: 10 }, /نوع الأتعاب/);
  await bad({ rate: 10, fixed_amount: 100 }, /مبلغ ثابت/);
  await assert.rejects(() => owner("update clinic_finance.doctor_contracts set rate=10 where id=$1", [hv]), /doctor_contracts_fee_ck/, 'table CHECK: a fixed contract must have rate 0');
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where doctor_key='EMP-BAD'"))[0].n, 0, 'rejected requests leave no row');
  // percent contracts still need a rate and still work through the wrapper (also with explicit fee_kind percent)
  const pc = await approve(await cmd(2, 'contract', base('EMP-PC', 'HV', { fee_kind: 'percent', rate: 20 }))); assert.deepEqual(await row(pc), { fee_kind: 'percent', f: null, r: 20, deduction: 'none', status: 'active' });
  await assert.rejects(() => cmd(2, 'contract', base('EMP-BAD', 'HV2', {})), /النسبة|rate|null/i, 'a percent request without a rate still fails as before');
  // idempotent: the same token returns the same contract; a different payload with the same token is refused
  const tk = key(); const p1 = base('EMP-I', 'HV', { fee_kind: 'fixed', fixed_amount: 80 }); const i1 = await cmd(2, 'contract', p1, tk), i2 = await cmd(2, 'contract', p1, tk); assert.equal(i1, i2);
  await assert.rejects(() => cmd(2, 'contract', { ...p1, fixed_amount: 90 }, tk), /مفتاح طلب مختلف/);
  // overlap check unchanged: a second approved contract for the same doctor+scope+dates is refused, fixed or percent
  const dup = await cmd(2, 'contract', base('EMP-N', 'HV', { fee_kind: 'fixed', fixed_amount: 120 })); await as(3);
  try { await fin('doctor_command', ['contract_review', { id: dup, approve: true, note: 'اختبار' }, key()]); assert.fail('no overlap error'); } catch (e) { assert.match(e.message, /تتداخل/, 'overlap check unchanged: ' + e.message); }
  await fin('doctor_command', ['contract_review', { id: dup, approve: false, note: 'رفض' }, key()]);
  // batch: several scopes at once, all fixed
  const b0 = await cmd(2, 'contract_batch', base('EMP-B', 'x', { scopes: ['HV', 'HV2'], fee_kind: 'fixed', fixed_amount: 100 }));
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where doctor_key='EMP-B' and fee_kind='fixed' and fixed_amount=100 and rate=0")).at(0).n, 2, 'batch creates fixed contracts');
  for (const r of await owner("select id from clinic_finance.doctor_contracts where doctor_key='EMP-B' and status='pending'")) await approve(r.id);
  // revise: percent -> fixed and fixed -> percent (starts tomorrow; approval by a second account shortens the old one)
  const rev = async (cid, extra) => cmd(2, 'contract_revise', { supersedes: cid, from: shift(10), to: shift(30), basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'تعديل', note: 'سبب', ...extra });
  const r1 = await rev(pc, { fee_kind: 'fixed', fixed_amount: 90 }); assert.deepEqual(await row(r1), { fee_kind: 'fixed', f: 90, r: 0, deduction: 'none', status: 'pending' }, 'percent -> fixed revision');
  await approve(r1); assert.equal((await owner('select valid_to::text d from clinic_finance.doctor_contracts where id=$1', [pc]))[0].d, shift(9), 'old percent contract shortened to the day before');
  const r2 = await rev(hv, { rate: 25 }); assert.deepEqual(await row(r2), { fee_kind: 'percent', f: null, r: 25, deduction: 'none', status: 'pending' }, 'fixed -> percent revision');
  await approve(r2); assert.equal((await row(hv)).status, 'active');
  await assert.rejects(() => rev(hv, { fee_kind: 'fixed', fixed_amount: 0 }), /غير صالح/, 'revision validation');

  // ---- ACCRUAL: fixed per service line
  const lbl = (code, amount, kind) => ({ code, amount, kind });
  const hvBill = (ref, doctor, amount, ls, extra = {}) => bill(2, { reference: ref, service_amount: amount, doctor_key: doctor, service_lines: ls, ...extra });
  const fx = await hvBill('FX-1', 'EMP-N', 500, [lbl('HV', 500)]); assert.equal(await earned(fx), 100, 'nurse: 100 for one home visit regardless of the price');
  const fx2 = await hvBill('FX-2', 'EMP-N', 800, [lbl('HV', 300), lbl('HV', 500)]); assert.equal(await earned(fx2), 200, 'one fixed amount per service line');
  const bal = async k => Number((await owner('select clinic_finance.doctor_balance($1) b', [k]))[0].b);
  assert.equal(await bal('EMP-N'), 300, 'balance by doctor_key picks the fixed fees up');
  await refund(fx, 250); assert.equal(await earned(fx), 50, 'refund of half the invoice halves the fixed fee (proportional_revenue, same as percent)');
  await owner('update clinic_finance.invoices set voided=true where id=$1', [fx2]); await owner('select clinic_finance.doctor_sync($1)', [fx2]); assert.equal(await earned(fx2), 0, 'voided invoice earns 0');
  assert.equal(await bal('EMP-N'), 50);
  // owner decision: the fee comes out of the service price -> never more than the line price (100 fixed on a 60 EGP line = 60; 80 fixed on a 100 line = 80)
  await mkf('EMP-CAP', 'HV', 100); const cap = await hvBill('FX-CAP', 'EMP-CAP', 60, [lbl('HV', 60)]); assert.equal(await earned(cap), 60, 'fixed fee capped at the line price'); await refund(cap, 30); assert.equal(await earned(cap), 30);
  const capm = await hvBill('FX-CAP2', 'EMP-CAP', 560, [lbl('HV', 60), lbl('HV', 500)]); assert.equal(await earned(capm), 160, 'per line: min(100,60) + min(100,500)');
  // collected basis
  await mkf('EMP-C', 'HV', 100, { basis: 'collected' });
  const fc = await hvBill('FX-C', 'EMP-C', 500, [lbl('HV', 500)]); assert.equal(await earned(fc), 0, 'collected basis: nothing collected yet');
  await pay_(fc, 250); assert.equal(await earned(fc), 50); await pay_(fc, 250); assert.equal(await earned(fc), 100, 'fully collected == performed result');
  // mixed on one invoice: percent 30% consultation-like line + fixed line
  await mkp('DOC-M', 'D-1', 30); await mkf('DOC-M', 'HV', 100);
  const mx = await hvBill('FX-M', 'DOC-M', 500, [lbl('D-1', 300), lbl('HV', 200)]); assert.equal(await earned(mx), 190, '30% * 300 + fixed 100');
  await refund(mx, 250); assert.equal(await earned(mx), 95, 'refund of half: both parts halve');
  // an invoice with ONE contract id (no lines) on a fixed contract: one amount per invoice
  const one = await bill(2, { reference: 'FX-ONE', service_amount: 400, doctor_contract_id: (await owner("select id from clinic_finance.doctor_contracts where doctor_key='EMP-B' and service_scope='HV'"))[0].id });
  assert.equal(await earned(one), 100, 'legacy single-contract invoice on a fixed contract: one fixed amount');
  // a fixed contract cannot carry a lab cost / first payment; nothing is left behind
  const invCount = async () => (await owner('select count(*)::int n from clinic_finance.invoices'))[0].n; const n1 = await invCount();
  await assert.rejects(() => hvBill('FX-E1', 'EMP-N', 500, [{ ...lbl('HV', 500), external_cost: 100, external_ref: 'LAB-1' }]), /لا يقبل تكلفة معمل/);
  assert.equal(await invCount(), n1, 'rejected bills leave no invoice');
  // resync of every fixed invoice is a no-op
  const a2 = await accN(); for (const inv of [fx, fx2, fc, mx, one]) await owner('select clinic_finance.doctor_sync($1)', [inv]); assert.equal((await accN()).n, a2.n, 're-sync posts nothing');
  // ledger: the accrual is posted like a percent one (5111 / 2120)
  assert.equal(Number((await owner("select coalesce(sum(delta),0) s from clinic_finance.doctor_accruals where doctor_key='EMP-N'"))[0].s), 50);

  // reception order agreements cannot point at a fixed contract
  const fixedC = (await owner("select id from clinic_finance.doctor_contracts where doctor_key='EMP-C'"))[0].id;
  await assert.rejects(() => owner("insert into clinic_reception.doctor_agreements(workspace_id, provider_id, service_code, rate, deduct_material_cost, valid_from, valid_to, reference, status, finance_contract_id) values ($1, gen_random_uuid(), 'HV', 0, false, now(), now(), 'x', 'active', $2)", [W, fixedC]), /لا يُربط باتفاقية/);

  // ---- STATEMENT shows the fixed amount
  await as(2); const st = await call('clinic_finance_doctor_statement', ['EMP-C', shift(-5), shift(5)]); await db.exec('reset role');
  const ln = st.invoices.find(x => x.reference === 'FX-C').lines[0]; assert.deepEqual([ln.fee_kind, ln.fixed_amount, ln.fee_estimate, ln.rate], ['fixed', 100, 100, 0], 'statement line: fixed fee');
  assert.equal(st.invoices.find(x => x.reference === 'FX-C').fee, 100);
  await as(2); const stp = await call('clinic_finance_doctor_statement', ['DOC-P', shift(-5), shift(5)]); await db.exec('reset role');
  const pl = stp.invoices.find(x => x.reference === 'S1a').lines[0]; assert.deepEqual([pl.fee_kind, pl.fee_estimate, pl.rate], ['percent', 90, 30], 'percent line unchanged in the statement');

  // ---- EXTRA PERFORMERS: doctor + nurse on ONE home-visit invoice
  await mkp('DOC-H', 'HV', 30);
  const hx = (ref, amount, extras, ls, extra = {}) => bill(2, { reference: ref, service_amount: amount, doctor_key: 'DOC-H', service_lines: ls || [lbl('HV', amount)], extra_performers: extras, ...extra });
  const ex = async inv => (await owner('select doctor_key, earned::float e, basis from clinic_finance.doctor_extra_allocations where invoice_id=$1 order by doctor_key', [inv]));
  const hb = await bal('DOC-H'), nb = await bal('EMP-N');
  const H = await hx('HX-1', 500, [{ doctor_key: 'EMP-N' }]);
  assert.equal(await earned(H), 150, 'primary doctor: 30% of the visit'); assert.deepEqual(await ex(H), [{ doctor_key: 'EMP-N', e: 100, basis: 'performed' }], 'nurse: fixed 100 on the SAME invoice');
  assert.equal(await bal('DOC-H') - hb, 150); assert.equal(await bal('EMP-N') - nb, 100, 'each balance is by doctor_key');
  assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_accruals where invoice_id=$1', [H]))[0].n, 2, 'two accrual events on one invoice');
  await refund(H, 250); assert.equal(await earned(H), 75); assert.deepEqual((await ex(H))[0].e, 50, 'refund shrinks both');
  // replay with the same token does not duplicate
  const tkx = key(), pl2 = { reference: 'HX-IDEM', service_amount: 500, doctor_key: 'DOC-H', service_lines: [lbl('HV', 500)], extra_performers: [{ doctor_key: 'EMP-N' }] };
  const h1 = await bill(2, pl2, tkx), h2 = await bill(2, pl2, tkx); assert.equal(h1, h2); assert.equal((await ex(h1)).length, 1); assert.equal((await ex(h1))[0].e, 100);
  // statement of the nurse lists the invoice with her fee
  await as(2); const sn = await call('clinic_finance_doctor_statement', ['EMP-N', shift(-5), shift(5)]); await db.exec('reset role');
  assert.equal(sn.invoices.find(x => x.reference === 'HX-1').fee, 50, 'nurse statement: fee of the shared invoice');
  // a nurse with a PERCENT contract (20%) on another service: she earns only on the lines she has a contract for; the primary needs a contract for EVERY line
  await approve(await cmd(2, 'contract', base('EMP-20', 'EXT', { rate: 20 })));
  await assert.rejects(() => hx('HX-2', 1000, [{ doctor_key: 'EMP-20' }], [lbl('HV', 500), lbl('EXT', 500)]), /لا يوجد عقد معتمد للطبيب DOC-H للخدمة EXT/, 'primary doctor without a contract for a line is refused (unchanged rule)');
  await mkp('DOC-H', 'EXT', 30);
  const H2 = await hx('HX-2', 1000, [{ doctor_key: 'EMP-20' }], [lbl('HV', 500), lbl('EXT', 500)]);
  assert.equal(await earned(H2), 300); assert.deepEqual(await ex(H2), [{ doctor_key: 'EMP-20', e: 100, basis: 'performed' }], '20% of the EXT line only (no contract for HV)');
  // two extras
  const H3 = await hx('HX-3', 500, [{ doctor_key: 'EMP-N' }, { doctor_key: 'EMP-C' }]); assert.deepEqual((await ex(H3)).map(x => [x.doctor_key, x.e, x.basis]), [['EMP-C', 0, 'collected'], ['EMP-N', 100, 'performed']], 'a collected-basis extra waits for the money');
  await pay_(H3, 500); assert.deepEqual((await ex(H3)).map(x => x.e), [100, 100], 'after full payment both earn');
  // refused cases leave nothing behind
  const n2 = await invCount(), ac = async () => (await owner('select count(*)::int n from clinic_finance.doctor_extra_allocations'))[0].n, e0 = await ac();
  await assert.rejects(() => hx('HX-E1', 500, [{ doctor_key: 'NOBODY' }]), /لا يوجد عقد معتمد للمشارك NOBODY/);
  await assert.rejects(() => hx('HX-E2', 500, [{ doctor_key: 'DOC-H' }]), /الطبيب الأساسي نفسه/);
  await assert.rejects(() => hx('HX-E3', 500, [{ doctor_key: 'EMP-N' }, { doctor_key: 'EMP-N' }]), /مكرر/);
  await assert.rejects(() => hx('HX-E4', 500, [{ doctor_key: 'A1' }, { doctor_key: 'A2' }, { doctor_key: 'A3' }, { doctor_key: 'A4' }]), /من 1 إلى 3/);
  await assert.rejects(() => hx('HX-E5', 500, []), /من 1 إلى 3/);
  await assert.rejects(() => hx('HX-E6', 500, [{ doctor_key: 'x' }]), /حدد كود المشارك/);
  await assert.rejects(() => bill(2, { reference: 'HX-E7', service_amount: 500, doctor_contract_id: single50, extra_performers: [{ doctor_key: 'EMP-N' }] }), /service_lines/);
  assert.equal(await invCount(), n2, 'rejected extra-performer bills leave no invoice'); assert.equal(await ac(), e0);
  await as(4); await assert.rejects(() => fin('bill', [{ reference: 'HX-E8', patient_ref: 'T', description: 'x', items: [], service_amount: 500, doctor_key: 'DOC-H', service_lines: [lbl('HV', 500)], extra_performers: [{ doctor_key: 'EMP-N' }] }, key()]), /صلاحية/, 'permissions unchanged'); await db.exec('reset role');
  // a channel invoice cannot take extras
  await assert.rejects(() => bill(2, { reference: 'HX-E9', service_amount: 600, channel_id: vez, consultation_gross: 100, services_gross: 500, doctor_key: 'DOC-H', service_lines: [{ code: 'HV', amount: 600, kind: 'consultation' }], extra_performers: [{ doctor_key: 'EMP-N' }] }), /قناة|مجموع سطور الكشف/);
  // payout cap sees the extras: a fully paid invoice is payable, an unpaid one is held (only if phase 2 is loaded)
  if (payout2) {
    const heldN = Number((await owner("select clinic_finance.doctor_held_fees('EMP-N') h"))[0].h);
    assert.equal(heldN, Number((await owner("select coalesce(sum(a.earned),0) h from clinic_finance.doctor_allocations a where a.doctor_key='EMP-N' and a.earned>0 and not clinic_finance.invoice_fully_paid(a.invoice_id)"))[0].h) + Number((await owner("select coalesce(sum(x.earned),0) h from clinic_finance.doctor_extra_allocations x where x.doctor_key='EMP-N' and x.earned>0 and not clinic_finance.invoice_fully_paid(x.invoice_id)"))[0].h), 'held fees include extras');
    assert(heldN > 0, 'EMP-N has unpaid shared invoices -> held');
  }

  // ---- ROLLBACK
  const rb = () => fs.readFileSync('supabase/rollbacks/20261108270000_doctor_fixed_fee.rollback.sql', 'utf8');
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(rb()); }, /بمبلغ ثابت|مشاركون/, 'rollback refused while fixed contracts / extra performers exist'); await db.exec('rollback');
  // rehearsal on a clone made BEFORE the migration: apply, use percent only, roll back -> byte-identical functions and no new objects
  const db2 = await PGlite.create({ loadDataDir: pre }); const o2 = async (q, a = []) => (await db2.query(q, a)).rows;
  const fn2 = async sig => (await o2("select pg_get_functiondef($1::regprocedure) d, coalesce(proacl::text,'') acl from pg_proc where oid=$1::regprocedure", [sig]))[0];
  await db2.exec(fmig());
  await db2.exec(rb());
  for (const s of SIG3) { const x = await fn2(s); assert.equal(x.d, defBefore[s].d, 'rollback restores byte-for-byte: ' + s); assert.equal(x.acl, defBefore[s].acl, 'and its privileges: ' + s); }
  assert.equal((await o2("select count(*)::int n from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name in ('fee_kind','fixed_amount')"))[0].n, 0);
  assert.equal((await o2("select count(*)::int n from pg_class where relname like 'doctor_extra%'"))[0].n, 0);
  await db2.exec(fmig()); await db2.exec(rb()); await db2.exec(fmig());   // re-apply after rollback works
  await db2.close();
  console.log('PASS doctor fixed fee SQL: percent parity, fixed per service line (refund/void/collected/mixed/no-lines), validation, contract_revise, overlap, statement, extra performers (doctor + nurse on one invoice), guards, byte-identical rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
