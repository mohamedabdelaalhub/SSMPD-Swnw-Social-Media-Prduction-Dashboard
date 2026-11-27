// «الخزن والورديات» clear view (help 333): real module, fake context. Covers: Arabic status chips (no raw English), 3 groups with counts, ONE action button per row
// with the SAME data-rx-action as before (shift_close / shift_review / shift_open), coloured difference, tiles, filter chips + tile toggle + search (Arabic normalised),
// reception without manage rights sees a note instead of «مراجعة مستقلة», the 9 tools only regrouped (nothing lost), and reception-services.js really uses the panel.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] }));
(async () => {
  const dom = new JSDOM('<main id="host"></main>', { url: 'https://t.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  w.eval(fs.readFileSync('assets/js/reception-shifts-view.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const b = (a, id, t) => '<button type="button" class="btn" data-rx-action="' + a + '" data-id="' + esc(id) + '">' + esc(t) + '</button>', m = v => Number(v || 0).toFixed(2);
  const c = { lookup: (k, id) => ({ r1: 'خزينة مازن', r2: 'خزينة الاستقبال التانية' }[id]), stamp: s => s, esc };
  const shifts = [{ id: 's1', register_id: 'r1', status: 'reviewed', counted: 0, difference: 0 }, { id: 's2', register_id: 'r1', status: 'open' }, { id: 's3', register_id: 'r1', status: 'submitted', counted: 450, difference: 0 },
    { id: 's4', register_id: 'r2', status: 'open' }, { id: 's5', register_id: 'r2', status: 'submitted', counted: 100, difference: -25 }, { id: 's6', register_id: 'r1', status: 'reviewed', counted: 550, difference: 10 }];
  const html = (can) => w.SSMPDReceptionShiftsView.panel({ c, d: { shifts, can_manage: can }, b, e: esc, m });
  const host = d.getElementById('host'); host.innerHTML = html(true) + '<details class="rx-more-tools"><summary>أدوات إضافية</summary><div class="rx-more-body">' + ['حالة كل طلبات الخدمة', 'تفاصيل طلب الخدمة (إحالة / تنفيذ / مزوّد)', 'لوحة المزوّدين الخارجيين', 'طباعة مطالبة تأمينية', 'موافقة التواصل', 'ربط الليد بالحجز', 'نشر ومراجعة تقارير المؤشرات', 'تصدير مؤشرات مجمعة', 'إرسال مهمة لموديول الفريق'].map((t, i) => b('t' + i, '', t)).join('') + '</div></details>';
  const q = s => host.querySelector(s), all = s => [...host.querySelectorAll(s)], vis = () => all('[data-rsv-row]').filter(r => !r.hidden).length;
  // ---- chips, groups, nothing English
  assert(!/\b(open|submitted|reviewed)\b/.test(host.textContent), 'no raw English statuses: ' + host.textContent.slice(0, 200));
  assert.deepEqual(all('.rsv-group h4').map(h => h.textContent), ['مفتوحة — محتاجة تسليم', 'مستنية مراجعة', 'خلصت']); assert.equal(all('[data-rsv-row]').length, 6, 'every shift is a row (rule 11)');
  assert.deepEqual(all('.rsv-chip').map(x => x.textContent).sort(), ['اتراجعت', 'اتراجعت', 'مفتوحة', 'مفتوحة', 'مستنية مراجعة', 'مستنية مراجعة'].sort());
  // ---- ONE action per row, same data-rx-action
  assert.deepEqual(all('[data-rsv-row] .rsv-act [data-rx-action]').map(x => x.dataset.rxAction + ':' + x.dataset.id), ['shift_close:s2', 'shift_close:s4', 'shift_review:s3', 'shift_review:s5']);
  assert(all('[data-rsv-row]').every(r => r.querySelectorAll('.rsv-act [data-rx-action]').length <= 1), 'at most one button per row');
  assert(q('.rsv-go [data-rx-action="shift_open"]'), 'primary shift_open button kept'); assert.equal(q('.rsv-go [data-rx-action="shift_open"]').textContent, 'فتح وردية');
  // ---- tiles + coloured difference
  const tiles = all('.rsv-tile'); assert.equal(tiles.length, 3); assert.equal(tiles[0].querySelector('b').textContent, '2'); assert.equal(tiles[1].querySelector('b').textContent, '2'); assert(tiles[1].classList.contains('hot'));
  assert.equal(tiles[2].querySelector('b').textContent, '-15.00'); assert(tiles[2].classList.contains('hot') === false && tiles[2].classList.contains('bad'), 'net -15 → red');
  assert(q('.rsv-diff.n') && q('.rsv-diff.p') && q('.rsv-diff.z'), 'عجز / زيادة / مظبوطة classes'); assert(host.textContent.includes('عجز') && host.textContent.includes('زيادة') && host.textContent.includes('مظبوطة'));
  assert(!/[٠-٩]/.test(host.textContent), 'English digits');
  // ---- filters
  const fb = f => q('.rsv-fb[data-rsv-f="' + f + '"]'); fb('open').click(); assert.equal(vis(), 2); assert(fb('open').classList.contains('on') && fb('open').getAttribute('aria-pressed') === 'true'); assert(q('[data-rsv-group="done"]').hidden && !q('[data-rsv-group="open"]').hidden, 'empty groups hide');
  fb('all').click(); assert.equal(vis(), 6); tiles[1].click(); assert.equal(vis(), 2, 'tile filters to waiting review'); tiles[1].click(); assert.equal(vis(), 6, 'tile again clears');
  const input = q('[data-rsv-q]'); input.value = 'الاستقبال'; input.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(vis(), 2, 'search by register name'); input.value = 'مراجعه'; input.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(vis(), 2, 'Arabic-normalised search (ة→ه)');
  input.value = 'zzzz'; input.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(vis(), 0); assert(!q('[data-rsv-none]').hidden, 'no-match note'); input.value = ''; input.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(vis(), 6);
  // ---- reception without manage rights: note instead of the review button
  const h2 = d.createElement('div'); h2.innerHTML = html(false); assert(!h2.querySelector('[data-rx-action="shift_review"]') && h2.textContent.includes('مستنية مراجعة من المدير المالي'), 'note instead of review button when can_manage is false');
  // ---- tools: regrouped, all 9 buttons still there, summary count
  w.SSMPDReceptionShiftsView.decorate({ host }); const groups = all('.rx-more-body .rsv-tg'); assert.deepEqual(groups.map(g => g.querySelector('h5').textContent), ['طلبات الخدمة', 'التأمين والتواصل', 'التقارير والفريق']);
  assert.equal(all('.rx-more-body button').length, 9, 'all nine tools kept'); assert.deepEqual(groups.map(g => g.querySelectorAll('button').length), [3, 3, 3]); assert(q('.rx-more-tools > summary').textContent.includes('(9)'));
  w.SSMPDReceptionShiftsView.decorate({ host }); assert.equal(all('.rx-more-body .rsv-tg').length, 3, 'idempotent');
  // ---- the real reception-services.js uses the panel (and keeps the old table as fallback)
  const src = fs.readFileSync('assets/js/reception-services.js', 'utf8'); assert(src.includes("active==='shifts'&&window.SSMPDReceptionShiftsView") && src.includes("b('shift_open','','فتح وردية')"), 'wired + fallback kept');
  assert(fs.readFileSync('assets/js/reception-workspace.js', 'utf8').includes("fx('SSMPDReceptionShiftsView','decorate')"), 'decorate wired');
  const idx = fs.readFileSync('index.html', 'utf8'); assert(/reception-shifts-view\.js\?v=/.test(idx) && /reception-shifts-view\.css\?v=/.test(idx), 'loaded in index.html');
  console.log('reception-shifts-view-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
