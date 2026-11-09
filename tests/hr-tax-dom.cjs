// DOM test (HR income-tax register + payroll prefill): «ضريبة الدخل» section for HR managers only (lazy), month switch, cards, exact payloads (create with request_id, update with reason),
// read-only view, escaping, missing-migration message, tax_type names from the server, and the payroll form reading the tax amount (editable; kept when no entry exists).
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', status: 'active', revision: 2, leave_balance: 5 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const fresh = () => ({ can_manage: true, can_view_all: true, today: '2026-11-09', month: '2026-11-01', tax_types: [{ code: 'salary_income', name: 'ضريبة كسب العمل على المرتبات' }],
    people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول' }, { id: 'p2', code: 'EMP-2', full_name: 'موظف ثان' }],
    items: [{ id: 't1', person_id: 'p1', full_name: 'موظف أول', code: 'EMP-1', tax_type: 'salary_income', amount: 120, taxable_base: 6000, reference: 'مستند 11', revision: 1, month: '2026-11-01' },
      { id: 't2', person_id: 'p2', full_name: 'ثان <img src=x onerror=window.__xss=1>', code: 'EMP-2', tax_type: 'salary_income', amount: 80.5, taxable_base: null, reference: '', revision: 3, month: '2026-11-01' }] });
  let tx = fresh(), calls = [], wsArgs = [], mode = 'ok', taxArgs = [];
  w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'super_admin', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  const actual = w.SSMPDRoles.canModuleAction; w.SSMPDRoles.canModuleAction = (a, m, x) => m === 'accounting' ? true : actual(a, m, x);
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_tax_workspace') { wsArgs.push(args); if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_tax_workspace in the schema cache' } }; return { data: Object.assign({}, tx, { month: args.p_month || '2026-11-01' }) }; }
    if (fn === 'hr_tax_command') { calls.push(args); if (mode === 'reject') return { error: { message: 'السجل تغير؛ أعد تحميله قبل الحفظ' } }; return { data: 'x' }; }
    if (fn === 'hr_payroll_calculate') return { data: { base: 6000, approved_shifts: 2, late_minutes: 0, absent_shifts: 0, overtime_hours: 0, bonus: 0, commission: 0, allowance: 0, salary_deduction: 0, pre_tax_net: 6000, scope: 'نطاق' } };
    if (fn === 'hr_insurance_deduction') return { data: { insurance: 0, items: [] } };
    if (fn === 'hr_tax_amount') { taxArgs.push(args); return { data: mode === 'notax' ? { found: false, tax: 0 } : { found: true, tax: 120, reference: 'مستند' } }; }
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-tax', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main');
  w.SSMPDHumanResources.render(host); await tick();
  const tab = d.querySelector('[data-hr-open=tax]'); assert(tab && tab.textContent === 'ضريبة الدخل'); assert.equal(wsArgs.length, 0, 'lazy');
  tab.click(); await tick();
  const root = () => d.querySelector('[data-hr-tax]'), trs = () => [...root().querySelectorAll('tbody tr')];
  assert.equal(wsArgs.length, 1); assert.equal(wsArgs[0].p_month, null, 'first load: server picks the current month'); assert.equal(trs().length, 2);
  const txt = root().textContent; for (const s of ['موظف أول', 'EMP-1', 'ضريبة كسب العمل على المرتبات', '6,000.00', '120.00', '80.50', 'مستند 11']) assert(txt.includes(s), 'shows ' + s);
  assert.deepEqual([...root().querySelectorAll('[data-tax-cards] .wp-card b')].map(x => x.textContent), ['2', '200.50']);
  assert.equal(root().querySelector('[name=tax_month]').value, '2026-11'); assert.equal(w.__xss, undefined); assert(!root().querySelector('img'));
  const mi = root().querySelector('[name=tax_month]'); mi.value = '2026-10'; mi.dispatchEvent(new w.Event('change')); await tick(); assert.equal(wsArgs.at(-1).p_month, '2026-10-01'); assert.equal(root().querySelector('[name=tax_month]').value, '2026-10');
  // create
  root().querySelector('[data-tax=new]').click(); let f = d.querySelector('.wp-modal form');
  f.elements.person_id.value = 'p2'; f.elements.amount.value = '95.25'; f.elements.taxable_base.value = '5000'; f.elements.reference.value = 'REF-1'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[0].p_action, calls[0].p_payload.person_id, calls[0].p_payload.month, calls[0].p_payload.tax_type, calls[0].p_payload.amount, calls[0].p_payload.taxable_base, calls[0].p_payload.reference], ['create', 'p2', '2026-10-01', 'salary_income', '95.25', '5000', 'REF-1']);
  assert(/^[0-9a-f-]{36}$/.test(calls[0].p_payload.request_id)); assert.equal(wsArgs.at(-1).p_month, '2026-10-01', 'reloads the same month');
  // update needs the reason from the user; payload carries revision
  trs()[0].querySelector('[data-tax=edit]').click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.amount.value, '120'); f.elements.amount.value = '130'; f.elements.reason.value = 'تصحيح المستند';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[1].p_action, calls[1].p_payload.id, calls[1].p_payload.revision, calls[1].p_payload.amount, calls[1].p_payload.reason], ['update', 't1', 1, '130', 'تصحيح المستند']);
  mode = 'reject'; trs()[0].querySelector('[data-tax=edit]').click(); f = d.querySelector('.wp-modal form'); f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert(d.querySelector('.wp-modal [role=alert]').textContent.includes('تغير')); d.querySelector('.wp-modal [data-close]').click(); mode = 'ok';
  // read-only
  tx = Object.assign(fresh(), { can_manage: false, people: [] }); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=tax]').click(); await tick();
  assert(!root().querySelector('[data-tax=new]') && !root().querySelector('[data-tax=edit]'));
  mode = 'missing'; d.querySelector('[data-hr-open=home]').click(); await tick(); d.querySelector('[data-hr-open=tax]').click(); await tick(); assert(root().textContent.includes('غير مفعّل بعد')); mode = 'ok';
  // payroll prefill
  w.SSMPDHumanResources.render(host); await tick();
  const calcBtn = d.querySelector('[data-hrp=calculate]'); calcBtn.click(); f = d.querySelector('.wp-modal form'); f.elements.person_id.value = 'p1'; f.querySelector('[data-hrp=calc-now]').click(); await tick(); await tick();
  assert.deepEqual([taxArgs.at(-1).p_person, taxArgs.at(-1).p_tax_type, /^\d{4}-\d{2}-01$/.test(taxArgs.at(-1).p_month)], ['p1', 'salary_income', true]); assert.equal(f.elements.tax.value, '120'); assert(f.querySelector('[data-tax-note]')); assert.equal(f.elements.tax.readOnly, false);
  d.querySelector('.wp-modal [data-close]').click();
  mode = 'notax'; calcBtn.click(); f = d.querySelector('.wp-modal form'); f.elements.person_id.value = 'p1'; f.elements.tax.value = '33'; f.querySelector('[data-hrp=calc-now]').click(); await tick(); await tick();
  assert.equal(f.elements.tax.value, '33', 'no entry: typed value kept'); assert(!f.querySelector('[data-tax-note]')); d.querySelector('.wp-modal [data-close]').click();
  hrData.can_manage = false; w.SSMPDAuth.currentAdmin = { id: 'a2', role: 'reception' }; w.SSMPDHumanResources.render(host); await tick(); assert(!d.querySelector('[data-hr-open=tax]'));
  dom.window.close();
  console.log('PASS hr tax DOM: manager-only lazy section, month switch, cards, escaping, create/update payloads, stale error in dialog, read-only view, missing-migration message, payroll form tax prefill.');
})().catch(e => { console.error(e); process.exit(1); });
