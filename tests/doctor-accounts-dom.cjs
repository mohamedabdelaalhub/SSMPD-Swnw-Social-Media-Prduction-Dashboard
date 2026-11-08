// DOM test (doctor accounts tab + HR picker): the tab lists only the rows the server returns, shows balance / payable now / waiting, filters, opens the EXISTING statement on click,
// degrades clearly when the RPC is not applied; the contract form uses an HR picker (code + name auto-filled, manual fallback), and "doctors needing a contract" opens the form prefilled.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const tick = () => new Promise(r => setTimeout(r, 20));
  const ACC = { generated_at: 'x', doctors: [
    { doctor_key: 'EMP-000038', doctor_name: 'د. أحمد', has_active_contract: true, accrued: 900, paid_out: 100, balance: 800, waiting: 300, waiting_invoices: 2, payable_now: 500, pending_payouts: 0 },
    { doctor_key: 'EMP-000043', doctor_name: 'د. منى', has_active_contract: true, accrued: 200, paid_out: 0, balance: 200, waiting: 200, waiting_invoices: 1, payable_now: 0, pending_payouts: 50 },
    { doctor_key: 'OLD-1', doctor_name: 'د. قديم', has_active_contract: false, accrued: 0, paid_out: 0, balance: 75, waiting: 0, waiting_invoices: 0, payable_now: 75, pending_payouts: 0 }] };
  const PEOPLE = { people: [
    { person_id: 'p1', code: 'EMP-000001', full_name: 'د. جديد', kind: 'doctor', status: 'active', department: 'أسنان', job_title: 'أخصائي', doctor_key: null, contract_key: 'EMP-000001', active_contracts: 0, pending_contracts: 0, needs_contract: true },
    { person_id: 'p2', code: 'EMP-000038', full_name: 'د. أحمد', kind: 'doctor', status: 'active', department: 'قلب', job_title: '', doctor_key: null, contract_key: 'EMP-000038', active_contracts: 4, pending_contracts: 0, needs_contract: false },
    { person_id: 'p3', code: 'EMP-000007', full_name: 'هدى ممرضة', kind: 'employee', status: 'active', department: 'تمريض', job_title: 'ممرضة', doctor_key: null, contract_key: 'EMP-000007', active_contracts: 0, pending_contracts: 0, needs_contract: true },
    { person_id: 'p4', code: 'EMP-000009', full_name: 'د. مربوط', kind: 'both', status: 'on_leave', department: '', job_title: '', doctor_key: 'LINKED-9', contract_key: 'LINKED-9', active_contracts: 0, pending_contracts: 0, needs_contract: true }] };
  let sent = null, accCalls = 0, hrCalls = 0, stmtCalls = [], mode = 'ok';
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [],
    financeDoctorCommand: async (a, p, k) => { sent = { a, p, k }; return {}; },
    financeDoctorStatement: async (k, f, t) => { stmtCalls.push([k, f, t]); return { summary: { accrued: 900, payable_invoices: 600, pending: 300, paid_out: 100, balance: 800, available_to_pay: 500 }, invoices: [] }; },
    financeDoctorAccounts: async () => { accCalls++; if (mode === 'missing') throw new Error('404'); return ACC; },
    financeHrStaff: async () => { hrCalls++; if (mode === 'missing') throw new Error('404'); return PEOPLE; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctor-accounts.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let submit = null;
  const modal = (title, body, fn) => { const form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [], doctor_contracts: [] };
  const box = d.createElement('div'); d.body.append(box);
  let navigated = [];
  // minimal stand-in for the workspace: navigate() re-draws the section and binds the buttons like the real one
  const bind = () => box.querySelectorAll('[data-fin-action]').forEach(b => { b.onclick = () => w.SSMPDFinanceControls.act(b.dataset.finAction, b.dataset.id, data, h); });
  const draw = id => { box.innerHTML = w.SSMPDFinanceControls.panel(id, data, h); bind(); };
  w.SSMPDFinanceCash = { navigate: id => { navigated.push(id); draw(id); } };

  // ---- the tab: first paint = loading, then the workspace re-draws with the rows
  draw('doctor-accounts');
  assert(box.textContent.includes('جاري تحميل'), 'loading state first');
  await tick(); assert.deepEqual(navigated, ['doctor-accounts'], 'one re-draw after the data arrives');
  const rows = () => [...box.querySelectorAll('.fc-da-table tbody tr')];
  assert.equal(rows().length, 3, 'exactly the accounts the server returned');
  const txt = box.textContent;
  for (const s of ['د. أحمد', 'EMP-000038', '800.00', '500.00', '300.00', '(2 فاتورة)', '50.00', 'بدون عقد معتمد']) assert(txt.includes(s), 'shows ' + s);
  const cards = box.querySelector('.fc-st-cards').textContent; assert(cards.includes('575.00'), 'payable now total 500+0+75'); assert(cards.includes('عدد الأطباء') && cards.includes('3'), 'doctor count'); const cv = [...box.querySelectorAll('.fc-st-card strong')].map(x => x.textContent); assert.deepEqual(cv, ['3', '575.00', '500.00'], 'cards: doctors with an account, payable now total, waiting total');
  assert.equal(accCalls, 1); assert.equal(hrCalls, 1);
  draw('doctor-accounts'); await tick(); assert.equal(accCalls, 1, 'cached for 30s: no new request on every redraw'); assert.equal(navigated.length, 1, 'no re-draw loop');

  // filters + name search (delegated, like the contracts filter)
  box.querySelector('[data-da-filter="owed"]').click(); assert.equal(rows().filter(r => !r.hidden).length, 2, 'only doctors with payable now > 0');
  box.querySelector('[data-da-filter="waiting"]').click(); assert.equal(rows().filter(r => !r.hidden).length, 2, 'waiting > 0');
  box.querySelector('[data-da-filter="all"]').click(); assert.equal(rows().filter(r => !r.hidden).length, 3);
  const inp = box.querySelector('[data-da-name]'); inp.value = 'منى'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(rows().filter(r => !r.hidden).length, 1, 'name search'); inp.value = 'EMP-000038'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(rows().filter(r => !r.hidden).length, 1, 'code search');
  inp.value = ''; inp.dispatchEvent(new w.Event('input', { bubbles: true }));

  // a click on the doctor name opens the EXISTING statement (finance-doctors.js), no new statement code
  rows()[0].querySelector('[data-fin-action="doctor-statement"]').click(); await tick();
  assert.deepEqual(stmtCalls[0], ['EMP-000038', '2026-08-10', '2026-11-08'], 'statement of the clicked doctor, last 90 days');
  assert(d.querySelector('.fc-modal form').textContent.includes('مستحق الصرف الآن'), 'statement content shown');
  d.querySelectorAll('.fc-modal').forEach(x => x.remove());
  assert.equal(rows()[0].querySelectorAll('[data-fin-action="doctor-statement"]').length, 2, 'name and an explicit button both open it');
  // payout entry point is only offered to users who can create
  assert(box.querySelector('[data-fin-action="open-disbursement"]'));
  box.innerHTML = w.SSMPDFinanceControls.panel('doctor-accounts', Object.assign({}, data, { can_create: false }), h); assert(!box.querySelector('[data-fin-action="open-disbursement"]'));

  // ---- doctors needing a contract (HR doctors with no contract; the nurse and the contracted doctor are NOT in it)
  navigated = []; draw('doctors');
  const need = box.querySelector('[data-da-needs]'); assert(need, 'needs list is shown on the contracts tab'); const nt = need.textContent;
  assert(nt.includes('د. جديد') && nt.includes('EMP-000001'), 'new HR doctor is listed'); assert(nt.includes('د. مربوط') && nt.includes('LINKED-9'), 'doctor+employee kind, with the HR-linked key');
  assert(!nt.includes('د. أحمد') && !nt.includes('هدى'), 'contracted doctor and non-doctor staff are not in the list');
  const forBtns = box.querySelectorAll('[data-fin-action="doctor-contract-for"]'); assert.equal(forBtns.length, 2);
  // the accounts tab shows the same list
  draw('doctor-accounts'); assert.equal(box.querySelectorAll('[data-fin-action="doctor-contract-for"]').length, 2);
  // read-only users see no create button
  box.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false }), h); assert.equal(box.querySelectorAll('[data-fin-action="doctor-contract-for"]').length, 0);

  // ---- button opens the contract form PREFILLED from HR
  draw('doctors'); box.querySelector('[data-fin-action="doctor-contract-for"][data-id="p1"]').click(); await tick();
  let form = d.querySelector('.fc-modal form'); assert(form, 'contract form opened');
  assert.equal(form.elements.doctor_key.value, 'EMP-000001', 'code filled from HR'); assert.equal(form.elements.doctor_name.value, 'د. جديد', 'name filled from HR');
  assert.equal(form.elements.doctor_key.readOnly, true); assert.equal(form.elements.doctor_name.readOnly, true);
  const pk = form.querySelector('[data-hr-picker]'); assert.equal(pk.value, 'p1'); assert.equal(pk.name, '', 'the picker itself is not submitted');
  const opts = [...pk.options].map(o => o.value); assert.deepEqual(opts, ['', 'p1', 'p4', 'p2', '__manual'], 'doctors only, those without a contract first, manual fallback last');
  // changing the picker re-fills; the HR-linked key wins over the code
  pk.value = 'p4'; pk.dispatchEvent(new w.Event('change')); assert.equal(form.elements.doctor_key.value, 'LINKED-9');
  // other staff (nurses) are available on request
  const all = form.querySelector('[data-hr-all]'); all.checked = true; all.dispatchEvent(new w.Event('change')); assert([...pk.options].some(o => o.value === 'p3'), 'nurse offered after ticking "show other staff"');
  pk.value = 'p3'; pk.dispatchEvent(new w.Event('change')); assert.equal(form.elements.doctor_key.value, 'EMP-000007'); assert.equal(form.elements.doctor_name.value, 'هدى ممرضة');
  // the saved payload carries the HR code + name only (no picker value)
  pk.value = 'p1'; pk.dispatchEvent(new w.Event('change'));
  const fd = {}; new w.FormData(form).forEach((v, k) => { fd[k] = v; }); assert(!('' in fd) && !Object.keys(fd).some(k => /picker|hr_/.test(k)), 'no extra keys are submitted');
  assert.equal(fd.doctor_key, 'EMP-000001');
  await submit({ doctor_key: fd.doctor_key, doctor_name: fd.doctor_name, scope_kind: 'department', department: 'أسنان', from: '2027-01-01', to: '2027-12-31', rate: '30', basis: 'performed', base_scope: 'service', deduction: 'none', reference: 'x' }, 'tok');
  assert.equal(sent.a, 'contract'); assert.equal(sent.p.doctor_key, 'EMP-000001'); assert.equal(sent.p.doctor_name, 'د. جديد'); assert.equal(sent.p.scope, 'قسم:أسنان');
  d.querySelectorAll('.fc-modal').forEach(x => x.remove());

  // plain "إضافة عقد": picker empty -> fields locked until a person (or the manual option) is chosen; manual option unlocks them
  w.SSMPDFinanceControls.act('doctor-contract', '', data, h); await tick(); form = d.querySelector('.fc-modal form');
  assert.equal(form.querySelector('[data-hr-picker]').value, ''); assert.equal(form.elements.doctor_key.readOnly, true);
  const pk2 = form.querySelector('[data-hr-picker]'); pk2.value = '__manual'; pk2.dispatchEvent(new w.Event('change')); assert.equal(form.elements.doctor_key.readOnly, false, 'manual entry for doctors not in HR'); form.elements.doctor_key.value = 'X-1'; assert.equal(form.elements.doctor_key.value, 'X-1');
  d.querySelectorAll('.fc-modal').forEach(x => x.remove());

  // ---- RPC not applied yet: clear message on the tab, manual entry still works in the contract form
  mode = 'missing'; w.eval('0'); const fresh = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w2 = fresh.window, d2 = w2.document;
  w2.SSMPDDb = Object.assign({}, w.SSMPDDb, { financeDoctorStatement: w.SSMPDDb.financeDoctorStatement });
  w2.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8')); w2.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8')); w2.eval(fs.readFileSync('assets/js/finance-doctor-accounts.js', 'utf8'));
  const box2 = d2.createElement('div'); d2.body.append(box2); let nav2 = 0;
  const h2 = Object.assign({}, h, { modal: (t, b, f) => { const fm = d2.createElement('form'); fm.innerHTML = b; const wr = d2.createElement('div'); wr.className = 'fc-modal'; wr.append(fm); d2.body.append(wr); } });
  w2.SSMPDFinanceCash = { navigate: id => { nav2++; box2.innerHTML = w2.SSMPDFinanceControls.panel(id, data, h2); } };
  box2.innerHTML = w2.SSMPDFinanceControls.panel('doctor-accounts', data, h2); await tick();
  assert(box2.textContent.includes('تحتاج تطبيق تحديث قاعدة البيانات'), 'clear message when the RPC is missing'); assert(!box2.querySelector('.fc-da-table'));
  w2.SSMPDFinanceControls.act('doctor-contract', '', data, h2); await tick(); const f2 = d2.querySelector('.fc-modal form');
  assert.equal(f2.elements.doctor_key.readOnly, false, 'manual entry still possible'); assert(f2.textContent.includes('تعذر تحميل قائمة الموارد البشرية'));
  console.log('PASS doctor accounts DOM: tab rows/cards/filters, statement reuse, no re-draw loop, needs-contract list, HR picker prefill + manual fallback, clean submit payload, RPC-missing fallbacks');
})().catch(e => { console.error(e); process.exitCode = 1; });
