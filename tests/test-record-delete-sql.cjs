// Owner-only «حذف سجل تجريبي» (20261109110000): flag as test (reason + confirmation) -> delete with full archive in ONE transaction. PGlite with the REAL finance migrations.
// Covers: owner-only access, unflagged refusal, every refusal (payments, payouts, claims, closed period, stock, linked records), archive == deleted rows, rollback on error, append-only archive, rollback script.
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

  // ===================== TEST-RECORD DELETE =====================
  const T = '20261109110000_test_record_delete.sql', TR = 'supabase/rollbacks/20261109110000_test_record_delete.rollback.sql';
  // extra tables of production that the slice does not load (stubs with the real column names used by the migration)
  const ddl = async q => { await db.exec('reset role'); await db.exec(q); };
  await ddl(`create schema if not exists clinic_reception;
    create table if not exists clinic_reception.items(id uuid primary key default gen_random_uuid(), workspace_id uuid, code text, name text, unit text, markup numeric, sale_price numeric, highest_cost numeric, track_expiry boolean, inventory_item_id uuid);
    create table clinic_reception.lots(id uuid primary key default gen_random_uuid(), item_id uuid references clinic_reception.items(id));
    create table clinic_reception.movements(id uuid primary key default gen_random_uuid(), item_id uuid references clinic_reception.items(id));
    create table clinic_reception.purchase_lines(id uuid primary key default gen_random_uuid(), item_id uuid references clinic_reception.items(id));
    create table clinic_reception.transfers(id uuid primary key default gen_random_uuid(), item_id uuid references clinic_reception.items(id));
    create table clinic_finance.inventory_catalog_prices(item_id uuid primary key references public.inventory_items(id) on delete cascade, reference_purchase_price numeric(14,4));
    create table public.pricing_supplies(id uuid primary key default gen_random_uuid(), name text, category text, active boolean default true, inventory_item_id uuid references public.inventory_items(id));
    alter table clinic_finance.doctor_contracts add column if not exists supersedes uuid references clinic_finance.doctor_contracts(id);   -- (contract revisions 20261108240000, not loaded by this slice)
    alter table public.pricing_services add column if not exists supplies_used jsonb default '[]';`);
  await db.exec('reset role'); await db.exec(mig(T));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig(T)); }, /تم تطبيق هذا الملف/, 'second apply refused'); await db.exec('rollback');
  await db.exec('reset role'); await db.exec('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role');

  const snapshot = async (tbl, col, vals) => (await owner(`select to_jsonb(t) r from ${tbl} t where t.${col}::text = any($1) order by 1::text`, [vals])).map(x => JSON.stringify(x.r)).sort();
  const cnt = async q => Number((await owner(q))[0].n);
  const tf = async (n, fn, ...a) => { await as(n); return call('clinic_finance_test_' + fn, a); };
  const flagIt = (type, key, reason = 'سجل تجربة من المالك') => tf(1, 'flag', type, key, reason, 'تجريبي');
  const delIt = (type, key, reason = 'تنظيف بيانات التجربة') => tf(1, 'delete', type, key, reason, 'حذف');
  const archive = async del => (await owner('select source_table, row_data from clinic_finance.test_deletion_rows where deletion_id=$1', [del]));
  const notDeleted = async (inv) => { assert.equal(await cnt(`select count(*)::int n from clinic_finance.invoices where id='${inv}'`), 1); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows'), rowsBefore()); };
  let archivedRows = 0; const rowsBefore = () => archivedRows;

  // ---- 1. ACCESS: only the owner (super_admin). financial manager, accountants, reception and anon are refused everywhere.
  const probe = [['overview'], ['find', 'invoice', ''], ['scan', 'invoice', id(777)], ['flag', 'invoice', id(777), 'سبب تجربة', 'تجريبي'], ['unflag', 'invoice', id(777), 'سبب تجربة'], ['delete', 'invoice', id(777), 'سبب تجربة', 'حذف']];
  for (const n of [2, 3, 4, 5]) for (const [fn, ...a] of probe) await assert.rejects(tf(n, fn, ...a), /للمالك فقط/, `admin ${n} refused: ${fn}`);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(call('clinic_finance_test_overview'), /permission denied/, 'anon cannot even execute'); await db.exec('reset role');
  await as(1); await assert.rejects(db.query('select * from clinic_finance.test_flags'), /permission denied/, 'even the owner has no direct table access (only the RPCs)');
  await assert.rejects(db.query('select * from clinic_finance.test_deletion_rows'), /permission denied/);

  // ---- 2. INVOICE: build a test doctor with a billed (unpaid) test invoice + a REAL invoice with a payment
  const TD = 'TST-DOC'; await mkc(TD, 'قسم:الاسنان', 50);
  const mkt = (ref, amt, doc = TD) => bill(2, { reference: ref, patient_ref: 'مريض تجريبي', service_amount: amt, doctor_key: doc, service_lines: [{ code: 'D-1', amount: amt }] });
  const I1 = await mkt('TST-INV-1', 600), IP = await mkt('TST-REAL-PAID', 400);
  await pay(IP, 400, 'RP');
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.entries where source='invoice' and source_id='${I1}'`), 1, 'the invoice has its journal entry');
  const ent1 = (await owner(`select id from clinic_finance.entries where source='invoice' and source_id='${I1}'`))[0].id;
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.lines where entry_id='${ent1}'`), 2);
  // never deletable while not flagged
  await assert.rejects(delIt('invoice', I1), /غير مُعلَّم/, 'unflagged data is never deleted');
  // flag validation
  await assert.rejects(tf(1, 'flag', 'invoice', I1, 'سبب كافي', 'غلط'), /«تجريبي»/, 'typed confirmation required');
  await assert.rejects(tf(1, 'flag', 'invoice', I1, 'x', 'تجريبي'), /٥ حروف/, 'reason required');
  await assert.rejects(tf(1, 'flag', 'invoice', id(999), 'سبب كافي', 'تجريبي'), /غير موجود/);
  await assert.rejects(tf(1, 'flag', 'nonsense', I1, 'سبب كافي', 'تجريبي'), /غير مدعوم/);
  await assert.rejects(tf(1, 'flag', 'invoice', 'not-a-uuid', 'سبب كافي', 'تجريبي'), /غير صالح/);
  // a REAL invoice (payment) can not even be flagged, and the reason says why
  await assert.rejects(flagIt('invoice', IP), /دفعات مسجلة على الفاتورة \(1\)/, 'invoice with a payment: refused with the Arabic reason');
  // scan (read only) shows what is there
  let sc = await tf(1, 'scan', 'invoice', I1);
  assert.equal(sc.deletable, true); assert.equal(sc.flagged, false); assert.deepEqual(sc.blockers, []);
  assert.equal(sc.counts['clinic_finance.invoices'], 1); assert.equal(sc.counts['clinic_finance.entries'], 1); assert.equal(sc.counts['clinic_finance.lines'], 2);
  assert.equal(sc.counts['clinic_finance.doctor_accruals'], 1); assert.equal(sc.counts['clinic_finance.doctor_allocations'], 1); assert.equal(sc.counts['clinic_finance.doctor_allocation_lines'], 1);
  const found = await tf(1, 'find', 'invoice', 'TST-INV'); assert.equal(found.length, 1); assert.equal(found[0].key, I1); assert.equal(found[0].flagged, false);
  const fid = await flagIt('invoice', I1);
  assert(fid); assert.equal((await tf(1, 'find', 'invoice', 'TST-INV'))[0].flagged, true);
  await assert.rejects(flagIt('invoice', I1), /بالفعل/, 'double flag refused');
  // a payment arrives AFTER flagging -> deletion refused, nothing touched, no archive rows
  await pay(I1, 100, 'LATE');
  await assert.rejects(delIt('invoice', I1), /مرفوض.*دفعات مسجلة على الفاتورة/, 'a later payment blocks the deletion');
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.invoices where id='${I1}'`), 1); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows'), 0);
  await owner("delete from clinic_finance.payments where reference='LATE'");
  // payout of the doctor blocks (doctor_payouts) ...
  const payoutRow = (await owner(`insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token,status) values($1,50,0,'bank','PAYREF','2026-01-01','2026-12-31','{}',$2,gen_random_uuid(),'pending') returning id`, [TD, id(2)]))[0].id;
  await assert.rejects(delIt('invoice', I1), /الطبيب المنسوب إليه الفاتورة له عمليات صرف/, 'doctor payout blocks');
  await owner("update clinic_finance.doctor_payouts set status='rejected' where id=$1", [payoutRow]);   // a rejected payout is not real activity
  // ... and so does a payout-by-invoice link, insurance claim, closed period, shift entry, extra entry
  await owner('insert into clinic_finance.doctor_payout_invoices(payout_id,invoice_id,doctor_key,fee) values($1,$2,$3,10)', [payoutRow, I1, TD]);
  await assert.rejects(delIt('invoice', I1), /صرف أتعاب دكتور/); await owner('delete from clinic_finance.doctor_payout_invoices');
  const cl = await claim(I1, 'شركة', 100, 'CL-T'); await assert.rejects(delIt('invoice', I1), /مطالبات تأمين/); await owner('delete from clinic_finance.insurance_claims where id=$1', [cl]);
  await owner("insert into clinic_finance.periods(closed_through, created_by) values ($1::date + 1, $2)", [today, id(1)]);
  await assert.rejects(delIt('invoice', I1), /فترة مالية مقفلة/, 'closed period blocks'); await owner('delete from clinic_finance.periods');
  await owner(`insert into clinic_finance.entries(source,source_id,description,created_by) values('collection','${I1}','x',$1)`, [id(2)]);
  await assert.rejects(delIt('invoice', I1), /قيود أخرى/); await owner(`delete from clinic_finance.entries where source='collection' and source_id='${I1}'`);
  // ATOMICITY: an error in the middle of the deletion rolls back archive + deletes. (1) an unknown dependent (FK) (2) a failing trigger on the last delete
  await ddl('create table clinic_finance.zz_dep(invoice_id uuid references clinic_finance.invoices(id))'); await owner(`insert into clinic_finance.zz_dep values('${I1}')`);
  await assert.rejects(delIt('invoice', I1), /مرتبط ببيانات أخرى لا يجوز حذفها/, 'unknown dependents are caught by the foreign keys');
  await ddl('drop table clinic_finance.zz_dep');
  await ddl(`create function clinic_finance.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$; create trigger zz_boom before delete on clinic_finance.invoices for each row execute function clinic_finance.zz_boom()`);
  const snapBefore = { ent: await snapshot('clinic_finance.entries', 'id', [ent1]), lines: await snapshot('clinic_finance.lines', 'entry_id', [ent1]), acc: await snapshot('clinic_finance.doctor_accruals', 'invoice_id', [I1]), alloc: await snapshot('clinic_finance.doctor_allocations', 'invoice_id', [I1]) };
  await assert.rejects(delIt('invoice', I1), /boom/);
  assert.deepEqual(await snapshot('clinic_finance.entries', 'id', [ent1]), snapBefore.ent, 'entries restored'); assert.deepEqual(await snapshot('clinic_finance.lines', 'entry_id', [ent1]), snapBefore.lines, 'lines restored');
  assert.deepEqual(await snapshot('clinic_finance.doctor_accruals', 'invoice_id', [I1]), snapBefore.acc); assert.deepEqual(await snapshot('clinic_finance.doctor_allocations', 'invoice_id', [I1]), snapBefore.alloc);
  assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletion_rows'), 0, 'archive rolled back with the deletes'); assert.equal(await cnt('select count(*)::int n from clinic_finance.test_deletions'), 0);
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.test_flags where record_key='${I1}' and deleted_at is null and unflagged_at is null`), 1, 'flag still active after a failed deletion');
  await ddl('drop trigger zz_boom on clinic_finance.invoices; drop function clinic_finance.zz_boom()');
  // other doctors' / other invoices untouched
  const otherBefore = { inv: await snapshot('clinic_finance.invoices', 'id', [IP]), acc: await snapshot('clinic_finance.doctor_accruals', 'invoice_id', [IP]) };
  const full = { inv: await snapshot('clinic_finance.invoices', 'id', [I1]), aud: await snapshot('clinic_finance.audit', 'entity_id', [I1]), alloc: snapBefore.alloc, acc: snapBefore.acc, ent: snapBefore.ent, lines: snapBefore.lines, dal: await snapshot('clinic_finance.doctor_allocation_lines', 'invoice_id', [I1]) };
  assert(full.aud.length >= 1, 'the invoice has audit rows');
  // THE DELETION
  const del1 = await delIt('invoice', I1, 'فاتورة تجربة أنشأها المحاسب');
  for (const [t, c, v] of [['invoices', 'id', I1], ['entries', 'id', ent1], ['lines', 'entry_id', ent1], ['audit', 'entity_id', I1], ['doctor_allocations', 'invoice_id', I1], ['doctor_accruals', 'invoice_id', I1], ['doctor_allocation_lines', 'invoice_id', I1]])
    assert.equal(await cnt(`select count(*)::int n from clinic_finance.${t} where ${c}::text='${v}'`), 0, t + ' deleted');
  const arch = await archive(del1), by = t => arch.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual(by('clinic_finance.invoices'), full.inv, 'archive holds the FULL invoice row'); assert.deepEqual(by('clinic_finance.entries'), full.ent); assert.deepEqual(by('clinic_finance.lines'), full.lines);
  assert.deepEqual(by('clinic_finance.doctor_allocations'), full.alloc); assert.deepEqual(by('clinic_finance.doctor_accruals'), full.acc); assert.deepEqual(by('clinic_finance.doctor_allocation_lines'), full.dal);
  assert.deepEqual(by('clinic_finance.audit'), full.aud, 'audit rows archived (before the new deletion audit row)');
  archivedRows = arch.length;
  const hdr = (await owner('select * from clinic_finance.test_deletions where id=$1', [del1]))[0];
  assert.equal(hdr.record_type, 'invoice'); assert.equal(hdr.record_key, I1); assert.equal(hdr.deleted_by, id(1), 'who'); assert(hdr.deleted_at, 'when'); assert.equal(hdr.reason, 'فاتورة تجربة أنشأها المحاسب', 'why');
  assert.equal(hdr.flag_reason, 'سجل تجربة من المالك'); assert.equal(hdr.flagged_by, id(1)); assert(hdr.label.includes('TST-INV-1'), 'what'); assert.equal(hdr.row_counts['clinic_finance.invoices'], 1); assert.equal(hdr.row_counts['clinic_finance.lines'], 2);
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.audit where action='test_record_deleted' and entity_id='${del1}'`), 1, 'the deletion itself is audited');
  assert.deepEqual({ inv: await snapshot('clinic_finance.invoices', 'id', [IP]), acc: await snapshot('clinic_finance.doctor_accruals', 'invoice_id', [IP]) }, otherBefore, 'the real invoice is untouched');
  await assert.rejects(delIt('invoice', I1), /غير مُعلَّم/, 'cannot delete twice');
  await assert.rejects(flagIt('invoice', I1), /غير موجود/);
  const ov = await tf(1, 'overview'); assert.equal(ov.flags.length, 0); assert.equal(ov.deletions.length, 1); assert.equal(ov.deletions[0].id, del1); assert.equal(ov.deletions[0].counts['clinic_finance.invoices'], 1);

  // ---- append-only archive
  await assert.rejects(owner('update clinic_finance.test_deletion_rows set source_table=$1', ['x']), /لا يُعدَّل/); await assert.rejects(owner('delete from clinic_finance.test_deletions'), /لا يُعدَّل ولا يُحذف/);

  // ---- 3. DOCTOR CONTRACT
  const cT = await mkc('TST-DOC3', 'قسم:الاسنان', 30), cU = await mkc('TST-DOC3', 'D-1', 40);
  const I3 = await mkt('TST-INV-3', 300, 'TST-DOC3');
  const cUsed = (await owner('select contract_id c from clinic_finance.doctor_allocations where invoice_id=$1', [I3]))[0].c;
  const cFree = [cT, cU].find(c => c !== cUsed);
  await flagIt('doctor_contract', cUsed).then(() => { throw new Error('contract in use must not be flaggable'); }, e => assert.match(e.message, /استُخدم في حساب فواتير/, 'contract used by an invoice: refused: ' + e.message));
  await flagIt('doctor_contract', cFree);
  const dc = await delIt('doctor_contract', cFree);
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.doctor_contracts where id='${cFree}'`), 0); assert.equal((await archive(dc)).length, 1); assert.equal((await archive(dc))[0].row_data.id, cFree); assert.equal((await archive(dc))[0].row_data.doctor_key, 'TST-DOC3');
  archivedRows += 1;

  // ---- 4. WHOLE TEST DOCTOR (doctor_key) with its accruals/allocations
  await assert.rejects(flagIt('doctor_key', 'TST-DOC3'), /ليست مُعلَّمة «تجريبي»/, 'doctor has an unflagged invoice: refused');
  await flagIt('invoice', I3);
  await flagIt('doctor_key', 'TST-DOC3');
  const dsnap = { c: await snapshot('clinic_finance.doctor_contracts', 'doctor_key', ['TST-DOC3']), a: await snapshot('clinic_finance.doctor_accruals', 'doctor_key', ['TST-DOC3']), al: await snapshot('clinic_finance.doctor_allocations', 'doctor_key', ['TST-DOC3']), l: await snapshot('clinic_finance.doctor_allocation_lines', 'invoice_id', [I3]) };
  assert(dsnap.c.length >= 1 && dsnap.a.length === 1 && dsnap.al.length === 1 && dsnap.l.length === 1);
  const dp = (await owner(`insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token,status) values('TST-DOC3',10,0,'bank','P3','2026-01-01','2026-12-31','{}',$1,gen_random_uuid(),'approved') returning id`, [id(2)]))[0].id;
  await assert.rejects(delIt('doctor_key', 'TST-DOC3'), /عمليات صرف أتعاب/, 'doctor payouts block'); await owner('delete from clinic_finance.doctor_payouts where id=$1', [dp]);
  const dd = await delIt('doctor_key', 'TST-DOC3', 'طبيب تجربة');
  for (const t of ['doctor_contracts', 'doctor_accruals', 'doctor_allocations']) assert.equal(await cnt(`select count(*)::int n from clinic_finance.${t} where doctor_key='TST-DOC3'`), 0, t);
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.doctor_allocation_lines where invoice_id='${I3}'`), 0);
  const da = await archive(dd), byd = t => da.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual(byd('clinic_finance.doctor_contracts'), dsnap.c); assert.deepEqual(byd('clinic_finance.doctor_accruals'), dsnap.a); assert.deepEqual(byd('clinic_finance.doctor_allocations'), dsnap.al); assert.deepEqual(byd('clinic_finance.doctor_allocation_lines'), dsnap.l);
  archivedRows += da.length;
  assert.equal(await cnt(`select count(*)::int n from clinic_finance.invoices where id='${I3}'`), 1, 'the (still flagged) invoice remains until the owner deletes it too');
  await delIt('invoice', I3); archivedRows = await cnt('select count(*)::int n from clinic_finance.test_deletion_rows');
  assert.equal(Number((await owner("select clinic_finance.doctor_balance('TST-DOC3') v"))[0].v || 0), 0, 'no balance left for the test doctor');

  // ---- 5. INVENTORY ITEM (+ reception item, alerts, price history, catalog price) and PRICING SUPPLY
  const item = async (name) => (await owner("insert into public.inventory_items(name, created_by) values ($1,$2) returning id", [name, id(1)]))[0].id;
  const X = await item('صنف تجربة'), Y = await item('صنف حقيقي');
  await owner(`insert into clinic_reception.items(workspace_id, code, name, inventory_item_id) values ($1,'INV-${X}','صنف تجربة',$2)`, [W, X]);
  await owner("insert into public.inventory_alerts(item_id, alert_type, message) values ($1,'low_stock','x')", [X]);
  await owner("insert into public.inventory_price_history(item_id, previous_price,new_price,previous_markup,new_markup,changed_by) values ($1,1,2,0,0,$2)", [X, id(1)]);
  await owner("insert into clinic_finance.inventory_catalog_prices values ($1, 5)", [X]);
  const SUP = (await owner("insert into public.pricing_supplies(name, inventory_item_id) values ('مستلزم تجربة',$1) returning id", [X]))[0].id;
  await assert.rejects(delIt('inventory_item', X), /غير مُعلَّم/);
  await assert.rejects(flagIt('inventory_item', X), /مستلزم تسعير مربوط بالصنف/, 'linked pricing supply must go first');
  // supply used by a service price -> refused
  await owner(`update public.pricing_services set supplies_used='[{"supply_id":"${SUP}","quantity":1}]' where id=(select id from public.pricing_services limit 1)`);
  await assert.rejects(flagIt('pricing_supply', SUP), /داخل تسعير خدمة/, 'a supply used in a service price is real data');
  await owner("update public.pricing_services set supplies_used='[]'");
  await flagIt('pricing_supply', SUP); const ds = await delIt('pricing_supply', SUP); assert.equal(await cnt(`select count(*)::int n from public.pricing_supplies where id='${SUP}'`), 0); assert.equal((await archive(ds))[0].row_data.name, 'مستلزم تجربة');
  await flagIt('inventory_item', X);
  const isnap = { it: await snapshot('public.inventory_items', 'id', [X]), al: await snapshot('public.inventory_alerts', 'item_id', [X]), ph: await snapshot('public.inventory_price_history', 'item_id', [X]), cp: await snapshot('clinic_finance.inventory_catalog_prices', 'item_id', [X]), ri: await snapshot('clinic_reception.items', 'inventory_item_id', [X]) };
  // stock activity blocks
  await owner("insert into public.inventory_movements(item_id, movement_type, quantity_delta, created_by) values ($1,'receipt',1,$2)", [X, id(1)]);
  await assert.rejects(delIt('inventory_item', X), /حركات مخزون/, 'stock movements block'); await owner('delete from public.inventory_movements where item_id=$1', [X]);
  await owner("insert into clinic_reception.lots(item_id) select id from clinic_reception.items where inventory_item_id=$1", [X]);
  await assert.rejects(delIt('inventory_item', X), /استقبال العيادة/, 'reception stock blocks'); await owner('delete from clinic_reception.lots');
  const di = await delIt('inventory_item', X, 'صنف تجربة');
  assert.equal(await cnt(`select count(*)::int n from public.inventory_items where id='${X}'`), 0); assert.equal(await cnt(`select count(*)::int n from clinic_reception.items where inventory_item_id='${X}'`), 0);
  const ai = await archive(di), bi = t => ai.filter(r => r.source_table === t).map(r => JSON.stringify(r.row_data)).sort();
  assert.deepEqual(bi('public.inventory_items'), isnap.it); assert.deepEqual(bi('public.inventory_alerts'), isnap.al); assert.deepEqual(bi('public.inventory_price_history'), isnap.ph); assert.deepEqual(bi('clinic_finance.inventory_catalog_prices'), isnap.cp); assert.deepEqual(bi('clinic_reception.items'), isnap.ri);
  assert.equal(await cnt(`select count(*)::int n from public.inventory_items where id='${Y}'`), 1, 'the other item is untouched');
  await assert.rejects(flagIt('inventory_item', Y).then(() => delIt('inventory_item', Y, 'x')), /٥ حروف/, 'short reason refused');
  await tf(1, 'unflag', 'inventory_item', Y, 'تراجعت، الصنف حقيقي'); await assert.rejects(delIt('inventory_item', Y), /غير مُعلَّم/, 'unflagged again -> never deletable');
  await assert.rejects(tf(1, 'unflag', 'inventory_item', Y, 'تراجعت مرة ثانية'), /غير مُعلَّم/);

  // ---- 6. rollback script: refuses while the archive holds data; clean drop on an empty install; the migration can be re-applied
  await db.exec('reset role'); await assert.rejects(db.exec(fs.readFileSync(TR, 'utf8')), /فيها بيانات/); await db.exec('rollback');
  await ddl('truncate clinic_finance.test_deletion_rows, clinic_finance.test_deletions, clinic_finance.test_flags');
  await db.exec(fs.readFileSync(TR, 'utf8'));
  assert.equal(await cnt("select count(*)::int n from pg_proc where proname like 'clinic_finance_test_%' or proname like 'test_%'"), 0); assert.equal((await owner("select to_regclass('clinic_finance.test_flags') t"))[0].t, null);
  await db.exec(mig(T)); assert.equal((await owner("select count(*)::int n from clinic_finance.test_flags"))[0].n, 0);
  console.log('PASS test-record delete SQL: owner-only (financial manager/admins/anon refused), unflagged never deletable, refusals (payment, payout, claim, closed period, stock, linked/used records, real invoices of a doctor), archive == deleted rows (who/when/why/what), atomic rollback on error, append-only archive, doctor/contract/invoice/inventory/supply, rollback script');
})().catch(e => { console.error(e.message, e.where || '', e.position || ''); process.exitCode = 1; });
