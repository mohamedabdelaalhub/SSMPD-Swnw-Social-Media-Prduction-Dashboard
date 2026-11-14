// DOM test («الحضور اللحظي» → «التقارير»): lazy third tab fed by hr_attendance_range; exact totals + deltas vs the previous equal period on a hand-computed fixture,
// period switching (today / week / month / last month / 90 / all / custom) incl. when it refetches, department / type / search filters, compare toggle, chart / heat map /
// leaderboards / watch list / insights, summary + weekly + monthly tables with sorting, CSV export (formula-safe), print, XSS, empty state, migration-missing message,
// non-managers, mobile-safe rendering of every state.
const assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const R = (day, pid, status, o) => Object.assign({ day, person_id: pid, status, late_min: 0, excused: false, template_name: 'صباحي', color: '#0F369D', first_in: status === 'absent' || status === 'leave' ? null : day + 'T07:00:00Z', last_out: null, early_leave_min: 0, overtime_min: 0, incomplete: false }, o);
const fixture = () => ({ from: '2026-05-17', to: '2026-11-12', today: '2026-11-12', now: '2026-11-12T10:00:00Z',
  people: [{ id: 'A', code: 'EMP-A', full_name: 'أحمد <img src=x onerror=window.__xss=1>', department: 'الاستقبال', job_title: 'استقبال' }, { id: 'B', code: 'EMP-B', full_name: '=HYPERLINK("x")', department: 'تمريض', job_title: 'ممرض' }, { id: 'C', code: 'EMP-C', full_name: 'بلا أيام', department: 'الإدارة', job_title: '' }],
  rows: [
    R('2026-10-20', 'A', 'late', { late_min: 40 }), R('2026-10-21', 'A', 'absent'), R('2026-10-22', 'A', 'absent'), R('2026-10-20', 'B', 'on_time'),
    R('2026-11-01', 'A', 'late', { late_min: 30 }), R('2026-11-02', 'A', 'late', { late_min: 20 }), R('2026-11-03', 'A', 'on_time'), R('2026-11-04', 'A', 'absent'), R('2026-11-05', 'A', 'leave'),
    R('2026-11-06', 'A', 'on_time', { overtime_min: 60 }), R('2026-11-07', 'A', 'on_time', { incomplete: true }), R('2026-11-12', 'A', 'waiting'),
    R('2026-11-01', 'B', 'on_time', { template_name: 'مسائي', color: '#F15A22' }), R('2026-11-02', 'B', 'on_time', { template_name: 'مسائي', color: '#F15A22' }), R('2026-11-03', 'B', 'absent', { excused: true, template_name: 'مسائي', color: '#F15A22' }), R('2026-11-12', 'B', 'upcoming'), R('2026-11-10', 'B', 'unmapped')] });
