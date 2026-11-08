// DOM test: fixed-amount fee in the contract form (create + revise): the type selector appears only when the server probe says the migration is deployed; fixed hides the percent, sends fee_kind/fixed_amount and no rate; list shows the fixed amount.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  let sent = null;
  let probe = true; w.SSMPDDb = { financeFixedFeeEnabled: async () => probe, financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async (a, p, k) => { sent = { a, p, k }; return {}; } };
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
  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { doctor_contracts: [mk('a1', 'active'), mk('f1', 'active', { fee_kind: 'fixed', fixed_amount: 100, rate: 0, doctor_key: 'EMP-7', doctor_name: 'ممرضة' })] }), h); d.body.append(box);
  assert(box.textContent.includes('100.00 ج ثابت'), 'list shows the fixed amount, not 0%'); assert(box.textContent.includes('مبلغ ثابت 100.00 ج'), 'group summary'); assert(box.textContent.includes('النسبة 50.00%'), 'percent group unchanged');
  const tick = () => new Promise(r => setTimeout(r, 20));
  // ---- create form
  assert.equal(w.SSMPDFinanceControls.act('doctor-contract', '', data, h), true); await tick();
  let cf = form, sel = cf.elements.fee_kind, selLabel = sel.closest('label');
  assert(!selLabel.hidden, 'selector shown when the migration probe is true'); assert(cf.querySelector('[data-fee-fixed]').hidden); assert(!cf.elements.rate.disabled);
  sel.value = 'fixed'; sel.onchange(); assert(!cf.querySelector('[data-fee-fixed]').hidden); assert(cf.elements.rate.disabled && !cf.elements.rate.required); assert(cf.elements.fixed_amount.required && !cf.elements.fixed_amount.disabled);
  const vals = f => Object.fromEntries(Array.from(f.elements).filter(e => e.name).map(e => [e.name, e.value]));
  Object.assign(cf.elements, {}); cf.elements.doctor_key.value = 'EMP-7'; cf.elements.fixed_amount.value = '100'; cf.elements.deduction.value = 'sale';
  let v = vals(cf); v.scope = 'HV'; await submit(v, 'k1');
  assert.equal(sent.a, 'contract'); assert.equal(sent.p.fee_kind, 'fixed'); assert.equal(sent.p.fixed_amount, 100); assert(!('rate' in sent.p), 'no rate for a fixed contract'); assert.equal(sent.p.deduction, 'none', 'fixed never deducts supplies');
  await assert.rejects(async () => { const bad = vals(cf); bad.fixed_amount = '0'; bad.scope = 'HV'; await submit(bad, 'k2'); }, /أكبر من صفر/);
  // percent path: no fee_kind / fixed_amount, rate numeric
  sel.value = 'percent'; sel.onchange(); cf.elements.rate.value = '30'; v = vals(cf); v.scope = 'HV'; v.fixed_amount = ''; await submit(v, 'k3');
  assert.equal(sent.p.rate, 30); assert(!('fee_kind' in sent.p) && !('fixed_amount' in sent.p), 'percent request is the old payload');
  // probe false (migration not deployed): the selector stays hidden
  probe = false; d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDFinanceControls.act('doctor-contract', '', data, h); await tick(); assert(form.elements.fee_kind.closest('label').hidden, 'selector hidden without the migration'); probe = true;
  // ---- revise a fixed contract: prefilled as fixed
  d.querySelectorAll('.fc-modal').forEach(x => x.remove());
  const data2 = Object.assign({}, data, { doctor_contracts: [mk('f1', 'active', { fee_kind: 'fixed', fixed_amount: 100, rate: 0 })] });
  assert.equal(w.SSMPDFinanceControls.act('doctor-contract-revise', 'f1', data2, h), true); await tick();
  const rf = form; assert.equal(rf.elements.fee_kind.value, 'fixed'); assert.equal(rf.elements.fixed_amount.value, '100'); assert(rf.elements.rate.disabled);
  rf.elements.fixed_amount.value = '120'; rf.elements.from.value = '2027-02-01'; rf.elements.reference.value = 'تعديل'; rf.elements.note.value = 'سبب';
  await submit(vals(rf), 'k4'); assert.equal(sent.a, 'contract_revise'); assert.equal(sent.p.supersedes, 'f1'); assert.equal(sent.p.fixed_amount, 120); assert.equal(sent.p.fee_kind, 'fixed'); assert(!('rate' in sent.p));
  console.log('PASS fixed fee contract UI');
})().catch(e => { console.error(e); process.exit(1); });
