// «ربح كل خدمة بعد المستلزمات» in the reports center (render-reports.js), as the financial manager (mocked rpc): card opens, the RPC is
// called with the period, columns incl. «بعد أتعاب الدكتور», statuses in words, below-supplies negative in red, tiles, notices
// (period before 24-11, «ناقص»), the sold-extras table and the per-service supplies <details>. A locked card for a role without access.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const mk = (rpcImpl) => { const dom = new JSDOM('<body><div id="v"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.SSMPDDb = { client: { rpc: (n, a) => Promise.resolve(rpcImpl(n, a)) } }; w.SSMPDRoles = { label: r => r };
    w.eval(fs.readFileSync('assets/js/render-reports.js', 'utf8')); return w; };
  const cat = allowed => ({ reports: [{ code: 'service_profit', title: 'ربح كل خدمة بعد المستلزمات', area: 'profitability', sensitive: true, allowed }], branches: [{ id: 'b1', name: 'حدائق الأهرام' }], is_owner: false });
  const data = { costs_from: '2026-11-24',
    rows: [{ service: 'غيار', specialty: 'تمريض', orders: 1, revenue: 50, supplies: 70, per_visit: 70, bom_per_visit: 60, margin: -20, margin_pct: -40, doctor_fees: 0, net_margin: -20, net_margin_pct: -40, status: 'below', missing: 0 },
      { service: 'محلول', specialty: 'تمريض', orders: 3, revenue: 290, supplies: 120, per_visit: 60, bom_per_visit: 66.67, margin: 170, margin_pct: 58.6, doctor_fees: 65, net_margin: 105, net_margin_pct: 36.2, status: 'missing', missing: 1 },
      { service: 'كشف', specialty: 'عيادات', orders: 2, revenue: 600, supplies: 0, per_visit: null, bom_per_visit: 0, margin: 600, margin_pct: 100, doctor_fees: 200, net_margin: 400, net_margin_pct: 66.7, status: 'no_supplies', missing: 0 }],
    items: { 'محلول': [{ item: 'سِت محلول', unit: 'قطعة', qty: 2, cost: 120 }] },
    sold: [{ kind: 'medicines', qty: 3, sale: 45, cost: 30, profit: 15, pct: 33.3 }],
    totals: { orders: 6, revenue: 940, supplies: 190, bom: 200, doctor_fees: 265, margin: 750, net_margin: 485, margin_pct: 79.8, net_margin_pct: 51.6, below: 1, missing: 1 } };
  const calls = [];
  const w = mk((n, a) => { calls.push([n, a]); if (n === 'report_catalog') return { data: cat(true) }; if (n === 'report_service_profit') return { data }; return { data: {} }; });
  const v = w.document.getElementById('v'); w.SSMPDRenderReports.render(v); await tick();
  v.querySelector('[data-code="service_profit"]').click(); await tick();
  const c = calls.filter(x => x[0] === 'report_service_profit').pop(); assert.ok(c, 'rpc called'); assert.ok(c[1].p_from && c[1].p_to, 'period sent');
  const heads = [...v.querySelectorAll('thead th')].map(t => t.textContent);
  ['الخدمة', 'مستلزمات فعلي', 'المفروض للزيارة', 'بعد المستلزمات', 'أتعاب الدكتور', 'بعد أتعاب الدكتور', 'الحالة'].forEach(h => assert.ok(heads.includes(h), h));
  const body = v.querySelector('tbody').textContent;
  assert.match(body, /السعر أقل من المستلزمات/); assert.match(body, /ناقص استهلاك/); assert.match(body, /مالهاش مستلزمات/);
  assert.ok(v.querySelector('tbody td.rc-negc'), 'negative margin red');
  assert.match(v.querySelector('tfoot').textContent, /الإجمالي[\s\S]*940/);
  assert.match(v.textContent, /الهامش بعد المستلزمات/); assert.match(v.textContent, /بعد أتعاب الدكتور/);
  assert.match(v.textContent, /المستلزمات اللي بتتباع للمريض[\s\S]*أدوية[\s\S]*33\.3%/);
  const det = v.querySelector('details.rc-svc'); assert.ok(det); assert.match(det.querySelector('summary').textContent, /محلول — 120/); assert.match(det.textContent, /سِت محلول/);
  assert.match(v.textContent, /ناقص استهلاك» = زيارة/);
  // a role without access: the card is locked and the RPC is never called
  const calls2 = []; const w2 = mk((n, a) => { calls2.push(n); return n === 'report_catalog' ? { data: cat(false) } : { data: {} }; });
  const v2 = w2.document.getElementById('v'); w2.SSMPDRenderReports.render(v2); await tick();
  assert.equal(v2.querySelectorAll('.rc-locked').length, 1); assert.ok(!calls2.includes('report_service_profit'));
  console.log('PASS service profit report UI (financial manager): columns incl. after doctor fees, statuses, red negatives, tiles, notices, sold extras, per-service supplies; locked for others');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
