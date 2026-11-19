// DOM test «ملف أداء الموظف» (assets/js/employee-profile.js) opened from the real attendance hub (الآن + التقارير), RPCs mocked:
// click on an employee opens the profile with the right identity (clinic person id + admin id), attendance aggregation follows the
// reports rules (excused absence = leave, upcoming skipped), score / band / delta / manager rating, task split, score dimensions,
// calendar with per-day details + table view + month navigation, period switch reloads with the right ranges,
// permission-denied sections show a note (no error), unmapped device numbers do not open a profile, names are escaped, close removes it.
const assert = require('node:assert/strict'), fs = require('fs'), makeEnv = require('./helpers/att-hub-env.cjs');
const NOW = '2026-11-17T10:00:00+00:00', t0 = Math.floor(Date.parse('2026-11-17') / 864e5), ds = n => new Date(n * 864e5).toISOString().slice(0, 10);
const people = [{ id: 'p1', admin_id: 'a1', full_name: 'موظفة <b>أولى</b>', code: 'EMP-1', kind: 'employee', department: 'تمريض', branch: 'x', status: 'active', revision: 1, leave_balance: 1, phone: '01012345678', job_title: 'تمريض' },
  { id: 'p2', admin_id: null, full_name: 'زميلة', code: 'EMP-2', kind: 'employee', department: 'التمريض', branch: 'x', status: 'active', revision: 1, leave_balance: 1, job_title: 'تمريض' }];
