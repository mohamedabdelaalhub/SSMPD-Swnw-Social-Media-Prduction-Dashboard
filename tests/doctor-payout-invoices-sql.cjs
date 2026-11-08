// Doctor dues by invoice (20261109100000): every case with a status, payout request carries the chosen invoices. PGlite with the REAL finance migrations (+ statement, detail, payout phase 2).
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


  // ===================== DUES BY INVOICE =====================
  const M = '20261109100000_doctor_payout_by_invoice.sql';
  await db.exec('reset role'); await db.exec(mig('20261108280000_doctor_statement_detail.sql')); await db.exec(mig('20261108260000_doctor_payout_phase2.sql'));
  await db.exec('reset role'); await db.exec(mig(M));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(M)); }, /تم تطبيق هذا الملف/, 'second apply refused'); await db.exec('rollback');

  const KEYD = 'DOC-PI'; await mkc(KEYD, 'قسم:الاسنان', 50);
  const mkp = (ref, amt) => bill(2, { reference: ref, service_amount: amt, doctor_key: KEYD, service_lines: [{ code: 'D-1', amount: amt }] });
  const P1 = await mkp('PI-1', 1000), P2 = await mkp('PI-2', 400), P3 = await mkp('PI-3', 600), P4 = await mkp('PI-4', 1000), P5 = await mkp('PI-5', 1000), P6 = await mkp('PI-6', 300), PV = await mkp('PI-V', 200);
  await pay(P1, 1000, 'R1'); await pay(P2, 400, 'R2'); await pay(P6, 300, 'R6');
  await claim(P4, 'شركة س', 600, 'CL-4'); await pay(P4, 400, 'R4'); await claim(P5, 'شركة س', 600, 'CL-5'); await pay(P5, 100, 'R5');
  await owner('update clinic_finance.invoices set voided=true where id=$1', [PV]); await owner('select clinic_finance.doctor_sync($1)', [PV]);
  const dues = async (n = 2, f = shift(-400), t = shift(400)) => { await as(n); return fin('doctor_dues', [KEYD, f, t]); };
  const st = (r, inv) => r.invoices.find(x => x.invoice_id === inv);
  let r = await dues();
  assert.deepEqual(['PI-1', 'PI-2', 'PI-3', 'PI-4', 'PI-5', 'PI-6'].map(x => r.invoices.find(i => i.reference === x).dues_status), ['payable', 'payable', 'waiting_patient', 'waiting_insurer', 'waiting_both', 'payable'], 'every case has its status');
  assert(!r.invoices.some(i => i.reference === 'PI-V'), 'voided invoices are not cases'); assert.equal(r.invoices.length, 6);
  assert.equal(st(r, P1).selectable, true); assert.equal(st(r, P3).selectable, false); assert.equal(st(r, P5).patient_open, 300); assert.equal(st(r, P5).insurer_open, 600);
  assert.equal(r.dues.payable_total, 500 + 200 + 150); assert.equal(r.dues.waiting_total, 300 + 500 + 500); assert.equal(r.dues.requested_total, 0);
  assert.equal(r.dues.payable_now, Number((await owner('select clinic_finance.doctor_payable_now($1) v', [KEYD]))[0].v)); assert.equal(r.dues.available_now, r.dues.payable_now);
  assert(Array.isArray(r.uncovered) || r.uncovered === null, 'statement detail fields are kept');

  const T = () => key(), PAY = (ids, o = {}) => [KEYD, ids, 0, 0, 'bank', null, 'PO-' + key().slice(0, 6), range[0], range[1], o.token || T()];
  const ask = async (n, args) => { await as(n); return fin('doctor_payout_invoices', args); };
  // choose P1 + P2 only (the owner does NOT pay P6 now)
  const tok = T(); const po = await ask(2, PAY([P1, P2], { token: tok }));
  let p = (await owner('select gross::float g, status, payload from clinic_finance.doctor_payouts where id=$1', [po]))[0];
  assert.equal(p.g, 700, 'gross = sum of the chosen invoices (500+200)'); assert.equal(p.status, 'pending'); assert.deepEqual([...p.payload.invoice_ids].sort(), [P1, P2].sort(), 'the request carries the invoices');
  assert.equal((await owner('select count(*)::int n, sum(fee)::float f from clinic_finance.doctor_payout_invoices where payout_id=$1', [po]))[0].f, 700);
  r = await dues(); assert.equal(st(r, P1).dues_status, 'requested'); assert.equal(st(r, P1).selectable, false); assert.equal(st(r, P6).dues_status, 'payable'); assert.equal(r.dues.requested_total, 700); assert.equal(r.dues.payable_total, 150);
  assert.equal(r.dues.pending_payouts, 700); assert.equal(r.dues.available_now, Math.max(0, r.dues.payable_now - 700));
  // idempotent replay: same token + same invoices = same payout, no duplicate links; same token + other invoices refused
  assert.equal(await ask(2, PAY([P2, P1], { token: tok })), po, 'replay returns the same payout'); assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_payout_invoices where payout_id=$1', [po]))[0].n, 2);
  await assert.rejects(ask(2, PAY([P1], { token: tok })), /مفتاح طلب مختلف/); await db.exec('rollback');
  // a requested invoice is never offered/accepted again
  await assert.rejects(ask(2, PAY([P1])), /مشمولة بطلب صرف سابق/); await db.exec('rollback');
  await assert.rejects(ask(2, PAY([P6, P2])), /مشمولة بطلب صرف سابق/, 'one bad invoice rejects the whole request'); await db.exec('rollback');
  // waiting / foreign / empty / missing rates are refused
  await assert.rejects(ask(2, PAY([P3])), /لم تُسدَّد بالكامل/); await db.exec('rollback');
  await assert.rejects(ask(2, PAY([P4])), /لم تُسدَّد بالكامل/); await db.exec('rollback');
  await assert.rejects(ask(2, PAY([PV])), /ليست من أتعاب|ملغاة/); await db.exec('rollback');
  const other = await bill(2, { reference: 'OTH-1', service_amount: 100, doctor_key: 'DOC-S', service_lines: [{ code: 'D-1', amount: 100 }] }).catch(() => null);
  if (other) { await pay(other, 100, 'RO'); await assert.rejects(ask(2, PAY([other])), /ليست من أتعاب/, 'another doctor\'s invoice'); await db.exec('rollback'); }
  await assert.rejects(ask(2, PAY([])), /اختر فاتورة/); await db.exec('rollback');
  await assert.rejects(ask(2, [KEYD, [P6], null, 0, 'bank', null, 'PO-X1', range[0], range[1], T()]), /نسبة الضريبة/); await db.exec('rollback');
  // existing gates still run: tax rules and the cash shift
  await assert.rejects(ask(2, [KEYD, [P6], 60, 50, 'bank', null, 'PO-X2', range[0], range[1], T()]), /نسبة الضريبة والاستقطاع/); await db.exec('rollback');
  await assert.rejects(ask(2, [KEYD, [P6], 0, 0, 'cash', null, 'PO-X3', range[0], range[1], T()]), /./, 'cash needs a shift'); await db.exec('rollback');
  // percentages: 14% tax + 5% withholding of 150
  const po6 = await ask(2, [KEYD, [P6], 14, 5, 'bank', null, 'PO-6', range[0], range[1], T()]);
  p = (await owner('select gross::float g, withheld::float w from clinic_finance.doctor_payouts where id=$1', [po6]))[0]; assert.equal(p.g, 150); assert.equal(p.w, 21 + 7.5);
  // maker-checker + financial manager review (existing gate)
  await as(2); await assert.rejects(fin('doctor_command', ['payout_review', { id: po, approve: true, note: 'اعتماد' }, T()]), /./, 'the creator cannot approve'); await db.exec('rollback');
  await as(3); await fin('doctor_command', ['payout_review', { id: po, approve: true, note: 'اعتماد الدفع' }, T()]);
  r = await dues(); assert.equal(st(r, P1).dues_status, 'paid_out'); assert.equal(st(r, P2).dues_status, 'paid_out'); assert.equal(r.dues.paid_out_total, 700);
  await assert.rejects(ask(2, PAY([P1])), /مشمولة بطلب صرف سابق/, 'a paid invoice is never paid twice'); await db.exec('rollback');
  // rejecting the other request frees its invoice again
  await as(3); await fin('doctor_command', ['payout_review', { id: po6, approve: false, note: 'رفض' }, T()]);
  r = await dues(); assert.equal(st(r, P6).dues_status, 'payable', 'a rejected request frees its invoice'); const po6b = await ask(2, PAY([P6])); assert((await owner('select 1 from clinic_finance.doctor_payouts where id=$1', [po6b])).length === 1);
  // the invoice fully collected later becomes payable (waiting -> payable)
  await pay(P3, 600, 'R3'); r = await dues(); assert.equal(st(r, P3).dues_status, 'payable');

  // access + privileges + read-only
  await as(4); await assert.rejects(fin('doctor_dues', [KEYD, range[0], range[1]]), /./); await db.exec('rollback');
  await as(4); await assert.rejects(fin('doctor_payout_invoices', PAY([P3])), /./); await db.exec('rollback');
  await as(2); await assert.rejects(db.query('select * from clinic_finance.doctor_payout_invoices'), /permission denied/); await db.exec('rollback');
  assert.deepEqual((await owner("select has_function_privilege('anon','public.clinic_finance_doctor_dues(text,date,date)','execute') a, has_function_privilege('anon','public.clinic_finance_doctor_payout_invoices(text,uuid[],numeric,numeric,text,uuid,text,date,date,uuid)','execute') b, has_function_privilege('authenticated','public.clinic_finance_doctor_dues(text,date,date)','execute') c, has_function_privilege('authenticated','clinic_finance.doctor_dues(text,date,date)','execute') d"))[0], { a: false, b: false, c: true, d: false });
  const cnt3 = async () => (await owner("select (select count(*) from clinic_finance.doctor_payouts)+(select count(*) from clinic_finance.doctor_payout_invoices)+(select count(*) from clinic_finance.payments) n"))[0].n;
  const c0 = await cnt3(); await dues(); assert.equal(await cnt3(), c0, 'dues is read-only');

  // rollback: refuses while links exist; then clean and re-applicable; payouts themselves untouched
  await db.exec('reset role'); await assert.rejects(db.exec(fs.readFileSync('supabase/rollbacks/20261109100000_doctor_payout_by_invoice.rollback.sql', 'utf8')), /فيه بيانات/); await db.exec('rollback');
  const payoutsBefore = (await owner('select count(*)::int n from clinic_finance.doctor_payouts'))[0].n;
  await owner('delete from clinic_finance.doctor_payout_invoices'); await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261109100000_doctor_payout_by_invoice.rollback.sql', 'utf8'));
  assert.equal((await owner("select count(*)::int n from pg_proc where proname in ('clinic_finance_doctor_dues','clinic_finance_doctor_payout_invoices','doctor_dues')"))[0].n, 0); assert.equal((await owner("select to_regclass('clinic_finance.doctor_payout_invoices') t"))[0].t, null);
  assert.equal((await owner('select count(*)::int n from clinic_finance.doctor_payouts'))[0].n, payoutsBefore, 'payouts untouched'); await db.exec(mig(M));
  console.log('PASS doctor payout by invoice SQL: statuses for every case, chosen invoices carried by the request, gross = sum of fees, idempotent replay, no double payment (requested/paid), rejected frees invoices, existing gates (tax, cash shift, maker-checker, financial-manager review), access, read-only, rollback guard');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
