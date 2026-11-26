// Rule 12 (2026-11-26): every big list gets type-to-search. One shared enhancer (select-search.js) — Arabic-friendly, value preserved, nothing removed.
// Unit cases + two REAL screens as the real role: the owner's example (reception «استخدام رصيد سابق للمريض») and the HR «إضافة طلب» person list.
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] })), fs = require('fs'), assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const tick = (n = 40) => new Promise(r => setTimeout(r, n));
(async () => {
  // ---------- unit ----------
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  w.eval(fs.readFileSync('assets/js/select-search.js', 'utf8'));
  const names = ['أحمد علي', 'إبراهيم حسن', 'آية محمود', 'سعاد عبدالله', 'منى السيد', 'يسري فؤاد', 'هدى كمال', 'مصطفى رمضان', 'فاطمة الزهراء', 'عمرو خالد', 'نجلاء صبري', 'رشا عادل'];
  const form = d.createElement('form');
  form.innerHTML = '<label>المريض<select name="patient_id" required><option value="">اختر</option>' + names.map((n, i) => '<option value="p' + i + '" data-phone="0100000' + String(1000 + i) + '" data-file="F-' + (500 + i) + '">' + n + '</option>').join('') + '</select></label>' +
    '<select name="month">' + Array.from({ length: 12 }, (_, i) => '<option value="' + (i + 1) + '">شهر ' + (i + 1) + '</option>').join('') + '</select>' +
    '<select name="hours">' + Array.from({ length: 24 }, (_, i) => '<option>' + i + ':00</option>').join('') + '</select>' +
    '<select name="doctor_id"><option value="">اختر</option><option value="1">أ</option><option value="2">ب</option><option value="3">ج</option><option value="4">د</option><option value="5">هـ</option></select>' +
    '<select name="status"><option value="">اختر</option><option>أ</option><option>ب</option><option>ج</option><option>د</option></select>' +
    '<select name="doctor_id2" data-ss-off><option value="">اختر</option>' + names.map(n => '<option>' + n + '</option>').join('') + '</select>' +
    '<select name="service_id"><option value="">اختر</option>' + Array.from({ length: 20 }, (_, i) => '<option value="s' + i + '">خدمة ' + i + '</option>').join('') + '</select>';
  d.body.appendChild(form); await tick();
  const sel = form.elements.patient_id, q = form.querySelector('select[name=patient_id]').previousElementSibling.querySelector('[data-ss-q]');
  assert(q, '12 patients → search box above the list'); assert(q.getAttribute('placeholder').includes('اكتب للبحث'));
  assert(!form.elements.month.hasAttribute('data-ss') && !form.elements.hours.hasAttribute('data-ss'), 'month / hours pickers are left alone');
  assert(form.elements.doctor_id.hasAttribute('data-ss'), '5 doctors (a data list) → searchable'); assert(!form.elements.status.hasAttribute('data-ss'), '4 plain options → not');
  assert(!form.elements.doctor_id2.hasAttribute('data-ss'), 'data-ss-off respected'); assert(!form.elements.service_id.hasAttribute('data-ss'), 'service lists keep their own enhancer');
  const type = v => { q.value = v; q.dispatchEvent(new w.Event('input')); }, vals = () => Array.from(sel.options).map(o => o.value).filter(Boolean);
  type('ابراهيم'); assert.deepEqual(vals(), ['p1'], 'إ/ا'); assert.equal(sel.value, 'p1', 'single match chosen');
  type('اية'); assert.deepEqual(vals(), ['p2'], 'آ/ا'); type('فاطمه'); assert.deepEqual(vals(), ['p8'], 'ة/ه'); type('منى'); assert.deepEqual(vals(), ['p4']); type('منا'); assert.equal(vals().length, 0);
  type('٠١٠٠٠٠٠١٠٠٥'); assert.deepEqual(vals(), ['p5'], 'Arabic-Indic digits find the phone'); type('F-507'); assert.deepEqual(vals(), ['p7'], 'by file number'); type('عمرو'); assert.deepEqual(vals(), ['p9']);
  type('ا'); assert(vals().length > 1 && +sel.size >= 2 && +sel.size <= 8, 'many matches shown as a short open list');
  // choosing, then searching something else, must not silently change the chosen value
  type(''); sel.value = 'p3'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); type('zzz'); assert.equal(vals().length, 0);
  q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(q.value, ''); assert.equal(vals().length, 12, 'Esc clears → full list'); assert.equal(sel.value, 'p3', 'original choice back');
  assert.equal(sel.options[1].getAttribute('data-phone'), '01000001000', 'data-* untouched'); assert.equal(new w.FormData(form).get('patient_id'), 'p3', 'form sends the chosen one');
  type('zzz'); let sent = null; form.addEventListener('submit', e => { e.preventDefault(); sent = new w.FormData(form).get('patient_id'); }); form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); assert.equal(sent, 'p3', 'half-finished search does not change what is sent');
  // options replaced by the app after the box exists → index refreshed
  sel.innerHTML = '<option value="">اختر</option>' + ['كريم', 'ليلى', 'مروة', 'نادر', 'هالة', 'وليد', 'ياسر', 'زياد', 'سمير'].map((n, i) => '<option value="n' + i + '">' + n + '</option>').join(''); await tick();
  type('ليل'); assert.deepEqual(vals(), ['n1'], 'new options are searchable');
  // keyboard: Enter picks the first match
  type('ا'); q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); assert(sel.value, 'Enter picks');
  // options filled in later (empty select first)
  const late = d.createElement('select'); late.name = 'invoice_id'; late.innerHTML = '<option value="">اختر</option>'; d.body.appendChild(late); await tick(); assert(!late.hasAttribute('data-ss'));
  late.innerHTML = '<option value="">اختر</option>' + Array.from({ length: 6 }, (_, i) => '<option value="i' + i + '">فاتورة ' + i + '</option>').join(''); await tick(); assert(late.hasAttribute('data-ss'), 'loaded-later data list becomes searchable');

  // ---------- REAL screen 1: the owner's example — reception «استخدام رصيد سابق للمريض» ----------
  const dom2 = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true }), w2 = dom2.window, d2 = w2.document;
  w2.eval(fs.readFileSync('assets/js/select-search.js', 'utf8')); w2.eval(fs.readFileSync('assets/js/reception-services.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const patients = Array.from({ length: 14 }, (_, i) => ({ id: 'pt' + i, name: ['سعاد', 'إيمان', 'أسماء', 'منال', 'هبة', 'رباب', 'سلمى', 'نهى', 'دعاء', 'شيماء', 'عبير', 'ولاء', 'غادة', 'ريهام'][i] + ' محمد' }));
  const invoices = patients.map((p, i) => ({ id: 'inv' + i, patient_id: p.id, description: 'كشف', due: 100 + i }));
  let sentCmd = null;
  const c = { data: { invoices, patients }, esc, money: v => String(v), btn: (a, id, t) => '<button data-rx-action="' + a + '">' + t + '</button>', field: (n, l) => '<label>' + l + '<input name="' + n + '"></label>',
    select: (n, l, rows, v) => '<label>' + esc(l) + '<select name="' + n + '"><option value="">اختر</option>' + rows.map(r => '<option value="' + esc(r[0]) + '">' + esc(r[1]) + '</option>').join('') + '</select></label>',
    lookup: (t, id) => (patients.find(p => p.id === id) || {}).name, command: async (a, p) => { sentCmd = { a, p }; return {}; },
    modal: (title, html, save) => { const f = d2.createElement('form'); f.dataset.title = title; f.innerHTML = html; f.addEventListener('submit', async e => { e.preventDefault(); await save(Object.fromEntries(new w2.FormData(f)), 'k'); }); d2.body.appendChild(f); return f; } };
  w2.SSMPDReceptionModules.act('credit_apply', '', c); await tick();
  const f2 = d2.querySelector('form[data-title]'); assert(f2.dataset.title.includes('استخدام رصيد سابق'), 'the owner\'s screen'); const inv = f2.elements.invoice_id, q2 = inv.previousElementSibling.querySelector('[data-ss-q]');
  assert(q2, 'the «الفاتورة» list has a search box now'); q2.value = 'ايمان'; q2.dispatchEvent(new w2.Event('input')); assert.equal(inv.value, 'inv1', 'finds the invoice by the patient name (إ/ا)');
  f2.elements.amount.value = '50'; f2.dispatchEvent(new w2.Event('submit', { cancelable: true })); await tick(); assert.deepEqual(JSON.parse(JSON.stringify(sentCmd)), { a: 'credit_apply', p: { invoice_id: 'inv1', amount: '50' } }, 'the command still carries the chosen invoice');

  // ---------- REAL screen 2: HR «إضافة طلب» person list ----------
  const people = Array.from({ length: 12 }, (_, i) => ({ id: 'e' + i, admin_id: 'a' + i, full_name: 'موظف ' + i, code: 'EMP-' + i, kind: 'employee', department: 'الاستقبال', job_title: 'موظف', branch: 'x', status: 'active', revision: 1, leave_balance: 5 }));
  const t = await makeEnv({ people, rpc: async () => undefined }); const { d: dh, w: wh } = t; wh.eval(fs.readFileSync('assets/js/select-search.js', 'utf8'));
  wh.SSMPDHumanResources.render(t.host); await t.tick(); dh.querySelector('[data-hr-open=requests]').click(); await t.tick(); await t.tick();
  const ps = dh.querySelector('[data-hr-section="requests"] [name=person_for_request]'); assert(ps && ps.hasAttribute('data-ss'), 'HR person list is searchable');
  const qh = ps.previousElementSibling.querySelector('[data-ss-q]'); qh.value = 'موظف 7'; qh.dispatchEvent(new wh.Event('input')); assert.equal(ps.value, 'e7', 'finds an employee by name');
  console.log('select-search-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
