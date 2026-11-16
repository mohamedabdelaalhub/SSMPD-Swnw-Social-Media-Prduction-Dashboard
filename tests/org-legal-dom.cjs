// DOM test of the «بيانات الشركة والفروع» tab (render-org-legal.js) with a fake Supabase client:
// super-admin-only tab access, company view/edit/save, expiry alerts, branch bank form with IBAN check + ledger link,
// upload to the PRIVATE bucket with a strict path then metadata insert (file removed if insert fails), signed URL to open,
// delete, add branch, and the "not allowed" message when the database refuses.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
(async () => {
  // 1) Roles: only super_admin sees the tab (GM, financial manager, accountant, reception don't).
  { const w = new JSDOM('', { runScripts: 'outside-only' }).window; w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
    const R = w.SSMPDRoles; assert.equal(R.canSeeTab({ role: 'super_admin' }, 'org_legal'), true);
    for (const role of ['general_manager', 'financial_manager', 'accountant', 'reception', 'page_manager']) assert.equal(R.canSeeTab({ role }, 'org_legal'), false, role);
    assert.equal(R.canSeeTab({ role: 'general_manager', roles: ['general_manager', 'super_admin'] }, 'org_legal'), true); }
  // wiring: renderer + label + cache-busted script tag
  const app = fs.readFileSync('assets/js/app.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
  assert.match(app, /org_legal: window\.SSMPDRenderOrgLegal/); assert.match(app, /org_legal: "بيانات الشركة والفروع"/);
  assert.match(html, /assets\/js\/render-org-legal\.js\?v=[^"]+"/); assert.match(html, /assets\/css\/org-legal\.css\?v=/);

  const B = '00000000-0000-4000-8000-000000000002';
  const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const store = {
    company: { id: 1, legal_name_ar: 'شركة <سونو>', cr_number: '123', cr_expiry_date: iso(10), tax_card_expiry_date: iso(400), phones: ['0100'], emails: [] },
    branches: [{ id: B, name: 'الفرع الحالي', active: true }], bank: [{ code: '1112', name: 'البنك' }, { code: '111201', name: 'بنك مصر' }],
    details: [{ branch_id: B, bank_name: 'بنك مصر', iban: '', phones: [], emails: [] }],
    docs: [{ id: 'd1', branch_id: null, doc_type: 'commercial_register', title: 'صورة السجل', storage_path: 'company/11111111-1111-4111-8111-111111111111.pdf', expiry_date: iso(-3), created_at: '2026-11-01' },
      { id: 'd2', branch_id: B, doc_type: 'license', title: 'ترخيص العلاج الحر', storage_path: B + '/22222222-2222-4222-8222-222222222222.png', expiry_date: iso(200), created_at: '2026-11-02' }]
  };
  const calls = []; let deny = false, failInsert = false;
  const builder = (table) => { const st = { table, op: 'select' }; const b = {
    select() { return b; }, eq(k, v) { st.eq = [k, v]; return b; }, order() { return b; },
    maybeSingle() { st.single = true; return b; },
    update(row) { st.op = 'update'; st.row = row; return b; }, upsert(row, o) { st.op = 'upsert'; st.row = row; st.opts = o; return b; },
    insert(row) { st.op = 'insert'; st.row = row; return b; }, delete() { st.op = 'delete'; return b; },
    then(ok, ko) { calls.push(st); let out;
      if (deny) out = { data: null, error: { message: 'permission denied for table ' + table } };
      else if (st.op === 'insert' && failInsert) out = { data: null, error: { message: 'new row violates check constraint' } };
      else if (st.op !== 'select') out = { data: [{ id: 'x', branch_id: B }], error: null };
      else out = { data: table === 'org_company' ? store.company : table === 'org_branch_details' ? store.details : store.docs, error: null };
      return Promise.resolve(out).then(ok, ko); } }; return b; };
  const storageCalls = [];
  const client = {
    from: builder,
    rpc: (fn, args) => { calls.push({ rpc: fn, args }); return Promise.resolve(deny ? { error: { message: 'البيانات دي للسوبر أدمن بس' } } : fn === 'org_branches' ? { data: { branches: store.branches, bank_accounts: store.bank }, error: null } : { data: 'new-branch-id', error: null }); },
    storage: { from: (bucket) => ({
      upload: (p, f, o) => { storageCalls.push(['upload', bucket, p, o]); return Promise.resolve({ data: { path: p }, error: null }); },
      remove: (ps) => { storageCalls.push(['remove', bucket, ps]); return Promise.resolve({ data: [], error: null }); },
      createSignedUrl: (p, s) => { storageCalls.push(['sign', bucket, p, s]); return Promise.resolve({ data: { signedUrl: 'https://api.test/signed/' + p }, error: null }); } }) }
  };
  const dom = new JSDOM('<main id="v"></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const alerts = []; w.alert = m => alerts.push(m); w.confirm = () => true; w.prompt = () => 'فرع أكتوبر';
  const opened = { location: { href: '' } }; w.open = () => opened;
  w.SSMPDDb = { client };
  w.eval(fs.readFileSync('assets/js/render-org-legal.js', 'utf8'));
  const v = d.getElementById('v'), $ = s => v.querySelector(s), $$ = s => [...v.querySelectorAll(s)];
  w.SSMPDRenderOrgLegal.render(v); await tick();

  // 2) Company view: escaped name, expiry alert lists CR (soon) + expired document, not the valid tax card.
  assert.match(v.innerHTML, /شركة &lt;سونو&gt;/); assert.ok(!v.innerHTML.includes('<سونو>'));
  const al = $('.ol-alerts').textContent; assert.match(al, /السجل التجاري/); assert.match(al, /صورة السجل/); assert.ok(!/البطاقة الضريبية/.test(al));
  assert.ok($('.ol-badge.ol-soon') && $('.ol-badge.ol-expired'));
  assert.deepEqual($$('[data-sec]').map(b => b.textContent), ['الشركة', 'الفرع الحالي']);
  assert.equal($$('[data-doc]').length, 1, 'company tab shows company docs only');

  // 3) Edit + save company: lists split by line, dates null when empty, bad email refused before any request.
  $('[data-edit]').click(); await tick();
  $('[data-list="phones"]').value = '0100\n 0122 ,0155'; $('[data-list="emails"]').value = 'not-an-email';
  $('[data-save]').click(); await tick(); assert.match(alerts.pop(), /الإيميل/); assert.ok(!calls.some(c => c.op === 'update'));
  $('[data-list="emails"]').value = 'info@swnwclinics.com'; $('[data-f="cr_issue_date"]').value = '';
  $('[data-save]').click(); await tick();
  let up = calls.find(c => c.op === 'update'); assert.equal(up.table, 'org_company'); assert.deepEqual(up.eq, ['id', 1]);
  assert.deepEqual([...up.row.phones], ['0100', '0122', '0155']); assert.deepEqual([...up.row.emails], ['info@swnwclinics.com']); assert.equal(up.row.cr_issue_date, null);
  assert.ok($('[data-edit]'), 'back to view mode');

  // 4) Upload a company document: type/size checks, private bucket, path company/<uuid>.<ext>, then metadata row.
  const box = $('[data-upload="company"]'), fileIn = box.querySelector('[data-u-file]');
  const setFile = f => Object.defineProperty(fileIn, 'files', { value: [f], configurable: true });
  box.querySelector('[data-u="title"]').value = 'البطاقة الضريبية'; box.querySelector('[data-u="doc_type"]').value = 'tax_card';
  setFile(new w.File(['x'], 'a.exe', { type: 'application/x-msdownload' })); box.querySelector('[data-upload-go]').click(); await tick();
  assert.match(alerts.pop(), /PDF أو صورة/); assert.equal(storageCalls.length, 0);
  const big = new w.File(['x'], 'b.pdf', { type: 'application/pdf' }); Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 });
  setFile(big); box.querySelector('[data-upload-go]').click(); await tick(); assert.match(alerts.pop(), /15 ميجا/);
  setFile(new w.File(['%PDF'], 'tax.pdf', { type: 'application/pdf' })); box.querySelector('[data-upload-go]').click(); await tick(30);
  const u = storageCalls.find(c => c[0] === 'upload'); assert.equal(u[1], 'org-legal-documents');
  assert.match(u[2], /^company\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/); assert.equal(u[3].upsert, false);
  const ins = calls.find(c => c.op === 'insert'); assert.equal(ins.table, 'org_documents'); assert.equal(ins.row.branch_id, null);
  assert.equal(ins.row.storage_path, u[2]); assert.equal(ins.row.doc_type, 'tax_card'); assert.equal(ins.row.mime_type, 'application/pdf');

  // 5) If the metadata insert fails, the uploaded file is removed again (no orphan file).
  failInsert = true; const box2 = $('[data-upload="company"]'), f2 = box2.querySelector('[data-u-file]');
  box2.querySelector('[data-u="title"]').value = 'الختم'; Object.defineProperty(f2, 'files', { value: [new w.File(['p'], 's.png', { type: 'image/png' })] });
  box2.querySelector('[data-upload-go]').click(); await tick(30); failInsert = false;
  const last = storageCalls[storageCalls.length - 1]; assert.equal(last[0], 'remove'); assert.match(last[2][0], /^company\/.+\.png$/); assert.match(alerts.pop(), /check constraint/);

  // 6) Open = short-lived signed URL (5 minutes), never a public URL.
  $('[data-open]').click(); await tick();
  const sg = storageCalls.find(c => c[0] === 'sign'); assert.deepEqual(sg.slice(1), ['org-legal-documents', store.docs[0].storage_path, 300]);
  assert.equal(opened.location.href, 'https://api.test/signed/' + store.docs[0].storage_path);

  // 7) Branch: bank view, edit with IBAN check, ledger link select, upsert by branch_id; branch doc upload path = <branch_id>/…
  $$('[data-sec]')[1].click(); await tick();
  assert.match(v.textContent, /حساب البنك/); assert.equal($$('[data-doc]').length, 1); assert.match(v.textContent, /ترخيص العلاج الحر/);
  $('[data-edit]').click(); await tick();
  assert.deepEqual([...$('[data-f="finance_account_code"]').options].map(o => o.value), ['', '1112', '111201']);
  $('[data-f="iban"]').value = 'EG12 34'; $('[data-save]').click(); await tick(); assert.match(alerts.pop(), /IBAN/);
  $('[data-f="iban"]').value = 'eg38 0019 0005 0000 0000 2631 8000 2'; $('[data-f="swift"]').value = 'bmisegcx'; $('[data-f="finance_account_code"]').value = '111201';
  $('[data-save]').click(); await tick();
  const ups = calls.find(c => c.op === 'upsert'); assert.equal(ups.table, 'org_branch_details'); assert.equal(ups.opts.onConflict, 'branch_id');
  assert.equal(ups.row.branch_id, B); assert.equal(ups.row.iban, 'EG380019000500000000263180002'); assert.equal(ups.row.swift, 'BMISEGCX'); assert.equal(ups.row.finance_account_code, '111201');
  const bbox = $('[data-upload="' + B + '"]'); assert.deepEqual([...bbox.querySelector('[data-u="doc_type"]').options].map(o => o.value), ['license', 'bank', 'contract', 'insurance', 'other']);
  bbox.querySelector('[data-u="title"]').value = 'ترخيص الدفاع المدني'; Object.defineProperty(bbox.querySelector('[data-u-file]'), 'files', { value: [new w.File(['j'], 'c.jpg', { type: 'image/jpeg' })] });
  const before = storageCalls.length; bbox.querySelector('[data-upload-go]').click(); await tick(30);
  assert.ok(storageCalls.slice(before).some(c => c[0] === 'upload' && c[2].startsWith(B + '/') && c[2].endsWith('.jpg')));

  // 8) Delete a document: row first, then the file.
  $('[data-del-doc]').click(); await tick(30);
  const del = calls.find(c => c.op === 'delete'); assert.deepEqual(del.eq, ['id', 'd2']);
  assert.ok(storageCalls.some(c => c[0] === 'remove' && c[2][0] === store.docs[1].storage_path));

  // 9) Add branch → RPC, opens the new branch in edit mode.
  $('[data-add-branch]').click(); await tick();
  assert.equal(calls.find(c => c.rpc === 'org_branch_create').args.p_name, 'فرع أكتوبر');

  // 10) Database refuses (not super admin) → clear Arabic message, no data shown.
  deny = true; w.SSMPDRenderOrgLegal.render(v); await tick();
  assert.match(v.textContent, /للسوبر أدمن بس/); assert.ok(!$('[data-doc]'));
  console.log('PASS org legal DOM: super-admin-only tab, company edit/save, expiry alerts, private-bucket upload with strict path + cleanup on failure, signed URL open, branch bank/IBAN/ledger link, delete, add branch, refusal message.');
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
