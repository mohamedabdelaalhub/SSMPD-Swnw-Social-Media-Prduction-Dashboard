// Rule 10 (owner 2026-11-27, «اديني مش عارف ارجع»): the top-bar arrow is ALWAYS visible (desktop and phone), sits right beside the bell, and steps back INSIDE a screen:
// it closes the open popup or presses the screen's own «العودة إلى …» button (price list detail, contract detail, patient file, HR person sheet), and every such
// in-page link looks like a real back button. Real Chromium, real back-nav.js + header CSS, markup copied from the real screens.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), { chromium } = require('playwright'), root = path.resolve(__dirname, '..');
const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/header-v2.css"><link rel="stylesheet" href="/assets/css/back-nav.css"></head><body>
<div class="app-shell"><div class="topbar"><div class="brand"><img src="/assets/img/mark.svg" alt=""><span id="brand-section-name">مركز</span></div>
<div class="topbar-tools"><button id="dashboard-help-toggle" class="btn ghost sm header-icon" type="button" aria-label="مساعدة">؟</button><div style="position:relative"><button id="notif-bell-btn" class="btn ghost sm header-icon" type="button" aria-label="إشعارات">🔔</button></div></div><div class="header-account"><b>محمد</b></div><button class="user-menu-icon" id="um" type="button" aria-label="القائمة">⌄</button></div>
<main id="view-container"></main></div>
<script>window.SSMPDGotoTab=function(t){window.went=(window.went||[]).concat(t);};window.clicked=[];</script><script src="/assets/js/back-nav.js"></script></body></html>`;
(async () => {
  const server = http.createServer((req, res) => { const u = req.url.split('?')[0]; if (u === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(html); } const p = path.join(root, u); if (!p.startsWith(root) || !fs.existsSync(p)) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', u.endsWith('.css') ? 'text/css' : u.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'); res.end(fs.readFileSync(p)); });
  await new Promise(r => server.listen(0, r)); const port = server.address().port, browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } }), errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('http://localhost:' + port + '/');
      const arrow = page.locator('#back-nav-btn'), wait = () => page.waitForTimeout(80);
      await page.evaluate(() => SSMPDBackNav.record('price_lists')); await wait();
      // 1) always visible, beside the bell (the arrow is on the bell's LEFT in RTL), disabled + greyed when there is nowhere to go
      assert.equal(await arrow.count(), 1); assert(await arrow.isVisible(), 'visible at ' + width); assert.equal(await arrow.isDisabled(), true, 'greyed on a first screen');
      // the arrow is the OUTERMOST control: far LEFT in Arabic (beyond the profile and its menu), far RIGHT in English; at least 40px
      const xs = async () => { const out = {}; for (const id of ['#back-nav-btn', '#notif-bell-btn', '#um', '.header-account', '.brand']) { const bx = await page.locator(id).first().boundingBox(); if (bx) out[id] = bx; } return out; };
      let pos = await xs(); const others = Object.entries(pos).filter(([k]) => k !== '#back-nav-btn').map(([, v]) => v);
      assert(others.every(o => pos['#back-nav-btn'].x + pos['#back-nav-btn'].width <= o.x + 1), 'RTL: the arrow is the LEFT-most item (beyond the profile menu): ' + JSON.stringify(pos));
      assert(pos['#back-nav-btn'].width >= 40 && pos['#back-nav-btn'].height >= 40, 'hit area at least 40px: ' + JSON.stringify(pos['#back-nav-btn']));
      await page.evaluate(() => { document.documentElement.dir = 'ltr'; }); await wait(); pos = await xs(); const others2 = Object.entries(pos).filter(([k]) => k !== '#back-nav-btn').map(([, v]) => v);
      assert(others2.every(o => pos['#back-nav-btn'].x >= o.x + o.width - 1), 'LTR: the arrow is the RIGHT-most item: ' + JSON.stringify(pos)); await page.evaluate(() => { document.documentElement.dir = 'rtl'; }); await wait();
      assert(Number(await arrow.evaluate(b => getComputedStyle(b).opacity)) >= 0.6, 'greyed but clearly visible');
      // 2) price list detail — markup built like contract-price-workspace.js (the owner's screen)
      await page.evaluate(() => { document.getElementById('view-container').innerHTML = '<div class="section"><div data-detail-back></div><div data-pi-detail><h3>لائحة نقابة الأطباء 2024</h3></div></div>'; const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.dataset.pi = 'close'; b.textContent = 'العودة إلى قوائم الأسعار'; b.onclick = () => clicked.push('prices'); document.querySelector('[data-detail-back]').append(b); }); await wait();
      assert.equal(await arrow.isDisabled(), false, 'price list detail: the arrow is live'); const link = page.locator('[data-pi="close"]');
      assert(await link.evaluate(b => b.classList.contains('bn-link')), 'the text link became a real back button'); assert.equal(await link.evaluate(b => getComputedStyle(b, '::before').content), '"←"', 'with a back arrow'); assert((await link.boundingBox()).height >= 43, 'comfortable tap size');
      await arrow.click({ force: true }); assert.deepEqual(await page.evaluate(() => clicked), ['prices'], 'arrow = «العودة إلى قوائم الأسعار»');
      // 3) contract detail (render-contracting-entities.js: #ce-back)
      await page.evaluate(() => { clicked.length = 0; document.getElementById('view-container').innerHTML = '<div class="section"><button class="btn ghost" id="ce-back">العودة إلى جهات التعاقد</button></div>'; document.getElementById('ce-back').onclick = () => clicked.push('contracts'); }); await wait();
      await arrow.click({ force: true }); assert.deepEqual(await page.evaluate(() => clicked), ['contracts'], 'contract detail');
      // 4) HR person sheet (workforce modal with ✕) + 5) patient file (modal with .modal-close) — the arrow closes the popup
      await page.evaluate(() => { document.getElementById('view-container').innerHTML = '<p>قايمة</p>'; const o = document.createElement('div'); o.className = 'wp-overlay'; o.innerHTML = '<section class="wp-modal" role="dialog" aria-modal="true"><header><h2>ملف موظف</h2><button type="button" aria-label="إغلاق" data-close>×</button></header></section>'; o.querySelector('[data-close]').onclick = () => o.remove(); document.body.append(o); }); await wait();
      assert.equal(await arrow.isDisabled(), false); await arrow.click({ force: true }); assert.equal(await page.locator('.wp-overlay').count(), 0, 'HR person sheet closed by the arrow');
      await page.evaluate(() => { const o = document.createElement('div'); o.className = 'modal-backdrop'; o.innerHTML = '<section class="modal"><div class="modal-head"><h3>ملف المريض</h3><button type="button" class="modal-close" title="العودة للأرشيف">×</button></div></section>'; o.querySelector('.modal-close').onclick = () => o.remove(); document.body.append(o); }); await wait();
      /* the dim backdrop of a modal covers the top bar, so a person closes it with its own ✕; the arrow is live and closes it too (pressed in code here) */ await page.evaluate(() => document.getElementById('back-nav-btn').click()); assert.equal(await page.locator('.modal-backdrop').count(), 0, 'patient file closed by the arrow');
      // 6) risky look-alikes are NOT treated as back (an image revert must never be pressed by the arrow)
      await page.evaluate(() => { clicked.length = 0; document.getElementById('view-container').innerHTML = '<button id="rv" class="btn">رجوع للصورة قبل التعديل</button><button id="rf" class="btn">رجوع مبلغ</button>'; document.getElementById('rv').onclick = () => clicked.push('revert'); document.getElementById('rf').onclick = () => clicked.push('refund'); }); await wait();
      assert.equal(await page.locator('#rv.bn-link, #rf.bn-link').count(), 0, 'not styled as back'); assert.equal(await arrow.isDisabled(), true, 'nothing to go back to → greyed, not pressing look-alikes'); assert.deepEqual(await page.evaluate(() => clicked), []);
      // 7) no in-page back → previous main screen
      await page.evaluate(() => { SSMPDBackNav.record('patients'); }); await wait(); assert.equal(await arrow.isDisabled(), false); await arrow.click({ force: true }); assert.deepEqual(await page.evaluate(() => went), ['price_lists'], 'falls back to the previous main screen');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('back-arrow-everywhere OK');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