// November so far for p1: 1 = late 30, 2 = absent, 3 = excused absence, 4 = leave, 5..16 on time, 17 = upcoming
const rows = [];
for (let n = t0 - 120; n <= t0; n++) {
  const day = ds(n), base = { day, person_id: 'p1', late_min: 0, excused: false, template_name: 'صباحي', first_in: day + 'T06:05:00Z', last_out: day + 'T14:00:00Z', early_leave_min: 0, overtime_min: 0, incomplete: false };
  let st = 'on_time';
  if (day === '2026-11-01') { st = 'late'; base.late_min = 30; }
  if (day === '2026-11-02') { st = 'absent'; base.first_in = null; }
  if (day === '2026-11-03') { st = 'absent'; base.excused = true; base.first_in = null; }
  if (day === '2026-11-04') { st = 'leave'; base.first_in = null; }
  if (day === '2026-11-17') st = 'upcoming';
  rows.push(Object.assign(base, { status: st }));
  rows.push({ day, person_id: 'p2', status: n % 2 ? 'late' : 'on_time', late_min: n % 2 ? 10 : 0, excused: false, first_in: day + 'T06:00:00Z', last_out: day + 'T14:00:00Z', early_leave_min: 0 });
}
const perf = { score: 82, band: 'good', provisional: false, dimensions: [{ key: 'attendance', label: 'الحضور والانضباط', weight: 15, score: 71, counted: true }, { key: 'tasks', label: 'الالتزام بتنفيذ المهام', weight: 20, score: null, counted: true }], issues: ['تأخير <script>x</script>'], improvement_steps: ['متابعة المواعيد'], feedback: [] };
(async () => {
  let deny = false;
  const t = await makeEnv({ now: NOW, people, rpc: async (fn, a) => {
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: NOW, lookback_hours: 16, last_received_at: NOW, last_seen_at: NOW, ignored: [], people, rows: [
      { device_id: 'k14', device_user_id: 1, person_id: 'p1', mapped: true, full_name: people[0].full_name, code: 'EMP-1', department: 'تمريض', job_title: 'تمريض', state: 'in', last_punch: 0, last_punch_at: NOW, last_in_at: NOW, minutes_since: 5, punches: 1 },
      { device_id: 'k14', device_user_id: 99, person_id: null, mapped: false, state: 'in', last_punch: 0, last_punch_at: NOW, last_in_at: NOW, minutes_since: 5, punches: 1 }] } };
    if (fn === 'hr_attendance_today' || fn === 'hr_shifts_workspace') return { error: { message: 'missing' } };
    if (fn === 'hr_attendance_range') return { data: { from: a.p_from, to: a.p_to, today: '2026-11-17', now: NOW, people, rows: rows.filter(r => r.day >= a.p_from && r.day <= a.p_to) } };
    if (fn === 'staff_comprehensive_performance') return deny ? { error: { code: '42501', message: 'يمكنك متابعة أدائك فقط' } } : { data: a.p_to < '2026-11-01' ? Object.assign({}, perf, { score: 75 }) : perf };
    if (fn === 'employee_task_performance') return deny ? { error: { code: '42501', message: 'يمكنك متابعة إنجاز مهامك فقط' } } : { data: { sample: 10, done: 6, review: 2, late: 1, revision: 1, blocked: 1, timed: 8, on_time: 6 } };
  } });
  const { w, d } = t;
  w.SSMPDDb.staffReviewHistory = async (id) => { assert.equal(id, 'a1'); return [{ month: '2026-10-01', rating: 4, note: 'ممتازة <i>جدا</i>' }]; };
  w.eval(fs.readFileSync('assets/js/employee-profile.js', 'utf8'));
  await t.openHub();
  const prof = () => d.querySelector('[data-employee-profile]'), wait = async () => { for (let i = 0; i < 10; i++) await t.tick(); };

  // ---- unmapped device numbers do not open a profile; a mapped person does
  assert(!d.querySelector('[data-presence-dept][data-dept="أرقام غير مربوطة بموظف"] [data-pid]'), 'unmapped number is not clickable');
  const row = d.querySelector('[data-presence-dept] [data-pp="p1"]'); assert(row, 'employee row carries the clinic person id');
  row.click(); const open = d.querySelector('.pp [data-pop=profile]'); assert(open, 'the details popup offers the performance profile'); open.click(); await wait();
  assert(prof(), 'profile opened'); assert.equal(d.querySelectorAll('[data-employee-profile]').length, 1);
  assert(prof().textContent.includes('موظفة <b>أولى</b>') && !prof().querySelector('h2 b'), 'name escaped');
  const calls = fn => t.calls.filter(c => c[0] === fn);
  assert.deepEqual(calls('staff_comprehensive_performance').map(c => c[1].p_admin), ['a1', 'a1'], 'current + previous period for the admin id');
  assert.equal(calls('employee_task_performance').length, 7, 'current period + 6 months of trend');
  assert(calls('employee_task_performance').every(c => c[1].p_period === 'custom' && c[1].p_admin === 'a1'));
  const rng = calls('hr_attendance_range').pop()[1]; assert.equal(rng.p_to, '2026-11-17'); assert(rng.p_from <= '2026-06-01', 'six months of daily rows for the trends');

  // ---- score, band, delta, manager rating
  const P = prof();
  assert.equal(P.querySelector('[data-ring]').dataset.ring, '82'); assert(P.querySelector('.epf-band').textContent === 'جيد');
  assert(P.querySelector('.epf-delta').textContent.includes('+7'), 'delta vs previous period');
  assert(P.textContent.includes('4 من 5') && P.textContent.includes('ممتازة <i>جدا</i>') && !P.querySelector('.epf-st i i'), 'manager rating + escaped note');
  // ---- attendance tiles: Nov 1..16 -> scheduled 14 (excused absence + leave are not held), on time 12, late 1 (30 min), absent 1
  const tiles = [...P.querySelectorAll('[data-ep-tile]')].map(x => x.textContent);
  assert(tiles[0].includes('86'), 'commitment = 12 / 14 = 86%'); assert(tiles[1].startsWith('أيام الغياب1'), 'one absence (the excused one is leave)');
  assert(tiles[2].includes('30 د'), 'late minutes'); assert(tiles[3].includes('75') && tiles[3].includes('6 من 8'), 'tasks on time = 6 / 8');
  const meters = [...P.querySelectorAll('.epf-meters')[0].querySelectorAll('.epf-m')].map(m => m.textContent);
  assert.deepEqual(meters.map(m => m.replace(/\s+/g, ' ')), ['في الميعاد12 أيام', 'متأخر1 يوم', 'غايب1 يوم', 'إجازة2 أيام'].map(m => m.replace(/\s+/g, ' ')));
  assert(P.querySelector('.epf-cmp') && P.querySelector('.epf-cmp').textContent.includes('متوسط القسم'), 'comparison with the same department (both spellings)');
  // ---- calendar: day states, details, table view, no navigation inside one month
  const cal = P.querySelector('[data-cal]'), day = n => [...cal.querySelectorAll('.day:not(.e)')][n - 1];
  assert(day(1).classList.contains('st-late') && day(1).textContent.includes('30 د')); assert(day(2).classList.contains('st-abs')); assert(day(3).classList.contains('st-leave') && day(4).classList.contains('st-leave'));
  assert(day(17).classList.contains('st-off') && day(20).classList.contains('future'), 'upcoming and future days are not scheduled');
  day(1).dispatchEvent(new w.Event('pointerenter')); const tip = P.parentNode.querySelector('.epf-tip') || d.querySelector('.epf-tip'); assert(tip.classList.contains('on') && tip.textContent.includes('تأخير 30 د'), 'day details tooltip');
  P.querySelector('[data-ep-table]').click(); assert(!P.querySelector('[data-caltbl]').hidden && cal.hidden, 'table view'); assert.equal(P.querySelectorAll('[data-caltbl] tbody tr').length, 16, 'one row per scheduled-or-leave day');
  assert(!P.querySelector('button[data-ep-cal]'), 'no month arrows inside a single month');
  // ---- tasks and dimensions
  assert.equal(P.querySelector('[data-segbar]').dataset.segbar, '6,2,1,1', 'on time, delivered late, overdue now, still in time');
  assert(P.textContent.includes('مفيش بيانات كفاية'), 'a dimension without data says so');
  assert(P.textContent.includes('تأخير <script>x</script>') && !P.querySelector('script'), 'issues escaped');

  // ---- period switch: last 3 months -> calendar gets month arrows; previous month opens
  P.querySelector('[data-ep-period="90"]').click(); await wait();
  const P2 = prof(); assert(P2.querySelector('[data-ep-period="90"]').getAttribute('aria-pressed') === 'true');
  const back = P2.querySelector('button[data-ep-cal="-1"]'); assert(back && !back.disabled, 'month arrows over 3 months');
  back.click(); assert(prof().querySelector('[data-ep-cal]').textContent.includes('أكتوبر'), 'previous month shown');
  const lastPerf = calls('staff_comprehensive_performance').slice(-2); assert(lastPerf[0][1].p_from < lastPerf[0][1].p_to && lastPerf[1][1].p_to <= lastPerf[0][1].p_from, 'previous period ends where the current starts');

  // ---- close
  prof().querySelector('[data-ep-close]').click(); assert(!prof(), 'closed and removed');

  // ---- permissions: an HR manager who is not GM / super admin sees attendance and a note instead of the score / tasks
  deny = true; d.querySelector('[data-presence-dept] [data-pp="p1"]').click(); d.querySelector('.pp [data-pop=profile]').click(); await wait();
  const P3 = prof(); assert(P3.textContent.includes('التقييم الشامل يظهر للسوبر أدمن والمدير العام بس'), 'score note');
  assert(P3.textContent.includes('المهام تظهر للسوبر أدمن والمدير العام بس'), 'tasks note'); assert(P3.querySelector('[data-cal]'), 'attendance still shown');
  P3.querySelector('[data-ep-close]').click(); deny = false;

  // ---- the reports tab opens the same profile; a person without a dashboard account still gets attendance
  d.querySelector('[data-att-tab=reports]').click(); await wait();
  const rep = d.querySelector('tr[data-rep-emp][data-pid="p2"]'); assert(rep, 'report row carries the person id'); rep.click(); await wait();
  const P4 = prof(); assert(P4 && P4.textContent.includes('زميلة'), 'opened from the reports');
  assert(P4.textContent.includes('مش مربوط بحساب'), 'no admin account -> explained, no performance calls'); assert(P4.querySelector('[data-cal]'));
  P4.querySelector('[data-ep-close]').click();
  console.log('PASS employee profile «ملف أداء الموظف» DOM');
})().catch(e => { console.error(e); process.exit(1); });
