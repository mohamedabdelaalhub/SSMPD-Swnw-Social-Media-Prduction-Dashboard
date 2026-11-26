// Doctor contract REVISIONS (supersede flow): SQL rehearsal on PGlite with the REAL finance migrations (cash control, stock/insurance, doctor settlements, supplier finance, channels) + reception stubs.
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

  await db.exec('reset role'); await db.exec(mig('20261108230000_department_contracts.sql'));
  // ---- APPLY the revisions migration (patches doctor_command_before_departments in place)
  const preDef = await def('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)');
  await db.exec('reset role'); await db.exec(mig('20261108240000_contract_revisions.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261108240000_contract_revisions.sql')); }, /تم تطبيق هذا الملف/, 'second apply refused'); await db.exec('rollback');

  await db.exec('reset role'); await db.exec(mig('20261117170000_doctor_contract_end.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261117170000_doctor_contract_end.sql')); }, /تم تطبيق هذا الملف/); await db.exec('rollback');
  const end = async (action, payload, who, tk = key()) => { await as(who); return fin('doctor_contract_end', [action, payload, tk]); };
  const row = async cid => (await owner('select status, valid_from::text f, valid_to::text t, end_request_last_day::text req, ended_by, end_reason from clinic_finance.doctor_contracts where id=$1', [cid]))[0];
  const c1 = await mkc('DOC-E', 'D-2', 50);
  const b0 = await row(c1);
  // validation
  await assert.rejects(() => end('request', { id: c1, last_day: shift(-1), reason: 'قرار المالك' }, 2), /بأثر رجعي/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(30), reason: 'قرار المالك' }, 2), /بينتهي أصل/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قصير' }, 2), /سبب الإنهاء/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك' }, 4), /صلاحية/, 'reception cannot request');
  // request (idempotent)
  const tk = key();
  assert.equal(await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 3, tk), c1);
  assert.equal(await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 3, tk), c1, 'same token = same request');
  await assert.rejects(() => end('request', { id: c1, last_day: shift(1), reason: 'طلب تاني مكرر' }, 5), /مستني المراجعة/, 'one pending end per contract');
  assert.equal((await row(c1)).req, shift(0)); assert.equal((await row(c1)).t, b0.t, 'nothing changes before review');
  // maker-checker
  await assert.rejects(() => end('review', { id: c1, approve: true }, 3), /لا يعتمد طلبه/, 'creator cannot approve');
  await assert.rejects(() => end('review', { id: c1, approve: true }, 2), /صلاحية/, 'accountant has no review right');
  await assert.rejects(() => end('review', { id: c1, approve: true }, 4), /صلاحية/);
  // reject clears
  await end('review', { id: c1, approve: false }, 1);
  assert.equal((await row(c1)).req, null); assert.equal((await row(c1)).status, 'active');
  // pending revision blocks the end request
  await as(2); const rev = await fin('doctor_command', ['contract_revise', { supersedes: c1, from: shift(10), to: shift(30), rate: 55, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'تعديل اختبار' }, key()]);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 5), /تعديل للعقد ده مستني/);
  await as(3); await fin('doctor_command', ['contract_review', { id: rev, approve: false, note: 'رفض اختبار' }, key()]);
  // approve: valid_to = last day
  await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 2);
  await end('review', { id: c1, approve: true, note: 'تمام' }, 3);
  const after = await row(c1);
  assert.equal(after.t, shift(0)); assert.equal(after.status, 'active'); assert.equal(after.req, null); assert(after.ended_by); assert(/قرار المالك/.test(after.end_reason) && /تمام/.test(after.end_reason));
  await assert.rejects(() => end('review', { id: c1, approve: true }, 3), /مفيش طلب إنهاء/);
  // a future contract ended before it starts becomes superseded
  await as(2); const fut = await fin('doctor_command', ['contract', { doctor_key: 'DOC-F', doctor_name: 'طبيب مستقبل', scope: 'L-1', from: shift(5), to: shift(30), rate: 40, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اختبار' }, key()]);
  await as(3); await fin('doctor_command', ['contract_review', { id: fut, approve: true, note: 'اعتماد' }, key()]);
  await end('request', { id: fut, last_day: shift(1), reason: 'مش هيشتغل خلاص' }, 2); await end('review', { id: fut, approve: true }, 3);
  assert.equal((await row(fut)).status, 'superseded'); assert.equal((await row(fut)).t, shift(30));
  // only active contracts can be ended
  await assert.rejects(() => end('request', { id: fut, last_day: shift(2), reason: 'مرة تانية' }, 2), /معتمد فقط/);
  // rollback file works, and re-apply works
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261117170000_doctor_contract_end.rollback.sql', 'utf8'));
  assert.equal((await owner("select to_regprocedure('public.clinic_finance_doctor_contract_end(text,jsonb,uuid)') r"))[0].r, null);
  await db.exec(mig('20261117170000_doctor_contract_end.sql'));
  await db.close();
  console.log('PASS doctor contract end: request/review maker-checker, no retroactive end, one pending, revision guard, valid_to on approval, superseded if never started, reject clears, rollback.');
})().catch(e => { console.error(e); process.exit(1); });
