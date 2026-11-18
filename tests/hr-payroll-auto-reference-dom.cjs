// DOM test (owner 2026-11-16): «بند مرتب للمراجعة» suggests «مرجع مستند لا يتكرر» automatically
// (kind-employee code-month-sequence), skips references already used, follows person/kind/month changes, and stops once the user types their own.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-000013', kind: 'employee', status: 'active', revision: 1, leave_balance: 5 },
    { id: 'p2', admin_id: 'x', full_name: 'موظف ثان', code: 'EMP-000020', kind: 'employee', status: 'active', revision: 1, leave_balance: 5 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const calls = [];
  w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'super_admin', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  const actual = w.SSMPDRoles.canModuleAction; w.SSMPDRoles.canModuleAction = (a, m, x) => m === 'accounting' ? true : actual(a, m, x);
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_payroll_command') { calls.push(args); return { data: 'x' }; }
    return { data: { rules: [], adjustments: [{ id: 'a1', person_id: 'p1', kind: 'deduction', status: 'pending', amount: 50, reference: 'خصم-EMP-000013-2026-11-01' }], devices: [], imports: [], services: [] } }; } } };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  w.SSMPDHumanResources.render(d.querySelector('main')); await tick();
  const btn = d.querySelector('[data-hrp=adjust]'); assert(btn, 'payroll item button'); btn.click(); await tick(); await tick();
  const f = d.querySelector('.wp-modal form'); assert(f, 'modal'); const ref = f.elements.reference;
  const month = f.elements.month.value.slice(0, 7); assert(/^\d{4}-\d{2}$/.test(month));
  const set = (n, v) => { f.elements[n].value = v; f.elements[n].dispatchEvent(new w.Event('change')); };
  set('person_id', 'p1'); set('month', '2026-11-01'); set('kind', 'deduction');
  assert.equal(ref.value, 'خصم-EMP-000013-2026-11-02', 'skips the reference already used');
  set('kind', 'bonus'); assert.equal(ref.value, 'مكافأة-EMP-000013-2026-11-01');
  set('person_id', 'p2'); assert.equal(ref.value, 'مكافأة-EMP-000020-2026-11-01');
  set('month', '2026-12-01'); assert.equal(ref.value, 'مكافأة-EMP-000020-2026-12-01');
  ref.value = 'قرار جزاء 7'; ref.dispatchEvent(new w.Event('input')); set('kind', 'deduction'); assert.equal(ref.value, 'قرار جزاء 7', 'own reference is kept');
  f.elements.amount.value = '145'; f.elements.note.value = 'سبب'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.equal(calls.at(-1).p_action, 'adjustment'); assert.equal(calls.at(-1).p_payload.reference, 'قرار جزاء 7');
  console.log('PASS payroll item: reference suggested automatically (kind-code-month-NN), skips used ones, follows changes, keeps a typed reference.');
})().catch(e => { console.error(e); process.exit(1); });
