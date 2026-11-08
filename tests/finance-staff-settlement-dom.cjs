// DOM test (accounting «مخالصات الموظفين»): the tab hosts the settlement workflow inside the finance panel for accountants/financial managers, other tabs still reach the previous handlers,
// the tab is registered in the finance workspace (group, description, available panels) and in search.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const tick = () => new Promise(r => setTimeout(r, 25));
  const ws = { me: 'fm', today: '2026-11-09', can_manage: false, can_prepare: false, can_review: true, is_owner: false, people: [], templates: [{ id: 't1', kind: 'settlement', version: 1, status: 'published', body: 'x' }],
    cases: [{ id: 'c1', person_id: 'p1', full_name: 'موظف <b>أول</b>', code: 'EMP-1', last_day: '2026-11-30', reason: 'other', status: 'sheet_ready', revision: 3, created_by: 'hr', sheet_by: 'acc', net: { to_him: 100, on_him: 40, net: 60 }, lines: [] }] };
  let calls = [];
  w.SSMPDAuth = { currentAdmin: { id: 'fm', role: 'financial_manager' } };
  w.SSMPDDb = { client: { rpc: async (fn, args) => { calls.push(fn); if (fn === 'hr_offboarding_workspace') return { data: ws }; if (fn === 'hr_offboarding_lock_due') return { data: 0 }; return { data: null }; } } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  for (const f of ['workforce-prices', 'hr-offboarding', 'finance-staff-settlement']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const box = d.createElement('div'); d.body.append(box);
  const h = { esc: v => String(v), money: v => String(v), btn: () => '', table: () => '', stamp: x => x, field: () => '', select: () => '', modal: () => {} };
  const data = { today: '2026-11-09', me: 'fm', can_create: true, can_review: true, active_shifts: [], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [], doctor_contracts: [] };
  box.innerHTML = w.SSMPDFinanceControls.panel('staff-settlement', data, h); await tick(); await tick();
  const root = box.querySelector('[data-hr-offboarding]'); assert(root, 'the workflow is mounted inside the finance panel');
  assert(root.textContent.includes('أول') && root.textContent.includes('بانتظار الاعتماد')); assert(root.textContent.includes('<b>أول</b>'), 'names are escaped (shown literally)');
  assert(calls.includes('hr_offboarding_workspace'));
  assert(!root.querySelector('[data-offb=new]'), 'finance users do not open cases');
  assert.equal(typeof w.SSMPDFinanceControls.act, 'function'); assert.equal(typeof w.SSMPDFinanceControls.due, 'function');
  const cash = fs.readFileSync('assets/js/finance-cash.js', 'utf8'), search = fs.readFileSync('assets/js/search-destinations.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
  assert(/items:\[[^\]]*'staff-settlement'/.test(cash), 'in a finance group'); assert(cash.includes("'staff-settlement':'"), 'description'); assert(cash.includes("['staff-settlement','مخالصات الموظفين']"), 'available panel');
  assert(search.includes("'staff-settlement'")); assert(html.includes('hr-offboarding.js') && html.includes('finance-staff-settlement.js'));
  assert(html.indexOf('hr-offboarding.js') < html.indexOf('finance-staff-settlement.js'), 'workflow script loads before the finance tab that hosts it');
  dom.window.close();
  console.log('PASS finance staff-settlement DOM: finance tab hosts the workflow, escaping, no case opening for finance users, registered in groups/descriptions/panels/search/index.');
})().catch(e => { console.error(e); process.exit(1); });
