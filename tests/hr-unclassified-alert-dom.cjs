// HR summary: a permanent «ملفات مش متصنفة» counter (kind 'unclassified', not ended) that opens the people list already filtered to those files.
const assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const mk = (id, name, kind, status) => ({ id, admin_id: null, full_name: name, code: 'EMP-' + id, kind, department: 'قسم', status, revision: 1, leave_balance: 30, phone: '' });
const people = [mk('1', 'موظف عادي', 'employee', 'active'), mk('2', 'غير مصنف أول', 'unclassified', 'active'), mk('3', 'غير مصنف ثان', 'unclassified', 'needs_setup'), mk('4', 'غير مصنف منتهي', 'unclassified', 'ended'), mk('5', 'طبيب', 'doctor', 'active')];
(async () => {
  const t = await makeEnv({ people }); const { w, d } = t;
  w.SSMPDHumanResources.render(t.host); await t.tick();
  const kpi = d.querySelector('[data-hr-unclassified]'); assert(kpi, 'counter on the HR summary');
  assert.equal(kpi.querySelector('b').textContent, '2', 'unclassified and not ended'); assert(kpi.textContent.includes('ملفات مش متصنفة'));
  kpi.click(); await t.tick(); await t.tick();
  const sel = d.querySelector('[name=hr_filter_kind]'); assert(sel, 'people filters visible'); assert.equal(sel.value, 'unclassified', 'the kind filter is already set');
  const visible = [...d.querySelectorAll('[data-wp=person]')].filter(n => !n.hidden).map(n => n.textContent);
  assert(visible.length === 3 && visible.every(x => !x.includes('موظف عادي') && !x.includes('طبيب')), 'only the unclassified files are shown (ended ones are shown until the user ends the filter: 3 rows)');
  // zero case: the counter stays visible with 0
  const t2 = await makeEnv({ people: [mk('1', 'موظف', 'employee', 'active')] }); t2.w.SSMPDHumanResources.render(t2.host); await t2.tick();
  assert.equal(t2.d.querySelector('[data-hr-unclassified] b').textContent, '0');
  console.log('PASS HR unclassified counter: counts unclassified non-ended files, opens the people list pre-filtered, stays visible at 0.');
})().catch(e => { console.error(e); process.exit(1); });
