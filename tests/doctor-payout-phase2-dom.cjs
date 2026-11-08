// DOM test of the payout Phase 2 form hook, loading the REAL finance-controls.js -> finance-doctors.js -> finance-doctor-payout.js chain.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const data = { today: '2026-11-08', me: 'me', can_create: true, can_review: true, active_shifts: [], doctor_payouts: [],
    doctor_contracts: [{ id: 'c1', status: 'active', doctor_key: 'DOC-1', doctor_name: 'د. اختبار', service_scope: 'X', rate: 50, basis: 'performed', base_scope: 'service', deduction: 'none', valid_from: '2026-01-01', valid_to: '2026-12-31', created_by: 'o' }] };
  const calls = [], toasts = [];
  let payable = { can_review_payouts: true, doctors: [{ doctor_key: 'DOC-1', available_now: 500 }] };
  w.SSMPDDb = { financeDoctorCommand: async (a, p, k) => { calls.push([a, p]); return 'id'; }, financeDoctorPayable: async () => payable };
  w.SSMPDToast = { show: (m) => toasts.push(m) };
  for (const f of ['finance-controls', 'finance-doctors', 'finance-doctor-payout']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const field = (name, label, type, value, extra) => '<label class="fc-field">' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' + (extra || 'required') + '></label>';
  const select = (name, label, options) => '<label class="fc-field">' + esc(label) + '<select name="' + name + '" required><option value="">اختر</option>' + options.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></label>';
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (h, rows) => '<table>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>';
  let saver;
  const modal = (title, body, save) => { saver = save; const root = d.createElement('div'); root.className = 'fc-modal'; root.innerHTML = '<form>' + body + '</form>'; d.body.append(root); };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const C = () => w.SSMPDFinanceControls, form = () => d.querySelector('.fc-modal form');
  const set = (n, v, ev = 'input') => { form().elements[n].value = v; form().elements[n].dispatchEvent(new w.Event(ev, { bubbles: true })); };

  C().panel('doctors', data, h); await tick();        // preloads the payable info
  assert.equal(C().act('doctor-payout', '', data, h), true);
  await tick();
  assert(form().elements.tax_pct && form().elements.withholding_pct, 'percent inputs added');
  assert.equal(form().elements.withheld.readOnly, true, 'withheld is computed, not typed');
  set('doctor_key', 'DOC-1', 'change'); await tick();
  set('gross', '500'); set('tax_pct', '5'); set('withholding_pct', '3');
  assert.equal(form().elements.withheld.value, '40.00');
  assert(d.querySelector('[data-payout-sum]').textContent.includes('460.00'), 'net shown');
  assert.equal(form().elements.gross.validity.valid, true);
  set('gross', '500.01'); assert.equal(form().elements.gross.validity.valid, false, 'cap from payable now');
  set('gross', '500'); set('tax_pct', '60'); set('withholding_pct', '50'); assert.equal(form().elements.tax_pct.validity.valid, false, 'sum over 100 refused');
  set('tax_pct', '1.234'); assert.equal(form().elements.tax_pct.validity.valid, false, 'more than 2 decimals refused');
  set('tax_pct', '0.07'); set('gross', '123.45'); set('withholding_pct', '0');
  assert.equal(form().elements.withheld.value, '0.09');   // 123.45*0.07% = 0.0864 -> 0.09
  set('gross', '500'); set('tax_pct', '5'); set('withholding_pct', '3');
  form().elements.method.value = 'bank'; form().elements.reference.value = 'PAY-1'; form().elements.from.value = '2026-11-01'; form().elements.to.value = '2026-11-08';
  await saver(Object.fromEntries(new w.FormData(form())), 'tok');
  assert.equal(calls[0][0], 'payout'); assert.equal(calls[0][1].withheld, 40); assert.equal(Number(calls[0][1].tax_pct), 5); assert.equal(Number(calls[0][1].withholding_pct), 3);
  d.querySelector('.fc-modal').remove();

  // review gate: not the financial manager -> toast, no modal
  payable = { can_review_payouts: false, doctors: [] }; w.SSMPDFinancePayout.refresh(null); await tick();
  assert.equal(C().act('doctor-payout-review', 'p1', data, h), true); assert(!d.querySelector('.fc-modal')); assert(toasts[0].includes('للمدير المالي'));
  payable = { can_review_payouts: true, doctors: [] }; await w.SSMPDFinancePayout.refresh(null);
  assert.equal(C().act('doctor-payout-review', 'p1', data, h), true); assert(d.querySelector('.fc-modal'), 'financial manager gets the review modal');
  console.log('PASS payout phase 2 DOM: % inputs, computed withheld/net, cap hint, review gate.');
})().catch(e => { console.error(e); process.exitCode = 1; });
