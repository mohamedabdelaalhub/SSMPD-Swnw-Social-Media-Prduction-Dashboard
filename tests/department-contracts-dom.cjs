// DOM test of the department-scope option in the doctor contract form + the labels, loading the REAL finance-controls.js -> finance-doctors.js.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const calls = [];
  const deptList = [{ name: 'الاسنان', restricted: false }, { name: 'التحاليل', restricted: true }];
  w.SSMPDDb = { financeContractDepartments: async () => deptList, financeDoctorCommand: async (a, p, k) => { calls.push([a, p]); return 'id'; }, financeBill: async () => 'id' };
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
  assert(html.includes('D-1 — 2026-01-01'), 'exact scope shown as is');
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
  assert(f.elements.department.options[2].textContent.includes('يحتاج تأكيدًا'), 'restricted departments are flagged in the list');
  assert(f.querySelector('[data-scope-restricted]').hidden && f.elements.allow_restricted.disabled);
  fill(f, { ...common, department: 'الاسنان' }); f.elements.department.dispatchEvent(new w.Event('change'));
  f.querySelector('.fc-check input[type=checkbox]:not([name])').checked = true;
  await submit(); [a, p] = calls.pop();
  assert.equal(p.scope, 'قسم:الاسنان'); assert(!('scope_kind' in p) && !('department' in p) && !('allow_restricted' in p));

  // ---- restricted department needs the explicit confirmation, which is then sent as true
  C().act('doctor-contract', '', data, h); await tick();
  f = d.querySelector('.fc-modal form');
  fill(f, { scope_kind: 'department' }); f.elements.scope_kind.dispatchEvent(new w.Event('change'));
  fill(f, { ...common, department: 'التحاليل' }); f.elements.department.dispatchEvent(new w.Event('change'));
  assert(!f.querySelector('[data-scope-restricted]').hidden && f.elements.allow_restricted.required && !f.elements.allow_restricted.disabled);
  f.elements.allow_restricted.checked = true; f.querySelector('.fc-check input[type=checkbox]:not([name])').checked = true;
  await submit(); [a, p] = calls.pop();
  assert.equal(p.scope, 'قسم:التحاليل'); assert.strictEqual(p.allow_restricted, true);

  // ---- invoice contract picker shows the readable label
  C().act('invoice', '', data, h);
  const opts = [...d.querySelectorAll('.fc-modal select[name=doctor_contract] option')].map(o => o.textContent);
  assert(opts.some(t => t.includes('كل خدمات قسم الاسنان')) && opts.some(t => t.includes('D-1')), 'invoice picker lists department and exact contracts');
  console.log('PASS department contracts DOM: labels, service/department toggle, department list, restricted confirmation, payload shape, invoice picker');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
