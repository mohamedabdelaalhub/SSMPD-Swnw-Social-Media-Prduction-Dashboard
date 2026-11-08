// DOM test: contract rows show the service NAME next to its code once the catalog loads (and fall back to the code alone). The
// "الصورة والنشر" button appears once per doctor (in the summary), and per-contract review buttons stay in the details.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [{ code: '0001374', name: 'كشف تجريبي', department: 'x' }], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}) };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v || 0).toFixed(2);
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><thead><tr>' + hd.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const h = { esc, money, btn, table, stamp: x => x, field: () => '', select: () => '', modal: () => {} };
  const mk = (id, key, name, scope, rate, status) => ({ id, doctor_key: key, doctor_name: name, service_scope: scope, valid_from: '2027-01-01', valid_to: '2027-12-31', rate, base_scope: 'service', deduction: 'none', basis: 'performed', status, created_by: 'maker', reference: 'r' });
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [],
    doctor_contracts: [mk('a1', 'EMP-1', 'د. أ', '0001374', 50, 'pending'), mk('a2', 'EMP-1', 'د. أ', '0001373', 50, 'pending'), mk('a3', 'EMP-1', 'د. أ', 'قسم:الاسنان', 30, 'active'), mk('b1', 'EMP-2', 'د. ب', '0001371', 50, 'pending')],
    doctor_allocations: [], doctor_payouts: [], doctor_balances: [] };
  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); d.body.append(box);
  const first = box.querySelector('[data-fc-svc="0001374"]');
  assert(first && first.textContent.trim() === '0001374', 'code shown before names load: ' + (first && first.textContent));
  await new Promise(r => setTimeout(r, 30));
  assert(first.textContent.includes('كشف تجريبي') && first.textContent.includes('0001374'), 'name + code after load: ' + first.textContent);
  const other = box.querySelector('[data-fc-svc="0001373"]');
  assert.equal(other.textContent.trim(), '0001373', 'unknown code falls back to the code');
  assert(box.textContent.includes('كل خدمات قسم الاسنان'), 'department still readable');
  box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h);
  assert(box.querySelector('[data-fc-svc="0001374"]').textContent.includes('كشف تجريبي'), 'rendered with the name once cached');
  console.log('PASS contract service names');
})().catch(e => { console.error(e); process.exit(1); });
