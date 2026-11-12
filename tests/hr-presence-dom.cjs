// DOM test («الحضور اللحظي» → «الآن (مباشر)»): the real HR page gets one hub section for HR managers only; it loads lazily and shows the live board on REAL-shaped data:
// KPI counts, urgent boxes (absent / late / leave), department cards (typing variants grouped), timeline + list views, KPI/department/search filters and empty states,
// stale-feed + heartbeat chip, very long open shift, XSS-safe names, phone/WhatsApp actions, link manager dialog (map / ignore / unignore payloads), 15s refresh,
// failure keeps the last picture, polling stops when closed, missing-migration message, degraded mode without the schedule RPCs, mobile-safe empty data.
const assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const NOW = '2026-11-12T10:00:00+00:00', iso = min => new Date(new Date(NOW).getTime() - min * 60000).toISOString();
const row = o => Object.assign({ device_id: 'k14', device_user_id: 1, person_id: null, mapped: false, full_name: null, code: null, department: null, job_title: null, state: 'in', last_punch: 0, last_punch_at: iso(10), last_in_at: iso(10), last_out_at: null, punches: 1, minutes_since: 10 }, o);
const brow = o => Object.assign({ person_id: 'x', full_name: 'س', code: '', department: '', job_title: '', template_id: 'T1', template_name: 'صباحي', color: '#0F369D', grace: 10, exp_start: iso(240), exp_end: iso(-240), first_in: null, status: 'on_time', late_min: 0, since_start: null, excused: false, late_week: 0, absent_week: 0 }, o);
const fresh = () => ({ can_manage: true, now: NOW, lookback_hours: 16, last_received_at: iso(1), last_seen_at: iso(0), last_punch_at: iso(10), ignored: [{ device_id: 'k14', device_user_id: 55, last_punch_at: iso(120) }],
  people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال' }, { id: 'p2', code: 'EMP-2', full_name: 'موظف ثان', department: '' }],
  rows: [
    row({ device_user_id: 3, person_id: 'p1', mapped: true, full_name: 'موظف أول', code: 'EMP-1', department: 'الاستقبال', job_title: 'استقبال', last_in_at: iso(185), last_punch_at: iso(185), minutes_since: 185 }),
    row({ device_user_id: 9, person_id: 'p2', mapped: true, full_name: 'ثان <img src=x onerror=window.__xss=1>', code: 'EMP-2', department: 'استقبال ', state: 'break', last_punch: 2, last_punch_at: iso(5), minutes_since: 5, last_in_at: iso(150) }),
    row({ device_user_id: 6, person_id: 'p3', mapped: true, full_name: 'منصرف', code: 'EMP-3', department: 'تمريض', state: 'out', last_punch: 1, last_punch_at: iso(40), last_out_at: iso(40), last_in_at: iso(500), minutes_since: 40 }),
    row({ device_user_id: 24, state: 'in', last_in_at: iso(15 * 60), last_punch_at: iso(15 * 60), minutes_since: 15 * 60 }),
    row({ device_user_id: 40, person_id: 'p4', mapped: true, full_name: 'لم يبصم', code: 'EMP-4', department: 'تمريض', state: 'none', last_punch: null, last_punch_at: null, last_in_at: null, minutes_since: null, punches: 0 }),
    row({ device_user_id: 41, person_id: 'p5', mapped: true, full_name: 'في إجازة', code: 'EMP-5', department: 'تمريض', state: 'none', last_punch: null, last_punch_at: null, last_in_at: null, minutes_since: null, punches: 0 }),
    row({ device_user_id: 42, person_id: 'p6', mapped: true, full_name: 'لم يبدأ', code: 'EMP-6', department: 'الإدارة', state: 'none', last_punch: null, last_punch_at: null, last_in_at: null, minutes_since: null, punches: 0 })] });
const board = () => ({ day: '2026-11-12', now: NOW, has_schedule: true, unscheduled: 0, rows: [
  brow({ person_id: 'p1', full_name: 'موظف أول', department: 'الاستقبال', first_in: iso(185) }), brow({ person_id: 'p2', full_name: 'ثان', department: 'استقبال ', status: 'late', late_min: 25, first_in: iso(150), late_week: 3 }),
  brow({ person_id: 'p3', full_name: 'منصرف', department: 'تمريض', first_in: iso(500) }), brow({ person_id: 'p4', full_name: 'لم يبصم', department: 'تمريض', status: 'absent', since_start: 240 }),
  brow({ person_id: 'p5', full_name: 'في إجازة', department: 'تمريض', status: 'leave' }), brow({ person_id: 'p6', full_name: 'لم يبدأ', department: 'الإدارة', status: 'upcoming', exp_start: iso(-60), exp_end: iso(-540) })] });