(async () => {
  let data = fixture(), mode = 'ok';
  const t = await makeEnv({ now: '2026-11-12T10:00:00Z', rpc: async (fn, a) => {
    if (fn === 'hr_attendance_range') { if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_attendance_range in the schema cache' } }; if (mode === 'down') return { error: { message: 'boom' } };
      return { data: Object.assign({}, data, { from: a.p_from, to: a.p_to, rows: data.rows.filter(r => r.day >= a.p_from && r.day <= a.p_to) }) }; }
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: '2026-11-12T10:00:00Z', lookback_hours: 16, rows: [], people: [], ignored: [] } };
    if (fn === 'hr_attendance_today') return { data: { has_schedule: true, rows: [] } };
    if (fn === 'hr_shifts_workspace') return { data: { today: '2026-11-12', templates: [], people: [] } };
  } });
  const { w, d } = t, root = () => d.querySelector('[data-hr-reports]'), range = () => t.calls.filter(c => c[0] === 'hr_attendance_range').map(c => c[1]);
  const kpis = () => [...root().querySelectorAll('[data-rep-kpis] .rk')].map(x => ({ label: x.querySelector('.l').textContent.trim(), v: x.querySelector('b').textContent.trim(), delta: (x.querySelector('.delta') || {}).textContent, cls: (x.querySelector('.delta') || {}).className }));
  const kv = (label) => kpis().find(k => k.label.includes(label));
  // ---- lazy third tab
  w.SSMPDHumanResources.render(t.host); await t.tick(); d.querySelector('[data-hr-open=presence]').click(); await t.tick(); await t.tick(); assert.equal(range().length, 0, 'nothing is fetched until the tab is opened');
  d.querySelector('[data-att-tab=reports]').click(); await t.tick(); await t.tick(); assert(root(), 'mounted'); assert.equal(range().length, 1);
  assert.deepEqual(range()[0], { p_from: '2026-05-17', p_to: '2026-11-12' }, 'one 180-day window covers every preset + comparison + heat map');
  // ---- this month (Nov 1..12) vs the previous 12 days (Oct 20..31): hand-computed
  assert(root().querySelector('[data-rep-range]').textContent.includes('12 يوم') && root().querySelector('[data-rep-range]').textContent.includes('مقارنة مع 12 يوم'));
  assert.equal(kv('الالتزام').v, '63%'); assert.equal(kv('الالتزام').delta, '▲ 38%'); assert(kv('الالتزام').cls.includes('d-good'), 'commitment up is good');
  assert.equal(kv('مرات التأخير').v, '2'); assert.equal(kv('مرات التأخير').delta, '▲ 1'); assert(kv('مرات التأخير').cls.includes('d-bad'), 'more lateness is bad');
  assert.equal(kv('دقائق التأخير').v, '50'); assert.equal(kv('دقائق التأخير').delta, '▲ 10'); assert.equal(kv('متوسط التأخير').v, '25 د'); assert.equal(kv('متوسط التأخير').delta, '▼ 15 د'); assert(kv('متوسط التأخير').cls.includes('d-good'));
  assert.equal(kv('أيام الغياب').v, '1'); assert.equal(kv('أيام الغياب').delta, '▼ 1'); assert(kv('أيام الغياب').cls.includes('d-good')); assert.equal(kv('الإجازات').v, '2', 'leave + excused absence'); assert.equal(kv('الإجازات').delta, '▲ 2');
  // table: unscheduled person is not listed; waiting/upcoming/unmapped rows never count
  const names = () => [...root().querySelectorAll('[data-rep-emp] b')].map(x => x.textContent); assert.deepEqual(names().sort(), ['=HYPERLINK("x")', 'أحمد <img src=x onerror=window.__xss=1>'].sort(), 'person without scheduled days is hidden');
  assert(!root().querySelector('img') && w.__xss === undefined, 'names are escaped');
  const rowA = [...root().querySelectorAll('[data-rep-emp]')].find(r => r.textContent.includes('أحمد')), c = [...rowA.querySelectorAll('td')].map(x => x.textContent.trim());
  assert.deepEqual(c.slice(1, 10), ['6', '2', '50', '1', '1', '0', '1.0', '1', '50%'], 'A: sched 6, late 2 (50 min), absent 1, leave 1, early 0, overtime 1.0h, incomplete 1, commitment 3/6');
  // insights, heat map, chart, leaderboards
  const ins = root().querySelector('[data-rep-insights]').textContent; assert(ins.includes('أكتر يوم تأخيرًا') && ins.includes('الغياب قلّ 1 يوم') && ins.includes('1 بصمات ناقصة') && ins.includes('1 يوم لموظفين غير مربوطين'), 'insights');
  assert.equal(root().querySelectorAll('[data-rep-chart] rect').length, 12, 'one bar per day'); assert.equal(root().querySelector('[data-rep-heat]').children.length, 7 + 78 + 5, 'weekday header + 12 calendar weeks up to today (Thursday)');
  assert(root().querySelector('[data-rep-compliance]').textContent.includes('الاستقبال') && root().querySelector('[data-rep-compliance]').textContent.includes('التمريض'));
  assert(root().querySelector('[data-rep-worst]').textContent.includes('2 مرة') && !root().querySelector('[data-rep-worst]').textContent.includes('HYPERLINK'), 'leaderboards need 5+ scheduled days: only A (2 lates), not B (2 days)'); assert(root().querySelector('[data-rep-watch]'), 'A has 50% commitment -> needs a decision'); 
  // ---- chart grouping + metric + by shift + table modes
  root().querySelector('[data-g=week]').click(); assert.equal(root().querySelectorAll('[data-rep-chart] rect').length, 2, 'Nov 1-12 spans two Saturday-first weeks'); root().querySelector('[data-g=month]').click(); assert.equal(root().querySelectorAll('[data-rep-chart] rect').length, 1);
  root().querySelector('[data-m=abs]').click(); assert(root().querySelector('[data-rep-chart]')); root().querySelector('[data-g=day]').click();
  root().querySelector('[data-by=shift]').click(); assert(root().querySelector('[data-rep-compliance]').textContent.includes('مسائي') && root().querySelector('[data-rep-compliance]').textContent.includes('صباحي'), 'commitment by shift uses template names');
  root().querySelector('[data-t=week]').click(); assert(root().querySelectorAll('[data-rep-table] thead th').length >= 4, 'weekly table'); root().querySelector('[data-t=month]').click(); assert.equal(root().querySelectorAll('[data-rep-table] thead th').length, 3, 'one month column + name + total'); root().querySelector('[data-t=sum]').click();
  const sortCol = [...root().querySelectorAll('th[data-s]')].find(h => h.dataset.s === 'absent'); sortCol.click(); assert(root().querySelector('th[data-s=absent]').textContent.includes('▼'), 'sort by absence desc'); assert(names()[0].includes('أحمد'));
  [...root().querySelectorAll('th[data-s]')].find(h => h.dataset.s === 'absent').click(); assert(root().querySelector('th[data-s=absent]').textContent.includes('▲'), 'second click flips the direction');
  // ---- period switching (no refetch inside the 180-day window)
  const n = range().length;
  root().querySelector('[data-p=today]').click(); await t.tick(); assert.equal(kv('الالتزام').v, '0%', 'today: only waiting/upcoming rows -> nothing evaluated yet'); assert(root().querySelector('[data-rep-range]').textContent.includes('1 يوم'));
  root().querySelector('[data-p=week]').click(); await t.tick(); assert(root().querySelector('[data-rep-range]').textContent.includes('6 يوم'), 'Saturday Nov 7 .. Thursday Nov 12 = 6 days'); assert.equal(kv('الالتزام').v, '100%', 'Nov 7 is the only evaluated day: on time');
  root().querySelector('[data-p=last]').click(); await t.tick(); assert(root().querySelector('[data-rep-range]').textContent.includes('31 يوم') && root().querySelector('[data-rep-range]').textContent.includes('1 أكتوبر') , 'last month = October'); assert.equal(kv('أيام الغياب').v, '2'); assert.equal(kv('مرات التأخير').v, '1');
  root().querySelector('[data-p="90"]').click(); await t.tick(); assert(root().querySelector('[data-rep-range]').textContent.includes('90 يوم')); assert.equal(range().length, n, 'no refetch for presets inside the window');
  root().querySelector('[data-p=all]').click(); await t.tick(); await t.tick(); assert.equal(range().length, n + 1, '«all» reaches further back and refetches'); assert.deepEqual(range().pop(), { p_from: '2025-11-12', p_to: '2026-11-12' }); assert(root().querySelector('[data-rep-range]').textContent.includes('366 يوم') && !root().querySelector('[data-rep-range]').textContent.includes('مقارنة'), 'no comparison for «all»');
  root().querySelector('[data-p=custom]').click(); await t.tick(); const from = root().querySelector('[data-rep-from]'), to = root().querySelector('[data-rep-to]'); assert(from && to, 'custom shows date inputs');
  from.value = '2026-11-03'; from.dispatchEvent(new w.Event('change')); await t.tick(); await t.tick(); root().querySelector('[data-rep-to]').value = '2026-11-06'; root().querySelector('[data-rep-to]').dispatchEvent(new w.Event('change')); await t.tick(); await t.tick();
  assert(root().querySelector('[data-rep-range]').textContent.includes('4 يوم')); assert.equal(kv('الالتزام').v, '67%', 'A: Nov 3 on time, Nov 4 absent, Nov 6 on time (+ Nov 5 leave, B excused)'); assert.equal(kv('أيام الغياب').v, '1'); assert.equal(kv('الإجازات').v, '2');
  // ---- filters
  root().querySelector('[data-p=month]').click(); await t.tick();
  const dept = root().querySelector('[data-rep-dept]'); assert.deepEqual([...dept.options].map(o => o.textContent), ['كل الأقسام', 'الاستقبال', 'التمريض', 'الإدارة']); dept.value = 'nurse'; dept.dispatchEvent(new w.Event('change')); assert.equal(kv('مرات التأخير').v, '0'); assert.equal(kv('الالتزام').v, '100%'); assert.deepEqual(names(), ['=HYPERLINK("x")']);
  dept.value = 'all'; dept.dispatchEvent(new w.Event('change')); const typ = root().querySelector('[data-rep-type]'); typ.value = 'abs'; typ.dispatchEvent(new w.Event('change')); assert(root().querySelector('[data-m=abs]').getAttribute('aria-pressed') === 'true', '«الغياب فقط» switches the chart metric'); typ.value = 'all'; typ.dispatchEvent(new w.Event('change'));
  const q = root().querySelector('[data-rep-q]'); q.value = 'ممرض'; q.dispatchEvent(new w.Event('input')); assert.deepEqual(names(), ['=HYPERLINK("x")'], 'search by job title'); root().querySelector('[data-rep-q]').value = ''; root().querySelector('[data-rep-q]').dispatchEvent(new w.Event('input'));
  const cmp = root().querySelector('[data-rep-compare]'); cmp.checked = false; cmp.dispatchEvent(new w.Event('change')); await t.tick(); assert(!root().querySelector('[data-rep-range]').textContent.includes('مقارنة') && !root().querySelector('[data-delta]'), 'comparison off -> no deltas'); cmp.checked = true; root().querySelector('[data-rep-compare]').checked = true; root().querySelector('[data-rep-compare]').dispatchEvent(new w.Event('change')); await t.tick();
  // ---- «راجع الوردية» jumps to the shifts tab
  root().querySelector('[data-rep-shifts]').click(); await t.tick(); assert(d.querySelector('[data-hr-shifts]'), 'opens the shifts tab'); d.querySelector('[data-att-tab=reports]').click(); await t.tick(); await t.tick(); assert.equal(kv('الالتزام').v, '63%', 'filters survive tab hopping');
  // ---- CSV (formula-safe) + print
  let blob = null, printed = 0; w.URL.createObjectURL = b => { blob = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = function () { this.dataset.clicked = this.download; }; w.print = () => { printed++; };
  root().querySelector('[data-rep-csv]').click(); const text = await new Promise(res => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); });
  assert(text.startsWith('"الموظف"') && text.includes('"=HYPERLINK') === false && text.includes("\"'=HYPERLINK"), 'formula-injection guard on names'); assert(text.split('\r\n').length === 3 && text.includes('"6","2","50","1","1","0","60","1","50"'), 'one line per employee with the shown numbers');
  root().querySelector('[data-rep-print]').click(); assert.equal(printed, 1);
  // ---- empty / failure / missing migration
  data = Object.assign(fixture(), { people: [], rows: [] }); await t.openHub('reports'); assert(root().querySelector('[data-rep-empty]'), 'empty state'); assert.equal(kv('الالتزام').v, '0%'); for (const p of ['today', 'week', 'last', '90', 'custom', 'month']) { root().querySelector('[data-p="' + p + '"]').click(); await t.tick(); assert(root().querySelector('[data-rep-kpis]'), 'renders ' + p); }
  mode = 'down'; data = fixture(); await t.openHub('reports'); assert(root().textContent.includes('boom') && root().querySelector('[data-rep-retry]'), 'errors are shown with a retry'); mode = 'missing'; await t.openHub('reports'); assert(root().textContent.includes('غير مفعّلة بعد'), 'clear message when the migration is missing'); mode = 'ok'; root().querySelector('[data-rep-retry]').click(); await t.tick(); await t.tick(); assert(root().querySelector('[data-rep-kpis]'), 'retry recovers');
  const emp = await makeEnv({ manager: false }); emp.w.SSMPDHumanResources.render(emp.host); await emp.tick(); assert(!emp.d.querySelector('[data-hr-open=presence]')); assert.equal(emp.count('hr_attendance_range'), 0);
  console.log('PASS hr attendance «التقارير» DOM');
})().catch(e => { console.error(e && e.stack || e, e && e.message, e && e.name); process.exit(1); });
