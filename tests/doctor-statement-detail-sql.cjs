// Doctor statement DETAIL (read-only): insurance patient/insurer split + services without an active contract. PGlite with the REAL finance migrations.
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
  const q = async inv => (await owner('select line_no, service_code, department, amount::float a, contract_id from clinic_finance.doctor_allocation_lines where invoice_id=$1 order by line_no', [inv]));

  // ===================== DOCTOR STATEMENT =====================
  await db.exec('reset role'); await db.exec(mig('20261108250000_doctor_statement.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261108250000_doctor_statement.sql')); }, /تم تطبيق هذا الملف/, 'second apply refused'); await db.exec('rollback');
  const pay = async (inv, amt, ref) => owner("insert into clinic_finance.payments(invoice_id,method,amount,reference,created_by,token) values($1,'cash',$2,$3,$4,gen_random_uuid())", [inv, amt, ref, id(2)]);
  const claim = async (inv, insurer, amt, ref) => (await owner("insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token) values($1,$2,$3,$4,$5,gen_random_uuid()) returning id", [inv, ref, insurer, amt, id(2)]))[0].id;
  const act = async (cid, kind, amt, ref) => owner("insert into clinic_finance.insurance_actions(claim_id,kind,amount,reference,reason,payload,created_by,token,status,reviewed_by) values($1,$2,$3,$4,'اختبار','{}',$5,gen_random_uuid(),'approved',$6)", [cid, kind, amt, ref, id(2), id(3)]);
  const stmt = async (n, k, f = range[0], t = range[1]) => { await as(n); return fin('doctor_statement', [k, f, t]); };
  const row = (s, inv) => s.invoices.find(x => x.invoice_id === inv);
  await mkc('DOC-ST', 'قسم:الاسنان', 50);
  const two = [['D-1', 300], ['D-2', 200]];
  const mk = (ref, amt, ls = two) => bill(2, { reference: ref, service_amount: amt, doctor_key: 'DOC-ST', service_lines: ls.map(([code, amount]) => ({ code, amount })) });

  const A = await mk('ST-A', 500);                 // credit patient, nothing paid yet
  const B = await mk('ST-B', 400, [['D-1', 400]]);  // insurance: patient 100 + insurer pending
  const C = await mk('ST-C', 200, [['D-1', 200]]);  // fully paid by the patient, then partly refunded
  const D = await mk('ST-D', 1000, [['D-1', 1000]]);// insurance with a contractual discount
  const V = await mk('ST-V', 300, [['D-2', 300]]);  // voided
  await claim(B, 'شركة تأمين ب', 300, 'CL-B');
  await pay(B, 100, 'P-B'); await pay(C, 200, 'P-C');
  let s = await stmt(2, 'DOC-ST');
  assert.equal(row(s, A).status, 'credit', 'unpaid, no insurer = credit (waiting)');
  assert.equal(row(s, B).status, 'insurance', 'insurer claim still open = insurance (waiting)'); assert.equal(row(s, B).insurer, 'شركة تأمين ب');
  assert.equal(row(s, C).status, 'paid');
  assert.equal(row(s, A).fee, 250); assert.equal(row(s, B).fee, 200); assert.equal(row(s, C).fee, 100);
  assert.equal(row(s, A).lines.length, 2); assert.deepEqual(row(s, A).lines.map(l => [l.service_code, l.amount, l.rate, l.fee_estimate]), [['D-1', 300, 50, 150], ['D-2', 200, 50, 100]]);
  assert.equal(s.summary.payable_invoices, 100, 'only the fully paid invoice is payable now'); assert.equal(s.summary.pending, 1100, "A250+B200+D500+V150 wait");

  // owner decision 1: ONE unpaid invoice holds only its own fee; paying it in full releases it
  await pay(A, 500, 'P-A'); s = await stmt(2, 'DOC-ST');
  assert.equal(row(s, A).status, 'paid'); assert.equal(s.summary.payable_invoices, 350); assert.equal(s.summary.pending, 850, 'A no longer waits');
  // half paid is still waiting (closed until fully paid)
  const H = await mk('ST-H', 200, [['D-1', 200]]); await pay(H, 100, 'P-H'); s = await stmt(2, 'DOC-ST'); assert.equal(row(s, H).status, 'credit', 'half paid = still waiting'); assert.equal(s.summary.pending, 950);

  // insurer payment approved -> collected counts it; pending insurer actions do NOT
  await owner("insert into clinic_finance.insurance_actions(claim_id,kind,amount,reference,reason,payload,created_by,token,status) select id,'payment',300,'ACT-PEND','اختبار','{}',$1,gen_random_uuid(),'pending' from clinic_finance.insurance_claims where reference='CL-B'", [id(2)]);
  s = await stmt(2, 'DOC-ST'); assert.equal(row(s, B).status, 'insurance', 'a pending (unapproved) insurer payment does not count');
  const clB = (await owner("select id from clinic_finance.insurance_claims where reference='CL-B'"))[0].id; await act(clB, 'payment', 300, 'ACT-B');
  s = await stmt(2, 'DOC-ST'); assert.equal(row(s, B).status, 'paid'); assert.equal(row(s, B).collected, 400);

  // refund: net of the refund, fee already reduced by the existing sync
  await refund(C, 100); s = await stmt(2, 'DOC-ST'); assert.equal(row(s, C).net, 100); assert.equal(row(s, C).collected, 100); assert.equal(row(s, C).status, 'paid'); assert.equal(row(s, C).fee, 50);

  // contractual discount reduces what must be collected
  const clD = await claim(D, 'شركة تأمين د', 900, 'CL-D'); await pay(D, 100, 'P-D'); await act(clD, 'payment', 700, 'ACT-D1');
  s = await stmt(2, 'DOC-ST'); assert.equal(row(s, D).status, 'insurance'); await act(clD, 'contractual', 200, 'ACT-D2'); s = await stmt(2, 'DOC-ST');
  assert.equal(row(s, D).net, 800); assert.equal(row(s, D).status, 'paid');

  // voided invoices never wait or pay
  await owner('update clinic_finance.invoices set voided=true where id=$1', [V]); await owner('select clinic_finance.doctor_sync($1)', [V]); s = await stmt(2, 'DOC-ST'); assert.equal(row(s, V).status, 'void'); assert.equal(row(s, V).fee, 0);

  // summary ties to the real balance
  const bal = Number((await owner("select clinic_finance.doctor_balance('DOC-ST') b"))[0].b);
  assert.equal(s.summary.balance, bal); assert.equal(s.summary.accrued, Number((await owner("select coalesce(sum(delta),0) a from clinic_finance.doctor_accruals where doctor_key='DOC-ST'"))[0].a));
  assert.equal(s.summary.available_to_pay, Math.max(0, bal - s.summary.pending));
  assert.equal(s.summary.payable_invoices + s.summary.pending, s.summary.accrued, 'every fee is either payable or waiting');
  await owner("insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token,status,reviewed_by) values('DOC-ST',100,10,'cash','PO-1',$1,$2,'{}',$3,gen_random_uuid(),'approved',$4)", [range[0], range[1], id(2), id(3)]);
  const s2 = await stmt(2, 'DOC-ST'); assert.equal(s2.summary.paid_out, 100); assert.equal(s2.summary.balance, bal - 100); assert.equal(s2.summary.available_to_pay, Math.max(0, bal - 100 - s2.summary.pending));
  // pending payouts do not count
  await owner("insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token,status) values('DOC-ST',50,0,'cash','PO-2',$1,$2,'{}',$3,gen_random_uuid(),'pending')", [range[0], range[1], id(2)]);
  assert.equal((await stmt(2, 'DOC-ST')).summary.paid_out, 100);


  // ===================== STATEMENT DETAIL =====================
  const DET = '20261108280000_doctor_statement_detail.sql';
  await db.exec('reset role'); await db.exec(mig(DET));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(DET)); }, /تم تطبيق هذا الملف/, 'second apply refused'); await db.exec('rollback');
  const det = async (n, k, f = shift(-400), t = shift(400)) => { await as(n); return fin('doctor_statement_detail', [k, f, t]); };

  // base statement is untouched: same summary and same invoices (plus the 3 extra fields)
  const base = await stmt(2, 'DOC-ST', shift(-400), shift(400)), d0 = await det(2, 'DOC-ST');
  assert.deepEqual(d0.summary, base.summary); assert.equal(d0.invoices.length, base.invoices.length);
  for (const i of base.invoices) { const j = d0.invoices.find(x => x.invoice_id === i.invoice_id); for (const k of Object.keys(i)) assert.deepEqual(j[k], i[k], 'unchanged field ' + k); }

  // ---- (1) insurance split: invoice 1000, insurer claim 600 -> patient share 400
  const I = await mk('DT-I', 1000, [['D-1', 1000]]); const clI = await claim(I, 'شركة س', 600, 'CL-I'); await pay(I, 150, 'P-I');
  let r = row(await det(2, 'DOC-ST'), I);
  assert.equal(r.status, 'insurance'); assert.equal(r.claim_amount, 600); assert.equal(r.patient_open, 250, 'patient share 400 - paid 150'); assert.equal(r.insurer_open, 600);
  await act(clI, 'payment', 200, 'ACT-I1'); await act(clI, 'contractual', 100, 'ACT-I2');
  r = row(await det(2, 'DOC-ST'), I); assert.equal(r.insurer_open, 300, '600 - 200 paid - 100 contractual'); assert.equal(r.patient_open, 250, 'patient part unchanged by insurer actions');
  await pay(I, 250, 'P-I2'); r = row(await det(2, 'DOC-ST'), I); assert.equal(r.patient_open, 0, 'patient part closed'); assert.equal(r.insurer_open, 300); assert.equal(r.status, 'insurance');
  // a plain credit invoice has no claim: all of it is the patient's
  const CR = await mk('DT-C', 300, [['D-1', 300]]); r = row(await det(2, 'DOC-ST'), CR); assert.equal(r.claim_amount, 0); assert.equal(r.patient_open, 300); assert.equal(r.insurer_open, 0);
  await pay(CR, 100, 'P-C1'); assert.equal(row(await det(2, 'DOC-ST'), CR).patient_open, 200);
  // refunds reduce what the patient has really paid
  await refund(CR, 40); r = row(await det(2, 'DOC-ST'), CR); assert(r.patient_open >= 0);

  // ---- (2) services without an active contract (reception orders)
  await db.exec('reset role');
  await db.exec(`create table clinic_reception.workspaces(id uuid primary key, mode text);
    alter table clinic_reception.services add column id uuid default gen_random_uuid(), add column name text;
    alter table clinic_reception.orders add column service_id uuid, add column quantity numeric default 1, add column price numeric, add column discount numeric default 0, add column status text, add column completed_at timestamptz, add column created_at timestamptz default now();
    update clinic_reception.services set name = 'خدمة ' || code;`);
  await owner(`insert into clinic_reception.workspaces values ($1,'live'),($2,'test')`, [W, id(901)]);
  const P1 = id(951), P2 = id(952), P3 = id(953);
  await owner(`insert into clinic_reception.providers(workspace_id,id,doctor_key,department) values ($1,$2,'DOC-ST','الاسنان'),($1,$3,'DOC-NOC','الاسنان'),($4,$5,'DOC-ST','الاسنان')`, [W, P1, P2, id(901), P3]);
  const svc = async code => (await owner('select id from clinic_reception.services where code=$1', [code]))[0].id;
  let oc = 0; const order = async (ws, prov, code, daysAgo, status, price = 200) => owner(`insert into clinic_reception.orders(workspace_id,id,provider_id,service_id,price,quantity,discount,status,completed_at) values ($1,$2,$3,$4,$5,2,10,$6,now() - ($7 || ' days')::interval)`, [ws, id(960 + ++oc), prov, await svc(code), price, status, String(daysAgo)]);
  await order(W, P1, 'D-1', 0, 'completed');        // covered by the dept contract of DOC-ST (today is inside -30..+30)
  await order(W, P1, 'L-1', 2, 'completed');        // lab: no contract of any kind
  await order(W, P1, 'D-2', 60, 'completed');       // dept contract starts 30 days ago -> not yet started then
  await order(W, P1, 'L-1', 1, 'cancelled');        // cancelled: ignored
  await order(id(901), P3, 'L-1', 3, 'completed');  // test workspace: ignored
  await order(W, P2, 'L-1', 2, 'completed');        // other doctor with NO active contract: statement shows no section
  let u = await det(2, 'DOC-ST'); assert.equal(u.has_active_contract, true); assert.equal(u.uncovered.length, 2, 'exactly the 2 uncovered completed live services');
  const byCode = c => u.uncovered.find(x => x.service_code === c);
  assert.equal(byCode('L-1').reason, 'none'); assert.equal(byCode('L-1').amount, 360, '200 x 2 x 0.9'); assert.equal(byCode('L-1').service_name, 'خدمة L-1');
  assert.equal(byCode('D-2').reason, 'starts_later'); assert.equal(u.uncovered[0].service_code, 'L-1', 'newest first');
  const noc = await det(2, 'DOC-NOC'); assert.equal(noc.has_active_contract, false); assert.equal(noc.uncovered, null, 'doctors without an active contract get no section');
  // an exact-code active contract that expired before the service date -> reason expired; a pending contract -> pending
  await mkc('DOC-ST', 'L-1', 40, { from: shift(-100), to: shift(-10) });
  u = await det(2, 'DOC-ST'); assert.equal(u.uncovered.find(x => x.service_code === 'L-1').reason, 'expired');
  // creating a contract that covers the date removes the line
  await mkc('DOC-ST', 'L-1', 40, { from: shift(-3), to: shift(30) });
  u = await det(2, 'DOC-ST'); assert(!u.uncovered.some(x => x.service_code === 'L-1'), 'covered now'); assert.equal(u.uncovered.length, 1);
  // period filter limits the list
  assert.equal((await det(2, 'DOC-ST', shift(-5), shift(5))).uncovered.length, 0);

  // access + grants + read-only + rollback
  await assert.rejects(det(4, 'DOC-ST'), /./, 'reception cannot read'); await db.exec('rollback'); await det(3, 'DOC-ST');
  assert.deepEqual((await owner("select has_function_privilege('anon','public.clinic_finance_doctor_statement_detail(text,date,date)','execute') a, has_function_privilege('authenticated','public.clinic_finance_doctor_statement_detail(text,date,date)','execute') b, has_function_privilege('authenticated','clinic_finance.doctor_statement_detail(text,date,date)','execute') c"))[0], { a: false, b: true, c: false });
  const cnt = async () => (await owner("select (select count(*) from clinic_finance.doctor_accruals)+(select count(*) from clinic_finance.payments)+(select count(*) from clinic_finance.doctor_payouts)+(select count(*) from clinic_finance.invoices) n"))[0].n;
  const c0 = await cnt(); await det(2, 'DOC-ST'); assert.equal(await cnt(), c0, 'detail writes nothing');
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261108280000_doctor_statement_detail.rollback.sql', 'utf8'));
  assert.equal((await owner("select count(*)::int n from pg_proc where proname in ('clinic_finance_doctor_statement_detail','doctor_statement_detail')"))[0].n, 0);
  assert.equal((await owner("select count(*)::int n from pg_proc where proname in ('clinic_finance_doctor_statement','doctor_statement')"))[0].n, 2, 'base statement untouched');
  await db.exec(mig(DET));
  console.log('PASS doctor statement detail SQL: base statement unchanged, patient/insurer split (claim, paid, contractual, refunds), uncovered services (none/starts_later/expired, cancelled+test ignored, only doctors with an active contract), access, grants, read-only, rollback');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
