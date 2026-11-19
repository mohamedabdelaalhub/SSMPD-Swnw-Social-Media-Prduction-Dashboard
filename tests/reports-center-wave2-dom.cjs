// Wave 2 of the «التقارير» tab: as-of reports default to today and pass p_as_of; adjustments map kinds/statuses to Arabic.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
(async () => {
  const calls = [];
  const catalog = { reports: [
    { code: 'deferred_revenue', title: 'الجلسات المتبقية', area: 'cash', sensitive: false, allowed: true },
    { code: 'adjustments_log', title: 'التعديلات', area: 'cash', sensitive: false, allowed: true },
    { code: 'slot_occupancy', title: 'الإشغال', area: 'operations', sensitive: false, allowed: true },
    { code: 'ar_aging', title: 'أعمار ديون الجهات', area: 'insurance', sensitive: false, allowed: true }],
    branches: [{ id: 'b1', name: 'حدائق الأهرام' }], is_owner: false };
  const data = {
    report_catalog: catalog,
    report_deferred_revenue: { as_of: '2026-11-19', rows: [{ branch: 'حدائق الأهرام', patient_file: 'F-1', package: 'باقة', purchased: '2026-11-01', expires_on: '2026-12-01', status: 'frozen', contract_price: 1000, funded: 600, recognized: 200, sessions_total: 5, sessions_used: 1, sessions_left: 4, remaining_value: 800, days_to_expiry: 12 }],
      totals: { packages: 1, contract: 1000, funded: 600, recognized: 200, remaining_value: 800, sessions_left: 4, expiring_30: 1 } },
    report_adjustments_log: { rows: [{ day: '2026-11-18', branch: 'حدائق الأهرام', kind: 'credit_note', amount: 120, reason: 'سبب', requested_by: 'أ', reviewed_by: null, status: 'pending' }],
      by_kind: [{ kind: 'credit_note', count: 1, amount: 120, approved: 0 }], totals: { count: 1, amount: 120, approved: 0, pending: 1 } },
    report_ar_aging: { as_of: '2026-11-19', rows: [{ entity: 'نقابة', entity_kind: 'insurer', claims: 2, b0_30: 100, b31_60: 0, b61_90: 0, b90_plus: 50, total: 150, allowance: 0, oldest_days: 95 }], totals: { claims: 2, b0_30: 100, b31_60: 0, b61_90: 0, b90_plus: 50, total: 150, allowance: 0 } },
    report_slot_occupancy: { rows: [{ doctor: 'د', specialty: 'س', available_hours: 10, booked_hours: 5, appointments: 6, occupancy: 50 }], totals: { available_hours: 10, booked_hours: 5, appointments: 6, occupancy: 50 } } };
  const dom = new JSDOM('<body><div id="v"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.SSMPDDb = { client: { rpc: (n, a) => { calls.push([n, a]); return Promise.resolve({ data: data[n] }); } } };
  w.SSMPDRoles = { label: r => r };
  w.eval(fs.readFileSync('assets/js/render-reports.js', 'utf8'));
  const host = w.document.getElementById('v');
  w.SSMPDRenderReports.render(host); await tick();
  const open = async code => { host.querySelector('[data-code="' + code + '"]').click(); await tick(); };

  await open('deferred_revenue');
  const call = calls.filter(c => c[0] === 'report_deferred_revenue').pop();
  const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.equal(call[1].p_as_of, today, 'as-of report defaults to today');
  assert.equal(call[1].p_branch, 'b1');
  assert.match(host.textContent, /لحد يوم/);
  assert.match(host.textContent, /متجمدة/, 'package status label');
  assert.match(host.querySelector('tfoot').textContent, /800/);

  host.querySelector('.rc-back, [data-act="back"]') ? host.querySelector('.rc-back, [data-act="back"]').click() : w.SSMPDRenderReports.render(host);
  await tick();
  await open('adjustments_log');
  assert.match(host.textContent, /إشعار دائن/);
  assert.match(host.textContent, /مستني موافقة/);

  w.SSMPDRenderReports.render(host); await tick();
  await open('slot_occupancy');
  assert.match(host.querySelector('tfoot').textContent, /50%/, 'percent footer');
  w.SSMPDRenderReports.render(host); await tick();
  assert.match(host.textContent, /التأمين والتعاقدات/, 'insurance area group');
  await open('ar_aging');
  const ac = calls.filter(c => c[0] === 'report_ar_aging').pop();
  assert.equal(ac[1].p_as_of, today);
  assert.match(host.textContent, /تأمين \/ نقابة/);
  assert.match(host.querySelector('tfoot').textContent, /150/);
  console.log('PASS reports-center-wave2-dom');
})().catch(e => { console.error(e); process.exit(1); });
