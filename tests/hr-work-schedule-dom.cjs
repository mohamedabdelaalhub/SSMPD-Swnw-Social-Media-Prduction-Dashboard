// «مواعيد العمل والإجازات والراحات» (help 302): read-only month calendar, real hr-actions button -> module, day sheets each with ✕.
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] }));
const T = 'tpl-1', calls = [];
(async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document;
  const todayCairo = new w.Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const ym = todayCairo.slice(0, 7), pad = n => String(n).padStart(2, '0'), day = n => ym + '-' + pad(n);
  w.SSMPDWorkforceUtils = { rpc: async (fn, a) => { calls.push([fn, a]); const w0 = fn;
    if (fn === 'hr_shifts_workspace') return { today: todayCairo, templates: [{ id: T, name: 'صباحي', start_time: '09:00:00', end_time: '17:00:00', active: true }], people: [{ id: 'p1', full_name: 'موظف أول', days: { 0: T, 1: T, 2: T, 3: T, 4: T, 5: null, 6: T } }] };
    if (fn === 'hr_workspace') return { people: [{ id: 'p1', admin_id: 'a1', full_name: 'موظف أول', leave_balance: 12 }, { id: 'p9', admin_id: 'a9', full_name: 'المدير' }],
      requests: [{ person_id: 'p1', kind: 'leave', leave_type: 'annual', status: 'approved', from_date: day(10), to_date: day(11), created_at: ym + '-02T10:00:00Z', reviewed_by: 'a9', reviewed_at: ym + '-03T12:30:00Z' },
                 { person_id: 'p1', kind: 'leave', leave_type: 'casual', status: 'pending', from_date: day(20), to_date: day(20), created_at: ym + '-05T10:00:00Z' }, { person_id: 'p2', kind: 'leave', status: 'approved', from_date: day(3), to_date: day(3) }] };
    if (fn === 'hr_attendance_range') return { rows: [{ person_id: 'p1', day: day(1), status: 'present', late_min: 12, first_in: ym + '-01T07:12:00Z', last_out: ym + '-01T15:05:00Z' }] };
  } };
  w.SSMPDToast = { show() {} };
  w.eval(fs.readFileSync('assets/js/hr-work-schedule.js', 'utf8')); w.eval(fs.readFileSync('assets/js/hr-actions.js', 'utf8'));
  const tick = () => new Promise(r => setTimeout(r, 30));
  // the real «⋯» sheet button opens the calendar
  w.SSMPDHRActions && w.SSMPDHRActions.remember && w.SSMPDHRActions.remember([{ id: 'p1', full_name: 'موظف أول' }]);
  const btn = d.createElement('button'); btn.dataset.hra = 'p1'; btn.dataset.hraName = 'موظف أول'; d.body.append(btn); btn.click(); await tick();
  const act = d.querySelector('[data-hra-sheet] [data-hra-act="workcal"]'); assert(act, 'entry button under الورديات والحضور'); assert(act.textContent.includes('مواعيد العمل والإجازات والراحات'));
  act.click(); await tick(); await tick();
  const dlg = d.querySelector('[data-hws="p1"]'); assert(dlg, 'calendar opened'); assert(dlg.querySelector('[data-hws-close]'), 'rule 10: ✕');
  assert.equal(dlg.querySelectorAll('.hws-grid .hws-c:not(.blank)').length, new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate(), 'one cell per day');
  assert(dlg.querySelector('.hws-c.leave') && dlg.querySelector('.hws-c.pending'), 'leave + pending colours');
  assert(dlg.querySelector('.hws-c.rest'), 'weekly rest (Friday) coloured'); assert(!/[٠-٩]/.test(dlg.textContent), 'English digits');
  // other person's request is ignored
  assert.equal(dlg.querySelectorAll('.hws-c.leave').length, 2, 'only this person\'s approved leave days (2)');
  // work-day sheet: times, punch, lateness
  dlg.querySelector('[data-hws-sheet="day:' + day(1) + '"]').click();
  const k = dlg.querySelector('[data-hws-panel]'); assert(k, 'day sheet'); if (new Date(day(1) + 'T12:00:00Z').getUTCDay() !== 5) { assert(/09:00/.test(k.textContent) && /17:00/.test(k.textContent) && /12/.test(k.textContent), 'times + lateness'); }
  assert(k.querySelector('[data-hws-sheet-x]'), 'sheet ✕'); k.querySelector('[data-hws-sheet-x]').click(); assert(!dlg.querySelector('[data-hws-panel]'), '✕ closes the sheet');
  // leave sheet: balance, request date, approver name
  dlg.querySelector('.hws-chips .leave').click();
  const lv = dlg.querySelector('[data-hws-panel]').textContent; assert(lv.includes('12'), 'balance'); assert(lv.includes('المدير'), 'approver name from reviewed_by'); assert(lv.includes('منتظر'), 'pending listed');
  dlg.querySelector('[data-hws-sheet-x]').click();
  dlg.querySelector('.hws-chips .rest').click(); assert(dlg.querySelector('[data-hws-panel]').textContent.includes('راحة أسبوعية'), 'rest sheet'); dlg.querySelector('[data-hws-sheet-x]').click();
  // month navigation refetches that month; future month: no attendance call
  const before = calls.filter(c => c[0] === 'hr_attendance_range').length; dlg.querySelector('[data-hws-nav="1"]').click(); await tick(); await tick();
  assert.equal(calls.filter(c => c[0] === 'hr_attendance_range').length, before, 'future month asks no punches');
  assert(dlg.querySelector('.hws-c.future, .hws-c.rest'), 'future days drawn from the current schedule');
  assert(calls.every(c => /^hr_(shifts_workspace|workspace|attendance_range)$/.test(c[0])), 'read-only: only the 3 existing reads');
  dlg.querySelector('[data-hws-close]').click(); assert(!d.querySelector('[data-hws]'), '✕ closes the calendar');
  console.log('hr-work-schedule-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
