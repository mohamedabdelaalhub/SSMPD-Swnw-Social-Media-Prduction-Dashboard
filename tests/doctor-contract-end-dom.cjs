// DOM test (owner 2026-11-17): «إنهاء العقد» on ACTIVE contracts (create rights), request form defaults to today and sends one request;
// a pending end shows its last day and reason, with «مراجعة طلب الإنهاء» only for a different reviewer; ended contracts are labelled.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  let sent = null;
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}), financeDoctorContractEnd: async (a, p, k) => { sent = { a, p, k }; return 'x'; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let form = null, submit = null;
  const modal = (title, body, fn) => { d.querySelectorAll('.fc-modal').forEach(x => x.remove()); form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const mk = (id, status, extra) => Object.assign({ id, doctor_key: 'EMP-26', doctor_name: 'د. مصطفى', service_scope: '0001371', valid_from: '2026-11-09', valid_to: '2027-12-31', rate: 50, base_scope: 'service', deduction: 'none', basis: 'performed', status, created_by: 'maker' }, extra || {});
  const data = { today: '2026-11-17', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [],
    doctor_contracts: [mk('a1', 'active'), mk('a2', 'pending'), mk('a3', 'active', { end_request_last_day: '2026-11-17', end_request_reason: 'قرار المالك: استشاري', end_requested_by: 'maker' }),
      mk('a4', 'active', { end_request_last_day: '2026-11-18', end_request_reason: 'طلبي أنا', end_requested_by: 'checker' }), mk('a5', 'active', { valid_to: '2026-11-17', ended_at: '2026-11-17T10:00:00Z', end_reason: 'قرار المالك <b>x</b>' })] };
  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); d.body.append(box);
  const endBtns = [...box.querySelectorAll('[data-fin-action="doctor-contract-end"]')].map(b => b.dataset.id);
  assert.deepEqual(endBtns, ['a1'], 'active, not yet ended, no pending end → «إنهاء العقد»');
  const revs = [...box.querySelectorAll('[data-fin-action="doctor-contract-end-review"]')].map(b => b.dataset.id);
  assert.deepEqual(revs, ['a3'], 'only another account reviews a pending end');
  assert(box.textContent.includes('طلب إنهاء — آخر يوم 2026-11-17') && box.textContent.includes('بانتظار مراجعة حساب آخر'));
  assert(box.textContent.includes('اتنهى بقرار') && !box.querySelector('b'), 'ended label, escaped');
  const none = d.createElement('div'); none.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false }), h);
  assert(!none.querySelector('[data-fin-action="doctor-contract-end"]'), 'no button without create rights');
  // request
  assert.equal(w.SSMPDFinanceControls.act('doctor-contract-end', 'a1', data, h), true);
  assert.equal(form.elements.last_day.value, '2026-11-17'); assert.equal(form.elements.last_day.min, '2026-11-17');
  form.elements.reason.value = 'قرار المالك: استشاري';
  await submit(Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.value])), 'tok1');
  assert.deepEqual([sent.a, sent.p.id, sent.p.last_day, sent.p.reason, sent.k], ['request', 'a1', '2026-11-17', 'قرار المالك: استشاري', 'tok1']);
  // review
  assert.equal(w.SSMPDFinanceControls.act('doctor-contract-end-review', 'a3', data, h), true);
  assert(form.textContent.includes('2026-11-17') && form.textContent.includes('قرار المالك: استشاري'));
  form.elements.decision.value = 'approve'; form.elements.note.value = 'تمام';
  await submit(Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.value])), 'tok2');
  assert.deepEqual([sent.a, sent.p.id, sent.p.approve, sent.p.note], ['review', 'a3', true, 'تمام']);
  form.elements.decision.value = 'reject';
  await submit(Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.value])), 'tok3');
  assert.equal(sent.p.approve, false);
  console.log('PASS contract end UI: button on active contracts, request form (today default, no past), pending end shown, review by another account only, ended label.');
})().catch(e => { console.error(e); process.exit(1); });
