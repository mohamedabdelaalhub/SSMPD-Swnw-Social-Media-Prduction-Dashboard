// DOM test (owner 2026-11-27): «طلبات الموقع» card for reception: 3 tiles with totals / new counts, list popup with search + status chips + last 5 / «عرض الكل»,
// detail popup with mark buttons (rpc), ✕ and Esc close every popup, escaping, English digits, trial workspace and other roles see nothing.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = () => new Promise(r => setTimeout(r, 30));
(async () => {
  const dom = new JSDOM('<div class="rx-shell"><header class="rx-header">الاستقبال</header><main id="host"></main></div>', { url: 'https://t.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const mk = (i, kind, status, f) => ({ id: 'id' + i, kind, status, fields: f, created_at: '2026-11-27T12:' + String(10 + i).padStart(2, '0') + ':00Z' });
  let rows = [
    mk(1, 'contact', 'new', { name: 'منى <b>x</b>', phone: '01000000001', message: 'عايزة أسأل عن مواعيد الأطفال' }),
    mk(2, 'contact', 'new', { name: 'كريم', email: 'k@example.com', message: 'شكوى' }),
    mk(3, 'contact', 'reviewed', { name: 'هدى', message: 'استفسار عن الأسعار' }),
    mk(4, 'contact', 'done', { name: 'ياسمين', message: 'طلب تقرير' }),
    mk(5, 'contact', 'done', { name: 'عمر', message: 'تعديل ميعاد' }),
    mk(6, 'contact', 'done', { name: 'سلمى', message: 'سادس' }),
    mk(7, 'job', 'new', { name: 'رنا', position: 'تمريض', message: 'خبرة سنتين' }),
    mk(8, 'internship', 'done', { name: 'أحمد', university: 'القاهرة', message: 'تدريب صيفي' })];
  const calls = [];
  w.SSMPDDb = { client: { rpc: (name, args) => { calls.push([name, args]); if (name === 'website_requests_list') return Promise.resolve({ data: rows }); if (name === 'website_requests_mark') return Promise.resolve({ data: { ok: true } }); return Promise.resolve({ error: { message: 'x' } }); } } };
  w.SSMPDAuth = { currentAdmin: { role: 'reception' } }; w.SSMPDRoles = { hasAnyRole: (a, rs) => rs.includes(a.role) };
  w.eval(fs.readFileSync('assets/js/website-requests.js', 'utf8'));
  const host = d.getElementById('host');
  w.SSMPDWebsiteRequests.decorate({ data: { workspace: { mode: 'trial' } }, workspace: 'ws0', host }); assert(!d.getElementById('website-requests-rx'), 'nothing for a trial workspace');
  w.SSMPDAuth.currentAdmin = { role: 'designer' }; w.SSMPDWebsiteRequests.decorate({ data: { workspace: { mode: 'live' } }, workspace: 'ws1', host }); assert(!d.getElementById('website-requests-rx'), 'nothing for other roles');
  w.SSMPDAuth.currentAdmin = { role: 'reception' };
  w.SSMPDWebsiteRequests.decorate({ data: { workspace: { mode: 'live' } }, workspace: 'ws1', host }); await tick(); await tick();
  const box = d.getElementById('website-requests-rx'); assert(box && box.previousElementSibling.classList.contains('rx-header'), 'card right under the header');
  assert.equal(box.querySelector('h3').textContent, 'طلبات الموقع'); assert.equal(JSON.stringify(calls[0]), JSON.stringify(['website_requests_list', { p_workspace: 'ws1', p_status: null, p_limit: 500 }]));
  const tile = k => box.querySelector('[data-wr-open="' + k + '"]');
  assert.deepEqual(['contact', 'job', 'partner'].map(k => tile(k).querySelector('b').textContent), ['اتصل بنا', 'وظايف وتدريب', 'شراكات']);
  assert.deepEqual(['contact', 'job', 'partner'].map(k => tile(k).querySelector('.wr-n').textContent), ['6', '2', '0'], 'job tile includes internships');
  assert(tile('contact').textContent.includes('2 جديد') && tile('job').textContent.includes('1 جديد') && tile('partner').textContent.includes('مفيش جديد') && tile('partner').querySelector('.wr-zero'), 'zero is muted');
  // list popup
  tile('contact').click(); let pop = () => box.querySelector('.wr-pop');
  assert(pop() && pop().querySelector('h3').textContent === 'طلبات «اتصل بنا»' && pop().querySelector('.wr-x'), 'popup with ✕');
  assert.equal(box.querySelectorAll('.wr-item').length, 5, 'last 5 only'); const more = box.querySelector('[data-wr-all]'); assert(more && more.textContent.includes('(6)'));
  assert(!box.innerHTML.includes('<b>x</b>') && box.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'), 'names are escaped');
  more.click(); assert.equal(box.querySelectorAll('.wr-item').length, 6, 'عرض الكل');
  box.querySelector('[data-wr-status="new"]').click(); assert.equal(box.querySelectorAll('.wr-item').length, 2);
  box.querySelector('[data-wr-status="all"]').click(); const s = box.querySelector('[data-wr-q]'); s.value = 'كريم'; s.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(box.querySelectorAll('.wr-item').length, 1, 'type-to-search'); assert(!/[٠-٩]/.test(box.textContent), 'English digits only');
  // detail popup + mark
  box.querySelector('.wr-item').click(); assert(pop().querySelector('h3').textContent === 'كريم' && pop().textContent.includes('k@example.com') && pop().querySelector('.wr-badge.wr-new'));
  assert(!box.querySelector('[data-wr-menu]').offsetParent || box.querySelector('[data-wr-menu]').hidden, 'secondary actions under ⋯');
  box.querySelector('[data-wr-set="reviewed"]').click(); await tick(); await tick();
  assert.equal(JSON.stringify(calls.filter(c => c[0] === 'website_requests_mark')[0]), JSON.stringify(['website_requests_mark', { p_workspace: 'ws1', p_id: 'id2', p_status: 'reviewed' }]));
  assert(pop().querySelector('.wr-badge.wr-reviewed'), 'status updated in place'); assert(tile('contact').textContent.includes('1 جديد'), 'tile count follows');
  // ✕ and Esc
  box.querySelector('[data-wr-close]').click(); assert(pop() && pop().querySelector('[data-wr-q]'), '✕ on detail goes back to the list');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert(!pop(), 'Esc closes the list');
  tile('job').click(); box.querySelector('[data-wr-close]').click(); assert(!pop(), '✕ closes');
  // failure message
  rows = null; w.SSMPDDb.client.rpc = () => Promise.resolve({ error: { message: 'x' } }); box.querySelector('[data-wr-refresh]').click(); await tick(); await tick(); assert(box.querySelector('.wr-err'), 'error shown');
  console.log('PASS website requests: card with 3 tiles, list popup (search, chips, last 5 / all), detail popup with mark, ✕ + Esc, escaping, English digits, trial and other roles hidden, error message.');
})().catch(e => { console.error(e); process.exit(1); });
