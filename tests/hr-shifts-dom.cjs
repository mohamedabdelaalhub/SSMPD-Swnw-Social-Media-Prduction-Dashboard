// DOM test («الحضور اللحظي» → «الورديات»): HR managers only, lazy inner tab, weekly grid grouped by department with template chips, day off / not scheduled cells, today column,
// weekly hours (>48 flagged), rest-between-shifts conflicts, coverage row, escaping, empty-state banner, unscheduled banner, template create/edit payloads,
// weekly schedule payload (incl. quick fill skipping Friday), old 'shifts' section key redirect, migration-missing message, mobile-safe empty data.
const assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222', T3 = '33333333-3333-4333-8333-333333333333';
const ws = () => ({ can_manage: true, today: '2026-11-12', templates: [
  { id: T1, name: 'صباحي', start_time: '09:00', end_time: '17:00', grace_minutes: 10, color: '#0F369D', active: true, overnight: false },
  { id: T2, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#F15A22', active: true, overnight: true },
  { id: T3, name: 'مبكر', start_time: '05:00', end_time: '12:00', grace_minutes: 10, color: '#evil"onmouseover="x', active: true, overnight: false }],
  people: [
    { id: 'p1', code: 'EMP-1', full_name: 'موظف أول <img src=x onerror=window.__xss=1>', department: 'الاستقبال', job_title: 'موظف', since: '2026-11-01', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: T1, 5: null, 6: T1 } },
    { id: 'p2', code: 'EMP-2', full_name: 'بدون جدول', department: '', job_title: '', since: null, days: {} },
    // night shift (ends 05:00) followed by a 09:00 shift the next morning -> only 4h rest, and 7 x 8h = 56h/week
    { id: 'p3', code: 'EMP-3', full_name: 'سهر', department: 'تمريض', job_title: '', since: '2026-11-01', days: { 0: T2, 1: T1, 2: T1, 3: T1, 4: T1, 5: T1, 6: T1 } }] });