const workspace = () => ({ can_manage: true, today: '2026-11-12', templates: [{ id: 'T1', name: 'صباحي', start_time: '08:00', end_time: '14:00', grace_minutes: 10, color: '#0F369D', active: true, overnight: false }, { id: 'T2', name: 'مسائي', start_time: '14:00', end_time: '22:00', grace_minutes: 10, color: '#F15A22', active: true, overnight: false }], people: [] });
(async () => {
  let snap = fresh(), brd = board(), mode = 'ok', boardMode = 'ok';
  const t = await makeEnv({ rpc: async (fn) => {
    if (fn === 'hr_presence_snapshot') { if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_presence_snapshot in the schema cache' } }; if (mode === 'down') return { error: { message: 'network down' } }; return { data: snap }; }
    if (fn === 'hr_attendance_today') return boardMode === 'ok' ? { data: brd } : { error: { message: 'missing' } };
    if (fn === 'hr_shifts_workspace') return boardMode === 'ok' ? { data: workspace() } : { error: { message: 'missing' } };
    if (fn === 'hr_presence_map' || fn === 'hr_presence_ignore') return { data: null };
  } });
  const { w, d } = t, root = () => d.querySelector('[data-hr-presence]'), kpi = k => root().querySelector('.kpi[data-k=' + k + '] b').textContent;

  // ---- section: one hub for HR managers, lazy
  w.SSMPDHumanResources.render(t.host); await t.tick();
  const tab = d.querySelector('[data-hr-open=presence]'); assert(tab, 'hub section for HR managers'); assert.equal(tab.textContent, 'الحضور اللحظي'); assert(!d.querySelector('[data-hr-open=shifts]'), 'shifts is now an inner tab');
  assert.equal(t.count('hr_presence_snapshot'), 0, 'nothing loads until opened');
  tab.click(); await t.tick(); await t.tick();
  assert(d.querySelector('.att-hub'), 'hub mounted, scoped under .att-hub'); assert.equal(t.count('hr_presence_snapshot'), 1); assert.equal(t.count('hr_attendance_today'), 1); assert.equal(t.count('hr_shifts_workspace'), 1);
  assert.deepEqual([...d.querySelectorAll('[data-att-tabs] button')].map(b => b.textContent.replace(/\d+$/, '')), ['الآن (مباشر)', 'الورديات', 'التقارير']);
  assert.equal(d.querySelector('[data-att-badge]').textContent, '1', 'badge = absent count on the «الآن» tab');
  assert(d.querySelector('[data-att-live]').textContent.includes('متصل'), 'header shows a live link');

  // ---- KPIs: real states merged from punches + schedule verdicts
  assert.equal(kpi('in'), '3', 'in + break + unmapped number inside'); assert.equal(kpi('late'), '1'); assert.equal(kpi('abs'), '1'); assert.equal(kpi('leave'), '1'); assert.equal(kpi('up'), '1'); assert.equal(kpi('out'), '1');
  assert(root().querySelector('.kpi[data-k=in] small').textContent.includes('من 5 مجدولين'), 'scheduled count comes from the board');
  const boxes = k => root().querySelector('[data-b=' + k + ']');
  assert(boxes('abs').textContent.includes('لم يبصم') && boxes('abs').textContent.includes('4 س'), 'absent box: name + time since shift start (240 min)');
  assert(boxes('late').textContent.includes('متأخر 25 د') && boxes('late').textContent.includes('3 مرات'), 'late box: minutes + repeat counter'); assert(boxes('leave').textContent.includes('في إجازة'));
  assert(root().querySelector('[data-presence-shift]').textContent.includes('الوردية الحالية') && root().textContent.includes('صباحي'), 'current shift chip from the templates');
  const wa = boxes('abs').querySelector('a.wa'); assert(!wa, 'no phone for p4 -> no call buttons'); // p4 is not in the HR people list

  // ---- department cards: spelling variants grouped, unmapped numbers in their own last card
  const depts = [...root().querySelectorAll('[data-presence-dept]')]; assert.deepEqual(depts.map(x => x.dataset.dept), ['التمريض', 'الاستقبال', 'الإدارة', 'أرقام غير مربوطة بموظف'], 'largest first, unmapped last');
  const rec = depts.find(c => c.dataset.dept === 'الاستقبال'); assert.equal(rec.querySelectorAll('[data-presence-person]').length, 2, 'both spellings land in the same card'); assert(rec.textContent.includes('استراحة') && rec.textContent.includes('الحد الأدنى 3'), 'break pill + coverage minimum for a known department');
  assert(rec.querySelector('.cov.ok'), 'below the minimum but nobody absent there -> not flagged');
  const nur = depts.find(c => c.dataset.dept === 'التمريض'); assert(nur.querySelector('.abs-line').textContent.includes('لم يبصم'), 'absent people are called out inside their department'); assert(nur.querySelector('.cov.low'), 'nursing below its minimum with an absence is flagged');
  const unm = depts.find(c => c.dataset.dept === 'أرقام غير مربوطة بموظف'); assert(unm && unm.textContent.includes('رقم الجهاز 24') && unm.querySelector('[data-presence=map]') && unm.querySelector('[data-presence=ignore]'), 'unmapped card has map + ignore'); assert.equal(depts[depts.length - 1], unm);
  assert(root().querySelector('[data-presence-warn]').textContent.includes('تحقق من بصمة الخروج'), 'very long open shift flagged'); assert(root().querySelector('[data-presence-smart]'), 'smart alerts panel');
  assert(!depts.find(c => c.dataset.dept === 'الإدارة').querySelector('[data-presence-person]'), 'upcoming person is hidden until expanded'); 
  assert.equal(w.__xss, undefined); assert(!root().querySelector('img'), 'names are escaped'); assert(root().textContent.includes('<img src=x'), 'escaped markup shown as text');
  assert(root().querySelector('[data-presence-health]').textContent.includes('منذ') && root().querySelector('[data-presence-lastpunch]').textContent.includes('آخر بصمة وصلت'));
  assert.equal(root().querySelectorAll('[data-presence-feed-item]').length, 4, 'recent movements from real last punches (numbers that punched)');

  // ---- views
  root().querySelector('[data-v=timeline]').click(); assert(root().querySelector('[data-presence-timeline]')); assert.equal(root().querySelectorAll('[data-presence-tlrow]').length, 7);
  assert(root().querySelector('.tl-bar.live') && root().querySelector('.tl-miss') && root().querySelector('.tl-now'), 'live bar, missing marker, now line');
  root().querySelector('[data-v=list]').click(); const lr = [...root().querySelectorAll('[data-presence-list] .lr[data-presence-person]')]; assert.equal(lr.length, 7); assert(lr[0].textContent.includes('لم يبصم') && lr[0].textContent.includes('لم يصل'), 'list sorts problems first');
  root().querySelector('[data-v=cards]').click();

  // ---- filters + empty state
  root().querySelector('.kpi[data-k=abs]').click(); assert.equal(root().querySelectorAll('[data-presence-person]').length, 0, 'absent filter shows only the abs-line, no present people'); assert(root().textContent.includes('فلتر نشط'));
  root().querySelector('[data-presence=clear]').click(); assert(root().querySelectorAll('[data-presence-person]').length > 0 && !root().textContent.includes('فلتر نشط'));
  root().querySelector('.kpi[data-k=late]').click(); assert.equal(root().querySelectorAll('[data-presence-person]').length, 1, 'late filter'); root().querySelector('.kpi[data-k=late]').click();
  [...root().querySelectorAll('.chip')].find(c => c.dataset.d === 'nurse').click(); assert.deepEqual([...root().querySelectorAll('[data-presence-dept]')].map(x => x.dataset.dept), ['التمريض'], 'department chip filters the cards'); root().querySelector('.chip[data-d=all]').click();
  const q = root().querySelector('[data-presence-q]'); q.value = 'zzz'; q.dispatchEvent(new w.Event('input')); assert(root().querySelector('[data-presence-empty]'), 'no match -> empty state'); 
  root().querySelector('[data-presence-q]').value = 'منصرف'; root().querySelector('[data-presence-q]').dispatchEvent(new w.Event('input')); assert.equal(root().querySelectorAll('[data-presence-dept]').length, 1, 'search by name'); root().querySelector('[data-presence-q]').value = ''; root().querySelector('[data-presence-q]').dispatchEvent(new w.Event('input'));
  root().querySelector('[data-bx=late]').click(); assert.equal(root().querySelector('.trio').dataset.show, 'late', 'mobile trio tabs switch the visible box');

  // ---- link manager dialog: payloads
  assert(root().querySelector('[data-presence=dlg-open] .badge').textContent === '1', 'badge = unmapped numbers'); root().querySelector('[data-presence=dlg-open]').click();
  const dlg = () => root().querySelector('[data-presence-dlg]'); assert(dlg()); assert.deepEqual([...dlg().querySelectorAll('[role=tab]')].map(b => b.textContent), ['غير مربوطة (1)', 'متجاهلة (غير إدارية) (1)', 'مربوطون ولم يبصموا (3)']);
  const pick = dlg().querySelector('[data-presence-pick]'); assert.deepEqual([...pick.options].map(o => o.value), ['', 'p1', 'p2'], 'people offered');
  const nCalls = t.calls.length; dlg().querySelector('[data-presence=dlg-map]').click(); await t.tick(); assert.equal(t.calls.length, nCalls, 'no person picked -> nothing sent');
  pick.value = 'p2'; dlg().querySelector('[data-presence=dlg-map]').click(); await t.tick(); await t.tick();
  assert.deepEqual(t.calls.filter(c => c[0] === 'hr_presence_map').pop()[1], { p_device_id: 'k14', p_device_user_id: 24, p_person_id: 'p2' }); assert.equal(t.count('hr_presence_snapshot'), 2, 'reloaded after mapping'); assert(dlg(), 'dialog stays open after an action');
  dlg().querySelector('[data-presence=ignore]').click(); await t.tick(); await t.tick(); assert.deepEqual(t.calls.filter(c => c[0] === 'hr_presence_ignore').pop()[1], { p_device_id: 'k14', p_device_user_id: 24, p_ignore: true });
  dlg().querySelector('[data-id=ignored]').click(); const un = dlg().querySelector('[data-presence=unignore]'); assert(un.dataset.id.startsWith('55|')); un.click(); await t.tick(); await t.tick(); assert.deepEqual(t.calls.filter(c => c[0] === 'hr_presence_ignore').pop()[1], { p_device_id: 'k14', p_device_user_id: 55, p_ignore: false });
  dlg().querySelector('[data-id=none]').click(); assert(dlg().textContent.includes('لم يبصم') && dlg().textContent.includes('في إجازة'), 'mapped people with no punch'); dlg().querySelector('[data-presence=dlg-close]').click(); assert(!dlg());
  w.confirm = () => false; const before = t.calls.length; root().querySelector('[data-presence=ignore]').click(); await t.tick(); assert.equal(t.calls.length, before, 'declining the confirmation sends nothing'); w.confirm = () => true;
  // kebab on a mapped person: change / remove mapping
  const kb = [...root().querySelectorAll('.kebab[data-presence=map]')].find(b => b.dataset.id.startsWith('3|')); kb.click(); let f = d.querySelector('.wp-modal form'); assert(f && f.elements.person.value === 'p1', 'current person preselected'); f.elements.person.value = '';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await t.tick(); await t.tick(); assert.deepEqual(t.calls.filter(c => c[0] === 'hr_presence_map').pop()[1], { p_device_id: 'k14', p_device_user_id: 3, p_person_id: null });

  // ---- phone / WhatsApp actions come from the HR people list
  t.hrData.people.push({ id: 'p4', admin_id: null, full_name: 'لم يبصم', code: 'EMP-4', kind: 'employee', department: 'تمريض', branch: 'x', status: 'active', revision: 1, leave_balance: 1, phone: '010 1234 5678' });
  const t2 = await makeEnv({ rpc: async (fn) => fn === 'hr_presence_snapshot' ? { data: fresh() } : fn === 'hr_attendance_today' ? { data: board() } : fn === 'hr_shifts_workspace' ? { data: workspace() } : undefined, people: [{ id: 'p4', admin_id: null, full_name: 'لم يبصم', code: 'EMP-4', kind: 'employee', department: 'تمريض', branch: 'x', status: 'active', revision: 1, leave_balance: 1, phone: '010 1234 5678' }] });
  await t2.openHub(); const wa2 = t2.d.querySelector('[data-b=abs] a.wa'); assert(wa2 && wa2.getAttribute('href') === 'https://wa.me/201012345678' && wa2.rel.includes('noopener'), 'wa.me link with Egyptian country code'); assert.equal(t2.d.querySelector('[data-b=abs] a[href^="tel:"]').getAttribute('href'), 'tel:+201012345678');

  // ---- auto refresh (15s): new punch + stale feed; failure keeps the picture; heartbeat semantics
  snap = fresh(); snap.last_received_at = iso(9); snap.last_seen_at = null; snap.rows[0].state = 'out'; snap.rows[0].last_punch = 1; snap.rows[0].last_punch_at = iso(1); snap.rows[0].last_out_at = iso(1); snap.rows[0].minutes_since = 1;
  const refresh = t.refresher(); assert(refresh, 'auto refresh scheduled'); await refresh(); await t.tick();
  assert(root().querySelector('[data-stale]') && root().textContent.includes('الربط متوقف'), 'old server without heartbeat: stale after 5 minutes'); assert(d.querySelector('[data-att-stale]'), 'header pill shows the stale link');
  assert.equal(kpi('in'), '2', 'KPIs updated by the refresh');
  mode = 'down'; const before2 = root().innerHTML; await refresh(); await t.tick(); assert.equal(root().innerHTML, before2, 'failed refresh keeps the last picture'); mode = 'ok';
  snap = fresh(); snap.last_received_at = iso(60); snap.last_seen_at = iso(1); await refresh(); await t.tick(); assert(!root().querySelector('[data-stale]'), 'live heartbeat clears the warning even with an old last punch');
  snap.last_seen_at = iso(9); await refresh(); await t.tick(); assert(root().querySelector('[data-stale]'), 'silent heartbeat (9 min) flagged');
  const n0 = t.count('hr_presence_snapshot'); d.querySelector('[data-att=refresh]').click(); await t.tick(); await t.tick(); assert.equal(t.count('hr_presence_snapshot'), n0 + 1, 'header refresh button reloads');

  // ---- leaving the section stops the polling
  t.host.innerHTML = ''; const live = t.refresher(); const n1 = t.count('hr_presence_snapshot'); await live(); await t.tick(); assert.equal(t.count('hr_presence_snapshot'), n1, 'no requests after the section is gone');

  // ---- migrations missing / degraded modes
  mode = 'missing'; snap = fresh(); await t.openHub(); assert(root().textContent.includes('غير مفعّل بعد') && root().querySelector('[data-presence=retry]'), 'clear message when the presence migration is missing'); mode = 'ok';
  boardMode = 'off'; await t.openHub(); assert(root().querySelector('.kpi'), 'still renders from punches when the schedule RPCs are missing'); assert.equal(kpi('abs'), '0'); assert(root().textContent.includes('حسب بصمات الجهاز'), 'no schedule -> subtitle says so'); boardMode = 'ok';
  // empty data (mobile-safe: every view renders with nothing)
  snap = fresh(); snap.rows = []; snap.people = []; snap.ignored = []; brd = { day: '2026-11-12', now: NOW, has_schedule: false, unscheduled: 0, rows: [] };
  await t.openHub(); assert(root().textContent.includes('لم تُحدَّد ورديات بعد') && root().querySelector('[data-presence-noschedule]'), 'no schedule hint'); for (const v of ['timeline', 'list', 'cards']) { root().querySelector('[data-v=' + v + ']').click(); assert(root().querySelector('[data-presence-empty]') || v === 'cards', 'empty view ' + v); }
  assert.equal(kpi('in'), '0');
  // ---- not for non-managers
  const emp = await makeEnv({ manager: false }); emp.w.SSMPDHumanResources.render(emp.host); await emp.tick(); assert(!emp.d.querySelector('[data-hr-open=presence]'), 'no hub for non-managers'); assert.equal(emp.count('hr_presence_snapshot'), 0);
  console.log('PASS hr attendance «الآن» DOM');
})().catch(e => { console.error(e); process.exit(1); });
