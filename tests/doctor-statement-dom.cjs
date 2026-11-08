// DOM test (doctor statement): the button appears for staff who can create/review, opens the statement, falls back when the RPC is missing or fails. (Old header: "تعديل العقد" appears only on ACTIVE contracts (for users who can create), opens a prefilled form and sends ONE contract_revise command; revisions/superseded contracts are labelled.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  let sent = null; const calls = []; const STMT = { summary: { accrued: 700, payable_invoices: 250, pending: 450, paid_out: 0, balance: 700, available_to_pay: 250, other_credits: 0 }, invoices: [{ invoice_id: 'i1', reference: 'INV-1', patient_ref: 'م1', date: '2026-11-01', net: 500, collected: 500, status: 'paid', fee: 250, insurer: null, lines: [{ service_code: 'D-1', service_name: 'حشو', amount: 300, rate: 50 }] }, { invoice_id: 'i2', reference: 'INV-2', patient_ref: '', date: '2026-11-02', net: 400, collected: 100, status: 'insurance', insurer: 'شركة ب', fee: 200, lines: [] }, { invoice_id: 'i3', reference: 'INV-3', patient_ref: '', date: '2026-11-03', net: 200, collected: 0, status: 'credit', insurer: null, fee: 100, lines: [] }] };
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async (a, p, k) => { sent = { a, p, k }; return {}; }, financeDoctorStatement: async (k, f, t) => { calls.push([k, f, t]); return STMT; } };
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
  const sb = box.querySelectorAll('[data-fin-action="doctor-statement"]');
  assert.equal(sb.length, 1, 'one statement button per doctor'); assert.equal(sb[0].dataset.id, 'EMP-1');
  const none = d.createElement('div'); none.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false, can_review: false }), h);
  assert.equal(none.querySelectorAll('[data-fin-action="doctor-statement"]').length, 0, 'hidden for users without create/review');
  const tick = () => new Promise(r => setTimeout(r, 20));
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  assert.deepEqual(calls[0], ['EMP-1', '2026-08-10', '2026-11-08'], 'last 90 days up to today');
  const txt = d.querySelector('.fc-modal form').textContent;
  for (const s of ['إجمالي المستحق', '700.00', 'مستحق الصرف الآن', '250.00', 'بانتظار التحصيل', '450.00', 'INV-1', 'حشو', 'اتحصّل بالكامل', 'بانتظار التأمين — شركة ب', 'آجل — بانتظار السداد']) assert(txt.includes(s), 'statement shows ' + s);
  assert.equal(d.querySelectorAll('.fc-st-badge.paid').length, 1);
  // RPC missing -> clear message, no crash
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); delete w.SSMPDDb.financeDoctorStatement;
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); assert(d.querySelector('.fc-modal form').textContent.includes('غير متاحة'));
  // RPC fails (migration not applied yet) -> clear message
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDDb.financeDoctorStatement = async () => { throw new Error('404'); };
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); assert(d.querySelector('.fc-modal form').textContent.includes('تعذر تحميل'));
  // ---- contracts status filter
  d.body.append(box);
  const fd = Object.assign({}, data, { doctor_contracts: [mk('f1', 'active'), mk('f2', 'pending'), Object.assign(mk('f3', 'rejected'), { doctor_key: 'EMP-2', doctor_name: 'د. ب' })] });
  box.innerHTML = w.SSMPDFinanceControls.panel('doctors', fd, h); await tick();
  const chips = [...box.querySelectorAll('[data-fc-filter]')].map(x => x.dataset.fcFilter); assert.deepEqual(chips, ['all', 'pending', 'active', 'rejected'], 'chips only for statuses that exist');
  const groups = () => [...box.querySelectorAll('.fc-doctor-group')].filter(g => !g.hidden).length;
  assert.equal(groups(), 2);
  box.querySelector('[data-fc-filter="rejected"]').click(); assert.equal(groups(), 1, 'only the doctor with a rejected contract'); assert(box.querySelector('.fc-chip.active').dataset.fcFilter === 'rejected');
  box.querySelector('[data-fc-filter="pending"]').click(); assert.equal(groups(), 1); assert.equal([...box.querySelectorAll('.fc-doctor-group tbody tr')].filter(r => !r.hidden).length, 1, 'only the pending row shows');
  box.querySelector('[data-fc-filter="all"]').click(); assert.equal(groups(), 2);
  const inp = box.querySelector('[data-fc-name]'); inp.value = 'EMP-2'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(groups(), 1, 'name search'); inp.value = ''; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  console.log('PASS doctor statement DOM: button visibility, statement content (cards, services, statuses), 90-day window, RPC-missing and RPC-error fallbacks');
})().catch(e => { console.error(e); process.exitCode = 1; });
