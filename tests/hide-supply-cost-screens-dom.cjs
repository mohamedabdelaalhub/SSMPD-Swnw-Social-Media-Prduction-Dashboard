// 20261128140000 (owner 2026-11-28 «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن»): head-nursing reports and the
// store screen of nursing / reception staff, with the reply the server now sends them (no cost keys, can_see_cost:false).
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const mk = rpcImpl => { const dom = new JSDOM('<body><div id="v"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.SSMPDDb = { client: { rpc: (n, a) => Promise.resolve(rpcImpl(n, a)) } }; w.SSMPDRoles = { label: r => r };
    w.eval(fs.readFileSync('assets/js/render-reports.js', 'utf8')); return w; };
  const catalog = { reports: [{ code: 'supplies_consumption', title: 'استهلاك المستلزمات', area: 'stock', allowed: true },
    { code: 'medicines_consumption', title: 'استهلاك الأدوية', area: 'stock', allowed: true }, { code: 'nursing_variance', title: 'فروق التمريض', area: 'stock', allowed: true }],
    branches: [{ id: 'b1', name: 'حدائق الأهرام' }], is_owner: false };
  const full = {
    report_supplies_consumption: { rows: [{ location: 'فرعي تمريض', item: 'جلافز M', unit: 'قطعة', included_qty: 4, sold_qty: 0, issued_qty: 1, loss_qty: 0, cost: 777.25, sales: 0 }], by_service: [{ service: 'كشف', orders: 2, cost: 777.25 }], totals: { cost: 777.25, included_cost: 600, loss_cost: 11, items: 1, sales: 0 } },
    report_medicines_consumption: { rows: [{ location: 'صيدلية', item: 'باراسيتامول', unit: 'قرص', included_qty: 3, included_cost: 777.25, sold_qty: 1, sold_cost: 31, sales: 40, margin: 9, wasted_qty: 0 }], totals: { included_cost: 777.25, sold_cost: 31, sales: 40, margin: 9 } },
    report_nursing_variance: { rows: [{ item: 'جلافز M', unit: 'قطعة', orders: 2, expected: 4, in_services: 4, outside: 2, variance: 2, variance_value: 777.25 }], totals: { variance_value: 777.25, over_items: 1, under_items: 0 } } };
  const KEYS = ['cost', 'included_cost', 'loss_cost', 'sold_cost', 'margin', 'variance_value'];
  const strip = j => Array.isArray(j) ? j.map(strip) : j && typeof j === 'object' ? Object.fromEntries(Object.entries(j).filter(([k]) => !KEYS.includes(k)).map(([k, v]) => [k, strip(v)])) : j;
  for (const who of ['head_nursing', 'accountant']) for (const code of catalog.reports.map(r => r.code)) {
    const w = mk((n) => n === 'report_catalog' ? { data: catalog } : full[n] ? { data: who === 'accountant' ? Object.assign({ can_see_cost: true }, full[n]) : Object.assign(strip(full[n]), { can_see_cost: false }) } : { data: {} });
    const v = w.document.getElementById('v'); w.SSMPDRenderReports.render(v); await tick();
    v.querySelector('[data-code="' + code + '"]').click(); await tick();
    const t = v.textContent;
    if (who === 'accountant') assert.match(t, /777\.25/, code + ' accountant sees cost');
    else { assert.doesNotMatch(t, /777|تكلفة اللي خرج|تكلفة المباع|ربح البيع|قيمة الفرق|تكلفة المستلزمات لكل إجراء/, code + ' head nursing sees no cost: ' + t.slice(0, 300));
      assert.doesNotMatch([...v.querySelectorAll('thead th')].map(x => x.textContent).join('|'), /التكلفة|تكلفته|الربح|قيمة الفرق/, code + ' no cost column');
      assert.ok(v.querySelectorAll('tbody tr').length >= 1, code + ' rows still there (quantities)'); }
  }
  // store screen (render-inventory.js): movements table without «التكلفة» / «الربح» for staff without cost
  const src = fs.readFileSync('assets/js/render-inventory.js', 'utf8');
  assert.match(src, /function noCost\(\)\{return !!\(state\.data&&state\.data\.can_see_cost===false\);\}/);
  assert.match(src, /concat\(noCost\(\)\?\['سعر البيع'\]:\['التكلفة','سعر البيع','الربح'\]/);
  assert.match(src, /\(noCost\(\)\?'':'<td>'\+fmt\(m\.unit_cost\)\+'<\/td>'\)/);
  assert.match(src, /\(noCost\(\)\?'':' — '\+\(r\.request_type==='purchase'\?'سعر شراء':'تكلفة تقديرية'\)/);
  console.log('PASS cost hidden on screens: supplies / medicines / nursing-variance reports for head nursing (no cost column, tile or per-service cost table; quantities stay), accountant still sees cost; store movements / requests without cost for staff.');
})().catch(e => { console.error(e); process.exit(1); });
