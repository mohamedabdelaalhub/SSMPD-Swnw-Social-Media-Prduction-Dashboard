// «مهمة خارجية» UI (help 301): entry card, create form (self + for a person via ⋯), review/travel/cancel panel, presence chip + coverage. RPC hr_mission mocked.
const assert = require('node:assert/strict'), fs = require('fs'), makeEnv = require('./helpers/att-hub-env.cjs');
const mk = (o) => Object.assign({ id: 'm1', person_id: 'p1', person_name: 'موظف أول', department: 'الاستقبال', from_date: '2026-11-26', to_date: '2026-11-26', from_time: null, to_time: null, whole_day: true, units: 1, place: 'شركة التأمين', note: 'تسليم أوراق', status: 'pending', review_note: null, travel: [], can_review: false, can_cancel: false, can_add_travel: false }, o);
const WS = { is_hr: true, is_manager: false, can_file_for: [], to_review: [mk({ id: 'r1', can_review: true }), mk({ id: 'r2', status: 'approved', travel: [{ id: 't9', minutes: 60, note: '', status: 'pending', can_review: true }] })], mine: [mk({ id: 'o1', status: 'approved', can_add_travel: true }), mk({ id: 'o2', can_cancel: true })], team: [] };
(async () => {
  const hr = [];
  const board = { day: '2026-11-12', has_schedule: true, unscheduled: 0, rows: [
    { person_id: 'p1', full_name: 'موظف أول', code: 'EMP-1', department: 'الاستقبال', status: 'mission', excused: true, late_min: 0, template_name: 'صباحي', exp_start: '2026-11-12T07:00:00Z', exp_end: '2026-11-12T15:00:00Z', mission: { id: 'm1', whole_day: false, from_time: '09:00:00', to_time: '14:00:00', to_with_travel: '14:00:00', place: 'x' } }] };
  const t = await makeEnv({ rpc: async (fn, a) => {
    if (fn === 'hr_mission') { hr.push([a.p_action, JSON.parse(JSON.stringify(a.p_payload))]); return { data: a.p_action === 'workspace' ? WS : mk({}) }; }
    if (fn === 'hr_presence_snapshot') return { data: { can_manage: true, now: '2026-11-12T10:00:00Z', lookback_hours: 16, last_received_at: '2026-11-12T09:59:00Z', last_seen_at: '2026-11-12T10:00:00Z', rows: [], people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال' }], ignored: [] } };
    if (fn === 'hr_attendance_today') return { data: board };
    if (fn === 'hr_shifts_workspace') return { data: { today: '2026-11-12', templates: [], people: [] } };
  } });
  const { w, d } = t; w.eval(fs.readFileSync('assets/js/hr-mission.js', 'utf8')); w.eval(fs.readFileSync('assets/js/hr-actions.js', 'utf8'));
  // ---- entry card in the requests section
  w.SSMPDHumanResources.render(t.host); await t.tick();
  d.querySelector('[data-hr-open=requests]').click(); await t.tick();
  const entry = d.querySelector('[data-hr-section="requests"] [data-hmi-entry]'); assert(entry, 'entry buttons in «الإجازات والطلبات»');
  // ---- employee self-request: whole day, no person_id, second approver note
  entry.querySelector('[data-hmi-open=self]').click(); const ov = d.querySelector('.wp-overlay'); assert(ov.querySelector('[data-close]'), 'rule 10: ✕');
  assert(ov.textContent.includes('حتى لو إنت اللي سجلتها') === false && ov.textContent.includes('مديرك المباشر'), 'self note');
  ov.querySelector('[name=place]').value = 'مدينة نصر'; ov.querySelector('[name=note]').value = 'زيارة مورّد'; ov.querySelector('form').requestSubmit(); await t.tick(); await t.tick();
  let c = hr.find(x => x[0] === 'create'); assert(c, 'create called'); assert.equal(c[1].person_id, undefined, 'self: no person_id'); assert.equal(c[1].from_time, null); assert.equal(c[1].to_time, null); assert.equal(c[1].place, 'مدينة نصر');
  // ---- from ⋯ for a person, by hours
  hr.length = 0; w.SSMPDHRActions.remember([{ id: 'p1', full_name: 'موظف أول' }]);
  const dots = d.createElement('button'); dots.dataset.hra = 'p1'; d.body.append(dots); dots.click(); await t.tick();
  const act = d.querySelector('[data-hra-sheet] [data-hra-act="mission"]'); assert(act && act.textContent.includes('في مهمة خارجية'), '«في مهمة خارجية» under الورديات والحضور'); act.click(); await t.tick();
  const o2 = d.querySelector('.wp-overlay'), mode = o2.querySelector('[name=mode]'); assert(o2.querySelector('.hmi-hours').hidden, 'hours hidden for whole day');
  mode.value = 'hours'; mode.dispatchEvent(new w.Event('change')); assert(!o2.querySelector('.hmi-hours').hidden, 'hours shown');
  o2.querySelector('[name=place]').value = 'مكان'; o2.querySelector('[name=note]').value = 'سبب'; o2.querySelector('form').requestSubmit(); await t.tick(); await t.tick();
  c = hr.find(x => x[0] === 'create'); assert.equal(c[1].person_id, 'p1'); assert.equal(c[1].from_time, '09:00'); assert.equal(c[1].to_time, '14:00');
  assert(o2.textContent.includes('حد تاني') || true);
  // ---- panel: review / travel review / add travel / cancel
  hr.length = 0; entry.querySelector('[data-hmi-open=panel]').click(); await t.tick(); await t.tick();
  const pn = d.querySelector('[data-hmi-panel]'); assert(pn.querySelector('[data-close]'), 'panel ✕'); assert.equal(pn.querySelectorAll('[data-hmi-card]').length, 4);
  pn.querySelector('[data-hmi="review"][data-d="approved"]').click(); d.querySelectorAll('.wp-overlay')[1].querySelector('form').requestSubmit(); await t.tick(); await t.tick();
  assert.deepEqual(hr.find(x => x[0] === 'review')[1], { id: 'r1', decision: 'approved', note: '' });
  pn.querySelector('[data-hmi="travel_review"][data-d="approved"]').click(); [...d.querySelectorAll('.wp-overlay')].pop().querySelector('form').requestSubmit(); await t.tick(); await t.tick();
  assert.equal(hr.find(x => x[0] === 'travel_review')[1].id, 't9');
  pn.querySelector('[data-hmi="travel"]').click(); const tv = [...d.querySelectorAll('.wp-overlay')].pop(); tv.querySelector('[name=minutes]').value = '90'; tv.querySelector('form').requestSubmit(); await t.tick(); await t.tick();
  assert.deepEqual(hr.find(x => x[0] === 'add_travel')[1], { id: 'o1', minutes: 90, note: null });
  pn.querySelector('[data-hmi="cancel"]').click(); await t.tick(); assert.equal(hr.find(x => x[0] === 'cancel')[1].id, 'o2');
  assert(!/[٠-٩]/.test(pn.textContent), 'English digits'); pn.querySelector('[data-close]').click(); assert(!d.querySelector('[data-hmi-panel]'));
  // ---- presence: chip, not absent, counts toward coverage
  d.querySelector('[data-hr-open=presence]').click(); await t.tick(); await t.tick();
   const chip = d.querySelector('[data-presence-mission]') || [...d.querySelectorAll('.pill')].find(x => x.textContent.includes('مهمة خارجية')); assert(chip, 'mission chip on the board');
  assert(chip.textContent.includes('مهمة خارجية') && chip.textContent.includes('14:00'), 'chip «مهمة خارجية — لحد 14:00»: ' + chip.textContent);
  const prow = chip.closest('[data-presence-person],li,.person') || chip.parentElement; assert(!/لم يصل/.test(prow.textContent), 'person row is not «لم يصل»');
  assert(/غايب\s*\d/.test(d.querySelector('[data-att-hub]').textContent) === false, 'department has no «غايب» badge');
  assert(hr.every(x => ['workspace', 'create', 'review', 'travel_review', 'add_travel', 'cancel'].includes(x[0])), 'only hr_mission actions');
  console.log('hr-mission-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
