// DOM test: the doctor contracts list is grouped one collapsible row per doctor (details/summary), the
// "الصورة والنشر" button appears once per doctor (in the summary), and per-contract review buttons stay in the details.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}) };
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
  const html = w.SSMPDFinanceControls.panel('doctors', data, h);
  const box = d.createElement('div'); box.innerHTML = html; d.body.append(box);
  const groups = box.querySelectorAll('details.fc-doctor-group');
  assert.equal(groups.length, 2, 'one group per doctor');
  const sum = groups[0].querySelector('summary').textContent;
  assert(sum.includes('د. أ') && sum.includes('EMP-1') && sum.includes('3 عقد'), 'summary shows doctor, code, contract count: ' + sum);
  assert(sum.includes('30.00%') && sum.includes('50.00%'), 'summary shows the rate range');
  assert(sum.includes('قيد الاعتماد 2') && sum.includes('معتمد 1'), 'summary shows status counts: ' + sum);
  assert.equal(box.querySelectorAll('[data-fin-action="contract-marketing"]').length, 2, 'marketing button once per doctor');
  assert(groups[0].querySelector('summary [data-fin-action="contract-marketing"]'), 'marketing button sits in the summary');
  assert(!groups[0].querySelector('table [data-fin-action="contract-marketing"]'), 'not repeated inside the table');
  assert.equal(groups[0].querySelectorAll('table tbody tr').length, 3, 'all three contracts are in the details');
  assert.equal(groups[0].querySelectorAll('[data-fin-action="doctor-contract-review"]').length, 2, 'review buttons for the two pending contracts stay in the details');
  assert(groups[0].querySelector('[data-fin-action="doctor-contract-review-batch"]'), 'group review button stays');
  assert(!groups[0].open, 'collapsed by default');
  // no create/review rights: no marketing button
  const none = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false, can_review: false }), h);
  assert(!none.includes('contract-marketing'), 'marketing hidden without rights');
  // empty list still renders a table header
  const empty = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { doctor_contracts: [] }), h);
  assert(empty.includes('<h4>العقود</h4>') && empty.includes('<table>'), 'empty list renders');
  console.log('PASS doctor contracts grouped: one collapsible row per doctor, marketing button once per doctor, review buttons inside');
})().catch(e => { console.error(e); process.exit(1); });
