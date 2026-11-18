// «الملخص العام» v2 (owner-approved mockup 2026-11-18): «محتاج منك» first and sorted, tiles 4/2/1 from real data only,
// content journey without empty stages, specialty filter, social trend, ads as cards, other modules, role-aware pieces,
// the original sections load only when «كل التفاصيل والأرشيف» opens, and no text wraps / nothing scrolls sideways.
const fs = require('fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const NOW = Date.parse('2026-11-18T14:00:00Z'), H = 36e5, D = 24 * H, iso = ms => new Date(NOW - ms).toISOString();
const item = (id, stage, o) => Object.assign({ id, title: 'مادة ' + id, stage, specialty: 'internal', created_at: iso(5 * D), updated_at: iso(H), published_at: null, stage_history: [{ stage: 'idea_selection', at: iso(5 * D) }, { stage, at: iso(H) }] }, o || {});
const items = [
  item('a1', 'initial_approval', { stage_history: [{ stage: 'initial_approval', at: iso(3 * D) }] }), item('a2', 'initial_approval'), item('a3', 'final_approval'),
  item('d1', 'in_design', { title: 'عروض الأسنان', specialty: 'surgery', stage_history: [{ stage: 'in_design', at: iso(4 * D) }] }), item('i1', 'idea_selection'), item('r1', 'ready_to_publish'),
  item('p1', 'published', { published_at: iso(2 * D), stage_history: [{ stage: 'idea_selection', at: iso(6 * D) }, { stage: 'in_design', at: iso(5 * D) }, { stage: 'published', at: iso(2 * D) }], created_at: iso(6 * D) }),
  item('p2', 'published', { published_at: iso(3 * D) }), item('p3', 'published', { published_at: iso(10 * D) })
];
const metrics = Array.from({ length: 9 }, (_, i) => ({ week_start: new Date(NOW - i * 7 * D).toISOString().slice(0, 10), reach: 1000 + (8 - i) * 50, engagement_rate: 3 + (i ? 0.3 : 0), new_followers: 20 - i }));
const ads = Array.from({ length: 7 }, (_, i) => ({ report_batch_id: 'b2', created_at: iso(H), campaign_name: 'حملة رقم ' + (i + 1), amount_spent: 100 * (i + 1), results: 10 * (i + 1), result_indicator: 'actions:link_click', cost_per_result: 10, reporting_start: '2026-11-01', reporting_end: '2026-11-15' })).concat([{ report_batch_id: 'b1', created_at: iso(30 * D), campaign_name: 'قديمة', amount_spent: 9999 }]);
const snap = { alerts: [{ severity: 'medium', title: 'إشارة إدارية', detail: 'تفصيل' }], recommendations: { pending: 2 }, tasks: { overdue: 1, review: 3 }, leads: { total: 18, booked: 4, conversion: 22.2 }, operations: { open_issues: 0 } };
async function open(browser, width, roleName) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: process.env.SV_QA_SHOTS ? 2 : 1 }), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://sv.test/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="view-container" style="padding:16px"></main></html>' }));
  await page.goto('https://sv.test/'); for (const f of ['styles', 'summary-v2']) await page.addStyleTag({ content: fs.readFileSync('assets/css/' + f + '.css', 'utf8') });
  await page.addScriptTag({ content: `(function(){const RD=Date,t0=${NOW};window.Date=class extends RD{constructor(...a){if(a.length)super(...a);else super(t0)}static now(){return t0}};})();
   window.ROLE=${JSON.stringify(roleName)};window.gone=[];window.legacy=0;window.SSMPDGotoTab=t=>gone.push(t);
   window.SSMPDAuth={currentAdmin:{id:'me',role:ROLE}};window.SSMPDRoles={hasAnyRole:(a,l)=>l.includes(a.role),canSeeTab:()=>true};
   const DATA=${JSON.stringify({ items, metrics, ads, snap })};
   window.SSMPDDb={listContentItems:async()=>DATA.items,listWeeklyMetrics:async()=>DATA.metrics,listAdCampaigns:async()=>DATA.ads,getLeadsStats:async()=>({open:9}),listLeads:async()=>({leads:[{created_at:new Date(${NOW}-50*36e5).toISOString()},{created_at:new Date(${NOW}-30*36e5).toISOString()},{created_at:new Date(${NOW}-2*36e5).toISOString()}]}),getPatientArchiveStats:async()=>({pending_review:2}),getAppSettings:async()=>({}),client:{rpc:async n=>n==='business_owner_snapshot'?{data:DATA.snap}:{data:null}}};` });
  for (const f of ['workflow', 'render-summary']) await page.addScriptTag({ content: fs.readFileSync('assets/js/' + f + '.js', 'utf8') });
  await page.evaluate(() => { window.SSMPDRenderSummaryBase.render = el => { window.legacy++; el.innerHTML = '<p data-legacy-ok>legacy</p>'; }; });
  await page.addScriptTag({ content: fs.readFileSync('assets/js/summary-v2.js', 'utf8') });
  await page.evaluate(() => SSMPDRenderSummary.render(document.querySelector('#view-container'))); await page.waitForSelector('.sv-k'); await page.waitForTimeout(400);
  return { page, errors };
}
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); try {
    for (const width of [1280, 1000, 800, 390]) {
      const { page, errors } = await open(browser, width, 'super_admin');
      // «محتاج منك»: late leads first, then approvals (one overdue → urgent), design stuck, tasks, recommendations, other alerts
      const need = await page.$$eval('.sv-row b', b => b.map(x => x.textContent));
      assert.equal(need[0], 'ليدين مستنيين رد', 'late leads first (older than 24h only): ' + need);
      assert.equal(need[1], '3 مواد مستنية اعتمادك');
      assert(need.includes('مادة واقفة في التصميم') && need.includes('2 توصيات مستنية قرارك') && need.includes('مهمة متأخرة') && need.includes('إشارة إدارية'), need.join('|'));
      assert.match(await page.textContent('.sv-need-list li:nth-child(2) small'), /2 اعتماد أولي · 1 اعتماد نهائي · 1 متأخرة/);
      // tiles 4/2/1 with real numbers
      const rows = await page.$$eval('.sv-k', k => { const r = {}; k.forEach(x => { const t = Math.round(x.getBoundingClientRect().top); r[t] = (r[t] || 0) + 1; }); return Object.values(r); });
      assert.deepEqual(rows, width >= 1000 ? [4] : width >= 700 ? [2, 2] : [1, 1, 1, 1], 'tiles ' + width + ': ' + rows);
      const vals = await page.$$eval('.sv-k b bdi', b => b.map(x => x.textContent));
      assert.deepEqual(vals, ['2', '3', '18', '2,800.00'], 'published this week, waiting approval, leads, latest ad report spend (old report ignored)');
      assert.match(await page.textContent('.sv-k:nth-child(1) i'), /↑ 1 عن الفترة اللي فاتت/);
      // journey: no empty stages, delay dot on design, average journey
      const stages = await page.$$eval('[data-sv-journey] [data-sv-stage]', b => b.map(x => x.dataset.svStage));
      assert.deepEqual(stages, ['idea_selection', 'initial_approval', 'in_design', 'final_approval', 'ready_to_publish', 'published']);
      assert.equal(await page.locator('[data-sv-stage=in_design].warn').count(), 1); assert.equal(await page.locator('[data-sv-stage=initial_approval].warn').count(), 1);
      await page.click('[data-sv-spec=surgery]'); assert.deepEqual(await page.$$eval('[data-sv-journey] [data-sv-stage]', b => b.map(x => x.dataset.svStage)), ['in_design'], 'specialty filter');
      await page.click('[data-sv-spec=""]');
      // social trend + ads cards
      assert.equal(await page.locator('[data-sv-line]').count(), 1); assert.match(await page.textContent('[data-sv-social]'), /آخر 8 أسابيع/);
      assert.equal(await page.locator('.sv-camps li').count(), 5); assert.match(await page.textContent('.sv-camps li:first-child b'), /حملة رقم 7/); assert.match(await page.textContent('[data-sv-ads]'), /وفيه 2 حملات تانية/);
      assert.match(await page.textContent('[data-sv-other]'), /ليدز مفتوحة/); assert.doesNotMatch(await page.textContent('[data-sv-other]'), /مشكلات تشغيل/, 'zero rows hidden');
      // nothing wraps, nothing scrolls sideways
      const bad = await page.evaluate(() => { const out = []; document.querySelectorAll('[data-summary-v2] button:not(.sv-fr):not(.sv-row):not(.sv-k),.sv-k small,.sv-k b,.sv-k i,.sv-tx b,.sv-tx small,.sv-fl,.sv-trio small,.sv-trio b,.sv-camps span,.sv-camps small,.sv-ch h3,.sv-ch small,.sv-fold summary b').forEach(e => { if (!e.offsetParent) return; const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let t; while ((t = tw.nextNode())) { if (!t.nodeValue.trim()) continue; const r = document.createRange(); r.selectNodeContents(t); if (new Set([...r.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top))).size > 1) { out.push(e.textContent.trim()); break; } } }); return { out, ox: document.documentElement.scrollWidth - innerWidth }; });
      assert.deepEqual(bad.out, [], 'no wrapped text'); assert(bad.ox <= 0, 'no sideways scroll');
      if (process.env.SV_QA_SHOTS) await page.screenshot({ path: process.env.SV_QA_SHOTS + '/summary-' + width + '.png', fullPage: true });
      // navigation and folds
      await page.click('.sv-need-list li:first-child .sv-row'); assert.deepEqual(await page.evaluate(() => gone), ['leads']);
      assert.equal(await page.evaluate(() => legacy), 0, 'original sections are not loaded until opened');
      await page.click('[data-sv-more] summary'); await page.waitForSelector('[data-legacy-ok]'); assert.equal(await page.evaluate(() => legacy), 1);
      // period switch reloads
      await page.click('[data-sv-period=today]'); await page.waitForTimeout(300); assert.equal(await page.textContent('.sv-k:nth-child(1) bdi'), '0');
      assert.deepEqual(errors, []); await page.close();
    }
    // approver: approvals but no manager-only pieces; page manager: calm, no approval tile
    let { page } = await open(browser, 1280, 'approver');
    assert.equal(await page.locator('.sv-k').count(), 3, 'published, waiting approval, ad spend'); assert.equal(await page.locator('[data-sv-other],[data-sv-bi]').count(), 0);
    assert.deepEqual(await page.$$eval('.sv-row b', b => b.map(x => x.textContent)), ['3 مواد مستنية اعتمادك', 'مادة واقفة في التصميم']); await page.close();
    ({ page } = await open(browser, 390, 'page_manager'));
    assert.equal(await page.locator('.sv-k').count(), 2); assert.match(await page.textContent('[data-sv-need-card]'), /مفيش حاجة مستنياك/); assert.equal(await page.locator('[data-sv-week]').count(), 0, 'only approvers add weekly metrics'); await page.close();
    console.log('PASS summary v2 1280/1000/800/390: «محتاج منك» sorted (late leads, approvals, design, tasks, recommendations, alerts), tiles 4/2/1 from real data, journey hides empty stages + delay dots + specialty filter, social trend, top-5 ad campaigns as cards, other modules without zero rows, role-aware pieces, original sections load only when opened, period switch, no wrapped text or sideways scroll');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await browser.close(); }
})();
