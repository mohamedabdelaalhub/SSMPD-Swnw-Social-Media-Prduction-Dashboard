// 20261127130000 «وردية اليوم السريعة» + «حسب تواجد الطبيب» — DOM (mocked RPC, live workspace for the nursing board, no real data).
// Rule 9: every new button is clicked and sends the right RPC; rule 10: every new panel has ✕ (and Esc for the nursing window).
//  A) calendar (hr-work-schedule.js) for someone allowed (can_quick): quick / doctor / «مفيش شغل» days coloured, empty days are «+» buttons;
//     rest day asks «إضافي ولا عادي» (إضافي checked first), save → quick_save payload, server error shown, cancel → quick_cancel.
//  B) «نوع الوردية» (HR, can_flex): doctors list loads, add via the select (search-ready <select>), chip ✕ removes, «شوف الأسبوع الجاي» → preview
//     table, «احفظ» → flex_save payload, «ثابتة كل أسبوع» → flex_stop.  C) not allowed → no «+», no «نوع الوردية» button.
//  D) nursing board: «حاضر من … — مفيش وردية النهارده» + «اعمل وردية النهارده» only with can_quick; window ✕ / Esc / save → hr_day_shift quick_save today.
const assert = require('node:assert/strict'), fs = require('fs');
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] }));
const tick = () => new Promise(r => setTimeout(r, 30));
const cairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ym = cairo.slice(0, 7), pad = n => String(n).padStart(2, '0'), day = n => ym + '-' + pad(n), last = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();
const dowOf = s => new Date(s + 'T12:00:00Z').getUTCDay();
// future days of this month (fall back to next month if today is near the end)
function calendar(opts) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document, calls = [];
  const base = +cairo.slice(8), fut = [], restDays = [];
  for (let n = base; n <= last; n++) (dowOf(day(n)) === 5 ? restDays : fut).push(day(n));
  const Q = fut[0], DR = fut[1], NW = fut[2], REST = restDays.find(x => x >= cairo);
  w.SSMPDWorkforceUtils = { rpc: async (fn, a) => {
    calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === 'hr_shifts_workspace') return { today: cairo, templates: [{ id: 'T', name: 'صباحي', start_time: '09:00:00', end_time: '17:00:00', active: true }], people: [{ id: 'p1', full_name: 'ممرضة تجريبية', days: { 0: 'T', 1: 'T', 2: 'T', 3: 'T', 4: 'T', 5: null, 6: 'T' } }] };
    if (fn === 'hr_workspace') return { people: [{ id: 'p1', full_name: 'ممرضة تجريبية', leave_balance: 5 }], requests: [] };
    if (fn === 'hr_attendance_range') return { rows: [] };
    if (fn === 'hr_day_shift') {
      const p = a.p_action, pl = a.p_payload || {};
      if (p === 'month') return opts.allowed ? { today: cairo, can_quick: true, can_fix_past: true, can_flex: true,
        flex: opts.flex ? { id: 'L', provider_ids: ['d1'], department: null, before_min: 30, after_min: 15, split_gap_min: 120, grace: 10, valid_from: cairo, doctors: ['د. أسنان تجريبي'] } : null,
        flex_days: opts.flex ? [DR, NW] : [],
        shifts: [{ id: 'q1', day: Q, period: 1, source: 'quick', extra: false, start: '10:00', end: '14:00', note: 'تغطية', active: true },
                 { id: 's1', day: DR, period: 1, source: 'doctor', start: '13:30', end: '21:30', note: 'د. أسنان تجريبي', active: true },
                 { id: 's2', day: NW, period: 1, source: 'doctor', start: '13:30', end: '21:30', active: false, cancel_reason: 'doctor_off' }] }
        : { today: cairo, can_quick: false, can_fix_past: false, can_flex: false, flex: null, flex_days: [], shifts: [] };
      if (p === 'quick_save' && opts.failOnce && !opts.failed) { opts.failed = true; throw new Error('اليوم ده فيه وردية بالفعل'); }
      if (p === 'providers') return { doctors: [{ id: 'd1', name: 'د. أسنان تجريبي', department: 'أسنان' }, { id: 'd2', name: 'د. تقويم تجريبي', department: 'أسنان' }], departments: ['أسنان'] };
      if (p === 'preview') return { days: [{ day: Q, periods: [{ start: '13:30', end: '21:30', doctors: 'د. أسنان تجريبي' }] }, { day: DR, periods: [] }] };
      return { id: 'ok', day: pl.day };
    }
  } };
  w.SSMPDToast = { show(m) { (w.__t = w.__t || []).push(m); } };
  w.confirm = () => true;
  w.eval(fs.readFileSync('assets/js/hr-work-schedule.js', 'utf8'));
  return { w, d, calls, Q, DR, NW, REST };
}
(async () => {
  // A) allowed manager / HR
  let { w, d, calls, Q, DR, NW, REST } = calendar({ allowed: true, flex: true, failOnce: true });
  w.SSMPDHRWorkSchedule.open({ id: 'p1', full_name: 'ممرضة تجريبية' }); await tick(); await tick();
  let dlg = d.querySelector('[data-hws="p1"]'); assert(dlg && dlg.querySelector('[data-hws-close]'), 'calendar with ✕');
  if (Q) assert(dlg.querySelector('[data-hws-sheet="day:' + Q + '"].work.quick'), 'quick day coloured');
  if (DR) assert(dlg.querySelector('[data-hws-sheet="day:' + DR + '"].work.doctor'), 'doctor day coloured');
  if (NW) assert(dlg.querySelector('[data-hws-add="' + NW + '"].nowork'), 'no-doctor day = «مفيش شغل» and can take a quick shift');
  assert(dlg.querySelector('.hws-type') && /حسب تواجد الطبيب/.test(dlg.querySelector('.hws-type').textContent), '«نوع الوردية» shows the link');
  assert(!/[٠-٩]/.test(dlg.textContent), 'English digits');
  if (REST) {
    dlg.querySelector('[data-hws-add="' + REST + '"]').click();
    let pn = dlg.querySelector('[data-hws-panel]'); assert(pn && pn.querySelector('[data-hws-sheet-x]'), 'quick form with ✕');
    const ex = pn.querySelectorAll('[name=q_extra]'); assert.equal(ex.length, 2, 'rest day asks extra / normal'); assert(ex[0].checked && ex[0].value === '1', '«يوم إضافي» chosen first');
    pn.querySelector('[name=q_start]').value = '10:00'; pn.querySelector('[name=q_end]').value = '14:00'; pn.querySelector('[name=q_note]').value = 'تغطية عيادة';
    pn.querySelector('[data-hws-act="qsave"]').click(); await tick(); await tick();
    assert(dlg.querySelector('[data-hws-panel] [role=alert]') && /فيه وردية بالفعل/.test(dlg.querySelector('[data-hws-panel] [role=alert]').textContent), 'server refusal shown in the form');
    dlg.querySelector('[data-hws-act="qsave"]').click(); await tick(); await tick(); await tick();
    const sv = calls.filter(c => c[0] === 'hr_day_shift' && c[1].p_action === 'quick_save').pop()[1].p_payload;
    assert.deepEqual({ person_id: sv.person_id, day: sv.day, start: sv.start, end: sv.end, note: sv.note, extra: sv.extra, grace: sv.grace }, { person_id: 'p1', day: REST, start: '10:00', end: '14:00', note: 'تغطية عيادة', extra: true, grace: '10' });
    assert(w.__t.some(m => /اتحفظت وردية/.test(m)), 'saved toast');
  }
  dlg = d.querySelector('[data-hws="p1"]');
  if (NW) { dlg.querySelector('[data-hws-add="' + NW + '"]').click(); assert.equal(dlg.querySelectorAll('[data-hws-panel] [name=q_extra]').length, 0, 'not a rest day → no extra question'); assert(/مفيش طبيب|الطبيب لغى/.test(dlg.querySelector('[data-hws-panel]').textContent)); dlg.querySelector('[data-hws-panel] [data-hws-sheet-x]').click(); assert(!dlg.querySelector('[data-hws-panel]'), '✕ closes the form'); }
  if (Q) {
    dlg.querySelector('[data-hws-sheet="day:' + Q + '"]').click();
    const cancel = dlg.querySelector('[data-hws-act="qcancel"]'); assert(cancel, 'cancel button on a quick day'); cancel.click(); await tick(); await tick();
    assert(calls.some(c => c[0] === 'hr_day_shift' && c[1].p_action === 'quick_cancel' && c[1].p_payload.id === 'q1'), 'quick_cancel sent');
  }
  // B) «نوع الوردية»
  dlg = d.querySelector('[data-hws="p1"]');
  dlg.querySelector('.hws-type').click(); await tick(); await tick();
  let pn = dlg.querySelector('[data-hws-panel]'); assert(pn && pn.querySelector('[data-hws-sheet-x]'), 'flex panel with ✕');
  assert(pn.querySelector('.hws-seg button.on[data-mode="doctor"]'), 'current mode: doctor');
  assert.equal(pn.querySelectorAll('.hws-chip').length, 1, 'linked doctor shown as a chip');
  pn.querySelector('[name=fx_before]').value = '45';
  const sel = pn.querySelector('[data-fx-add]'); assert.equal(sel.tagName, 'SELECT', 'doctor picker is a <select> (select-search adds typing search)');
  sel.value = 'd2'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await tick();
  pn = dlg.querySelector('[data-hws-panel]'); assert.equal(pn.querySelectorAll('.hws-chip').length, 2, 'second doctor added'); assert.equal(pn.querySelector('[name=fx_before]').value, '45', 'typed margin kept after re-draw');
  pn.querySelector('.hws-chip button[data-id="d1"]').click(); pn = dlg.querySelector('[data-hws-panel]'); assert.equal(pn.querySelectorAll('.hws-chip').length, 1, 'chip ✕ removes the doctor');
  pn.querySelector('[data-hws-act="fx-preview"]').click(); await tick(); await tick();
  pn = dlg.querySelector('[data-hws-panel]'); assert(pn.querySelector('.hws-tbl') && /13:30–21:30/.test(pn.textContent) && /مفيش شغل/.test(pn.textContent), 'preview table');
  pn.querySelector('[data-hws-act="fx-save"]').click(); await tick(); await tick();
  const fx = calls.filter(c => c[0] === 'hr_day_shift' && c[1].p_action === 'flex_save').pop()[1].p_payload;
  assert.deepEqual(fx.provider_ids, ['d2']); assert.equal(fx.before_min, '45'); assert.equal(fx.after_min, '15'); assert.equal(fx.person_id, 'p1');
  dlg.querySelector('.hws-type').click(); await tick(); await tick();
  dlg.querySelector('[data-hws-act="fx-mode"][data-mode="fixed"]').click();
  pn = dlg.querySelector('[data-hws-panel]'); assert(pn.querySelector('[name=fx_from]'), 'back-to-fixed asks from which day');
  pn.querySelector('[data-hws-act="fx-fixed"]').click(); await tick(); await tick();
  assert(calls.some(c => c[0] === 'hr_day_shift' && c[1].p_action === 'flex_stop' && c[1].p_payload.person_id === 'p1'), 'flex_stop sent');
  d.querySelector('[data-hws="p1"] [data-hws-close]').click(); assert(!d.querySelector('[data-hws]'), '✕ closes the calendar');
  // C) not allowed
  ({ w, d, calls } = calendar({ allowed: false }));
  w.SSMPDHRWorkSchedule.open({ id: 'p1', full_name: 'ممرضة تجريبية' }); await tick(); await tick();
  dlg = d.querySelector('[data-hws="p1"]'); assert(!dlg.querySelector('[data-hws-add]') && !dlg.querySelector('.hws-type'), 'no «+» and no «نوع الوردية» without permission');

  // D) nursing board
  for (const can of [true, false]) {
    const dom = new JSDOM('<body><div id="h"></div></body>', { url: 'https://x.test/', runScripts: 'outside-only', pretendToBeVisual: true }), nw = dom.window, nd = nw.document, nc = [];
    nw.scrollTo = () => {}; nw.SSMPDToast = { show: m => { (nw.__t = nw.__t || []).push(m); } };
    nw.SSMPDRoles = { hasAnyRole: () => false }; nw.SSMPDAuth = { currentAdmin: { roles: ['nursing'] } };
    const STAFF = { date: cairo, now: new Date().toISOString(), covered: { physio: true, dental: true }, nurses: [{ admin_id: 'u9', name: 'ممرضة أسنان تجريبية', section: 'dental', state: 'off', punch_in: cairo + 'T11:27:00Z', person_id: can ? 'p9' : null, can_quick: can }] };
    nw.SSMPDDb = { client: { rpc: async (name, args) => { nc.push(JSON.parse(JSON.stringify([name, args]))); const a = args.p_action;
      if (name === 'hr_day_shift') return { data: { id: 'x' }, error: null };
      if (a === 'day') return { data: { date: cairo, my_section: 'dental', sections: ['dental'], unread: 0, appointments: [] }, error: null };
      if (a === 'staff_today') return { data: STAFF, error: null };
      if (a === 'notifications') return { data: { unread: 0, items: [] }, error: null };
      return { data: null, error: { message: 'مش مسموح' } }; } } };
    nw.SSMPDReceptionModules = { sections: () => [['journey', 'x', 'y']], panel: () => '<p>j</p>' };
    nw.eval(fs.readFileSync('assets/js/nursing-day-ops.js', 'utf8'));
    nd.querySelector('#h').innerHTML = nw.SSMPDReceptionModules.panel('nursing', { workspace: 'w1', data: { workspace: { mode: 'live' } } });
    for (let i = 0; i < 100 && !nd.querySelector('[data-nd-nurse="u9"]'); i++) await tick();
    const row = nd.querySelector('[data-nd-nurse="u9"]'); assert(row, 'nurse row');
    assert.match(row.textContent, /حاضر من 01:27 م — مفيش وردية النهارده/, 'clocked in with no shift');
    const b = row.querySelector('[data-nd="quick"]');
    if (!can) { assert(!b, 'no button without permission'); nw.close(); continue; }
    assert(b && b.textContent === 'اعمل وردية النهارده');
    b.click(); let m = nd.querySelector('[data-nd-quick]'); assert(m && m.querySelector('[data-q="close"][aria-label="إغلاق"]'), 'window with ✕');
    assert.equal(m.querySelector('[name=q_start]').value, '13:00', 'starts at the punch, rounded down to 30 minutes');
    m.querySelector('[data-q="close"]').click(); assert(!nd.querySelector('[data-nd-quick]'), '✕ closes');
    b.click(); nd.dispatchEvent(new nw.KeyboardEvent('keydown', { key: 'Escape' })); assert(!nd.querySelector('[data-nd-quick]'), 'Esc closes');
    nd.querySelector('[data-nd-nurse="u9"] [data-nd="quick"]').click(); m = nd.querySelector('[data-nd-quick]');
    m.querySelector('[name=q_end]').value = '21:30'; m.querySelector('[data-q="save"]').click(); for (let i = 0; i < 20 && nd.querySelector('[data-nd-quick]'); i++) await tick();
    const call = nc.find(c => c[0] === 'hr_day_shift'); assert(call, 'hr_day_shift called');
    assert.deepEqual({ a: call[1].p_action, p: call[1].p_payload.person_id, d: call[1].p_payload.day, s: call[1].p_payload.start, e: call[1].p_payload.end }, { a: 'quick_save', p: 'p9', d: cairo, s: '13:00', e: '21:30' });
    assert(!nd.querySelector('[data-nd-quick]') && nw.__t.some(t => /اتحفظت وردية النهارده/.test(t)), 'saved, window closed, board reloaded');
  }
  console.log('PASS hr flex shifts DOM: calendar quick shift (rest-day extra, error, cancel), «نوع الوردية» (add/remove doctor, preview, save, back to fixed), hidden without permission, nursing «اعمل وردية النهارده» (✕, Esc, save).');
  process.exit(0); // the nursing board keeps a refresh timer
})().catch(e => { console.error(e); process.exit(1); });
