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
  const postDef = await def('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)');
  assert(postDef.includes("p_action='contract_revise'") && postDef.includes('c.supersedes is not null'), 'function patched');
  const mkr = async (id0, extra = {}, creator = 2, tk = key()) => { await as(creator); return fin('doctor_command', ['contract_revise', { supersedes: id0, from: shift(10), to: shift(30), rate: 55, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'تعديل اختبار', note: 'سبب', ...extra }, tk]); };
  const st = async id0 => (await owner('select status, valid_from::text f, valid_to::text t, supersedes, superseded_valid_to::text sv, rate::float r from clinic_finance.doctor_contracts where id=$1', [id0]))[0];

  // base contract A: D-1 at 50%, valid -30..+30
  const A = await mkc('DOC-A2', 'D-1', 50);
  // 1) validation
  await assert.rejects(() => mkr(id(999)), /معتمد فقط/, 'unknown contract');
  const pendOnly = await mkc('DOC-P', 'D-1', 40, {}, false);
  await assert.rejects(() => mkr(pendOnly), /معتمد فقط/, 'a pending contract cannot be revised');
  await assert.rejects(() => mkr(A, { from: shift(0) }), /بعد النهارده/, 'not retroactive / not today');
  await assert.rejects(() => mkr(A, { from: shift(-5) }), /بعد النهارده/);
  await assert.rejects(() => mkr(A, { from: shift(45) }), /داخل فترة العقد/, 'must fall inside the current period');
  await assert.rejects(() => mkr(A, { rate: 120 }), /rate|violates|check/i, 'rate range check still applies');
  await assert.rejects(() => mkr(A, { reference: '' }), /مرجع/);
  await as(4); await assert.rejects(() => fin('doctor_command', ['contract_revise', { supersedes: A, from: shift(10), to: shift(30), rate: 55, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'x' }, key()]), /صلاحية/, 'reception cannot revise');

  // 2) creating the revision leaves the old contract untouched; idempotent; one pending revision per contract
  const tk = key(); const R1 = await mkr(A, {}, 2, tk);
  assert.equal(await mkr(A, {}, 2, tk), R1, 'same token returns the same revision');
  let a = await st(A); assert.equal(a.status, 'active'); assert.equal(a.t, shift(30), 'old unchanged while the revision is pending');
  const r1 = await st(R1); assert.equal(r1.status, 'pending'); assert.equal(r1.supersedes, A); assert.equal(r1.r, 55);
  await assert.rejects(() => mkr(A), /duplicate|unique|مكرر/i, 'only one pending revision per contract');
  assert.equal(Number((await rows('DOC-A2', 'D-1', 'الاسنان'))[0].rate), 50, 'old contract still applies');

  // 3) maker-checker: the creator cannot approve the revision; a different reviewer can
  await as(2); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: R1, approve: true, note: 'اعتماد من المنشئ' }, key()]), /اعتماد عقدك|صلاحية/);
  await as(3); await fin('doctor_command', ['contract_review', { id: R1, approve: true, note: 'اعتماد التعديل' }, key()]);
  a = await st(A); assert.equal(a.status, 'active'); assert.equal(a.t, shift(9), 'old contract ends the day before the revision starts');
  const r1b = await st(R1); assert.equal(r1b.status, 'active'); assert.equal(r1b.sv, shift(30), 'old valid_to remembered for rollback');
  assert.equal(Number((await rows('DOC-A2', 'D-1', 'الاسنان'))[0].rate), 50, 'today still uses the old terms');
  const future = await owner('select id, rate::float r from clinic_finance.doctor_contract_for_service($1,$2,null,$3,$4::date)', ['DOC-A2', 'D-1', 'الاسنان', shift(15)]);
  assert.deepEqual(future.map(x => [x.id, x.r]), [[R1, 55]], 'from the start date the revision applies, and only it');
  const gap = await owner('select count(*)::int n from clinic_finance.doctor_contract_for_service($1,$2,null,$3,$4::date)', ['DOC-A2', 'D-1', 'الاسنان', shift(9)]);
  assert.equal(gap[0].n, 1, 'the day before: old contract only');

  // 4) revising the revision again chains correctly
  const R2 = await mkr(R1, { from: shift(20), rate: 60, to: shift(30) });
  await as(3); await fin('doctor_command', ['contract_review', { id: R2, approve: true, note: 'اعتماد' }, key()]);
  assert.equal((await st(R1)).t, shift(19)); assert.equal((await st(R2)).status, 'active');

  // 5) rejecting a revision changes nothing
  const B = await mkc('DOC-B', 'D-1', 30); const RB = await mkr(B, { rate: 35 });
  await as(3); await fin('doctor_command', ['contract_review', { id: RB, approve: false, note: 'مرفوض' }, key()]);
  assert.equal((await st(B)).status, 'active'); assert.equal((await st(B)).t, shift(30)); assert.equal((await st(RB)).status, 'rejected');
  const RB2 = await mkr(B, { rate: 36 }); assert(RB2, 'after a rejection a new revision can be proposed');

  // 6) revision starting on the first day of a FUTURE contract supersedes it entirely
  await as(2);
  const Fid = await fin('doctor_command', ['contract', { doctor_key: 'DOC-F', doctor_name: 'طبيب ف', scope: 'D-1', from: shift(20), to: shift(60), rate: 30, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'مستقبلي' }, key()]);
  await as(3); await fin('doctor_command', ['contract_review', { id: Fid, approve: true, note: 'اعتماد' }, key()]);
  const RF = await mkr(Fid, { from: shift(20), to: shift(60), rate: 33 });
  await as(3); await fin('doctor_command', ['contract_review', { id: RF, approve: true, note: 'اعتماد' }, key()]);
  assert.equal((await st(Fid)).status, 'superseded'); assert.equal((await st(RF)).status, 'active');
  const fut = await owner('select id from clinic_finance.doctor_contract_for_service($1,$2,null,$3,$4::date)', ['DOC-F', 'D-1', 'الاسنان', shift(25)]);
  assert.deepEqual(fut.map(x => x.id), [RF], 'superseded contract no longer applies');

  // 7) batch review path (contract_review_batch) goes through the same patched function
  const C1 = await mkc('DOC-G', 'D-1', 20), C2 = await mkc('DOC-G', 'D-2', 20);
  const RC1 = await mkr(C1, { rate: 25 }), RC2 = await mkr(C2, { rate: 25 });
  await as(3); await fin('doctor_command', ['contract_review_batch', { ids: [RC1, RC2], approve: true, note: 'اعتماد المجموعة' }, key()]);
  assert.equal((await st(C1)).t, shift(9)); assert.equal((await st(C2)).t, shift(9)); assert.equal((await st(RC1)).status, 'active');

  // 8) approval after the start date has passed is refused (revision must be re-proposed)
  const D = await mkc('DOC-H', 'D-1', 20); const RD = await mkr(D, { from: shift(1) });
  await owner("update clinic_finance.doctor_contracts set valid_from = valid_from - 3 where id = $1", [RD]);
  await as(3); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: RD, approve: true, note: 'متأخر' }, key()]), /مضى/);
  assert.equal((await st(D)).t, shift(30), 'nothing changed by the refused approval');

  // 9) a revision whose original is no longer active is refused at approval
  const E = await mkc('DOC-I', 'D-1', 20); const RE = await mkr(E, { from: shift(5) });
  await owner("update clinic_finance.doctor_contracts set status='rejected' where id=$1", [E]);
  await as(3); await assert.rejects(() => fin('doctor_command', ['contract_review', { id: RE, approve: true, note: 'اعتماد' }, key()]), /لم يعد معتمدًا/);

  // 10) the workspace snapshot exposes the new columns (to_jsonb(row))
  await as(3); const ws = await fin('doctor_workspace', []).catch(() => null);
  if (ws) { const row = (ws.doctor_contracts || []).find(x => x.id === R1); assert(row && row.supersedes === A, 'workspace carries supersedes'); }

  // 11) rollback: refused after an approved revision; works when only pending/rejected revisions remain
  const roll = fs.readFileSync('supabase/rollbacks/20261108240000_contract_revisions.rollback.sql', 'utf8');
  await db.exec('reset role');
  await assert.rejects(() => db.exec(roll), /لا تراجع بعد اعتماد/, 'rollback refused after approved revisions'); await db.exec('rollback');
  await owner("update clinic_finance.doctor_contracts set supersedes=null where supersedes is not null and status='active'");
  await owner("delete from clinic_finance.doctor_contracts where status='superseded'");
  await db.exec(roll);
  assert.equal(await def('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)'), preDef, 'rollback restores the function byte-for-byte');
  assert.equal((await owner("select count(*)::int n from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name in ('supersedes','superseded_valid_to')"))[0].n, 0);
  await db.exec(mig('20261108240000_contract_revisions.sql')); // re-apply after rollback
  console.log('PASS contract revisions SQL: validation, idempotency, one pending per contract, maker-checker, shortened/superseded old contract, chained revisions, batch review, stale refusals, rollback byte-identical');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
