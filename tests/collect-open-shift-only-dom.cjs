// Owner 2026-11-27 (reception: «جيت اسجل تحصيل… جابلي كدا» — «انتهت الوردية وهي بانتظار التسليم: لا تسجل تحصيلاً جديداً»):
// after a handover the old shift keeps status 'open' with ended_at set until the main treasury confirms the receipt. The collect window's
// «وردية الكاش أو الفيزا» must list and auto-pick only the shift still running (status open AND no ended_at). Real paintShifts() + real
// shiftLabel() from reception-services.js in jsdom; finance-treasury.js's shift picker follows the same rule.
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets/js/reception-services.js'), 'utf8');
const grab = name => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name); let depth = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); } };
const dom = new JSDOM('<form><label>وردية الكاش أو الفيزا<select name="shift_id"></select></label></form>', { runScripts: 'outside-only' });
const w = dom.window; w.SSMPDAuth = { currentAdmin: { id: 'mazen' } };
w.eval(grab('shiftLabel') + ';' + grab('paintShifts') + ';window.__paint=paintShifts;');
const c = { esc: s => String(s), lookup: (t, id) => id === 'r1' ? 'خزينة مازن' : '?', data: { workspace: { mode: 'live' }, shifts: [
  { id: 'old', register_id: 'r1', cashier_id: 'mazen', status: 'open', ended_at: '2026-11-27T11:59:11Z' },
  { id: 'new', register_id: 'r1', cashier_id: 'mazen', status: 'open', ended_at: null },
  { id: 'peer', register_id: 'r2', cashier_id: 'x', status: 'open', ended_at: '2026-11-27T10:00:00Z' }] } };
const form = w.document.querySelector('form');
w.__paint(c, form, null);
const vals = [...form.elements.shift_id.options].map(o => o.value).filter(Boolean);
assert.deepStrictEqual(vals, ['new'], 'only the running shift is offered (handed-over ones hidden): ' + vals);
assert.strictEqual(form.elements.shift_id.value, 'new', 'the running shift is picked automatically');
assert.ok(!form.querySelector('[data-rx-no-shift]'), 'no «افتح ورديتك» note when a running shift exists');
// only handed-over shift → «مفيش وردية مفتوحة باسمك» + «افتح ورديتي»
c.data.shifts = [c.data.shifts[0]]; w.__paint(c, form, null);
assert.ok(form.querySelector('[data-rx-no-shift] [data-rx-open-shift]'), 'handed-over only → open-shift button shown');
const tr = fs.readFileSync(path.join(__dirname, '..', 'assets/js/finance-treasury.js'), 'utf8');
assert.ok(/x\.status==='open'&&!x\.ended_at&&x\.cashier_id===d\.me/.test(tr), 'finance-treasury shift picker excludes handed-over shifts');
console.log('collect-open-shift-only-dom: OK');
