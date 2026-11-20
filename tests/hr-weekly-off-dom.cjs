// «الإجازة الأسبوعية» entry points: (1) a tap on an employee card in «الحضور والورديات» (it used to do nothing), (2) the «الإجازة الأسبوعية» button
// in the employee's HR profile, both open the weekly schedule dialog whose day-off option reads «إجازة أسبوعية»; (3) doctors / ended staff get no button.
const assert = require('node:assert/strict'), makeEnv = require('./helpers/att-hub-env.cjs');
const T1 = '11111111-1111-4111-8111-111111111111';
const people = [
  { id: 'p1', admin_id: 'a1', full_name: 'موظفة اختبار', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', status: 'active', revision: 1, leave_balance: 30, phone: '0100000000' },
  { id: 'p2', admin_id: null, full_name: 'طبيب اختبار', code: 'EMP-2', kind: 'doctor', department: '', status: 'active', revision: 1, leave_balance: 0, phone: '' }];
const ws = { can_manage: true, today: '2026-11-20', templates: [{ id: T1, name: 'صباحي', start_time: '08:00', end_time: '16:00', grace_minutes: 15, color: '#0F369D', active: true, overnight: false }],
  people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظفة اختبار', department: 'الاستقبال', job_title: 'موظفة', since: '2026-11-01', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: T1, 5: null, 6: null } }] };
(async () => {
  const t = await makeEnv({ people, rpc: async (fn) => { if (fn === 'hr_shifts_workspace') return { data: ws }; if (fn === 'hr_shifts_command') return { data: 'ok' }; } });
  const { w, d } = t, toasts = () => w.__toasts || [];
  w.SSMPDHumanResources.render(t.host); await t.tick();
  // ---- 1) the cards in «الحضور والورديات»
  d.querySelector('[data-hr-open=attendance]').click(); await t.tick(); await t.tick();
  const sec = d.querySelector('[data-hr-section=attendance]'), cards = [...sec.querySelectorAll('[data-hrp-sched]')];
  assert.equal(cards.length, 2, 'every employee card is tappable'); assert(sec.textContent.includes('اضغط على أي موظف'), 'the hint tells the user to tap');
  cards[0].click(); await t.tick(); await t.tick();
  let f = d.querySelector('.wp-modal form'); assert(f, 'tap opens the schedule dialog'); assert(d.querySelector('.wp-modal').textContent.includes('جدول موظفة اختبار'));
  assert.deepEqual([...f.elements.d5.options].map(o => o.textContent.trim()).slice(0, 2), ['إجازة أسبوعية', 'صباحي (08:00 → 16:00)'], 'the day-off option is «إجازة أسبوعية»');
  assert.equal(f.elements.d5.value, '', 'Friday is the weekly day off'); assert(!/>\s*راحة\s*</.test(d.querySelector('.wp-modal').innerHTML), 'no old «راحة» label');
  f.elements.d6.value = T1; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await t.tick(); await t.tick();
  const saved = t.calls.filter(c => c[0] === 'hr_shifts_command').pop()[1];
  assert.deepEqual(saved, { p_action: 'schedule_save', p_payload: { person_id: 'p1', days: { 0: T1, 1: T1, 2: T1, 3: T1, 4: T1, 5: null, 6: T1 }, valid_from: '2026-11-20' } });
  assert(toasts().some(x => String(x[0]).includes('تم حفظ جدول')), 'saved confirmation'); assert(!d.querySelector('.wp-modal'), 'dialog closed');
  // keyboard
  cards[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await t.tick(); await t.tick(); assert(d.querySelector('.wp-modal form'), 'Enter opens it too');
  // a person outside the schedule list (a doctor) → explained, nothing opens
  [...d.querySelectorAll('.wp-overlay')].forEach(n => n.remove()); const doc = d.querySelectorAll('[data-hrp-sched]')[1]; doc.click(); await t.tick(); await t.tick(); assert(!d.querySelector('.wp-modal'), 'no dialog for a doctor'); assert(toasts().some(x => x[1] === 'error' && String(x[0]).includes('الإداريين')), 'explained');
  // ---- 2) the HR profile button
  d.querySelector('[data-hr-open=people]').click(); await t.tick();
  const open = id => { const c = [...d.querySelectorAll('[data-wp=person]')].find(x => x.dataset.id === id); c.click(); };
  open('p1'); await t.tick(); await t.tick();
  const btn = d.querySelector('[data-wp=weekly-off]'); assert(btn && btn.textContent.includes('الإجازة الأسبوعية') && btn.dataset.id === 'p1', 'profile button for staff');
  btn.click(); await t.tick(); await t.tick(); assert(d.querySelector('.wp-modal form') && d.querySelector('.wp-modal').textContent.includes('جدول موظفة اختبار'), 'the button opens the same dialog');
  [...d.querySelectorAll('.wp-overlay')].forEach(n => n.remove());
  open('p2'); await t.tick(); await t.tick(); assert(!d.querySelector('[data-wp=weekly-off]'), 'no button for a doctor');
  console.log('PASS weekly day off: employee cards in «الحضور والورديات» and the HR profile button open the weekly schedule dialog («إجازة أسبوعية»); doctors are explained, not offered.');
})().catch(e => { console.error(e); process.exit(1); });
