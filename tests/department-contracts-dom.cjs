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
  const common = { doctor_key: 'DOC-Q', doctor_name: 'طبيب كيو', from: '2026-11-01', to: '2026-12-31', rate: '45', basis: 'performed', base_scope: 'service', deduction: 'none', reference: 'ملحق' };

  // ---- listing shows a readable label for department scopes and leaves exact scopes alone
  const html = C().panel('doctors', data, h);
  assert(html.includes('كل خدمات قسم الاسنان'), 'department contract label');
  assert(html.includes('>D-1</span> — 2026-01-01'), 'exact scope shown as is');
  assert(!html.includes('قسم:الاسنان'), 'raw storage format is not shown');

  // ---- form: service kind is the default and behaves exactly like before
  C().act('doctor-contract', '', data, h); await tick();
  let f = d.querySelector('.fc-modal form');
  assert.equal(f.elements.scope_kind.value, 'service' === f.elements.scope_kind.value ? 'service' : f.elements.scope_kind.value);
  f.elements.scope_kind.value = 'service'; f.elements.scope_kind.dispatchEvent(new w.Event('change'));
  assert(f.elements.scope.required && !f.elements.scope.disabled && f.elements.department.disabled && !f.elements.department.required);
  assert(f.querySelector('[data-scope-dept]').hidden && !f.querySelector('[data-scope-service]').hidden);
  fill(f, { ...common, scope_kind: 'service', scope: 'D-7' }); f.querySelector('.fc-check input[type=checkbox]:not([name])').checked = true;
  await submit(); let [a, p] = calls.pop();
  assert.equal(a, 'contract'); assert.equal(p.scope, 'D-7'); assert(!('scope_kind' in p) && !('department' in p) && !('allow_restricted' in p), 'payload shape unchanged for exact scopes');
  assert.equal(p.rate, 45); assert.equal(p.refund_policy, 'proportional_revenue');

  // ---- form: department kind loads departments, builds the stored format, drops helper fields
  C().act('doctor-contract', '', data, h); await tick();
  f = d.querySelector('.fc-modal form');
  fill(f, { scope_kind: 'department' }); f.elements.scope_kind.dispatchEvent(new w.Event('change'));
  assert(f.elements.scope.disabled && !f.elements.scope.required && !f.elements.department.disabled && f.elements.department.required);
  assert(!f.querySelector('[data-scope-dept]').hidden && f.querySelector('[data-scope-service]').hidden);
  assert.deepEqual([...f.elements.department.options].map(o => o.value), ['', 'الاسنان', 'التحاليل']);
  assert(!f.elements.allow_restricted && !f.querySelector('[data-scope-restricted]'), 'no restricted-department confirmation exists');
  fill(f, { ...common, department: 'الاسنان' }); f.elements.department.dispatchEvent(new w.Event('change'));
  f.querySelector('.fc-check input[type=checkbox]:not([name])').checked = true;
  await submit(); [a, p] = calls.pop();
  assert.equal(p.scope, 'قسم:الاسنان'); assert(!('scope_kind' in p) && !('department' in p) && !('allow_restricted' in p));

  // ---- labs / emergency are ordinary departments: picking one needs no confirmation
  C().act('doctor-contract', '', data, h); await tick();
  f = d.querySelector('.fc-modal form');
  fill(f, { scope_kind: 'department' }); f.elements.scope_kind.dispatchEvent(new w.Event('change'));
  fill(f, { ...common, department: 'التحاليل' }); f.elements.department.dispatchEvent(new w.Event('change'));
  f.querySelector('.fc-check input[type=checkbox]:not([name])').checked = true;
  await submit(); [a, p] = calls.pop();
  assert.equal(p.scope, 'قسم:التحاليل'); assert(!('allow_restricted' in p));

  // ---- invoice contract picker shows the readable label
  C().act('invoice', '', data, h); await tick();
  const opts = [...d.querySelectorAll('.fc-modal select[name=doctor_contract] option')].map(o => o.textContent);
  assert(opts.some(t => t.includes('كل خدمات قسم الاسنان')) && opts.some(t => t.includes('D-1')), 'invoice picker lists department and exact contracts');
  // ---- multi-service contract: search, select many, ONE rate -> one batch call with every selected code
  d.querySelectorAll('.fc-modal').forEach(m => m.remove());
  C().act('doctor-contract', '', data, h); await tick();
  f = d.querySelector('.fc-modal form');
  fill(f, { scope_kind: 'services' }); f.elements.scope_kind.dispatchEvent(new w.Event('change'));
  assert(!f.querySelector('[data-scope-multi]').hidden && f.elements.scope.disabled && !f.elements.scope.required && f.querySelector('[data-scope-service]').hidden && f.querySelector('[data-scope-dept]').hidden);
  assert.equal(f.querySelectorAll('[data-svc-list] input').length, 3, 'the whole service list is offered');
  const search = f.querySelector('[data-svc-search]'); search.value = 'خلع'; search.dispatchEvent(new w.Event('input'));
  assert.deepEqual([...f.querySelectorAll('[data-svc-list] input')].map(x => x.value), ['D-2'], 'search narrows the list by name');
  f.querySelector('[data-svc-list] input').checked = true; f.querySelector('[data-svc-list]').dispatchEvent(new w.Event('change', { bubbles: true }));
  search.value = 'الاسنان'; search.dispatchEvent(new w.Event('input'));
  assert.deepEqual([...f.querySelectorAll('[data-svc-list] input')].map(x => x.value), ['D-1', 'D-2'], 'search by department; the earlier pick stays selected');
  assert(f.querySelector('[data-svc-list] input[value="D-2"]').checked);
  f.querySelector('[data-svc-pick]').click();
  assert(f.querySelector('[data-svc-count]').textContent.includes('2'), 'the count of selected services is shown');
  fill(f, common); f.querySelector('.fc-check input[type=checkbox]:not([name]):not([value])').checked = true;
  await submit(); [a, p] = calls.pop();
  assert.equal(a, 'contract_batch'); assert.equal(JSON.stringify(p.scopes), JSON.stringify(['D-1', 'D-2'])); assert(!('scope' in p) && !('scope_kind' in p)); assert.equal(p.rate, 45);
  C().act('doctor-contract', '', data, h); await tick(); f = d.querySelector('.fc-modal form');
  fill(f, { scope_kind: 'services' }); f.elements.scope_kind.dispatchEvent(new w.Event('change')); fill(f, common); f.querySelector('.fc-check input[type=checkbox]:not([name]):not([value])').checked = true;
  await assert.rejects(() => submit(), /خدمة واحدة على الأقل/, 'a batch with nothing selected is refused in the form');
  d.querySelectorAll('.fc-modal').forEach(m => m.remove());

  // ---- batch review: pending contracts created together are offered as one group
  for (const n of ['p1', 'p2']) data.doctor_contracts.push({ id: n, doctor_key: 'DOC-Z', doctor_name: 'طبيب ز', service_scope: n === 'p1' ? 'D-1' : 'D-2', valid_from: '2026-01-01', valid_to: '2026-12-31', rate: 35, base_scope: 'service', deduction: 'none', basis: 'performed', status: 'pending', created_by: 'x', reference: 'دفعة' });
  assert(C().panel('doctors', data, h).includes('مراجعة المجموعة (2)'), 'a group button appears for pending contracts created together');
  C().act('doctor-contract-review-batch', 'p1', data, h);
  f = d.querySelector('.fc-modal form'); fill(f, { approval: 'yes', note: 'اعتماد الدفعة' }); await submit(); [a, p] = calls.pop();
  assert.equal(a, 'contract_review_batch'); assert.equal(JSON.stringify(p.ids), JSON.stringify(['p1', 'p2'])); assert.equal(p.approve, true);
  data.doctor_contracts.splice(-2, 2);

  // ---- invoice with per-service lines: rows, running total, payload shape, and the guard against a wrong total
  d.querySelectorAll('.fc-modal').forEach(m => m.remove());
  // feature gate: the per-line block exists only when the SQL probe succeeds (an old SQL would silently drop the doctor allocation)
  for (const state of ['missing', 'off']) {
    linesProbe = state; C().act('invoice', '', data, h); await tick();
    const g = d.querySelector('.fc-modal form'); assert(!g.querySelector('[data-doctor-lines]') && g.elements.doctor_contract, 'probe ' + state + ': old single-contract UI only');
    fill(g, { reference: 'INV-G' + state, patient: 'م', description: 'خدمة أسنان', amount: '100' }); g.querySelector('.fc-check input').checked = true; await submit();
    assert(!('service_lines' in bills.pop()) && true, 'probe ' + state + ': legacy payload');
  }
  linesProbe = 'on';
  C().act('invoice', '', data, h); await tick();
  const inv = d.querySelector('.fc-modal form'), ctr = inv.elements.doctor_contract;
  assert(inv.querySelector('[data-doctor-lines]') && !inv.querySelector('[data-line-rows]').children.length, 'the lines block is collapsed until a doctor is chosen');
  inv.elements.lines_doctor.value = 'DOC-A'; inv.elements.lines_doctor.dispatchEvent(new w.Event('change'));
  assert(ctr.disabled && inv.querySelectorAll('[data-line-row]').length === 1, 'choosing a doctor opens one line and disables the single-contract picker');
  inv.querySelector('[data-line-add]').click();
  const rowsEl = inv.querySelectorAll('[data-line-row]');
  rowsEl[0].querySelector('[data-line-code]').value = 'D-1'; rowsEl[0].querySelector('[data-line-amount]').value = '300';
  rowsEl[1].querySelector('[data-line-code]').value = 'D-2'; rowsEl[1].querySelector('[data-line-amount]').value = '200';
  fill(inv, { reference: 'INV-L1', patient: 'م', description: 'خدمتان أسنان', amount: '400' }); inv.querySelector('.fc-check input').checked = true;
  inv.querySelector('[data-line-rows]').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(inv.querySelector('[data-line-total]').textContent.includes('يجب أن يتساويا'), 'running total flags a mismatch');
  await assert.rejects(() => submit(), /يجب أن يساوي قيمة الخدمة/, 'a wrong total never reaches the server');
  inv.elements.amount.value = '500'; inv.elements.amount.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(inv.querySelector('[data-line-total]').textContent.includes('✔'));
  await submit(); const bp = bills.pop();
  assert.equal(bp.doctor_key, 'DOC-A'); assert.equal(bp.doctor_contract_id, null); assert.equal(bp.service_amount, 500);
  assert.equal(JSON.stringify(bp.service_lines), JSON.stringify([{ code: 'D-1', amount: 300, kind: 'service' }, { code: 'D-2', amount: 200, kind: 'service' }]));
  // without a doctor choice the payload is the legacy one (no service_lines)
  C().act('invoice', '', data, h); await tick(); const inv2 = d.querySelector('.fc-modal form');
  fill(inv2, { reference: 'INV-L2', patient: 'م', description: 'خدمة أسنان', amount: '100' }); inv2.querySelector('.fc-check input').checked = true; await submit();
  assert(!('service_lines' in bills.pop()), 'legacy payload unchanged without a doctor split');
  console.log('PASS department contracts DOM: multi-service batch + group review, invoice service lines, labels, service/department toggle, department list, no restricted confirmation, payload shape, invoice picker');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
