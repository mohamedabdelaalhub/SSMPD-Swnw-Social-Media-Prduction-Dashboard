// HR look (owner 2026-11-23 «طبقه», option أ): the shift warnings collapse into ONE alerts line with details on demand, the cell after a short rest is outlined,
// and a «⋯» button next to every employee (shifts grid, presence board, person file) opens one sheet with the EXISTING HR tools for that person.
const assert = require('node:assert/strict'), fs = require('fs'), makeEnv = require('./helpers/att-hub-env.cjs');
const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
const ws = { can_manage: true, today: '2026-11-12', templates: [
  { id: T1, name: 'صباحي', start_time: '09:00', end_time: '17:00', grace_minutes: 10, color: '#0F369D', active: true, overnight: false },
  { id: T2, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#F15A22', active: true, overnight: true }],
  people: [
    { id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال', job_title: 'موظف', since: '2026-11-01', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: T1, 5: null, 6: T1 } },
    { id: 'p2', code: 'EMP-2', full_name: 'بدون جدول', department: '', job_title: '', since: null, days: {} },
    { id: 'p3', code: 'EMP-3', full_name: 'سهر', department: 'تمريض', job_title: '', since: '2026-11-01', days: { 0: T2, 1: T1, 2: T1, 3: T1, 4: T1, 5: T1, 6: T1 } }] };
(async () => {
  const people = [{ id: 'p1', admin_id: 'a1', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', job_title: 'موظف', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5, phone: '010 1234 5678' }];
  const t = await makeEnv({ people, rpc: async (fn) => {
    if (fn === 'hr_shifts_workspace') return { data: ws };
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: '2026-11-12T10:00:00Z', lookback_hours: 16, last_received_at: '2026-11-12T09:59:00Z', last_seen_at: '2026-11-12T10:00:00Z', rows: [{ device_id: 'k', device_user_id: 1, person_id: 'p1', mapped: true, full_name: 'موظف أول', code: 'EMP-1', department: 'الاستقبال', job_title: '', state: 'in', last_punch: 0, last_punch_at: '2026-11-12T09:50:00Z', last_in_at: '2026-11-12T09:00:00Z', last_out_at: null, punches: 1, minutes_since: 10 }], people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال' }], ignored: [] } };
    if (fn === 'hr_attendance_today') return { data: { day: '2026-11-12', has_schedule: true, unscheduled: 0, rows: [] } };
  } });
  const { w, d } = t;
  w.eval(fs.readFileSync('assets/js/hr-actions.js', 'utf8'));
  let profiles = 0; w.SSMPDEmployeeProfile = { open: () => { profiles++; } };
  // ---- «الآن»: «⋯» on the employee, and it does NOT open the performance file behind it
  await t.openHub('now'); await t.tick();
  const dots = d.querySelector('[data-att-hub] [data-hra="p1"]'); assert(dots, '«⋯» next to the employee on the live board');
  assert.equal(d.querySelector('[data-presence="map"] use') ? d.querySelector('[data-presence="map"] use').getAttribute('href') : '#ai-link', '#ai-link', 'fingerprint re-link uses the link icon, not a second «⋯»');
  dots.click(); await t.tick();
  const sheet = d.querySelector('[data-hra-sheet="p1"]'); assert(sheet, 'actions sheet opened'); assert.equal(profiles, 0, 'the row behind did not open the performance file');
  const labels = [...sheet.querySelectorAll('[data-hra-act]')].map(b => b.textContent);
  for (const l of ['تعديل جدول الورديات', 'تبديل وردية', 'إجازة أو إذن جديد', 'إجازاته وطلباته', 'ملف الأداء', 'فتح ملف الموظف', 'تحديث العلاقة', 'العهد', 'التأمينات', 'اتصال', 'واتساب', 'إنهاء الخدمة']) assert(labels.some(x => x.includes(l)), 'action: ' + l);
  assert(sheet.querySelector('[data-hra-act="whatsapp"]').getAttribute('href').endsWith('201012345678'), 'WhatsApp link from the HR phone');
  assert(sheet.querySelector('[data-hra-act="offboarding"]').classList.contains('danger'), 'end of service in red');
  sheet.querySelector('[data-hra-act="profile"]').click(); await t.tick(); assert.equal(profiles, 1, 'ملف الأداء opens the existing profile'); assert(!d.querySelector('[data-hra-sheet]'), 'sheet closes after an action');
  // ---- «الورديات»: one alerts line, details on demand, outlined cell, «⋯» per row
  d.querySelector('[data-att-tab=shifts]').click(); await t.tick(); await t.tick();
  const root = d.querySelector('[data-hr-shifts]'), al = root.querySelector('[data-shifts-alerts]');
  assert(al && al.tagName === 'DETAILS' && !al.open, 'one collapsed alerts line'); assert.equal(root.querySelectorAll('[data-shifts-alerts]').length, 1);
  assert(al.querySelector('summary').textContent.includes('1 تنبيه راحة') && al.querySelector('summary').textContent.includes('1 من غير جدول'), 'counts in the line');
  assert(al.querySelector('[data-shifts-conflict]').textContent.includes('سهر') && al.querySelector('[data-shifts-unscheduled]').textContent.includes('بدون جدول'), 'details inside');
  assert(!root.querySelector('.strip [data-shifts-conflict]') && !root.querySelector('.banner[data-shifts-unscheduled]'), 'the old warning stack is gone');
  const rest = root.querySelectorAll('.sc-rest'); assert.equal(rest.length, 1, 'the morning after the night shift is outlined'); assert(rest[0].title.includes('راحة أقل من 11 ساعة'));
  assert.equal(root.querySelectorAll('[data-shifts-person] [data-hra]').length, 3, '«⋯» on every row');
  const before = t.count('hr_shifts_workspace'); root.querySelector('[data-hra="p3"]').click(); await t.tick();
  d.querySelector('[data-hra-sheet="p3"] [data-hra-act="sched"]').click(); await t.tick(); await t.tick();
  assert.equal(t.count('hr_shifts_workspace'), before + 1, 'تعديل جدول الورديات uses the existing schedule editor');
  console.log('PASS hr actions + shifts alerts: «⋯» on live board / shifts grid, sheet lists the existing HR tools (shifts, swap, leave, file, contract, custody, insurance, call/WhatsApp, end of service), row click not triggered, profile + schedule editor reused; warnings in ONE collapsed line with details, short-rest cell outlined.');
})().catch(e => { console.error(e); process.exitCode = 1; });
