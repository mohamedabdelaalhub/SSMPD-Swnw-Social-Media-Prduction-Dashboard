// Mobile (owner 2026-11-27, Android, keyboard open): the top «بحث في الأقسام المتاحة لك» panel fits the phone — full width with side gutters, not cut off, not covering the page —
// has its own ✕ (rule 10), and focusing the page's OWN search/select never opens it. Real app, fake backend, super admin, 390 wide, then 340 high (keyboard).
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }), ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://app.test/**', r => { let u = new URL(r.request().url()).pathname; if (u === '/') u = '/index.html'; const f = path.join(ROOT, u); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) }); });
  await page.route(/^https?:\/\/(?!app\.test)/, r => { if (/supabase-js/.test(r.request().url())) return r.fulfill({ contentType: 'text/javascript', body: 'window.supabase={createClient:function(){return window.__fake}}' }); r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.addInitScript(() => {
    const ME = { id: 'admin-1', user_id: 'user-1', email: 'a@b.c', name: 'محمد', role: 'super_admin', active: true, created_at: new Date().toISOString(), has_archive_access: true };
    function q(t) { const s = { single: false, p: new Proxy({}, { get(_, k) { if (k === 'then') return (ok, no) => Promise.resolve({ data: t === 'admins' ? (s.single ? ME : [ME]) : (s.single ? null : []), error: null }).then(ok, no); if (k === 'single' || k === 'maybeSingle') return () => { s.single = true; return s.p; }; return () => s.p; } }) }; return s.p; }
    window.__fake = { from: q, auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: ME.user_id, email: ME.email } } } }), signInWithPassword: () => Promise.resolve({ data: {}, error: null }), signOut: () => Promise.resolve({}), onAuthStateChange: () => {} }, rpc: (n) => Promise.resolve({ data: n === 'list_admins_basic' ? [ME] : [], error: null }), storage: { from: () => ({}) }, functions: { invoke: () => Promise.resolve({ data: null, error: null }) }, channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {} };
  });
  await page.goto('https://app.test/'); await page.waitForSelector('#global-search-toggle', { timeout: 30000 }); await page.addStyleTag({ content: '.usage-notice{display:none!important}' }); await page.waitForTimeout(800);
  const panel = page.locator('#global-search-panel'), box = async () => panel.boundingBox();
  // the page's own search / select never opens the global panel
  await page.evaluate(() => { const v = document.getElementById('view-container') || document.body; const i = document.createElement('input'); i.type = 'search'; i.id = 'own-search'; const s = document.createElement('select'); s.id = 'own-select'; s.innerHTML = '<option>القسم</option>'; v.prepend(i, s); });
  await page.focus('#own-search'); await page.focus('#own-select'); assert.equal(await panel.isHidden(), true, 'focusing the page\'s own fields does not open the global search');
  // opening it: fits the viewport with side gutters
  await page.evaluate(() => document.getElementById('global-search-toggle').click()); await page.waitForTimeout(200);
  assert.equal(await panel.isVisible(), true); let b = await box(); assert(b.x >= 8 && b.x + b.width <= 390 - 8, 'inside the viewport with gutters: ' + JSON.stringify(b)); assert(b.width >= 390 - 40, 'full width: ' + b.width);
  const tb = await page.locator('.topbar').boundingBox(); assert(b.y >= tb.y + tb.height - 4, 'sits below the top bar');
  assert((await page.locator('#global-search-input').boundingBox()).x >= 8, 'the input is not cut off');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true, 'no sideways scroll');
  // keyboard open ≈ a short viewport: the panel never grows past it
  await page.setViewportSize({ width: 390, height: 340 }); await page.waitForTimeout(150); b = await box(); assert(b.y + b.height <= 340 + 1, 'panel fits above the keyboard: ' + JSON.stringify(b));
  // rule 10: its own ✕
  await page.setViewportSize({ width: 390, height: 844 }); assert(await page.locator('#global-search-close').isVisible(), '✕ is there'); await page.locator('#global-search-close').click(); assert.equal(await panel.isHidden(), true, '✕ closes it');
  assert.deepEqual(errors.filter(e => !/reading 'mode'/.test(e)), []); await browser.close(); console.log('global-search-mobile OK');
})().catch(e => { console.error(e); process.exit(1); });
