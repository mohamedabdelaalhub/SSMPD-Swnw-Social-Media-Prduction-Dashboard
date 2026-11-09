// Online doctor contracts: SQL rehearsal on PGlite with the REAL finance base migrations (contracts + maker-checker) and the new migration.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('node:assert/strict');
const zlib = require('zlib');
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const makePng = () => { const w = 24, h = 24, ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), crypto.randomBytes(w * 4)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
const PNG = 'data:image/png;base64,' + makePng().toString('base64'), JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(300)]).toString('base64');
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
  await db.exec('reset role'); await db.exec(mig('20261109110000_online_contracts.sql'));
  const tmpls = await owner('select kind,version,published,placeholder from clinic_finance.contract_templates order by kind');
  assert.deepEqual(tmpls.map(t => [t.kind, t.version, t.published, t.placeholder]), [['consent', 1, false, true], ['contract', 1, false, true]], 'seeded placeholders are unpublished');
  assert.deepEqual((await owner('select rule, start_date from clinic_finance.contract_settings order by rule')).map(r => [r.rule, r.start_date]), [['consent', null], ['contract_signature', null]], 'both rules are OFF by default');
  for (const t of ['contract_templates', 'signature_requests', 'acceptances', 'contract_settings']) {
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
  await as(5); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA', 'drawn', PNG]), /الطلب غير متاح/);
  await as(6); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA', 'drawn', PNG]), /غير مربوط/);
  await as(2); await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, 'UA', 'drawn', PNG]), /غير مربوط/);

  // ---- accept: sha must match, idempotent, opposite decision refused
  await as(4); await fails(call('doctor_contract_decide', [r1, true, null, 'f'.repeat(64), 'UA', 'drawn', PNG]), /لا يطابق/);
  const ua = 'Mozilla/5.0 test ' + 'x'.repeat(400);
  // accepting needs a valid signature (drawn / uploaded PNG|JPEG); nothing is recorded when it is missing or bad
  await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua]), /اختر طريقة التوقيع/);
  await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'drawn', 'data:image/png;base64,AAAA']), /غير صالحة/);
  await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'drawn', 'data:text/html;base64,' + Buffer.from('<script>x</script>'.repeat(20)).toString('base64')]), /غير صالحة/);
  await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'scribble', PNG]), /اختر طريقة التوقيع/);
  await fails(call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'drawn', 'data:image/png;base64,' + 'A'.repeat(400001)]), /كبيرة/);
  assert.equal((await owner("select count(*)::int n from clinic_finance.acceptances"))[0].n, 0, 'rejected signatures record nothing');
  const d1 = await call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'drawn', PNG]); assert.equal(d1.status, 'accepted'); assert.equal(d1.repeated, false);
  const d2 = await call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'drawn', PNG]); assert.equal(d2.repeated, true); assert.equal(d2.decided_at, d1.decided_at);
  await fails(call('doctor_contract_decide', [r1, false, 'سبب الرفض', req.text_sha256, ua]), /من قبل/);
  const d2b = await call('doctor_contract_decide', [r1, true, null, req.text_sha256, ua, 'uploaded', JPG]); assert.equal(d2b.repeated, true, 'a repeat with another signature is still just the first record');
  const accs = await owner('select * from clinic_finance.acceptances where request_id=$1', [r1]);
  assert.equal(accs.length, 1, 'double accept stays ONE record'); assert.equal(accs[0].admin_id, id(4)); assert.equal(accs[0].doctor_key, 'DOC-Q'); assert.equal(accs[0].text_sha256, req.text_sha256); assert.equal(accs[0].template_version, 1); assert.equal(accs[0].user_agent.length, 300);
  assert.equal(accs[0].signature_kind, 'drawn'); assert.equal(accs[0].signature_image, PNG); assert.equal(accs[0].signature_sha256, crypto.createHash('sha256').update(Buffer.from(PNG.split(',')[1], 'base64')).digest('hex'), 'signature stored with its sha256');
  assert(!('ip' in accs[0]) && !Object.keys(accs[0]).some(k => /ip_|^ip/.test(k)), 'no IP column');
  await as(2); st = await fin('contract_signature_status'); assert.equal(st.contracts[c1].state, 'accepted'); assert(st.contracts[c1].at);
  assert.equal(st.contracts[c1].signature_kind, 'drawn'); assert(!JSON.stringify(st).includes(PNG.slice(30, 80)), 'status list never carries the signature image');
  const sd = await fin('contract_signed_document', [st.contracts[c1].acceptance_id]);
  assert.equal(sd.signature_image, PNG); assert.equal(sd.text, req.rendered_text); assert.equal(sd.text_sha256, req.text_sha256); assert.equal(sd.template_version, 1); assert.equal(sd.doctor_key, 'DOC-Q');
  await as(7); await fails(fin('contract_signed_document', [st.contracts[c1].acceptance_id]), /صلاحية/); await as(4); await fails(fin('contract_signed_document', [st.contracts[c1].acceptance_id]), /صلاحية|permission/);
  inbox = await call('doctor_contract_inbox'); assert.equal(inbox.requests[0].signature_image, PNG, 'the doctor sees his own signature on the signed contract');
  await as(5); inbox = await call('doctor_contract_inbox'); assert(!JSON.stringify(inbox).includes(PNG.slice(30, 80)), 'doctor S never sees doctor Q signature'); await as(2);

  // ---- accruals untouched: acceptance changes nothing in the finance tables
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_accruals"))[0].n, 0);

  // ---- template version change invalidates a PENDING request (accepted ones stay history)
  await as(2); const r2 = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-S', reference: 'اتفاق ثاني' }, key()]);
  const req2 = (await owner('select * from clinic_finance.signature_requests where id=$1', [r2]))[0];
  await as(3); await fin('contract_signature_command', ['template_save', { kind: 'contract', title: 'نص المحامي النهائي', body: 'نص نهائي للعقد: {{doctor_name}} {{reference}} — نسخة {{template_version}}', clauses: ['البند الأول للطبيب {{doctor_name}}', '', 'البند الثاني'], publish: true }, key()]);
  await as(5); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.requests[0].stale, true); assert.equal(inbox.pending, 0, 'stale requests are not counted as pending');
  await fails(call('doctor_contract_decide', [r2, true, null, req2.text_sha256, 'UA', 'drawn', PNG]), /اتغيّرت/);
  await as(2); st = await fin('contract_signature_command', ['send', { doctor_key: 'DOC-S', reference: 'اتفاق ثاني' }, key()]).then(async r3 => ({ r3 })); // resend on the new version
  const req3 = (await owner('select * from clinic_finance.signature_requests where id=$1', [st.r3]))[0];
  assert.equal(req3.template_version, 2); assert(req3.rendered_text.startsWith('نص نهائي للعقد: طبيب DOC-S اتفاق ثاني — نسخة 2'));
  assert(req3.rendered_text.includes('1. البند الأول للطبيب طبيب DOC-S\n2. البند الثاني'), 'clauses are numbered, blanks dropped, placeholders replaced');
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
  await fails(fin('contract_signature_command', ['template_publish', { id: (await owner("select id from clinic_finance.contract_templates where kind='consent'"))[0].id }, key()]), /منشور من قبل/);
  await as(4); inbox = await call('doctor_contract_inbox'); assert(inbox.consent && !inbox.consent.accepted_at && inbox.consent.body.includes('المسؤول مهنيًا') && inbox.consent.body.includes('2. أقر بأنني المسؤول'), 'consent = intro + numbered clauses');
  await fails(call('doctor_consent_accept', [inbox.consent.template_id, 'a'.repeat(64), 'UA', 'drawn', PNG]), /لا يطابق/);
  await fails(call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA']), /اختر طريقة التوقيع/);
  const c = await call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA', 'uploaded', JPG]); const c2r = await call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA', 'drawn', PNG]);
  assert.equal(c2r.repeated, true); assert.equal((await owner("select count(*)::int n from clinic_finance.acceptances where kind='consent'"))[0].n, 1); assert.equal((await owner("select signature_kind k from clinic_finance.acceptances where kind='consent'"))[0].k, 'uploaded', 'first signature kept; the repeat does not overwrite');
  await as(5); inbox = await call('doctor_contract_inbox'); assert(!inbox.consent.accepted_at, 'doctor S has not accepted the consent');
  await as(3); await fin('contract_signature_command', ['template_save', { kind: 'consent', title: 'إقرار نهائي', body: 'نص الإقرار النهائي من المحامي، نسخة جديدة', clauses: ['بند 1', 'بند 2'], publish: true }, key()]);
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.consent.version, 2); assert(!inbox.consent.accepted_at, 'new version asks again');
  await fails(call('doctor_consent_accept', [(await owner("select id from clinic_finance.contract_templates where kind='consent' and version=1"))[0].id, 'x', 'UA', 'drawn', PNG]), /أحدث/);
  await as(2); assert.equal((await fin('contract_signature_status')).consents['DOC-Q'].version, 1);

  // ---- owner edits the text: draft -> re-save -> publish; accountant cannot; old versions stay untouched
  await as(2); await fails(fin('contract_signature_command', ['template_save', { kind: 'consent', title: 'x y z', body: 'مقدمة طويلة بما يكفي للقبول', clauses: [] }, key()]), /صلاحية/);
  await as(3); await fails(fin('contract_signature_command', ['template_save', { kind: 'consent', title: 'x', body: 'مقدمة طويلة بما يكفي للقبول', clauses: [] }, key()]), /عنوان/);
  const dr = await fin('contract_signature_command', ['template_save', { kind: 'consent', title: 'مسودة', body: 'مقدمة المسودة الأولى للإقرار', clauses: ['أ'] }, key()]);
  assert.equal((await owner('select version, published from clinic_finance.contract_templates where id=$1', [dr]))[0].version, 3); assert.equal((await owner('select count(*)::int n from clinic_finance.contract_templates where kind=\'consent\'' ))[0].n, 3);
  const dr2 = await fin('contract_signature_command', ['template_save', { id: dr, kind: 'consent', title: 'مسودة معدلة', body: 'مقدمة المسودة المعدلة للإقرار', clauses: ['أ', 'ب', 'ج'] }, key()]);
  assert.equal(dr2, dr, 'a draft is updated in place'); assert.deepEqual((await owner('select clauses, published from clinic_finance.contract_templates where id=$1', [dr]))[0].clauses, ['أ', 'ب', 'ج']);
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.consent.version, 2, 'a draft is invisible to the doctor');
  await as(3); await fin('contract_signature_command', ['template_save', { id: dr, kind: 'consent', title: 'مسودة معدلة', body: 'مقدمة المسودة المعدلة للإقرار', clauses: ['أ', 'ب', 'ج'], publish: true }, key()]);
  await fails(fin('contract_signature_command', ['template_save', { id: dr, kind: 'consent', title: 'بعد النشر', body: 'مقدمة بعد النشر للإقرار الجديد', clauses: ['د'] }, key()]).then(async nid => { assert.notEqual(nid, dr, 'published version is never edited: save makes version 4'); assert.equal((await owner('select version from clinic_finance.contract_templates where id=$1', [nid]))[0].version, 4); throw new Error('ok-new-version'); }), /ok-new-version/);
  assert.equal((await owner("select title from clinic_finance.contract_templates where kind='consent' and version=2"))[0].title, 'إقرار نهائي', 'old versions untouched');
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.consent.version, 3); assert(!inbox.consent.accepted_at, 'published v3 asks again');
  const c3 = await call('doctor_consent_accept', [inbox.consent.template_id, inbox.consent.sha256, 'UA', 'drawn', PNG]);
  assert.deepEqual((await owner("select template_version v from clinic_finance.acceptances where kind='consent' and doctor_key='DOC-Q' order by template_version")).map(r => r.v), [1, 3], 'each acceptance records the version the doctor saw');

  // ---- enforcement start dates: OFF by default, owner-set, never in the past; compliance computed, NOTHING blocked here
  await as(2); let comp = (await fin('contract_signature_status')).compliance;
  assert.equal(comp['DOC-S'].contract_ok, false); assert.equal(comp['DOC-S'].contract_blocked, false, 'off by default: nothing blocked'); assert.equal(comp['DOC-S'].consent_blocked, false);
  await fails(fin('contract_signature_command', ['set_enforcement', { rule: 'consent', start_date: shift(5) }, key()]), /صلاحية/); // accountant cannot
  await as(3); await fails(fin('contract_signature_command', ['set_enforcement', { rule: 'consent', start_date: shift(-1) }, key()]), /الماضي/);
  await fails(fin('contract_signature_command', ['set_enforcement', { rule: 'nope', start_date: shift(5) }, key()]), /غير معروفة/);
  await fin('contract_signature_command', ['set_enforcement', { rule: 'consent', start_date: shift(5) }, key()]); await fin('contract_signature_command', ['set_enforcement', { rule: 'contract_signature', start_date: today }, key()]);
  let stt = await fin('contract_signature_status'); assert.equal(stt.enforcement.consent.active, false); assert.equal(stt.enforcement.consent.start_date, shift(5)); assert.equal(stt.enforcement.contract_signature.active, true);
  assert.equal(stt.compliance['DOC-S'].consent_blocked, false, 'future date: not yet'); assert.equal(stt.compliance['DOC-S'].contract_blocked, true, 'date reached and S rejected -> would be blocked'); assert.equal(stt.compliance['DOC-Q'].contract_ok, false, 'Q signed, but c1 terms changed afterwards -> signature no longer covers it'); assert.equal(stt.compliance['DOC-Q'].contract_blocked, true);
  await as(4); inbox = await call('doctor_contract_inbox'); assert.equal(inbox.enforcement.consent.start_date, shift(5)); assert.equal(typeof inbox.compliance.contract_ok, 'boolean');
  await as(3); await fin('contract_signature_command', ['set_enforcement', { rule: 'contract_signature', start_date: null }, key()]);
  stt = await fin('contract_signature_status'); assert.equal(stt.enforcement.contract_signature.start_date, null, 'owner can switch a rule back off'); assert.equal(stt.compliance['DOC-S'].contract_blocked, false);
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_accruals"))[0].n, 0, 'still nothing wired into accruals');

  // ---- void + rollback
  await as(2); await fin('contract_signature_command', ['void', { id: r4, note: 'غلط' }, key()]);
  await db.exec('reset role');
  await fails(db.exec(fs.readFileSync('supabase/rollbacks/20261109110000_online_contracts.rollback.sql', 'utf8')), /منفصل|مسجّلة/);
  await db.exec('rollback; delete from clinic_finance.acceptances; delete from clinic_finance.signature_requests;');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261109110000_online_contracts.rollback.sql', 'utf8'));
  assert.equal((await owner("select to_regclass('clinic_finance.acceptances') t"))[0].t, null);
  assert.equal((await owner("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('doctor_contract_inbox','doctor_contract_decide','doctor_consent_accept','contract_render','request_stale','clinic_finance_contract_signature_status')"))[0].n, 0, 'rollback removes all functions');
  await db.exec(mig('20261109110000_online_contracts.sql'));  // re-applies cleanly after rollback
  console.log('online-contracts-sql: OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
