// DOM test (shifts tab «الورديات والمواعيد»): HR managers only, lazy load, board cards (on time / late / absent / waiting / leave / unmapped), Cairo clock times,
// escaping, empty-state guidance, day picker reload, template create/edit payloads, weekly schedule payload (incl. quick fill), employees get no tab, migration-missing message.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25)), T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
async function run(manager) {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  const hrData = { can_manage: manager, people: [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5 }], requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };

  const ws = () => ({ can_manage: true, today: '2026-11-12', templates: [
    { id: T1, name: 'صباحي', start_time: '09:00', end_time: '17:00', grace_minutes: 10, color: '#0F369D', active: true, overnight: false },
    { id: T2, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#F15A22', active: true, overnight: true }],
    people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال', job_title: 'موظف', since: '2026-11-01', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: T1, 5: null, 6: T1 } },
      { id: 'p2', code: 'EMP-2', full_name: 'بدون جدول', department: '', job_title: '', since: null, days: {} }] });
  const r = (o) => Object.assign({ person_id: 'x', full_name: 'س', code: '', department: '', job_title: '', template_id: T1, template_name: 'صباحي', color: '#0F369D', grace: 10, exp_start: '2026-11-12T07:00:00Z', exp_end: '2026-11-12T15:00:00Z', first_in: null, status: 'on_time', late_min: 0, since_start: null, excused: false, late_week: 0, absent_week: 0 }, o);
  const brd = () => ({ day: '2026-11-12', now: '2026-11-12T10:00:00Z', has_schedule: true, unscheduled: 1, rows: [
    r({ person_id: 'a', full_name: 'غايب <img src=x onerror=window.__xss=1>', status: 'absent', since_start: 180, absent_week: 2 }),
    r({ person_id: 'b', full_name: 'متأخر', status: 'late', first_in: '2026-11-12T07:25:00Z', late_min: 25, late_week: 3 }),
    r({ person_id: 'c', full_name: 'في الميعاد', status: 'on_time', first_in: '2026-11-12T06:58:00Z' }),
    r({ person_id: 'd', full_name: 'سماح', status: 'on_time', first_in: '2026-11-12T07:06:00Z', late_min: 6 }),
    r({ person_id: 'e', full_name: 'ينتظر', status: 'waiting', since_start: 5 }), r({ person_id: 'f', full_name: 'قادم', status: 'upcoming' }),
    r({ person_id: 'g', full_name: 'إجازة', status: 'leave' }), r({ person_id: 'h', full_name: 'بلا بصمة', status: 'unmapped' }),
    r({ person_id: 'i', full_name: 'بإذن', status: 'absent', excused: true, since_start: 60 })] });
  let calls = [], boardCalls = [], wsCalls = 0, mode = 'ok', wsData = ws(), boardData = brd(), intervals = [];
  w.confirm = () => true; w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'reception', has_hr_access: manager } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_shifts_workspace') { wsCalls++; if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_shifts_workspace in the schema cache' } }; return { data: wsData }; }
    if (fn === 'hr_attendance_today') { boardCalls.push(args); return { data: boardData }; }
    if (fn === 'hr_shifts_command') { calls.push(args); return { data: 'ok' }; }
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: '2026-11-12T10:00:00Z', lookback_hours: 16, rows: [], people: [], ignored: [] } };
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  w.setInterval = (fn) => { intervals.push(fn); return intervals.length; }; w.clearInterval = (id) => { intervals[id - 1] = null; };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-presence', 'hr-shifts', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  w.SSMPDHumanResources.render(d.querySelector('main')); await tick();
  return { w, d, calls, boardCalls, get wsCalls() { return wsCalls; }, set mode(v) { mode = v; }, set boardData(v) { boardData = v; }, set wsData(v) { wsData = v; }, intervals };
}
(async () => {
  // ---- employees (non managers) never get the tab
  const emp = await run(false); assert(!emp.d.querySelector('[data-hr-open=shifts]'), 'no shifts tab for employees'); assert.equal(emp.wsCalls, 0);

  const t = await run(true), d = t.d, w = t.w;
  const tab = d.querySelector('[data-hr-open=shifts]'); assert(tab, 'shifts tab for HR managers'); assert.equal(tab.textContent, 'الورديات والمواعيد'); assert.equal(t.wsCalls, 0, 'lazy: nothing loads until opened');
  tab.click(); await tick(); await tick();
  const root = () => d.querySelector('[data-hr-shifts]'); assert(root(), 'mounted'); assert.equal(t.wsCalls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(t.boardCalls[0])), { p_day: null }, 'first load asks for today');
  const card = k => root().querySelector('[data-card=' + k + ']').textContent;
  assert(card('on_time').includes('2'), 'on time = 2 (incl. within grace)'); assert(card('late').includes('1')); assert(card('absent').includes('2'), 'absent incl. excused'); assert(card('pending').includes('2'), 'waiting + upcoming'); assert(card('leave').includes('1')); assert(card('unmapped').includes('1'));
  const txt = root().textContent;
  for (const s of ['في الميعاد', 'متأخر', 'تأخر 25 د', 'غائب', 'تأخر 3 س بلا بصمة', 'في فترة السماح', 'لم يحن موعده', 'إجازة', 'غير مربوط بالبصمة', 'بإذن معتمد', 'ضمن السماح (6 د)', 'آخر 6 أيام: تأخر 3', 'غياب 2', '09:25', '09:00 → 17:00', '1 موظف بدون جدول']) assert(txt.includes(s), 'shows ' + s);
  assert.equal(w.__xss, undefined); assert(!root().querySelector('img'), 'names escaped');
  assert(txt.includes('أنواع الورديات') && txt.includes('(تعبر منتصف الليل)') && txt.includes('15 د'), 'templates listed');
  assert(txt.includes('جدول الأسبوع لكل موظف') && txt.includes('بدون جدول'), 'schedule grid lists everyone');

  // ---- day picker reloads the board for that day only
  const dp = root().querySelector('[data-shifts-day]'); assert.equal(dp.value, '2026-11-12'); dp.value = '2026-11-09'; dp.dispatchEvent(new w.Event('change')); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(t.boardCalls.at(-1))), { p_day: '2026-11-09' });

  // ---- add a template
  const addTpl = [...root().querySelectorAll('[data-shifts=tpl]')].find(b => !b.dataset.id); addTpl.click(); let f = d.querySelector('.wp-modal form'); assert(f, 'template modal');
  f.elements.name.value = 'مسائي'; f.elements.start_time.value = '14:00'; f.elements.end_time.value = '22:00'; f.elements.grace_minutes.value = '5'; f.elements.color.value = '#2f7d5c';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls[0])), { p_action: 'template_save', p_payload: { name: 'مسائي', start_time: '14:00', end_time: '22:00', grace_minutes: 5, color: '#2f7d5c' } }); assert(!d.querySelector('.wp-modal'));
  // ---- edit a template (stop it)
  [...root().querySelectorAll('[data-shifts=tpl]')].find(b => b.dataset.id === T2).click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.name.value, 'ليلي'); f.elements.active.value = 'false';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls[1].p_payload)), { id: T2, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#f15a22', active: false });

  // ---- weekly schedule: prefilled from the current pattern; quick fill skips Friday
  [...root().querySelectorAll('[data-shifts=sched]')].find(b => b.dataset.id === 'p1').click(); f = d.querySelector('.wp-modal form');
  assert.equal(f.elements.d0.value, T1); assert.equal(f.elements.d5.value, ''); assert.equal(f.elements.valid_from.value, '2026-11-12');
  assert.deepEqual([...f.elements.d0.options].map(o => o.value), ['', T1, T2], 'only active templates + day off');
  [...root().querySelectorAll('[data-shifts=sched]')].find(b => b.dataset.id === 'p2');
  f.elements.d3.value = ''; f.elements.fill.value = T2; f.elements.fill.dispatchEvent(new w.Event('change'));
  assert.equal(f.elements.d3.value, T2); assert.equal(f.elements.d5.value, '', 'quick fill leaves Friday off');
  f.elements.d4.value = ''; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls[2])), { p_action: 'schedule_save', p_payload: { person_id: 'p1', days: { 0: T2, 1: T2, 2: T2, 3: T2, 4: null, 5: null, 6: T2 }, valid_from: '2026-11-12' } });

  // ---- auto refresh only for today
  assert(t.intervals.some(Boolean), 'polling set up');

  // ---- empty state and missing migration
  const e = await run(true); e.boardData = { day: '2026-11-12', now: '2026-11-12T10:00:00Z', has_schedule: false, unscheduled: 2, rows: [] }; e.wsData = { can_manage: true, today: '2026-11-12', templates: [], people: [] };
  e.d.querySelector('[data-hr-open=shifts]').click(); await tick(); await tick();
  assert(e.d.querySelector('[data-shifts-empty]').textContent.includes('أضف وردية'), 'guides the first-time setup'); assert(e.d.querySelector('[data-hr-shifts]').textContent.includes('لا توجد ورديات'));
  const m = await run(true); m.mode = 'missing'; m.d.querySelector('[data-hr-open=shifts]').click(); await tick(); await tick();
  assert(m.d.querySelector('[data-hr-shifts]').textContent.includes('غير مفعّلة بعد'), 'clear message when the migration is not applied');
  console.log('hr-shifts-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
