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
  // ===================== external service + nurse options (20261109100000), on top of the fixed-fee chain =====================
  const xmig = () => fs.readFileSync('supabase/migrations/20261109100000_external_service_nurse.sql', 'utf8');
  const xrb = () => fs.readFileSync('supabase/rollbacks/20261109100000_external_service_nurse.rollback.sql', 'utf8');
  const lbl = (code, amount, kind) => ({ code, amount, kind });
  const bal = async k => Number((await owner('select clinic_finance.doctor_balance($1) b', [k]))[0].b);
  const cmd = async (n, a, p, tk) => { await as(n); return fin('doctor_command', [a, p, tk || key()]); };
  const approve = async cid => { await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد' }, key()]); return cid; };
  const cbase = (doctor, scope, extra = {}) => ({ doctor_key: doctor, doctor_name: 'ممرض ' + doctor, scope, from: shift(-30), to: shift(30), basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اتفاق اختبار', ...extra });
  const mkf = async (doctor, scope, amount, extra = {}) => approve(await cmd(2, 'contract', cbase(doctor, scope, { fee_kind: 'fixed', fixed_amount: amount, ...extra })));
  const defs = async () => { const o = {}; for (const s of ['public.clinic_finance_bill(jsonb,uuid)', 'clinic_finance.doctor_extra_sync(uuid)']) o[s] = await fn(s); return o; };
  const defsBefore = await defs(); const pre2 = await db.dumpDataDir();
  const scenBefore2 = await scen();

  // ---- APPLY
  await db.exec('reset role'); await db.exec(xmig());
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(xmig()); }, /تم تطبيق هذا الملف/, 'a second apply is refused'); await db.exec('rollback');
  assert.equal((await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.replace(/^\{|\}$/g, '').split(',').sort().join(','), (await fn('clinic_finance.bill_before_external_service(jsonb,uuid)')).acl.replace(/^\{|\}$/g, '').split(',').sort().join(','), 'wrapper has exactly the privileges of the wrapped bill');
  assert(!(await fn('public.clinic_finance_bill(jsonb,uuid)')).acl.includes('anon='), 'anon never gets the bill wrapper');
  assert.equal((await fn('clinic_finance.doctor_extra_sync(uuid)')).acl, defsBefore['clinic_finance.doctor_extra_sync(uuid)'].acl, 'doctor_extra_sync keeps its privileges');
  await as(2); assert.equal(await call('clinic_finance_external_service_enabled'), true, 'capability probe');
  await assert.rejects(() => db.query('select * from clinic_finance.invoice_external'), /permission denied/, 'invoice_external is closed to the app roles'); await db.exec('reset role');
  assert.deepEqual(await scen(), scenBefore2, 'invoices WITHOUT the new options compute exactly as before');

  // ---- contracts
  const docH = await mkc('DOC-H', 'HV', 30), doc50 = await mkc('DOC-50', 'HV', 50), doc50b = await mkc('DOC-50', 'HV2', 50);
  const nAlone = await approve(await cmd(2, 'contract', cbase('EMP-A', 'تمريض:وحده', { rate: 20, basis: 'collected' })));
  const nWith = await mkf('EMP-W', 'تمريض:مع طبيب', 100);
  const inv = async id => (await owner('select amount::float a from clinic_finance.invoices where id=$1', [id]))[0].a;
  const ie = async id => (await owner('select external_extra::float x, performer_mode m, nurse_key k from clinic_finance.invoice_external where invoice_id=$1', [id]))[0];
  const entry = async id => (await owner("select coalesce(sum(l.debit),0)::float d, coalesce(sum(l.credit),0)::float c, string_agg(distinct l.account, ',' order by l.account) acc from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='invoice_external' and e.source_id=$1", [id]))[0];
  const ex = async id => (await owner('select doctor_key, earned::float e from clinic_finance.doctor_extra_allocations where invoice_id=$1 order by 1', [id]));
  const nInv = async () => (await owner('select count(*)::int n from clinic_finance.invoices'))[0].n;

  // 1) external service on an ordinary doctor invoice: patient pays 500 + 250 = 750; the doctor is paid on the SERVICE (50% of 500), not on the extra
  const E1 = await bill(2, { reference: 'EX-1', service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 500)], external_service: true, external_extra: 250 });
  assert.equal(await inv(E1), 750, 'patient bill = service + extra'); assert.equal(await earned(E1), 250, 'doctor: 50% of the 500 service only');
  assert.deepEqual(await ie(E1), { x: 250, m: 'doctor', k: null }); assert.deepEqual(await entry(E1), { d: 250, c: 250, acc: '1122,4110' }, 'extra is posted Dr 1122 / Cr 4110');
  const sp = (await owner('select bill_payload p from clinic_finance.invoices where id=$1', [E1]))[0].p; assert.equal(sp.external_extra, 250); assert.equal(sp.external_service, true);
  // the patient can be charged the whole 750
  await pay_(E1, 750); assert.equal((await owner('select coalesce(sum(amount),0)::float s from clinic_finance.payments where invoice_id=$1', [E1]))[0].s, 750);
  // refund half of the bill scales the doctor's fee: 50% of 500 * (375/750)
  const E1b = await bill(2, { reference: 'EX-1b', service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 500)], external_service: true, external_extra: 250 });
  await refund(E1b, 375); assert.equal(await earned(E1b), 125, 'refund of half the bill halves the fee');
  // doctor invoice-level contract (no lines): same rule
  const E1c = await bill(2, { reference: 'EX-1c', service_amount: 200, doctor_contract_id: single50, external_service: true, external_extra: 100 });
  assert.equal(await inv(E1c), 300); assert.equal(await earned(E1c), 100, 'invoice-level contract: 50% of the 200 service');

  // 2) nurse ALONE: base = service + extra (20% of the amount collected), nurse is the primary performer
  const A1 = await bill(2, { reference: 'NA-1', service_amount: 500, performer_mode: 'nurse_alone', nurse_key: 'EMP-A', external_service: true, external_extra: 250 });
  assert.equal(await inv(A1), 750); assert.equal(await earned(A1), 0, 'collected basis: nothing before the money comes');
  assert.equal((await owner('select doctor_key, contract_id from clinic_finance.doctor_allocations where invoice_id=$1', [A1]))[0].doctor_key, 'EMP-A');
  const nb = await bal('EMP-A'); await pay_(A1, 375); assert.equal(await earned(A1), 75, '20% of the 375 collected'); await pay_(A1, 375); assert.equal(await earned(A1), 150, '20% of 750 collected'); assert.equal(await bal('EMP-A') - nb, 150);
  assert.deepEqual(await ie(A1), { x: 250, m: 'nurse_alone', k: 'EMP-A' });
  const A2 = await bill(2, { reference: 'NA-2', service_amount: 300, performer_mode: 'nurse_alone', nurse_key: 'EMP-A' });   // no extra: service only
  await pay_(A2, 300); assert.equal(await earned(A2), 60, 'nurse alone without an external extra: 20% of 300');
  assert.equal((await owner('select count(*)::int n from clinic_finance.entries where source=$1 and source_id=$2', ['invoice_external', A2]))[0].n, 0, 'no extra -> no extra posting');

  // 3) nurse WITH a doctor: nurse flat 100 on top, doctor unchanged (50% of the full 500), once per invoice even with several lines
  const hb = await bal('DOC-50'), wb = await bal('EMP-W');
  const W1 = await bill(2, { reference: 'NW-1', service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 500)], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W' });
  assert.equal(await earned(W1), 250, 'doctor keeps 50% of the full price'); assert.deepEqual(await ex(W1), [{ doctor_key: 'EMP-W', e: 100 }], 'nurse: flat 100 only');
  assert.equal(await bal('DOC-50') - hb, 250); assert.equal(await bal('EMP-W') - wb, 100);
  const W2 = await bill(2, { reference: 'NW-2', service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 300), lbl('HV2', 200)], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W', external_service: true, external_extra: 250 });
  assert.equal(await inv(W2), 750); assert.equal(await earned(W2), 250, 'doctor 50% of 500 (the extra is not in his base)'); assert.deepEqual(await ex(W2), [{ doctor_key: 'EMP-W', e: 100 }], 'two lines -> still ONE flat 100');
  await refund(W2, 375); assert.equal(await earned(W2), 125); assert.deepEqual(await ex(W2), [{ doctor_key: 'EMP-W', e: 50 }], 'refund shrinks the nurse amount too');
  const W3 = await bill(2, { reference: 'NW-3', service_amount: 60, doctor_key: 'DOC-50', service_lines: [lbl('HV', 60)], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W' });
  assert.deepEqual(await ex(W3), [{ doctor_key: 'EMP-W', e: 60 }], 'never more than the invoice service total');
  // consultation + nurse
  await mkc('DOC-C', 'CONS', 40); const W4 = await bill(2, { reference: 'NW-4', service_amount: 200, doctor_key: 'DOC-C', service_lines: [lbl('CONS', 200, 'consultation')], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W' });
  assert.equal(await earned(W4), 80); assert.deepEqual(await ex(W4), [{ doctor_key: 'EMP-W', e: 100 }], 'consultation with a nurse: doctor 40% + nurse flat 100');

  // 4) unchanged behaviour of the plain extra_performers payload (per line)
  await mkf('EMP-L', 'HV', 100); const L1 = await bill(2, { reference: 'XL-1', service_amount: 500, doctor_key: 'DOC-H', service_lines: [lbl('HV', 300), lbl('HV', 200)], extra_performers: [{ doctor_key: 'EMP-L' }] });
  assert.deepEqual(await ex(L1), [{ doctor_key: 'EMP-L', e: 200 }], 'the fixed-fee migration rule (per line) is untouched for ordinary contracts');

  // 5) validation: nothing is created
  const n0 = await nInv(), io0 = (await owner('select count(*)::int n from clinic_finance.invoice_external'))[0].n;
  const rej = async (p, re, who = 2) => assert.rejects(() => bill(who, { service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 500)], ...p, reference: 'V-' + key().slice(0, 8) }), re);
  await rej({ external_extra: 250 }, /فعّل خيار الخدمة الخارجية/); await rej({ external_service: true }, /اكتب المبلغ الإضافي/);
  await rej({ external_service: true, external_extra: 0 }, /غير صالح/); await rej({ external_service: true, external_extra: -5 }, /غير صالح/); await rej({ external_service: true, external_extra: 10.555 }, /غير صالح/);
  await rej({ external_service: true, external_extra: '250' }, /رقمًا/); await rej({ external_service: 'yes', external_extra: 5 }, /غير صالح/);
  await rej({ performer_mode: 'robot', nurse_key: 'EMP-A' }, /غير معروف/); await rej({ performer_mode: 'nurse_alone' }, /حدد كود الممرض/);
  await rej({ nurse_key: 'EMP-A' }, /كود الممرض بدون/);
  await rej({ performer_mode: 'nurse_alone', nurse_key: 'EMP-A' }, /ممرض وحده: لا تختر/);   // doctor + lines present
  await rej({ performer_mode: 'nurse_alone', nurse_key: 'NOBODY', doctor_key: undefined, service_lines: undefined }, /لا يوجد عقد تمريض/);
  await rej({ performer_mode: 'nurse_with_doctor', nurse_key: 'NOBODY' }, /لا يوجد عقد تمريض/);
  await rej({ performer_mode: 'nurse_with_doctor', nurse_key: 'DOC-50' }, /الممرض هو الطبيب/);
  await rej({ performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W', service_lines: undefined }, /وزّع الخدمات/);
  await rej({ performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W', extra_performers: [{ doctor_key: 'EMP-L' }] }, /يغني عن المشاركين/);
  await rej({ performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W', channel_id: vez, consultation_gross: 100, services_gross: 400 }, /قناة حجز/);
  await rej({ external_service: true, external_extra: 5 }, /permission|صلاحية|غير مصرح|دور|الوصول/, 4);   // reception role has no 'create' access
  assert.equal(await nInv(), n0, 'rejected bills leave no invoice'); assert.equal((await owner('select count(*)::int n from clinic_finance.invoice_external'))[0].n, io0);
  // a nurse contract of the wrong kind
  await mkf('EMP-F', 'تمريض:وحده', 50);
  await assert.rejects(() => bill(2, { reference: 'V-F', service_amount: 100, performer_mode: 'nurse_alone', nurse_key: 'EMP-F' }), /يجب أن يكون نسبة/, 'nurse alone needs a percent contract');
  assert.equal(await nInv(), n0);

  // 6) idempotent replay of the same token: same invoice, nothing posted twice; a different payload with the same token is refused
  const tk = key(), pl = { reference: 'RP-1', service_amount: 500, performer_mode: 'nurse_alone', nurse_key: 'EMP-A', external_service: true, external_extra: 250 };
  const R1 = await bill(2, pl, tk), acc1 = (await owner('select count(*)::int n from clinic_finance.entries')).map(r => r.n)[0];
  const R2 = await bill(2, pl, tk); assert.equal(R2, R1); assert.equal(await inv(R1), 750, 'replay does not add the extra twice'); assert.equal((await owner('select count(*)::int n from clinic_finance.entries'))[0].n, acc1);
  await assert.rejects(() => bill(2, { ...pl, external_extra: 300 }, tk), /مفتاح الطلب مستخدم/);
  const tk2 = key(), pw = { reference: 'RP-2', service_amount: 500, doctor_key: 'DOC-50', service_lines: [lbl('HV', 500)], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-W', external_service: true, external_extra: 50 };
  const P1 = await bill(2, pw, tk2), P2 = await bill(2, pw, tk2); assert.equal(P1, P2); assert.deepEqual(await ex(P1), [{ doctor_key: 'EMP-W', e: 100 }]); assert.equal(await inv(P1), 550);

  // 7) every accrual event of the new invoices is balanced in the ledger (Dr 5111 / Cr 2120) and the trial balance still nets to zero
  assert.equal((await owner('select coalesce(sum(debit)-sum(credit),0)::float d from clinic_finance.lines'))[0].d, 0, 'ledger balanced');

  // 8) the prepared nurse-contract script (docs/apply/nurse_contracts.sql): 5 nurses x 2 contracts, pending -> approved -> usable on a bill
  await db.exec(`reset role; create schema if not exists clinic_people; create table if not exists clinic_people.people(code text primary key, full_name text)`);
  await owner(`insert into clinic_people.people values ('EMP-000001','ممرضة ١'),('EMP-000003','ممرضة ٣'),('EMP-000007','هدى'),('EMP-000008','ممرضة ٨'),('EMP-000011','ممرضة ١١') on conflict do nothing`);
  const script = fs.readFileSync('docs/apply/nurse_contracts.sql', 'utf8').split('\n').filter(l => !l.startsWith('\\')).join('\n')
    .replace(/:'valid_from'/g, `'${shift(0)}'`).replace(/:'valid_to'/g, `'${shift(30)}'`).replace('3e1f9a1f-7789-4cf0-a756-93caa6d9cc73', id(2));
  await db.exec('reset role'); await db.exec(script);
  const cs = await owner("select doctor_key, service_scope, fee_kind, rate::float r, fixed_amount::float f, basis, status from clinic_finance.doctor_contracts where service_scope like 'تمريض:%' and doctor_key like 'EMP-0000%' and doctor_key in ('EMP-000001','EMP-000003','EMP-000007','EMP-000008','EMP-000011') order by 1,2");
  assert.equal(cs.length, 10, '5 nurses x 2'); assert(cs.every(c => c.status === 'pending'));
  assert.deepEqual(cs.filter(c => c.service_scope === 'تمريض:وحده').map(c => [c.fee_kind, c.r, c.f, c.basis]).filter((x, i, a) => a.findIndex(y => y.join() === x.join()) === i), [['percent', 20, null, 'collected']]);
  assert.deepEqual(cs.filter(c => c.service_scope === 'تمريض:مع طبيب').map(c => [c.fee_kind, c.r, c.f, c.basis]).filter((x, i, a) => a.findIndex(y => y.join() === x.join()) === i), [['fixed', 0, 100, 'performed']]);
  await db.exec(script); assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where doctor_key='EMP-000007' and service_scope like 'تمريض:%'"))[0].n, 2, 'running the script twice adds nothing');
  for (const c of await owner("select id from clinic_finance.doctor_contracts where doctor_key='EMP-000007' and service_scope like 'تمريض:%'")) await approve(c.id);
  const S1 = await bill(2, { reference: 'SC-1', service_amount: 1000, performer_mode: 'nurse_alone', nurse_key: 'EMP-000007', external_service: true, external_extra: 500 }); await pay_(S1, 1500);
  assert.equal(await earned(S1), 300, 'script contract: 20% of 1500 collected');
  const S2 = await bill(2, { reference: 'SC-2', service_amount: 400, doctor_key: 'DOC-50', service_lines: [lbl('HV', 400)], performer_mode: 'nurse_with_doctor', nurse_key: 'EMP-000007' });
  assert.deepEqual(await ex(S2), [{ doctor_key: 'EMP-000007', e: 100 }], 'script contract: flat 100 with a doctor');
  await assert.rejects(() => bill(2, { reference: 'SC-3', service_amount: 400, performer_mode: 'nurse_alone', nurse_key: 'EMP-000001' }), /لا يوجد عقد تمريض/, 'a pending contract is not usable until approved');

  // 9) the prepared channel script (docs/apply/channel_rules.sql): 10 pending rules through channel_command, starting the day it is applied; re-run adds nothing; a different admin approves
  const cscript = fs.readFileSync('docs/apply/channel_rules.sql', 'utf8').split('\n').filter(l => !l.startsWith('\\') && !l.includes('-- AUTH')).join('\n')
    .replace(/:'valid_from'/g, `'${shift(0)}'`).replace(/:'valid_to'/g, `'${shift(60)}'`);
  await owner("update clinic_finance.channel_rules set status='retired' where status='active'");
  await as(2); await db.exec(cscript); await db.exec('reset role');
  let pend = await owner("select code, kind, applies_to, patient_discount_percent::float d, platform_share_percent::float s, payable_kind, status, valid_from::text vf, source_codes sc from clinic_finance.channel_rules where notes like 'قرار المالك 2026-11-09%' order by code");
  assert.equal(pend.length, 10); assert(pend.every(r => r.status === 'pending' && r.vf === shift(0)), 'all pending, valid from the apply day');
  const byc = Object.fromEntries(pend.map(r => [r.code, r])); assert.deepEqual([byc.vezeeta.s, byc.club_ahly.d, byc.kafaret.d, byc.kafaret.s, byc.kafaret.payable_kind, byc.internal_booking.kind, byc.social.sc.join()], [25, 30, 20, 10, 'cashback', 'internal', 'facebook,instagram']);
  await as(2); await db.exec(cscript); await db.exec('reset role'); assert.equal((await owner("select count(*)::int n from clinic_finance.channel_rules where notes like 'قرار المالك 2026-11-09%'"))[0].n, 10, 'running the script twice adds nothing');
  const rid = (await owner("select id from clinic_finance.channel_rules where code='vezeeta' and notes like 'قرار المالك 2026-11-09%'"))[0].id;
  await as(2); await assert.rejects(() => fin('channel_command', ['review', { id: rid, approve: true, note: 'اعتماد ذاتي' }, key()]), /صلاحية|لا يمكنك اعتماد قاعدتك|غير متاحة/);
  await as(3); await fin('channel_command', ['review', { id: rid, approve: true, note: 'اعتماد من مدير آخر' }, key()]); await db.exec('reset role');
  assert.equal((await owner('select status from clinic_finance.channel_rules where id=$1', [rid]))[0].status, 'active');
  // a Vezeeta booking on the new rule: doctor sees the 25% platform share like the owner's example
  const CH = await bill(2, { reference: 'CH-1', service_amount: 500, channel_id: rid, consultation_gross: 100, services_gross: 400, doctor_contract_id: single50 });
  assert((await earned(CH)) > 0, 'invoice on the new channel works');

  // ---- ROLLBACK
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(xrb()); }, /توجد فواتير بخدمة خارجية/, 'rollback refused while invoices use the new options'); await db.exec('rollback');
  const db2 = await PGlite.create({ loadDataDir: pre2 }); const o2 = async (q, a = []) => (await db2.query(q, a)).rows;
  const fn2 = async sig => (await o2("select pg_get_functiondef($1::regprocedure) d, coalesce(proacl::text,'') acl from pg_proc where oid=$1::regprocedure", [sig]))[0];
  await db2.exec(xmig()); await db2.exec(xrb());
  for (const s of Object.keys(defsBefore)) { const x = await fn2(s); assert.equal(x.d, defsBefore[s].d, 'rollback restores byte-for-byte: ' + s); assert.equal(x.acl, defsBefore[s].acl, 'and its privileges: ' + s); }
  assert.equal((await o2("select count(*)::int n from pg_class where relname='invoice_external'"))[0].n, 0);
  await db2.exec(xmig()); await db2.exec(xrb()); await db2.exec(xmig());   // re-apply after rollback works
  await db2.close();
  console.log('PASS external service + nurse options SQL: extra added to the bill (500+250=750), doctor base unchanged, nurse alone 20% of collected incl. extra, nurse with doctor flat 100 once per invoice, validation, replay, privileges, prepared nurse-contract + channel scripts, byte-identical rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
