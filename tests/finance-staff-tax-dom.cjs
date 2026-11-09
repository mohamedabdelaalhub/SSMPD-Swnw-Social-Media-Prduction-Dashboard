// DOM test (accounting «سداد ضريبة المرتبات»): month picture from the server, gap + cap warnings, month change, pay dialog payload (token, cash needs a shift), pending/approved/rejected display,
// create-only button, degrades clearly when the migration is not applied; the tab is registered in the finance workspace.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const tick = () => new Promise(r => setTimeout(r, 20));
  const S = (o) => Object.assign({ month: '2026-11-01', total_due: 800, payroll_withheld: 650, paid_approved: 250, paid_pending: 100, remaining: 450, liability_balance: 0,
    lines: [{ person_id: 'p1', code: 'EMP-1', full_name: 'موظف أول', amount: 500, taxable_base: 6000, reference: 'DOC-1' }, { person_id: 'p2', code: 'EMP-2', full_name: 'موظف <b>ثان</b>', amount: 300, taxable_base: null, reference: '' }],
    payments: [{ id: 'x1', amount: 250, reference: 'RCPT-1', note: '', status: 'approved', created_at: 'x' }, { id: 'x2', amount: 100, reference: 'RCPT-2', note: 'سداد', status: 'pending' }, { id: 'x3', amount: 90, reference: 'RCPT-3', note: '', review_note: 'لا يوجد التزام', status: 'rejected' }] }, o);
  let monthCalls = [], payCalls = [], mode = 'ok', result = S();
  w.SSMPDDb = { financeTaxMonth: async m => { monthCalls.push(m); if (mode === 'missing') throw new Error('Could not find the function public.clinic_finance_tax_month in the schema cache'); return m === '2026-10-01' ? S({ month: '2026-10-01', payroll_withheld: 800, remaining: 0, liability_balance: 99, payments: [] }) : result; },
    financeTaxPay: async (...a) => { payCalls.push(a); return 'req1'; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-staff-tax.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let submit = null, lastForm = null;
  const modal = (title, body, fn) => { const form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; lastForm = form; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const data = { today: '2026-11-09', me: 'u1', can_create: true, can_review: false, active_shifts: [{ id: 'sh1', cashier_id: 'u1', register_name: 'خزينة 1' }], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [], doctor_contracts: [] };
  const box = d.createElement('div'); d.body.append(box); let navigated = [];
  const bind = () => box.querySelectorAll('[data-fin-action]').forEach(b => { b.onclick = () => w.SSMPDFinanceControls.act(b.dataset.finAction, b.dataset.id, data, h); });
  const draw = id => { box.innerHTML = w.SSMPDFinanceControls.panel(id, data, h); bind(); };
  w.SSMPDFinanceCash = { navigate: id => { navigated.push(id); draw(id); } };

  draw('staff-tax'); assert(box.textContent.includes('جاري تحميل')); await tick();
  assert.deepEqual(monthCalls.map(x => x), ['2026-11-01'], 'current month, first day'); assert.deepEqual(navigated, ['staff-tax']);
  const cards = [...box.querySelectorAll('[data-st-cards] .fc-st-card strong')].map(x => x.textContent); assert.deepEqual(cards, ['800.00', '650.00', '250.00', '100.00', '450.00', '0.00']);
  assert(box.querySelector('[data-st-gap]'), 'register (800) differs from payroll (650)'); assert(box.querySelector('[data-st-cap]'), 'remaining 450 > liability 0');
  const t = box.textContent; for (const s of ['موظف أول', 'DOC-1', 'RCPT-1', 'معتمد ومرحّل', 'بانتظار الاعتماد', 'مرفوض', 'لا يوجد التزام']) assert(t.includes(s), 'shows ' + s);
  assert(!box.querySelector('b'), 'names are escaped'); assert(t.includes('<b>ثان</b>'));
  draw('staff-tax'); await tick(); assert.equal(monthCalls.length, 1, 'cached per month');

  // ---- month change
  const inp = box.querySelector('[data-st-month]'); inp.value = '2026-10'; inp.dispatchEvent(new w.Event('change', { bubbles: true })); await tick();
  assert.equal(monthCalls.at(-1), '2026-10-01'); assert(!box.querySelector('[data-st-gap]') && !box.querySelector('[data-st-cap]'), 'no warnings when numbers agree'); assert(!box.querySelector('[data-fin-action="staff-tax-pay"]'), 'nothing remaining: no pay button'); assert(box.textContent.includes('لم يُسجل سداد'));
  const inp2 = box.querySelector('[data-st-month]'); inp2.value = '2026-11'; inp2.dispatchEvent(new w.Event('change', { bubbles: true })); await tick();

  // ---- pay dialog
  box.querySelector('[data-fin-action="staff-tax-pay"]').click(); assert(lastForm, 'dialog'); assert.equal(lastForm.elements.amount.value, '450');
  lastForm.elements.amount.value = '300'; lastForm.elements.method.value = 'bank'; lastForm.elements.reference.value = 'RCPT-9'; lastForm.elements.note.value = 'سداد نوفمبر';
  await submit({ amount: '300', method: 'bank', shift_id: 'sh1', reference: 'RCPT-9', note: 'سداد نوفمبر' }, 'tok1');
  assert.deepEqual(payCalls[0], ['2026-11-01', 'salary_income', 300, 'bank', null, 'RCPT-9', 'سداد نوفمبر', 'tok1'], 'bank: no shift sent'); 
  await submit({ amount: '100', method: 'cash', shift_id: 'sh1', reference: 'R2', note: 'نقدي' }, 'tok2'); assert.deepEqual(payCalls[1], ['2026-11-01', 'salary_income', 100, 'cash', 'sh1', 'R2', 'نقدي', 'tok2']);
  await assert.rejects(async () => submit({ amount: '100', method: 'cash', reference: 'R3', note: 'نقدي' }, 'tok3'), /وردية/, 'cash needs a shift');
  assert.equal(payCalls.length, 2);
  d.querySelectorAll('.fc-modal').forEach(x => x.remove());

  // ---- permissions and failures
  box.innerHTML = w.SSMPDFinanceControls.panel('staff-tax', Object.assign({}, data, { can_create: false }), h); assert(!box.querySelector('[data-fin-action="staff-tax-pay"]'), 'view-only users cannot start a payment');
  mode = 'missing'; w.SSMPDFinanceControls.act('staff-tax-refresh', '', data, h); await tick(); assert(box.textContent.includes('يحتاج تطبيق تحديث قاعدة البيانات'));
  // other tabs still go to the previous handler
  assert.equal(typeof w.SSMPDFinanceControls.panel('shifts', data, h), 'string');
  // registered in the workspace
  const cash = fs.readFileSync('assets/js/finance-cash.js', 'utf8'); assert(cash.includes("'staff-tax'") && cash.includes('سداد ضريبة المرتبات'));
  assert(fs.readFileSync('assets/js/db.js', 'utf8').includes("clinic_finance_tax_pay")); assert(fs.readFileSync('index.html', 'utf8').includes('finance-staff-tax.js'));
  dom.window.close();
  console.log('PASS finance staff tax DOM: month cards, gap/cap warnings, escaping, caching + month change, pay payloads (bank/cash+shift), create-only button, migration-missing message, registration.');
})().catch(e => { console.error(e); process.exit(1); });
