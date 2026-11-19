// Wave 2 of the «التقارير» tab: as-of reports default to today and pass p_as_of; adjustments map kinds/statuses to Arabic.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
(async () => {
  const calls = [];
  const catalog = { reports: [
    { code: 'deferred_revenue', title: 'الجلسات المتبقية', area: 'cash', sensitive: false, allowed: true },
    { code: 'adjustments_log', title: 'التعديلات', area: 'cash', sensitive: false, allowed: true },
    { code: 'slot_occupancy', title: 'الإشغال', area: 'operations', sensitive: false, allowed: true },
    { code: 'ar_aging', title: 'أعمار ديون الجهات', area: 'insurance', sensitive: false, allowed: true },
    { code: 'branch_pnl', title: 'قائمة الدخل', area: 'statements', sensitive: false, allowed: true },
    { code: 'stock_shortage_expiry', title: 'النواقص', area: 'stock', sensitive: false, allowed: true },
    { code: 'targets_vs_actual', title: 'التارجت', area: 'marketing', sensitive: false, allowed: true }],
    branches: [{ id: 'b1', name: 'حدائق الأهرام' }], is_owner: false };
  const data = {
    report_catalog: catalog,
    report_deferred_revenue: { as_of: '2026-11-19', rows: [{ branch: 'حدائق الأهرام', patient_file: 'F-1', package: 'باقة', purchased: '2026-11-01', expires_on: '2026-12-01', status: 'frozen', contract_price: 1000, funded: 600, recognized: 200, sessions_total: 5, sessions_used: 1, sessions_left: 4, remaining_value: 800, days_to_expiry: 12 }],
      totals: { packages: 1, contract: 1000, funded: 600, recognized: 200, remaining_value: 800, sessions_left: 4, expiring_30: 1 } },
    report_adjustments_log: { rows: [{ day: '2026-11-18', branch: 'حدائق الأهرام', kind: 'credit_note', amount: 120, reason: 'سبب', requested_by: 'أ', reviewed_by: null, status: 'pending' }],
      by_kind: [{ kind: 'credit_note', count: 1, amount: 120, approved: 0 }], totals: { count: 1, amount: 120, approved: 0, pending: 1 } },
    report_ar_aging: { as_of: '2026-11-19', rows: [{ entity: 'نقابة', entity_kind: 'insurer', claims: 2, b0_30: 100, b31_60: 0, b61_90: 0, b90_plus: 50, total: 150, allowance: 0, oldest_days: 95 }], totals: { claims: 2, b0_30: 100, b31_60: 0, b61_90: 0, b90_plus: 50, total: 150, allowance: 0 } },
    report_branch_pnl: { rows: [{ section: 'revenue', group: 'الإيرادات', account: '4110', name: 'إيراد', current: 1000, previous: 800 }], totals: { revenue: 1000, revenue_prev: 800, cost: 300, cost_prev: 200, gna: 100, gna_prev: 100, other: 0, other_prev: 0, gross: 700, gross_prev: 600, net: 600, net_prev: 500 }, unallocated: { revenue: 0, expense: 250 }, unposted: 2 },
    report_stock_shortage_expiry: { as_of: '2026-11-19', rows: [{ item: 'جوانتي', category: 'م', unit: 'علبة', on_hand: 8, minimum: 20, gap: 12 }], expiry: [{ item: 'دوا', lot: 'L1', location: 'الادوية', quantity: 3, expiry_date: '2026-11-01', days_left: -18 }], totals: { short_items: 1, expired_lots: 1, expiring_lots: 0 } },
    report_targets_vs_actual: { month: '2026-11-01', rows: [{ owner: 'الفرع', label: 'صافي إيراد الفرع', unit: 'money', target: 1000, actual: 800, achievement: 80 }], totals: { targets: 1, met: 0, avg_achievement: 80 } },
    report_target_can_propose: true,
    report_targets_admin: { month: '2026-11-01', is_approver: false, editors: [], targets: [], metrics: [{ key: 'bookings', meta: { label: 'حجوزات', scope: 'person' } }], people: [{ id: 'p1', name: 'س', role: 'reception' }], branches: [{ id: 'b1', name: 'ف' }] },
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
  w.SSMPDRenderReports.render(host); await tick();
  await open('branch_pnl');
  assert.match(host.textContent, /غير مُرحّل/, 'unposted warning');
  assert.match(host.textContent, /مش متوزعة على فرع/, 'unallocated note');
  assert.match(host.querySelector('tfoot').textContent, /صافي الربح/);
  assert.match(w.SSMPDRenderReports.buildCsv ? 'ok' : '', /ok/);
  w.SSMPDRenderReports.render(host); await tick();
  await open('stock_shortage_expiry');
  assert.match(host.textContent, /الصلاحية/, 'expiry table rendered');
  assert.match(host.textContent, /خلصت/, 'expired lot label');
  w.SSMPDRenderReports.render(host); await tick();
  assert.match(host.textContent, /التسويق والتارجت/);
  await open('targets_vs_actual');
  assert.match(host.textContent, /80%/);
  const th = w.document.createElement('div'); w.document.body.appendChild(th);
  await w.SSMPDRenderReports.mountTargets(th); await tick();
  assert.match(th.textContent, /مفيش تارجت للشهر ده لسه/);
  th.querySelector('[data-t="who"]').value = 'admin:p1'; th.querySelector('[data-t="target"]').value = '12';
  th.querySelector('[data-t-save]').click(); await tick();
  const setCall = calls.filter(c => c[0] === 'report_targets_admin' && c[1].p_action === 'set').pop();
  assert.equal(setCall[1].p_payload.admin_id, 'p1'); assert.equal(setCall[1].p_payload.metric, 'bookings'); assert.equal(setCall[1].p_payload.month, '2026-11-01');
  assert.match(th.textContent, /اقتراح التارجت/, 'non-approver proposes');
  assert.equal(th.querySelectorAll('[data-appr]').length, 0, 'no approve buttons for proposers');
  w.SSMPDRenderReports.render(host); await tick(60);
  assert.ok(host.querySelector('.rc-open-targets'), 'targets entry on reports home for proposers');
  console.log('PASS reports-center-wave2-dom');
})().catch(e => { console.error(e); process.exit(1); });
