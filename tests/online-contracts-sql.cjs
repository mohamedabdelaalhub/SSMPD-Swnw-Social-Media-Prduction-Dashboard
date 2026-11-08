// Online doctor contracts: SQL rehearsal on PGlite with the REAL finance base migrations (contracts + maker-checker) and the new migration.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('node:assert/strict');
const root = path.resolve('.'), id = n => '40000000-0000-4000-8000-' + String(n).padStart(12, '0'), key = () => crypto.randomUUID();
(async () => {
  const db = new PGlite();
  const fixture = fs.readFileSync('tests/inventory-locations-sql.cjs', 'utf8');
  const setup = fixture.slice(fixture.indexOf(' await db.exec(`create role'), fixture.indexOf(' for(const [n,role,name]'));
  await new (Object.getPrototypeOf(async function () {}).constructor)('db', 'fs', 'path', 'root', setup)(db, fs, path, root);
  await db.exec(`create table admin_module_permissions(admin_id uuid,module_key text,can_view boolean,can_create boolean,can_update boolean);
    create function finance_module_allowed(m text,a text) returns boolean language sql stable security definer as $$select exists(select 1 from admin_module_permissions where admin_id=my_admin_id() and module_key=m and can_view and case a when 'create' then can_create when 'update' then can_update else true end)$$;`);
  const mig = n => fs.readFileSync('supabase/migrations/' + n, 'utf8');
  for (const n of ['20261017003349_clinic_cash_control.sql', '20261017004849_clinic_stock_insurance_controls.sql', '20261017010341_clinic_doctor_settlements.sql']) await db.exec(mig(n));
  // stubs of tables owned by other (already applied) migrations: HR people link + price catalogue names
  await db.exec(`create schema clinic_people; create table clinic_people.people(id uuid primary key default gen_random_uuid(), admin_id uuid unique references admins(id), doctor_key text unique, status text not null default 'active');
    create table public.pricing_services(booking_code text, name text, active boolean default true);
    insert into public.pricing_services values ('D-1','حشو أسنان تجميلي'),('CONS','كشف');
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;`);
  // 1 super 2 accountant(create) 3 financial_manager(review) 4 doctor Q (linked) 5 doctor S (linked) 6 plain user (no link) 7 accountant without perms
  for (const [n, role] of [[1, 'super_admin'], [2, 'accountant'], [3, 'financial_manager'], [4, 'sono_doctor'], [5, 'sono_doctor'], [6, 'reception'], [7, 'accountant']]) await db.query('insert into admins(id,name,role) values($1,$2,$3)', [id(n), 'Test ' + n, role]);
  await db.exec(`insert into admin_module_permissions values('${id(2)}','accounting',true,true,true),('${id(3)}','accounting',true,true,true)`);
  await db.exec(`insert into clinic_people.people(admin_id,doctor_key) values('${id(4)}','DOC-Q'),('${id(5)}','DOC-S')`);
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); };
  const owner = async (q, a = []) => { await db.exec('reset role'); return (await db.query(q, a)).rows; };
  const call = async (fn, args = []) => (await db.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).rows[0].v;
  const fails = async (p, re) => { let e; try { await p; } catch (x) { e = x; } assert(e, 'expected failure ' + re); if (re) assert(re.test(e.message), e.message + ' !~ ' + re); };
  const fin = (fn, args) => call('clinic_finance_' + fn, args);
  const today = (await owner("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d;
  const shift = d => new Date(Date.parse(today) + d * 864e5).toISOString().slice(0, 10);
  const mkc = async (doctor, scope, rate, ref = 'اتفاق 2027') => { await as(2); const cid = await fin('doctor_command', ['contract', { doctor_key: doctor, doctor_name: 'طبيب ' + doctor, scope, from: shift(-30), to: shift(30), rate, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: ref, ...(arguments[4] || {}) }, key()]); return cid; };
  const approve = async cid => { await as(3); await fin('doctor_command', ['contract_review', { id: cid, approve: true, note: 'اعتماد اختبار' }, key()]); };

  // ---- APPLY (+ privileges as production: authenticated only, no anon)
  await db.exec('reset role'); await db.exec(mig('20261108280000_online_contracts.sql'));
  const tmpls = await owner('select kind,version,published,placeholder from clinic_finance.contract_templates order by kind');
  assert.deepEqual(tmpls.map(t => [t.kind, t.version, t.published, t.placeholder]), [['consent', 1, false, true], ['contract', 1, false, true]], 'seeded placeholders are unpublished');
  for (const t of ['contract_templates', 'signature_requests', 'acceptances']) {
    await as(2); await fails(db.query(`select * from clinic_finance.${t}`), /permission denied/);
  }
  await fails(owner('select 1').then(() => db.exec('reset role; set role anon; select public.doctor_contract_inbox()')), /permission denied/);

  // ---- contracts: approved first
  const c1 = await mkc('DOC-Q', 'D-1', 30), c2 = await mkc('DOC-Q', 'قسم:الاسنان', 40), s1 = await mkc('DOC-S', 'CONS', 50, 'اتفاق ثاني');
  await as(2); await fails(fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]), /قيد الاعتماد/);
  await approve(c1);
  await as(2); await fails(fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]), /قيد الاعتماد/);
  await approve(c2); await approve(s1);

  // ---- send needs a PUBLISHED contract template
  await as(2); await fails(fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]), /نص عقد منشور/);
  await as(2); await fails(fin('contract_signature_command', ['template_publish', { id: (await owner("select id from clinic_finance.contract_templates where kind='contract'"))[0].id }, key()]), /صلاحية/); // accountant cannot publish (review = financial manager)
  const tid1 = (await owner("select id from clinic_finance.contract_templates where kind='contract'"))[0].id;
  await as(3); await fin('contract_signature_command', ['template_publish', { id: tid1 }, key()]);
  await as(7); await fails(fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]), /صلاحية/);
  await as(6); await fails(fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]), /صلاحية/);
  await fails(fin('contract_signature_status'), /صلاحية/);

  // ---- send: group = same doctor + reference; idempotent on token
  const tk = key(); await as(2);
  const r1 = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, tk]);
  assert.equal(await fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, tk]), r1, 'same token = same request');
  const req = (await owner('select * from clinic_finance.signature_requests where id=$1', [r1]))[0];
  assert.deepEqual([...req.contract_ids].sort(), [c1, c2].sort(), 'only the doctor\'s contracts of THAT reference');
  assert(req.rendered_text.includes('طبيب DOC-Q') && req.rendered_text.includes('حشو أسنان تجميلي (D-1)') && req.rendered_text.includes('كل خدمات قسم الاسنان') && req.rendered_text.includes('نسبة 30') && req.rendered_text.includes('جدول الشروط المالية'), 'text = template + generated schedule with service names');
  assert.equal(req.text_sha256, crypto.createHash('sha256').update(req.rendered_text, 'utf8').digest('hex'), 'sha256 of the rendered text');

  // ---- accountant sees status on contract rows
  let st = await fin('contract_signature_status');
  assert.equal(st.contracts[c1].state, 'pending'); assert.equal(st.contracts[c2].state, 'pending'); assert.equal(st.contracts[s1], undefined, 'other doctor/reference not sent');
  assert.equal(st.requests[0].linked, true);

  // ---- doctor sees ONLY his own
  await as(4); let inbox = await call('doctor_contract_inbox');
  assert.equal(inbox.linked, true); assert.equal(inbox.doctor_key, 'DOC-Q'); assert.equal(inbox.requests.length, 1); assert.equal(inbox.pending, 1); assert.equal(inbox.consent, null, 'consent template still unpublished');
  await as(5); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.doctor_key, 'DOC-S'); assert.equal(inbox.requests.length, 0, 'doctor S sees nothing of Q');
  await as(6); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.linked, false); assert.equal(inbox.requests.length, 0);
  await as(5); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA']), /الطلب غير متاح/);
  await as(6); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA']), /غير مربوط/);
  await as(2); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA']), /غير مربوط/);

  // ---- accept: sha must match, idempotent, opposite decision refused
  await as(4); await fails(call('doctor_contract_decide', [r1, true, null, 'f'.repeat(64), 'UA']), /لا يطابق/);
  const ua = 'Mozilla/5.0 test ' + 'x'.repeat(400);
  const d1 = await call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua]); assert.equal(d1.status, 'accepted'); assert.equal(d1.repeated, false);
  const d2 = await call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua]); assert.equal(d2.repeated, true); assert.equal(d2.decided_at, d1.decided_at);
  await fails(call('doctor_contract_decide', [r1, false, 'سبب الرفض', req.text_sha256, ua]), /من قبل/);
  const accs = await owner('select * from clinic_finance.acceptances where request_id=$1', [r1]);
  assert.equal(accs.length, 1, 'double accept stays ONE record'); assert.equal(accs[0].admin_id, id(4)); assert.equal(accs[0].doctor_key, 'DOC-Q'); assert.equal(accs[0].text_sha256, req.text_sha256); assert.equal(accs[0].template_version, 1); assert.equal(accs[0].user_agent.length, 300);
  assert(!('ip' in accs[0]) && !Object.keys(accs[0]).some(k => /ip_|^ip/.test(k)), 'no IP column');
  await as(2); st = await fin('contract_signature_status'); assert.equal(st.contracts[c1].state, 'accepted'); assert(st.contracts[c1].at);

  // ---- accruals untouched: acceptance changes nothing in the finance tables
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_accruals"))[0].n, 0);

  // ---- template version change invalidates a PENDING request (accepted ones stay history)
  await as(2); const r2 = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-S', reference: 'اتفاق ثاني' }, key()]);
  const req2 = (await owner('select * from clinic_finance.signature_requests where id=$1', [r2]))[0];
  await as(3); await fin('contract_signature_command', ['template_publish', { kind: 'contract', title: 'نص المحامي النهائي', body: 'نص نهائي للعقد: {{doctor_name}} {{reference}} — نسخة {{template_version}}' }, key()]);
  await as(5); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.requests[0].stale, true); assert.equal(inbox.pending, 0, 'stale requests are not counted as pending');
  await fails(call('doctor_contract_decide', [r2, true, null, req2.text_sha256, 'UA']), /اتغيّرت/);
  await as(2); st = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-S', reference: 'اتفاق ثاني' }, key()]).then(async r3 => ({ r3 })); // resend on the new version
  const req3 = (await owner('select * from clinic_finance.signature_requests where id=$1', [st.r3]))[0];
  assert.equal(req3.template_version, 2); assert(req3.rendered_text.startsWith('نص نهائي للعقد: طبيب DOC-S اتفاق ثاني — نسخة 2'));
  assert.equal((await owner('select status from clinic_finance.signature_requests where id=$1', [r2]))[0].status, 'void', 'older pending request voided by the resend');
  await as(5); await fails(call('doctor_contract_decide', [r2, true, null, req2.text_sha256, 'UA']), /الطلب غير متاح/);
  const d3 = await call('doctor_contract_decide', [st.r3, false, 'ab', req3.text_sha256, 'UA']).catch(e => e.message); assert(/سبب الرفض/.test(d3), 'reject needs a reason');
  const d4 = await call('doctor_contract_decide', [st.r3, false, 'النسبة غير مناسبة', req3.text_sha256, 'UA']); assert.equal(d4.status, 'rejected');
  await as(2); let s2 = await fin('contract_signature_status'); assert.equal(s2.contracts[s1].state, 'rejected'); assert.equal(s2.contracts[s1].reason, 'النسبة غير مناسبة');
  // the accepted Q request stays accepted although the template moved on
  assert.equal(s2.contracts[c1].state, 'accepted');

  // ---- changed contract terms also invalidate a pending request
  await as(2); const r4 = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-Q', reference: 'اتفاق 2027' }, key()]);
  await owner("update clinic_finance.doctor_contracts set valid_to = valid_to - 1 where id=$1", [c1]);
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.requests.find(r => r.id === r4).stale, true, 'contract changed after sending');
  await as(2); s2 = await fin('contract_signature_status'); assert.equal(s2.contracts[c1].state, 'stale');

  // ---- consent: shown until accepted, idempotent, version bump asks again, never blocks anything
  await as(3); await fin('contract_signature_command', ['template_publish', { id: (await owner("select id from clinic_finance.contract_templates where kind='consent'"))[0].id }, key()]);
  await as(4); inbox = await call('doctor_contract_inbox'); assert(inbox.consent && !inbox.consent.accepted_at && inbox.consent.body.includes('المسؤول مهنيًا'));
  await fails(call('doctor_consent_accept', [inbox.consent.template_id, 'a'.repeat(64), 'UA']), /لا يطابق/);
  const c = await call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA']); const c2r = await call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA']);
  assert.equal(c2r.repeated, true); assert.equal((await owner("select count(*)::int n from clinic_finance.acceptances where kind='consent'"))[0].n, 1);
  await as(5); inbox = await call('doctor_contract_inbox'); assert(!inbox.consent.accepted_at, 'doctor S has not accepted the consent');
  await as(3); await fin('contract_signature_command', ['template_publish', { kind: 'consent', title: 'إقرار نهائي', body: 'نص الإقرار النهائي من المحامي، نسخة جديدة' }, key()]);
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.consent.version, 2); assert(!inbox.consent.accepted_at, 'new version asks again');
  await fails(call('doctor_consent_accept', [(await owner("select id from clinic_finance.contract_templates where kind='consent' and version=1"))[0].id, 'x', 'UA']), /أحدث/);
  await as(2); assert.equal((await fin('contract_signature_status')).consents['DOC-Q'].version, 1);

  // ---- void + rollback
  await as(2); await fin('contract_signature_command', ['void', { id: r4, note: 'غلط' }, key()]);
  await db.exec('reset role');
  await fails(db.exec(fs.readFileSync('supabase/rollbacks/20261108280000_online_contracts.rollback.sql', 'utf8')), /منفصل|مسجّلة/);
  await db.exec('rollback; delete from clinic_finance.acceptances; delete from clinic_finance.signature_requests;');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261108280000_online_contracts.rollback.sql', 'utf8'));
  assert.equal((await owner("select to_regclass('clinic_finance.acceptances') t"))[0].t, null);
  assert.equal((await owner("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('doctor_contract_inbox','doctor_contract_decide','doctor_consent_accept','contract_render','request_stale','clinic_finance_contract_signature_status')"))[0].n, 0, 'rollback removes all functions');
  await db.exec(mig('20261108280000_online_contracts.sql'));  // re-applies cleanly after rollback
  console.log('online-contracts-sql: OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
