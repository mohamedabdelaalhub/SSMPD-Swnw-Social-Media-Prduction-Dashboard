// DOM test (HR insurance register + payroll prefill): «التأمينات» section for HR managers only, lazy load, list/cards/filters, exact payloads (create with request_id, update with reason,
// stop with a MANUAL notification deadline), stopped rows only complete the notification details, escaping, missing-migration message, and the payroll form reading the insurance value from the register.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5 }, { id: 'p2', admin_id: 'a2', full_name: 'موظف ثان', code: 'EMP-2', kind: 'employee', status: 'active', revision: 2, leave_balance: 0 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const it = o => Object.assign({ id: 'i' + Math.random(), person_id: 'p1', full_name: 'موظف أول', code: 'EMP-1', insurance_type: 'social', insurance_number: '123456', employee_deduction: 200, center_share: 300, status: 'active', started_on: '2026-01-01', stopped_on: null, stop_reference: '', notification_deadline: null, revision: 1 }, o);
  const fresh = () => ({ can_manage: true, can_view_all: true, today: '2026-11-09', people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول' }, { id: 'p2', code: 'EMP-2', full_name: 'موظف ثان' }],
    items: [it({ id: 'a1' }), it({ id: 'a2', insurance_type: 'medical', insurance_number: 'MED-9', employee_deduction: 50, center_share: 0 }),
      it({ id: 'a3', person_id: 'p2', full_name: 'ثان <img src=x onerror=window.__xss=1>', code: 'EMP-2', status: 'stopped', stopped_on: '2026-10-31', stop_reference: 'إخطار 123', notification_deadline: '2026-11-30', employee_deduction: 100, center_share: 150, revision: 2 })] });
  let ins = fresh(), calls = [], wsCalls = 0, mode = 'ok', dedCalls = [];
  w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'reception', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  const actual = w.SSMPDRoles.canModuleAction; w.SSMPDRoles.canModuleAction = (a, m, x) => m === 'accounting' ? true : actual(a, m, x);
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_insurance_workspace') { wsCalls++; if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_insurance_workspace in the schema cache' } }; return { data: ins }; }
    if (fn === 'hr_insurance_command') { calls.push(args); if (mode === 'reject') return { error: { message: 'الاشتراك تغير؛ أعد تحميله قبل الحفظ' } }; return { data: 'x' }; }
    if (fn === 'hr_payroll_calculate') return { data: { base: 6000, approved_shifts: 2, late_minutes: 0, absent_shifts: 0, overtime_hours: 0, bonus: 0, commission: 0, allowance: 0, salary_deduction: 0, pre_tax_net: 6000, scope: 'نطاق' } };
    if (fn === 'hr_insurance_deduction') { dedCalls.push(args); return mode === 'noreg' ? { data: { insurance: 0, items: [] } } : { data: { insurance: 250, items: [{ type: 'social' }, { type: 'medical' }] } }; }
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-insurance', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main');
  w.SSMPDHumanResources.render(host); await tick();
  const tab = d.querySelector('[data-hr-open=insurance]'); assert(tab && tab.textContent === 'التأمينات', 'insurance tab for HR managers'); assert.equal(wsCalls, 0, 'lazy');
  tab.click(); await tick();
  const root = () => d.querySelector('[data-hr-insurance]'), trs = () => [...root().querySelectorAll('tbody tr')];
  assert.equal(wsCalls, 1); assert.equal(trs().length, 2, 'default filter = active only');
  const txt = root().textContent;
  for (const s of ['موظف أول', 'EMP-1', 'تأمينات اجتماعية', 'تأمين طبي', '123456', 'MED-9', '200.00', '300.00']) assert(txt.includes(s), 'shows ' + s);
  const cards = [...root().querySelectorAll('[data-insurance-cards] .wp-card b')].map(x => x.textContent); assert.deepEqual(cards, ['2', '250.00', '300.00', '550.00'], 'cards: count, employee, center, total per month');
  const st = root().querySelector('[name=ins_status]'); st.value = ''; st.dispatchEvent(new w.Event('change')); assert.equal(trs().length, 3);
  assert.equal(w.__xss, undefined); assert(!root().querySelector('img'), 'escaped');
  const stopped = trs().find(r => r.textContent.includes('موقوف'));
  assert(stopped.textContent.includes('2026-10-31') && stopped.textContent.includes('إخطار 123') && stopped.textContent.includes('آخر موعد للإخطار: 2026-11-30'));
  assert.deepEqual([...stopped.querySelectorAll('[data-insurance]')].map(b => b.dataset.insurance), ['edit'], 'stopped row: only completing the notification');
  st.value = 'stopped'; st.dispatchEvent(new w.Event('change')); assert.equal(trs().length, 1);
  const ty = root().querySelector('[name=ins_type]'); ty.value = 'medical'; ty.dispatchEvent(new w.Event('change')); assert.equal(trs().length, 0); ty.value = ''; ty.dispatchEvent(new w.Event('change')); st.value = 'active'; st.dispatchEvent(new w.Event('change'));
  const q = root().querySelector('[name=ins_q]'); q.value = 'MED'; q.dispatchEvent(new w.Event('input')); assert.equal(trs().length, 1); q.value = ''; q.dispatchEvent(new w.Event('input'));

  // ---- create
  root().querySelector('[data-insurance=new]').click(); let f = d.querySelector('.wp-modal form');
  f.elements.person_id.value = 'p2'; f.elements.insurance_type.value = 'medical'; f.elements.insurance_number.value = 'M-5'; f.elements.employee_deduction.value = '75.5'; f.elements.center_share.value = '20'; f.elements.started_on.value = '2026-11-01';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.equal(calls[0].p_action, 'create'); assert.deepEqual([calls[0].p_payload.person_id, calls[0].p_payload.insurance_type, calls[0].p_payload.employee_deduction, calls[0].p_payload.center_share, calls[0].p_payload.started_on], ['p2', 'medical', '75.5', '20', '2026-11-01']); assert(/^[0-9a-f-]{36}$/.test(calls[0].p_payload.request_id)); assert.equal(wsCalls, 2);

  // ---- update with reason, stop with manual deadline
  trs()[0].querySelector('[data-insurance=edit]').click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.insurance_number.value, '123456'); f.elements.employee_deduction.value = '220'; f.elements.reason.value = 'زيادة الأجر التأميني';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[1].p_action, calls[1].p_payload.revision, calls[1].p_payload.employee_deduction, calls[1].p_payload.reason], ['update', 1, '220', 'زيادة الأجر التأميني']);
  trs()[0].querySelector('[data-insurance=stop]').click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.stopped_on.value, '2026-11-09');
  assert(f.textContent.includes('يكتبه المسؤول يدويًا'), 'deadline is labelled manual'); assert.equal(f.elements.notification_deadline.value, '', 'no computed default');
  f.elements.stop_reference.value = 'إخطار 9'; f.elements.notification_deadline.value = '2026-12-10'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[2].p_action, calls[2].p_payload.stopped_on, calls[2].p_payload.stop_reference, calls[2].p_payload.notification_deadline], ['stop', '2026-11-09', 'إخطار 9', '2026-12-10']);
  // completing the notification of a stopped row
  st.value = 'stopped'; st.dispatchEvent(new w.Event('change')); trs()[0].querySelector('[data-insurance=edit]').click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.notification_deadline.value, '2026-11-30'); f.elements.notification_deadline.value = '2026-12-15';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[3].p_action, calls[3].p_payload.notification_deadline, 'employee_deduction' in calls[3].p_payload], ['update', '2026-12-15', false]);
  // server rejection stays in the dialog
  mode = 'reject'; st.value = 'active'; st.dispatchEvent(new w.Event('change')); trs()[0].querySelector('[data-insurance=stop]').click(); f = d.querySelector('.wp-modal form'); f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert(d.querySelector('.wp-modal [role=alert]').textContent.includes('تغير')); d.querySelector('.wp-modal [data-close]').click(); mode = 'ok';

  // ---- read-only viewer, missing migration, ordinary employee
  ins = Object.assign(fresh(), { can_manage: false, people: [] }); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=insurance]').click(); await tick();
  assert(!root().querySelector('[data-insurance=new]') && !root().querySelector('[data-insurance=stop]'), 'no write buttons for read-only');
  mode = 'missing'; d.querySelector('[data-hr-open=home]').click(); await tick(); d.querySelector('[data-hr-open=insurance]').click(); await tick(); assert(root().textContent.includes('غير مفعّل بعد')); mode = 'ok';
  root().querySelector('[data-insurance=retry]').click(); await tick(); assert(trs().length >= 1);

  // ---- payroll form reads the register (editable), and keeps the typed value when the person has no enrollment
  hrData.can_manage = true; w.SSMPDAuth.currentAdmin = { id: 'hr', role: 'super_admin' }; w.SSMPDHumanResources.render(host); await tick();
  const calcBtn = d.querySelector('[data-hrp=calculate]'); assert(calcBtn, 'calculate button present'); calcBtn.click(); f = d.querySelector('.wp-modal form'); f.elements.person_id.value = 'p1';
  f.querySelector('[data-hrp=calc-now]').click(); await tick(); await tick();
  assert.deepEqual([dedCalls.at(-1).p_person, /^\d{4}-\d{2}-01$/.test(dedCalls.at(-1).p_month)], ['p1', true]); assert.equal(f.elements.insurance.value, '250'); assert(f.querySelector('[data-insurance-note]'), 'tells where the number came from'); assert.equal(f.elements.insurance.readOnly, false, 'still editable');
  d.querySelector('.wp-modal [data-close]').click();
  mode = 'noreg'; calcBtn.click(); f = d.querySelector('.wp-modal form'); f.elements.person_id.value = 'p1'; f.elements.insurance.value = '40'; f.querySelector('[data-hrp=calc-now]').click(); await tick(); await tick();
  assert.equal(f.elements.insurance.value, '40', 'no register entry: typed value kept'); assert(!f.querySelector('[data-insurance-note]'));

  hrData.can_manage = false; w.SSMPDAuth.currentAdmin = { id: 'a2', role: 'reception' }; d.querySelector('.wp-modal [data-close]').click(); w.SSMPDHumanResources.render(host); await tick();
  assert(!d.querySelector('[data-hr-open=insurance]'), 'no insurance tab for ordinary employees');
  dom.window.close();
  console.log('PASS hr insurance DOM: manager-only lazy section, cards/filters/search, escaping, create/update/stop payloads with a manual notification deadline, stopped-row completion, read-only view, missing-migration message, payroll form prefill from the register.');
})().catch(e => { console.error(e); process.exit(1); });
