// DOM test: "تعديل العقد" appears only on ACTIVE contracts (for users who can create), opens a prefilled form and sends ONE contract_revise command; revisions/superseded contracts are labelled.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  let sent = null;
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async (a, p, k) => { sent = { a, p, k }; return {}; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let form = null, submit = null;
  const modal = (title, body, fn) => { form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const mk = (id, status, extra) => Object.assign({ id, doctor_key: 'EMP-1', doctor_name: 'د. أ', service_scope: '0001374', valid_from: '2027-01-01', valid_to: '2027-12-31', rate: 50, base_scope: 'service', deduction: 'none', basis: 'performed', status, created_by: 'maker' }, extra || {});
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [],
    doctor_contracts: [mk('a1', 'active'), mk('a2', 'pending'), mk('a3', 'rejected'), mk('a4', 'superseded'), mk('a5', 'pending', { supersedes: 'a1' })] };
  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); d.body.append(box);
  const revBtns = box.querySelectorAll('[data-fin-action="doctor-contract-revise"]');
  assert.equal(revBtns.length, 1, 'only the active contract gets the revise button'); assert.equal(revBtns[0].dataset.id, 'a1');
  assert(box.textContent.includes('حلّ محله إصدار معدّل'), 'superseded status label');
  assert(box.textContent.includes('إصدار معدّل من عقد سابق'), 'revision is labelled');
  const none = d.createElement('div'); none.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false }), h);
  assert(!none.querySelector('[data-fin-action="doctor-contract-revise"]'), 'no button without create rights');
  assert.equal(w.SSMPDFinanceControls.act('doctor-contract-revise', 'a1', data, h), true);
  assert.equal(form.elements.rate.value, '50'); assert.equal(form.elements.to.value, '2027-12-31'); assert.equal(form.elements.basis.value, 'performed');
  assert.equal(form.elements.from.value, '', 'tomorrow is before the contract period: the user must pick the start date');
  form.elements.rate.value = '55'; form.elements.from.value = '2027-02-01'; form.elements.reference.value = 'تعديل'; form.elements.note.value = 'سبب';
  const v = Object.fromEntries(Array.from(form.elements).filter(e => e.name).map(e => [e.name, e.value]));
  await submit(v, 'tok');
  assert.equal(sent.a, 'contract_revise'); assert.equal(sent.p.supersedes, 'a1'); assert.equal(sent.p.rate, 55); assert.equal(sent.p.refund_policy, 'proportional_revenue'); assert.equal(sent.p.from, '2027-02-01');
  console.log('PASS contract revise UI');
})().catch(e => { console.error(e); process.exit(1); });
