// DOM test of the department-scope option in the doctor contract form + the labels, loading the REAL finance-controls.js -> finance-doctors.js.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const calls = [], bills = []; let linesProbe = 'on';
  const deptList = [{ name: 'الاسنان' }, { name: 'التحاليل' }];
  const svcList = [{ code: 'D-1', name: 'حشو', department: 'الاسنان' }, { code: 'D-2', name: 'خلع', department: 'الاسنان' }, { code: 'S-1', name: 'جلدية', department: 'الجلدية' }];
  w.SSMPDDb = { financeLinesEnabled: async () => { if (linesProbe === 'missing') throw new Error('function clinic_finance_lines_enabled does not exist'); return linesProbe === 'on'; }, financeContractServices: async () => svcList, financeContractDepartments: async () => deptList, financeDoctorCommand: async (a, p, k) => { calls.push([a, p]); return 'id'; }, financeBill: async (p) => { bills.push(p); return 'id'; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v || 0).toFixed(2);
  const field = (name, label, type, value, extra) => '<label class="fc-field">' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' + (extra || 'required') + '></label>';
  const select = (name, label, options) => '<label class="fc-field">' + esc(label) + '<select name="' + name + '" required><option value="">اختر</option>' + options.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></label>';
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><thead><tr>' + hd.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  let saver;
  const modal = (title, body, save) => { saver = save; const root = d.createElement('div'); root.className = 'fc-modal'; root.innerHTML = '<form>' + body + '</form>'; d.body.append(root); };
  const h = { esc, money, btn, table, stamp: x => x, field, select, modal };
  const C = () => w.SSMPDFinanceControls;
  const data = { today: '2026-11-08', me: 'me', can_create: true, can_review: true, stock_catalog: [], invoices: [],
    doctor_contracts: [
      { id: 'c1', doctor_key: 'DOC-A', doctor_name: 'طبيب أ', service_scope: 'D-1', valid_from: '2026-01-01', valid_to: '2026-12-31', rate: 50, base_scope: 'service', deduction: 'none', basis: 'performed', status: 'active', created_by: 'x' },
      { id: 'c2', doctor_key: 'DOC-B', doctor_name: 'طبيب ب', service_scope: 'قسم:الاسنان', valid_from: '2026-01-01', valid_to: '2026-12-31', rate: 40, base_scope: 'service', deduction: 'none', basis: 'performed', status: 'active', created_by: 'x' }],
    doctor_allocations: [], doctor_payouts: [], doctor_balances: [] };
  const submit = async () => { const f = d.querySelector('.fc-modal form'), v = {}; new w.FormData(f).forEach((x, k) => { v[k] = x; }); await saver(v, 'tok'); d.querySelector('.fc-modal').remove(); };
  const fill = (f, o) => Object.entries(o).forEach(([k, v]) => { f.elements[k].value = v; });

  // ===== external service + nurse performer in the invoice form =====
  data.today = '2026-11-10'; data.doctor_contracts = [
    { id: 'c1', doctor_key: 'DOC-A', doctor_name: 'طبيب أ', service_scope: 'D-1', valid_from: '2026-01-01', valid_to: '2026-12-31', rate: 50, base_scope: 'service', deduction: 'none', basis: 'performed', status: 'active', created_by: 'x' },
    { id: 'n1', doctor_key: 'EMP-000007', doctor_name: 'هدى', service_scope: 'تمريض:وحده', valid_from: '2026-11-09', valid_to: '2027-12-31', rate: 20, base_scope: 'service', deduction: 'none', basis: 'collected', status: 'active', created_by: 'x' },
    { id: 'n2', doctor_key: 'EMP-000008', doctor_name: 'سلمى', service_scope: 'تمريض:مع طبيب', valid_from: '2026-11-09', valid_to: '2027-12-31', fee_kind: 'fixed', fixed_amount: 100, rate: 0, base_scope: 'service', deduction: 'none', basis: 'performed', status: 'active', created_by: 'x' },
    { id: 'n3', doctor_key: 'EMP-000011', doctor_name: 'منتهي', service_scope: 'تمريض:وحده', valid_from: '2025-01-01', valid_to: '2025-12-31', rate: 20, base_scope: 'service', deduction: 'none', basis: 'collected', status: 'active', created_by: 'x' },
    { id: 'n4', doctor_key: 'EMP-000003', doctor_name: 'معلّق', service_scope: 'تمريض:وحده', valid_from: '2026-11-09', valid_to: '2027-12-31', rate: 20, base_scope: 'service', deduction: 'none', basis: 'collected', status: 'pending', created_by: 'x' }];
  let extProbe = false; w.SSMPDDb.financeExternalServiceEnabled = async () => extProbe;
  d.querySelectorAll('.fc-modal').forEach(m => m.remove()); linesProbe = 'on';
  // probe off: nothing changes
  C().act('invoice', '', data, h); await tick(); let fx = d.querySelector('.fc-modal form'); assert(!fx.querySelector('[data-external-nurse]'), 'no external/nurse block before the migration is deployed');
  fill(fx, { reference: 'X-0', patient: 'م', description: 'خدمة', amount: '100' }); Array.from(fx.querySelectorAll('.fc-check input')).pop().checked = true; await submit(); let b0 = bills.pop(); assert(!('external_service' in b0) && !('performer_mode' in b0), 'legacy payload');
  // probe on
  extProbe = true; d.querySelectorAll('.fc-modal').forEach(m => m.remove()); C().act('invoice', '', data, h); await tick(); fx = d.querySelector('.fc-modal form');
  const nb = fx.querySelector('[data-external-nurse]'); assert(nb, 'block shown');
  assert(fx.querySelector('[data-ext-box]').hidden && fx.querySelector('[data-nurse-box]').hidden, 'collapsed by default');
  // external service: toggle opens the box; payload carries the flag and the extra
  fx.elements.external_service.checked = true; fx.elements.external_service.dispatchEvent(new w.Event('change')); assert(!fx.querySelector('[data-ext-box]').hidden && fx.elements.external_extra.required);
  fill(fx, { reference: 'X-1', patient: 'م', description: 'زيارة', amount: '500', external_extra: '250' }); Array.from(fx.querySelectorAll('.fc-check input')).pop().checked = true; await submit(); let b1 = bills.pop();
  assert.equal(b1.external_service, true); assert.equal(b1.external_extra, 250); assert.equal(b1.service_amount, 500, 'service amount is the service only; the server adds the extra'); assert(!('performer_mode' in b1));
  // toggle on but no amount
  d.querySelectorAll('.fc-modal').forEach(m => m.remove()); C().act('invoice', '', data, h); await tick(); fx = d.querySelector('.fc-modal form');
  fx.elements.external_service.checked = true; fx.elements.external_service.dispatchEvent(new w.Event('change')); fill(fx, { reference: 'X-2', patient: 'م', description: 'زيارة', amount: '500', external_extra: '0' }); Array.from(fx.querySelectorAll('.fc-check input')).pop().checked = true;
  await assert.rejects(() => submit(), /اكتب المبلغ الإضافي/);
  // nurse alone: only nurses with an ACTIVE nurse-alone contract today; the doctor pickers are disabled; payload
  d.querySelectorAll('.fc-modal').forEach(m => m.remove()); C().act('invoice', '', data, h); await tick(); fx = d.querySelector('.fc-modal form');
  fx.elements.performer_mode.value = 'nurse_alone'; fx.elements.performer_mode.dispatchEvent(new w.Event('change'));
  assert(!fx.querySelector('[data-nurse-box]').hidden); assert.deepEqual(Array.from(fx.elements.nurse_key.options).map(o => o.value), ['EMP-000007'], 'expired and pending contracts are not offered; with-doctor nurses not offered here');
  assert(fx.elements.doctor_contract.disabled && fx.elements.lines_doctor.disabled, 'doctor pickers disabled for nurse alone');
  fill(fx, { reference: 'X-3', patient: 'م', description: 'حقنة', amount: '300' }); Array.from(fx.querySelectorAll('.fc-check input')).pop().checked = true; await submit(); let b3 = bills.pop();
  assert.equal(b3.performer_mode, 'nurse_alone'); assert.equal(b3.nurse_key, 'EMP-000007'); assert(!b3.service_lines && !b3.doctor_key);
  // nurse with doctor: needs the doctor + lines
  d.querySelectorAll('.fc-modal').forEach(m => m.remove()); C().act('invoice', '', data, h); await tick(); fx = d.querySelector('.fc-modal form');
  fx.elements.performer_mode.value = 'nurse_with_doctor'; fx.elements.performer_mode.dispatchEvent(new w.Event('change'));
  assert.deepEqual(Array.from(fx.elements.nurse_key.options).map(o => o.value), ['EMP-000008']); assert(fx.elements.lines_doctor.required && !fx.elements.lines_doctor.disabled);
  fill(fx, { reference: 'X-4', patient: 'م', description: 'زيارة', amount: '500' }); Array.from(fx.querySelectorAll('.fc-check input')).pop().checked = true;
  await assert.rejects(() => submit(), /ممرض مع طبيب: اختر الطبيب/, 'without a doctor/lines it never reaches the server');
  fx.elements.lines_doctor.value = 'DOC-A'; fx.elements.lines_doctor.dispatchEvent(new w.Event('change'));
  const r4 = fx.querySelectorAll('[data-line-row]'); r4[0].querySelector('[data-line-code]').value = 'D-1'; r4[0].querySelector('[data-line-amount]').value = '500';
  await submit(); let b4 = bills.pop(); assert.equal(b4.performer_mode, 'nurse_with_doctor'); assert.equal(b4.nurse_key, 'EMP-000008'); assert.equal(b4.doctor_key, 'DOC-A'); assert.equal(b4.service_lines.length, 1);
  // back to the default performer clears the requirement
  fx.elements.performer_mode.value = ''; fx.elements.performer_mode.dispatchEvent(new w.Event('change')); assert(fx.querySelector('[data-nurse-box]').hidden && !fx.elements.lines_doctor.required);
  console.log('PASS external service + nurse options UI: probe gate, extra toggle/amount, nurse alone (doctor pickers off), nurse with doctor (needs lines), payload shapes');
})().catch(e => { console.error(e); process.exit(1); });