(async () => {
  let wsData = ws(), mode = 'ok';
  const t = await makeEnv({ rpc: async (fn) => {
    if (fn === 'hr_shifts_workspace') { if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_shifts_workspace in the schema cache' } }; return { data: wsData }; }
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: '2026-11-12T10:00:00Z', lookback_hours: 16, rows: [], people: [], ignored: [] } };
    if (fn === 'hr_attendance_today') return { data: { day: '2026-11-12', has_schedule: true, unscheduled: 0, rows: [] } };
    if (fn === 'hr_shifts_command') return { data: 'ok' };
  } });
  const { w, d } = t, root = () => d.querySelector('[data-hr-shifts]');
  // ---- lazy: only after the inner tab is opened
  w.SSMPDHumanResources.render(t.host); await t.tick(); d.querySelector('[data-hr-open=presence]').click(); await t.tick(); await t.tick();
  assert.equal(t.count('hr_shifts_workspace'), 1, 'the «الآن» tab reads the templates once'); assert(!root(), 'shifts tab not mounted yet');
  d.querySelector('[data-att-tab=shifts]').click(); await t.tick(); await t.tick(); assert(root(), 'mounted'); assert.equal(t.count('hr_shifts_workspace'), 2);
  const txt = root().textContent;
  assert(!root().querySelector('img') && w.__xss === undefined && txt.includes('<img src=x'), 'names are escaped');
  // ---- grid: departments, chips, day off, not scheduled
  assert.deepEqual([...root().querySelectorAll('[data-shifts-dept]')].map(x => x.textContent.trim()).length, 3, 'grouped by department (reception, nursing, none)');
  const row = id => [...root().querySelectorAll('[data-shifts-person]')].find(r => r.querySelector('[data-id=' + id + ']'));
  const cells = id => [...row(id).querySelectorAll('td')].slice(1, 8).map(x => x.textContent.trim());
  assert.equal(cells('p1')[0], 'صباحي 09–17'); assert.equal(cells('p1')[6], 'راحة', 'Friday is the last column (Saturday first)'); assert.deepEqual(cells('p2'), ['—', '—', '—', '—', '—', '—', '—'], 'person without a pattern shows dashes');
  assert(cells('p3')[0].includes('صباحي'), 'Saturday column holds dow 6');
  assert.equal([...row('p3').querySelectorAll('td')][2].textContent.includes('ليلي'), true, 'Sunday = night shift');
  assert(!row('p1').outerHTML.includes('evil'), 'unsafe template color never reaches markup'); assert(root().innerHTML.includes('#0F369D1f') || root().innerHTML.includes('#0f369d1f'));
  assert(root().querySelector('th.today').textContent.includes('الخميس') && root().querySelector('th.today').textContent.includes('12/11'), 'today column highlighted with its date');
  // ---- hours / conflicts / coverage
  assert(row('p1').lastElementChild.textContent.includes('48'), 'p1 works 6 x 8h = 48 (not over)'); assert(!row('p1').lastElementChild.textContent.includes('فوق'));
  assert(row('p3').lastElementChild.textContent.includes('56') && row('p3').lastElementChild.textContent.includes('فوق 48'), '56h flagged');
  const conflict = root().querySelector('[data-shifts-conflict]'); assert(conflict && conflict.textContent.includes('سهر') && conflict.textContent.includes('ليلي') && conflict.textContent.includes('أقل من 11 ساعة'), 'night -> morning rest conflict'); assert(!root().querySelector('[data-shifts-ok]'));
  assert(root().querySelector('.covrow').textContent.includes('صباحي'), 'coverage row'); assert(root().querySelector('[data-shifts-unscheduled]').textContent.includes('1 موظف بدون جدول'), 'unscheduled banner');
  assert(root().textContent.includes('أنواع الورديات') && root().textContent.includes('تعبر منتصف الليل') && root().textContent.includes('سماح 15 د'), 'templates listed');
  // ---- add a template
  const calls = () => t.calls.filter(c => c[0] === 'hr_shifts_command').map(c => c[1]);
  const addTpl = [...root().querySelectorAll('[data-shifts=tpl]')].find(b => !b.dataset.id); addTpl.click(); let f = d.querySelector('.wp-modal form'); assert(f, 'template modal');
  f.elements.name.value = 'مسائي'; f.elements.start_time.value = '14:00'; f.elements.end_time.value = '22:00'; f.elements.grace_minutes.value = '5'; f.elements.color.value = '#2f7d5c';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await t.tick(); await t.tick();
  assert.deepEqual(calls()[0], { p_action: 'template_save', p_payload: { name: 'مسائي', start_time: '14:00', end_time: '22:00', grace_minutes: 5, color: '#2f7d5c' } }); assert(!d.querySelector('.wp-modal')); assert(t.count('hr_shifts_workspace') >= 3, 'grid reloaded after saving');
  // ---- edit a template (stop it)
  [...root().querySelectorAll('[data-shifts=tpl]')].find(b => b.dataset.id === T2).click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.name.value, 'ليلي'); f.elements.active.value = 'false';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await t.tick(); await t.tick();
  assert.deepEqual(calls()[1].p_payload, { id: T2, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#f15a22', active: false });
  // ---- weekly schedule: any cell opens the editor, prefilled; quick fill skips Friday
  [...root().querySelectorAll('[data-shifts=sched]')].find(b => b.dataset.id === 'p1' && b.classList.contains('sc')).click(); f = d.querySelector('.wp-modal form');
  assert.equal(f.elements.d0.value, T1); assert.equal(f.elements.d5.value, ''); assert.equal(f.elements.valid_from.value, '2026-11-12'); assert.deepEqual([...f.elements.d0.options].map(o => o.value), ['', T1, T2, T3], 'active templates + day off');
  f.elements.d3.value = ''; f.elements.fill.value = T1; f.elements.fill.dispatchEvent(new w.Event('change')); assert.equal(f.elements.d3.value, T1); assert.equal(f.elements.d5.value, '', 'quick fill leaves Friday off');
  f.elements.d4.value = ''; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await t.tick(); await t.tick();
  assert.deepEqual(calls()[2], { p_action: 'schedule_save', p_payload: { person_id: 'p1', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: null, 5: null, 6: T1 }, valid_from: '2026-11-12' } });
  // ---- empty state, migration missing, old section key, employees
  wsData = { can_manage: true, today: '2026-11-12', templates: [], people: [] }; await t.openHub('shifts'); assert(root().querySelector('[data-shifts-empty]').textContent.includes('أضف وردية') && root().textContent.includes('لا توجد ورديات'), 'guides first-time setup'); assert(root().querySelector('[data-shifts-ok]'), 'no conflicts'); assert(root().textContent.includes('لا يوجد موظفون'), 'empty grid is safe');
  mode = 'missing'; wsData = ws(); await t.openHub('shifts'); assert(root().textContent.includes('غير مفعّلة بعد'), 'clear message when the migration is not applied'); mode = 'ok';
  wsData = ws(); w.SSMPDNavState = { get: () => ({ section: 'shifts' }), set: () => {} }; w.SSMPDHumanResources.render(t.host); await t.tick(); await t.tick(); await t.tick(); assert(root(), 'a saved «shifts» section opens the hub on the shifts tab');
  const emp = await makeEnv({ manager: false }); emp.w.SSMPDHumanResources.render(emp.host); await emp.tick(); assert(!emp.d.querySelector('[data-hr-open=shifts]') && !emp.d.querySelector('[data-hr-open=presence]')); assert.equal(emp.count('hr_shifts_workspace'), 0);
  console.log('PASS hr attendance «الورديات» DOM');
})().catch(e => { console.error(e); process.exit(1); });
