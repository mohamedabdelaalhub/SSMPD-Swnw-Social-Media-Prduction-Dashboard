// Department-scope doctor contracts: SQL rehearsal on PGlite with the REAL finance migrations (cash control, stock/insurance, doctor settlements, supplier finance, channels) + reception stubs.
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

  // ---- reception stubs (the slice cannot load the whole reception schema): only what sync_doctor_contract and the department list touch
  await db.exec(`create schema clinic_reception;
    create function clinic_reception.today() returns date language sql as $$ select (now() at time zone 'Africa/Cairo')::date $$;
    create table clinic_reception.services(workspace_id uuid, code text, department text, active boolean default true);
    create table clinic_reception.providers(workspace_id uuid, id uuid primary key, doctor_key text, department text);
    create table clinic_reception.orders(workspace_id uuid, id uuid primary key, provider_id uuid, snapshot jsonb);
    create table clinic_reception.doctor_agreements(workspace_id uuid, provider_id uuid, service_code text, rate numeric, deduct_material_cost boolean, valid_from date, valid_to date, reference text, status text, created_by uuid, reviewed_by uuid, finance_contract_id uuid);
    create table public.pricing_services(id uuid default gen_random_uuid(), name text, booking_code text, booking_department text, category text, active boolean default true);`);
  // the ORIGINAL production text of the two functions the migration re-creates (verbatim from their migrations)
  const canon = mig('20261017130324_reception_canonical_catalog.sql'), a0 = canon.indexOf('create function clinic_reception.sync_doctor_contract(');
  await db.exec(canon.slice(a0, canon.indexOf('\nend $$;', a0) + 8));
  await db.exec(mig('20261018005957_pricing_doctor_contract_lookup.sql'));
  const W = id(900), P_B = id(901), P_C = id(902);
  await owner(`insert into clinic_reception.services(workspace_id, code, department) values ($1,'D-1','الاسنان'),($1,'D-2','الاسنان'),($1,'L-1','التحاليل'),($1,'E-1','الطوارئ'),($1,'S-1','الجلدية')`, [W]);
  await owner(`insert into public.pricing_services(category) values ('الاسنان'),('التحاليل'),('الطوارئ'),('الجلدية'),('')`);
  await owner(`insert into clinic_reception.providers values ($1,$2,'DOC-B','الاسنان'),($1,$3,'DOC-C','الاسنان')`, [W, P_B, P_C]);
  const def = async sig => (await owner("select pg_get_functiondef($1::regprocedure) d", [sig]))[0].d;
  const SIGS = ['clinic_reception.sync_doctor_contract(uuid,uuid,uuid)', 'public.pricing_doctor_contracts()', 'public.clinic_finance_doctor_command(text,jsonb,uuid)'];
  const before = {}; for (const s of SIGS) before[s] = await def(s);

  // NOTE on md5s: this test loads only a PARTIAL migration chain (the finance slice + channels), so md5 of public.clinic_finance_doctor_command here is NOT the production md5
  // (production's copy is also patched by 20261017015715). sync_doctor_contract and pricing_doctor_contracts are loaded verbatim from their own migrations, so their md5s
  // (9940a1df7a26af0005b3dd3b9ab96348 / 2d64788544ad0c556ed070853df21d09) are the ones the migration guard asserts against production.
  if (process.env.PRINT_MD5) for (const s of SIGS) console.log('md5', crypto.createHash('md5').update(before[s]).digest('hex'), s);

  // ---- exact-service contracts keep working exactly as before the migration
  const mkc = async (doctor, scope, rate, extra = {}, approve = true, creator = 2) => {
    await as(creator);
    const cid = await fin('doctor_command', ['contract', { doctor_key: doctor, doctor_name: 'طبيب ' + doctor, scope, from: shift(-30), to: shift(30), rate, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اختبار', ...extra }, key()]);
    if (approve) { await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد اختبار' }, key()]); }
    return cid;
  };
  const exactA = await mkc('DOC-A', 'D-1', 50);
  const rows = async (doctor, code, dep) => (await owner('select id, service_scope, rate from clinic_finance.doctor_contract_for_service($1,$2,null,$3,clinic_reception.today())', [doctor, code, dep]));

  // ---- APPLY
  await db.exec('reset role'); await db.exec(mig('20261108230000_department_contracts.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261108230000_department_contracts.sql')); }, /تم تطبيق هذا الملف/, 'a second apply is refused by the guard'); await db.exec('rollback');
  assert.equal((await rows('DOC-A', 'D-1', 'الاسنان')).length, 1, 'exact contract still resolves');
  assert.equal((await rows('DOC-A', 'D-2', 'الاسنان')).length, 0, 'an exact contract for D-1 does not cover D-2');

  // ---- creation: format, existing department, maker-checker, idempotency (labs/radiology/emergency are ordinary departments: no special guard)
  await as(2);
  await assert.rejects(() => fin('doctor_command', ['contract', { doctor_key: 'DOC-B', doctor_name: 'طبيب ب', scope: 'قسم: الاسنان', from: shift(-30), to: shift(30), rate: 40, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'مرجع' }, key()]), /صيغة نطاق القسم/);
  await assert.rejects(() => mkc('DOC-B', 'قسم:غير موجود', 40), /غير موجود/);
  await as(4); await assert.rejects(() => fin('doctor_command', ['contract', { doctor_key: 'DOC-B', doctor_name: 'طبيب ب', scope: 'قسم:الاسنان', from: shift(-30), to: shift(30), rate: 40, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'x', reference: 'مرجع' }, key()]), /صلاحية/);
  const deptB = await mkc('DOC-B', 'قسم:الاسنان', 40);
  const tk = key(); await as(2);
  const pay = { doctor_key: 'DOC-B2', doctor_name: 'طبيب ب٢', scope: 'قسم:الجلدية', from: shift(-30), to: shift(30), rate: 35, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'مرجع' };
  const p1 = await fin('doctor_command', ['contract', pay, tk]); assert.equal(await fin('doctor_command', ['contract', pay, tk]), p1, 'same token returns the same contract');
  await as(3); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: deptB, approve: true, note: 'مرة أخرى' }, key()]), /غير متاح/, 'an already approved contract cannot be approved twice');
  await as(2); const pend = await mkc('DOC-D', 'قسم:الاسنان', 30, {}, false);
  await as(2); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: pend, approve: true, note: 'اعتماد من المنشئ' }, key()]), /صلاحية|اعتماد عقدك/, 'maker-checker unchanged');
  // overlap: same doctor + same department + overlapping dates cannot both be active; another department or non-overlapping dates can
  const dup = await mkc('DOC-B', 'قسم:الاسنان', 45, {}, false);
  await as(3); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: dup, approve: true, note: 'اعتماد' }, key()]), /تتداخل/);
  const other = await mkc('DOC-B', 'قسم:الجلدية', 45); assert(other);
  const lab = await mkc('DOC-L', 'قسم:التحاليل', 10); assert(lab);
  assert.equal((await rows('DOC-L', 'L-1', 'التحاليل')).length, 1, 'a lab department contract is an ordinary department contract');
  const emg = await mkc('DOC-M', 'قسم:الطوارئ', 20); assert(emg);
  assert.equal((await rows('DOC-M', 'E-1', 'الطوارئ')).length, 1, 'same for emergency');
  assert.equal((await rows('DOC-L', 'E-1', 'الطوارئ')).length, 0, 'a lab contract does not cover emergency');

  // ---- resolution + precedence
  const exactC = await mkc('DOC-C', 'D-1', 30), deptC = await mkc('DOC-C', 'قسم:الاسنان', 60);
  const rC1 = await rows('DOC-C', 'D-1', 'الاسنان'), rC2 = await rows('DOC-C', 'D-2', 'الاسنان');
  assert.deepEqual(rC1.map(r => r.id), [exactC], 'exact service contract wins over the department contract');
  assert.deepEqual(rC2.map(r => r.id), [deptC], 'other services of the department use the department contract');
  assert.equal((await rows('DOC-B', 'D-2', 'الاسنان')).length, 1);
  assert.equal((await rows('DOC-B', 'L-1', 'التحاليل')).length, 0, 'dental department contract never covers labs');
  assert.equal((await rows('DOC-B', 'E-1', 'الطوارئ')).length, 0, 'dental department contract never covers emergency');
  assert.equal((await rows('DOC-B', 'S-1', 'الجلدية')).length, 1, 'DOC-B has its own dermatology contract');
  assert.equal((await rows('DOC-B', 'D-2', null)).length, 0, 'unknown department -> nothing');

  // ---- reception execution (sync_doctor_contract) uses the same precedence
  const O1 = id(910), O2 = id(911), O3 = id(912), O4 = id(913);
  await owner(`insert into clinic_reception.orders values ($1,$2,$3,'{"code":"D-2"}'),($1,$4,$3,'{"code":"E-1"}'),($1,$5,$6,'{"code":"D-1"}'),($1,$7,$6,'{"code":"D-2"}')`, [W, O1, P_B, O2, O3, P_C, O4]);
  await owner('select clinic_reception.sync_doctor_contract($1,$2,$3)', [W, O1, P_B]);
  await owner('select clinic_reception.sync_doctor_contract($1,$2,$3)', [W, O3, P_C]);
  await owner('select clinic_reception.sync_doctor_contract($1,$2,$3)', [W, O4, P_C]);
  const ag = await owner("select service_code, rate::float r, finance_contract_id from clinic_reception.doctor_agreements where status='active' order by provider_id, service_code");
  assert.deepEqual(ag.map(x => [x.service_code, x.r, x.finance_contract_id]), [['D-2', 40, deptB], ['D-1', 30, exactC], ['D-2', 60, deptC]]);
  await assert.rejects(() => owner('select clinic_reception.sync_doctor_contract($1,$2,$3)', [W, O2, P_B]), /حدد عقدًا واحدًا/, 'no contract covers the emergency service');

  // ---- listing for the pickers
  await as(2);
  const list = await call('pricing_doctor_contracts');
  const d = list.find(c => c.id === deptB); assert.equal(d.scope_kind, 'department'); assert.equal(d.department, 'الاسنان');
  assert.equal(list.find(c => c.id === exactA).scope_kind, 'service'); assert.equal(list.find(c => c.id === exactA).department, null);
  const deps = await fin('contract_departments');
  assert.deepEqual(deps.map(x => x.name), ['الاسنان', 'التحاليل', 'الجلدية', 'الطوارئ']);
  assert(deps.every(x => Object.keys(x).join() === 'name'), 'the department list carries only names (no restricted flag)');
  await as(4); await assert.rejects(() => fin('contract_departments'), /صلاحية/);

  // ---- service list for the multi-select
  await owner(`insert into public.pricing_services(name, booking_code, booking_department, category) values ('حشو','D-1','الاسنان','الاسنان'),('خلع','D-2',null,'الاسنان'),('بدون كود',null,null,'الاسنان')`);
  await as(2); const svc = await fin('contract_services');
  assert.deepEqual(svc.map(x => [x.code, x.name, x.department]), [['D-2', 'خلع', 'الاسنان'], ['D-1', 'حشو', 'الاسنان']].sort((a, b) => a[1] < b[1] ? -1 : 1), 'services with a booking code, department falls back to the category');
  await as(4); await assert.rejects(() => fin('contract_services'), /صلاحية/);

  // ---- batch contracts: ONE rate -> one pending contract per selected service, same doctor/rate/dates/reference, atomic and idempotent
  const bpay = { doctor_key: 'DOC-BT', doctor_name: 'طبيب بت', from: shift(-30), to: shift(30), rate: 35, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'دفعة اختبار' };
  const bcnt = async () => (await owner("select count(*)::int n from clinic_finance.doctor_contracts where doctor_key='DOC-BT'"))[0].n;
  const btk = key(); await as(2);
  const bfirst = await fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-1', 'D-2', 'قسم:الجلدية'] }, btk]);
  assert(bfirst); assert.equal(await bcnt(), 3);
  const brows = await owner("select id, service_scope, status, rate::float r, reference, valid_from::text f, valid_to::text t, created_by from clinic_finance.doctor_contracts where doctor_key='DOC-BT' order by service_scope");
  assert.deepEqual(brows.map(x => x.service_scope), ['D-1', 'D-2', 'قسم:الجلدية']);
  assert(brows.every(x => x.status === 'pending' && x.r === 35 && x.reference === 'دفعة اختبار' && x.f === shift(-30) && x.t === shift(30) && x.created_by === id(2)), 'identical terms, all pending');
  assert.equal(await fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-1', 'D-2', 'قسم:الجلدية'] }, btk]), bfirst, 'replaying the batch with the same token is idempotent');
  assert.equal(await bcnt(), 3);
  await assert.rejects(() => fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-7', 'قسم:غير موجود'] }, key()]), /غير موجود/);
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where service_scope='D-7'"))[0].n, 0, 'a failing batch creates nothing (atomic)');
  await assert.rejects(() => fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-1', ' D-1 '] }, key()]), /تكرار/);
  await assert.rejects(() => fin('doctor_command', ['contract_batch', { ...bpay, scopes: [] }, key()]), /من 1 إلى 200/);
  await assert.rejects(() => fin('doctor_command', ['contract_batch', { ...bpay, scopes: 'D-1' }, key()]), /خدمة واحدة/);
  await as(4); await assert.rejects(() => fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-1'] }, key()]), /صلاحية/);
  const bids = brows.map(x => x.id);
  await as(2); await assert.rejects(() => fin('doctor_command', ['contract_review_batch', { ids: bids, approve: true, note: 'اعتماد من المنشئ' }, key()]), /صلاحية|اعتماد عقدك|غير متاح/, 'the creator cannot approve the batch');
  // overlap: a second batch whose D-1 overlaps the first (once approved) must be refused as a whole
  await as(3); await fin('doctor_command', ['contract_review_batch', { ids: bids, approve: true, note: 'اعتماد الدفعة' }, key()]);
  assert.deepEqual((await owner("select distinct status from clinic_finance.doctor_contracts where doctor_key='DOC-BT'")).map(x => x.status), ['active'], 'the whole batch is approved together');
  assert.equal((await rows('DOC-BT', 'D-2', 'الاسنان')).length, 1); assert.equal((await rows('DOC-BT', 'S-1', 'الجلدية')).length, 1, 'a department entry inside the batch works');
  await as(2); await fin('doctor_command', ['contract_batch', { ...bpay, scopes: ['D-1', 'D-5'], rate: 50 }, key()]);
  const second = (await owner("select id from clinic_finance.doctor_contracts where doctor_key='DOC-BT' and status='pending' order by service_scope")).map(x => x.id);
  await as(3); await assert.rejects(() => fin('doctor_command', ['contract_review_batch', { ids: second, approve: true, note: 'اعتماد الدفعة الثانية' }, key()]), /تتداخل/);
  assert.deepEqual((await owner("select distinct status from clinic_finance.doctor_contracts where id = any($1::uuid[])", [second])).map(x => x.status), ['pending'], 'an overlap rejects the whole review batch');
  // exact service > department still holds for batch-created contracts
  const bx = await mkc('DOC-BX', 'قسم:الاسنان', 20); await as(2);
  await fin('doctor_command', ['contract_batch', { ...bpay, doctor_key: 'DOC-BX', doctor_name: 'طبيب بكس', scopes: ['D-1'], rate: 45 }, key()]);
  await as(3); await fin('doctor_command', ['contract_review_batch', { ids: (await owner("select id from clinic_finance.doctor_contracts where doctor_key='DOC-BX' and status='pending'")).map(x => x.id), approve: true, note: 'اعتماد' }, key()]);
  assert.equal((await rows('DOC-BX', 'D-1', 'الاسنان'))[0].rate, '45.0000'); assert.equal((await rows('DOC-BX', 'D-2', 'الاسنان'))[0].id, bx);

  // ---- billing with a department contract + channel share still works (doctor_sync untouched)
  const rule = (o) => ({ code: 'x', name: 'قاعدة', kind: 'external', applies_to: 'consultation', patient_discount_percent: 0, platform_share_percent: 25, payable_kind: 'commission', payable_when: 'آخر الشهر', source_codes: [], valid_from: shift(-5), valid_to: shift(300), notes: '', ...o });
  await as(2); const vez = await fin('channel_command', ['create', rule({ code: 'vezeeta', name: 'فيزيتا' }), key()]);
  await as(3); await fin('channel_command', ['review', { id: vez, approve: true, note: 'اعتماد اختبار' }, key()]);
  const deptInv = await mkc('DOC-E', 'قسم:الاسنان', 50, { base_scope: 'invoice' });
  const bill = async (n, p) => { await as(n); return fin('bill', [{ patient_ref: 'T', description: 'اختبار', items: [], ...p }, key()]); };
  const earned = async inv => Number((await owner('select earned from clinic_finance.doctor_allocations where invoice_id=$1', [inv]))[0].earned);
  const b1 = await bill(2, { reference: 'DEPT-1', service_amount: 200, doctor_contract_id: deptInv });
  assert.equal(await earned(b1), 100, 'department contract: 50% of 200');
  const b2 = await bill(2, { reference: 'DEPT-VEZ', service_amount: 100, channel_id: vez, consultation_gross: 100, services_gross: 0, doctor_contract_id: deptInv });
  assert.equal(await earned(b2), 37.5, 'owner example: external platform 25% share, doctor 50% of the rest');

  // ---- ROLLBACK: byte-identical restore of every replaced function; department contracts become inert, exact ones keep working
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261108230000_department_contracts.rollback.sql', 'utf8'));
  for (const s of SIGS) assert.equal(await def(s), before[s], 'rollback restores ' + s + ' byte-for-byte');
  assert.equal((await owner("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_finance' and p.proname in ('doctor_contract_for_service','department_scope_name','contract_departments','doctor_command_before_departments')"))[0].n, 0, 'helpers dropped');
  await as(2); const old = await fin('doctor_command', ['contract', { doctor_key: 'DOC-Z', doctor_name: 'طبيب ز', scope: 'D-9', from: shift(-30), to: shift(30), rate: 40, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'مرجع' }, key()]);
  assert(old, 'contract creation works after rollback');
  await db.exec('reset role'); await db.exec(mig('20261108230000_department_contracts.sql')); // can be applied again after a rollback
  console.log('PASS department contracts SQL: batch contracts (atomic, idempotent, approved together), format/existence checks, maker-checker, overlap, exact-over-department precedence, labs/emergency as ordinary departments, reception sync, pickers, channel share unaffected, byte-identical rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
