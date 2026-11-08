// DOM test: per-doctor 'review all pending' button in the group summary; it sends ONE contract_review_batch with only the reviewable pending ids (never the creator's own). The
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
  let sent = null, shown = null;
  w.SSMPDDb.financeDoctorCommand = async (a, p, k) => { sent = { a, p }; return {}; };
  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); d.body.append(box);
  const g = box.querySelectorAll('details.fc-doctor-group');
  assert(g[0].querySelector('summary [data-fin-action="doctor-contracts-review-all"]'), 'approve-all in doctor 1 summary');
  assert(g[0].querySelector('summary').textContent.includes('(2)'), 'count of pending shown');
  assert(!g[1].querySelector('[data-fin-action="doctor-contracts-review-all"]'), 'single pending contract: no bulk button');
  // own contracts are excluded and nothing shows when the viewer cannot review
  const own = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { me: 'maker' }), h);
  assert(!own.includes('doctor-contracts-review-all'), 'creator cannot bulk-review own contracts');
  assert(!w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_review: false }), h).includes('doctor-contracts-review-all'), 'hidden without review right');
  // the action opens a modal and submits exactly the pending, not-own ids
  let submit = null; const h2 = Object.assign({}, h, { modal: (t, body, fn) => { shown = t; submit = fn; } });
  assert.equal(w.SSMPDFinanceControls.act('doctor-contracts-review-all', 'EMP-1', data, h2), true);
  assert(shown && shown.includes('(2)'), 'modal title: ' + shown);
  await submit({ approval: 'yes', note: 'ok' }, 'tok');
  assert.deepEqual(sent.p.ids.sort(), ['a1', 'a2'], 'only the two pending ids');
  assert.equal(sent.a, 'contract_review_batch'); assert.equal(sent.p.approve, true);
  console.log('PASS approve-all pending per doctor');
})().catch(e => { console.error(e); process.exit(1); });
