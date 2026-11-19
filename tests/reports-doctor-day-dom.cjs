// «حالاتي اليوم»: a linked doctor whose only report is doctor_day lands on it directly, sees no amounts and no day/doctor
// pickers; the owner/GM preview shows a doctor picker; an unlinked account sees the "not linked" notice.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
const rows = [{ time: '10:00', patient: 'أ', file_no: 'F-1', service: 'كشف', doctor: 'د', state: 'waiting', arrived: '09:55', wait_min: 5 },
  { time: '11:00', patient: 'ب', file_no: 'F-2', service: 'متابعة', doctor: 'د', state: 'booked', arrived: null, wait_min: null }];
async function mount(cat, day, canTargets) {
  const calls = [];
  const data = { report_catalog: cat, report_target_can_propose: canTargets, report_doctor_day: day };
  const dom = new JSDOM('<body><div id="v"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.SSMPDDb = { client: { rpc: (n, a) => { calls.push([n, a]); return Promise.resolve({ data: data[n] }); } } };
  w.SSMPDRoles = { label: r => r };
  w.eval(fs.readFileSync('assets/js/render-reports.js', 'utf8'));
  const host = w.document.getElementById('v');
  w.SSMPDRenderReports.render(host); await tick(); await tick();
  return { host, calls };
}
(async () => {
  const doctorCat = { reports: [{ code: 'cash_closing', title: 'الخزنة', area: 'cash', sensitive: false, allowed: false },
    { code: 'doctor_day', title: 'حالاتي اليوم', area: 'doctors', sensitive: false, allowed: true }], branches: [{ id: 'b1', name: 'ف' }] };
  let { host, calls } = await mount(doctorCat, { day: '2026-11-20', mode: 'doctor', linked: true, rows,
    totals: { patients: 2, waiting: 1, in_visit: 0, done: 0, booked: 1, no_show: 0 }, options: {} }, false);
  const c = calls.filter(x => x[0] === 'report_doctor_day').pop();
  assert.ok(c, 'doctor lands on doctor_day directly');
  assert.equal(c[1].p_doctor_key, null, 'a doctor never sends a doctor key');
  assert.match(host.textContent, /حالاتي اليوم/);
  assert.match(host.textContent, /وصل ومستني/);
  assert.equal(host.querySelector('[data-f="dockey"]'), null, 'no doctor picker for a doctor');
  assert.equal(host.querySelector('input[data-f="day"]'), null, 'no day picker for a doctor');
  assert.doesNotMatch(host.querySelector('table').textContent, /ج\.م|جنيه|EGP/, 'no money in the table');

  ({ host, calls } = await mount(doctorCat, { day: '2026-11-20', mode: 'doctor', linked: false, rows: [], totals: {}, options: {} }, false));
  assert.match(host.textContent, /حسابك لسه مش متربط/);

  const ownerCat = { reports: doctorCat.reports.map(r => Object.assign({}, r, { allowed: true })), branches: doctorCat.branches };
  ({ host, calls } = await mount(ownerCat, { day: '2026-11-20', mode: 'preview', linked: false, rows, totals: { patients: 2 },
    options: { doctors: [{ key: 'EMP-1', name: 'د. أ' }] } }, true));
  assert.ok(!calls.some(x => x[0] === 'report_doctor_day'), 'owner gets the home page, not auto-open');
  host.querySelector('[data-code="doctor_day"]').click(); await tick(); await tick();
  const sel = host.querySelector('[data-f="dockey"]');
  assert.ok(sel && /د\. أ/.test(sel.textContent), 'preview shows the doctor picker');
  sel.value = 'EMP-1'; sel.onchange(); await tick();
  assert.equal(calls.filter(x => x[0] === 'report_doctor_day').pop()[1].p_doctor_key, 'EMP-1');
  console.log('PASS reports-doctor-day-dom');
})().catch(e => { console.error(e); process.exit(1); });
