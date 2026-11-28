// HR home «محتاج متابعتك»: a «ملفات مش متصنفة» row (kind 'unclassified', not ended) whose «افتح» opens the people list already filtered to those files.
const fs = require('fs'), assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const mk = (id, name, kind, status) => ({ id, admin_id: null, full_name: name, code: 'EMP-' + id, kind, department: 'قسم', status, revision: 1, leave_balance: 30, phone: '' });
const people = [mk('1', 'موظف عادي', 'employee', 'active'), mk('2', 'غير مصنف أول', 'unclassified', 'active'), mk('3', 'غير مصنف ثان', 'unclassified', 'needs_setup'), mk('4', 'غير مصنف منتهي', 'unclassified', 'ended'), mk('5', 'طبيب', 'doctor', 'active')];
(async () => {
  const t = await makeEnv({ people }); const { w, d } = t; w.eval(fs.readFileSync('assets/js/hr-today-inbox.js', 'utf8'));
  w.SSMPDHumanResources.render(t.host); await t.tick();
  const row = d.querySelector('[data-hrn-row=unclassified]'); assert(row, 'row on the HR home');
  assert.equal(row.querySelector('.hrn-n').textContent, '2', 'unclassified and not ended'); assert(row.textContent.includes('ملفات مش متصنفة'));
  row.querySelector('[data-hrn-go]').click(); await t.tick(); await t.tick();
  const sel = d.querySelector('[name=hr_filter_kind]'); assert(sel, 'people filters visible'); assert.equal(sel.value, 'unclassified', 'the kind filter is already set');
  const visible = [...d.querySelectorAll('[data-wp=person]')].filter(n => !n.hidden).map(n => n.textContent);
  assert(visible.length === 3 && visible.every(x => !x.includes('موظف عادي') && !x.includes('طبيب')), 'only the unclassified files are shown (ended ones are shown until the user ends the filter: 3 rows)');
  // zero case: no row, and once the optional reads finish the home says everything is done
  const t2 = await makeEnv({ people: [mk('1', 'موظف', 'employee', 'active')] }); t2.w.eval(fs.readFileSync('assets/js/hr-today-inbox.js', 'utf8')); t2.w.SSMPDHumanResources.render(t2.host); await t2.tick(); await t2.tick();
  assert(!t2.d.querySelector('[data-hrn-row=unclassified]')); assert(!t2.d.querySelector('[data-hrn-done]').hidden, 'all done');
  console.log('PASS HR unclassified row: counts unclassified non-ended files, «افتح» opens the people list pre-filtered, hidden at 0.');
})().catch(e => { console.error(e); process.exit(1); });
