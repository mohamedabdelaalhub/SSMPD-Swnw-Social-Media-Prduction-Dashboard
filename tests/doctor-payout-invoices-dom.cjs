// DOM test (doctor dues by invoice): every case is listed with a status, only payable invoices have a checkbox, select-all picks the payable ones,
// the running total follows the ticks, the request carries the chosen invoice ids (never a lump amount), the cap is enforced, fallbacks when the RPC is missing.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const tick = () => new Promise(r => setTimeout(r, 20));
  const inv = (id, ref, fee, status, extra) => Object.assign({ invoice_id: id, reference: ref, date: '2026-11-01', fee, net: 1000, collected: 0, dues_status: status, selectable: status === 'payable', lines: [{ service_name: 'كشف', service_code: 'S1' }] }, extra || {});
  const DUES = { invoices: [
    inv('i1', 'INV-1', 500, 'payable', { collected: 1000 }), inv('i2', 'INV-2', 200.5, 'payable', { collected: 1000 }),
    inv('i3', 'INV-3', 100, 'waiting_patient', { patient_open: 300 }), inv('i4', 'INV-4', 80, 'waiting_insurer', { insurer: 'شركة س', insurer_open: 400 }),
    inv('i5', 'INV-5', 60, 'requested', { collected: 1000 }), inv('i6', 'INV-6', 40, 'paid_out', { collected: 1000 })],
    uncovered: [{ date: '2026-11-02', service_code: 'X9', service_name: 'تحليل', amount: 150, reason: 'none' }],
    dues: { payable_total: 700.5, requested_total: 60, paid_out_total: 40, waiting_total: 180, payable_now: 800, pending_payouts: 60, available_now: 740 } };
  let mode = 'ok', sent = null, dueCalls = [];
  w.SSMPDDb = { financeDoctorCommand: async () => ({}), financeDoctorStatement: async () => ({ summary: {}, invoices: [] }),
    financeDoctorDues: async (k, f, t) => { dueCalls.push([k, f, t]); if (mode === 'missing') throw new Error('404'); return DUES; },
    financePayoutInvoices: async (...a) => { sent = a; return 'payout-id'; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctor-dues.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" value="' + (val || '') + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let submit = null;
  const modal = (title, body, fn) => { d.querySelectorAll('.fc-modal').forEach(x => x.remove()); const form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn: () => '', table, stamp: x => x, field, select, modal };
  const data = { today: '2026-11-09', can_create: true, active_shifts: [{ id: 'sh1', register_name: 'الخزنة' }], doctor_contracts: [{ doctor_key: 'EMP-38', doctor_name: 'د. أحمد' }] };
  const vals = (o) => Object.assign({ tax_pct: '0', withholding_pct: '0', method: 'bank', shift_id: '', reference: 'R1' }, o);

  assert.equal(w.SSMPDFinanceControls.act('doctor-dues', 'EMP-38', data, h), true);
  assert(d.body.textContent.includes('جاري تحميل'), 'loading first');
  await tick();
  assert.equal(dueCalls.length, 1); assert.equal(dueCalls[0][0], 'EMP-38');
  const m = d.querySelector('.fc-modal'), txt = m.textContent;
  for (const s of ['INV-1', 'INV-3', 'INV-6', 'مستحق للصرف الآن', 'بانتظار حصة المريض', 'بانتظار التأمين', 'طلب صرف معلّق', 'تم صرفه', 'بدون عقد ساري', 'تحليل', 'متبقي على المريض 300.00', 'شركة س', '740.00']) assert(txt.includes(s), 'shows ' + s);
  const boxes = () => [...m.querySelectorAll('[data-dues-row]')];
  assert.equal(boxes().length, 2, 'checkbox only for payable invoices'); assert.deepEqual(boxes().map(x => x.value), ['i1', 'i2']);
  assert.equal(m.querySelectorAll('tbody tr').length, 7, 'all 6 invoices + the no-contract service are listed');
  const total = () => m.querySelector('[data-dues-total]').textContent;
  assert.equal(total(), '0.00');
  boxes()[1].checked = true; boxes()[1].dispatchEvent(new w.Event('change', { bubbles: true })); assert.equal(total(), '200.50', 'running total');
  const all = m.querySelector('[data-dues-all]'); all.checked = true; all.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert(boxes().every(x => x.checked)); assert.equal(total(), '700.50');
  boxes()[0].checked = false; boxes()[0].dispatchEvent(new w.Event('change', { bubbles: true })); assert.equal(total(), '200.50'); assert.equal(all.checked, false, 'select-all unticks when one is cleared');
  // tax preview (half-up): 200.50 * 5% = 10.025 -> 10.03
  const f = m.querySelector('form'); f.elements.tax_pct.value = '5'; f.elements.tax_pct.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(m.querySelector('[data-dues-sum]').textContent.includes('ضريبة 10.03') , m.querySelector('[data-dues-sum]').textContent);
  assert.equal(f.elements.shift_id.disabled, true, 'shift only for cash'); f.elements.method.value = 'cash'; f.elements.method.dispatchEvent(new w.Event('change')); assert.equal(f.elements.shift_id.disabled, false);
  f.elements.method.value = 'bank'; f.elements.method.dispatchEvent(new w.Event('change'));

  // submit carries ids (not an amount)
  await submit(vals({ tax_pct: '5' }), 'tok-1');
  assert.equal(sent[0], 'EMP-38'); assert.equal(JSON.stringify(sent[1]), '["i2"]'); assert.equal(sent[2], 5); assert.equal(sent[3], 0); assert.equal(sent[4], 'bank'); assert.equal(sent[5], null); assert.equal(sent[9], 'tok-1');
  // cash passes the shift
  await submit(vals({ method: 'cash', shift_id: 'sh1' }), 'tok-2'); assert.equal(sent[5], 'sh1');
  // nothing ticked -> refused, no request
  boxes()[1].checked = false; sent = null;
  await assert.rejects(async () => submit(vals(), 'tok-3'), /فاتورة واحدة/); assert.equal(sent, null);
  // over the available cap -> refused
  DUES.dues.available_now = 100; boxes()[0].checked = true; boxes()[0].dispatchEvent(new w.Event('change', { bubbles: true }));
  await assert.rejects(async () => submit(vals(), 'tok-4'), /أكبر من المتاح/); assert.equal(sent, null); assert(m.querySelector('[data-dues-sum]').textContent.includes('أكبر من المتاح'));
  DUES.dues.available_now = 740;

  // RPC not applied -> clear message, no crash
  mode = 'missing'; w.SSMPDFinanceControls.act('doctor-dues', 'EMP-38', data, h); await tick();
  assert(d.querySelector('.fc-modal').textContent.includes('تحديث قاعدة البيانات'));
  // missing wrapper -> unavailable message
  const keep = w.SSMPDDb.financeDoctorDues; delete w.SSMPDDb.financeDoctorDues; w.SSMPDFinanceControls.act('doctor-dues', 'EMP-38', data, h);
  assert(d.querySelector('.fc-modal').textContent.includes('غير متاحة'));
  // other actions still reach the prior chain
  assert.doesNotThrow(() => w.SSMPDFinanceControls.act('doctor-statement', 'EMP-38', data, h));
  console.log('PASS doctor payout by invoice DOM: all cases listed with status, checkbox only for payable, select-all, running total, request carries invoice ids, cap + empty refusals, cash shift, missing-RPC fallbacks');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
