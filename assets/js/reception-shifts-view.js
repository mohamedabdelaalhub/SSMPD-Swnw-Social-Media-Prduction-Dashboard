/* «الخزن والورديات» — clear shifts screen (owner «طبّق» 2026-11-27, mockup docs/ui-references/mockups/shifts-clear.html, Sonu Glass style).
   Replaces the plain 4-column table of the reception «العمليات» → «الخزن والورديات» tab with: 3 summary tiles, search + status filters, and the shifts
   grouped by status (open / waiting review / done) with Arabic status chips, the difference coloured, and ONE action button per row.
   Nothing is removed (rule 11): every row, and the same shift_open / shift_close / shift_review buttons (same data-rx-action, so the bridge keeps routing
   them), are still there; the 9 «أدوات إضافية» buttons are only regrouped under three headings. */
(function (w, d) {
  'use strict';
  var STATUS = { open: ['مفتوحة', 'open', 'open'], submitted: ['مستنية مراجعة', 'sub', 'sub'], reviewed: ['اتراجعت', 'done', 'done'], closed: ['اتقفلت', 'done', 'done'], approved: ['اتراجعت', 'done', 'done'] };
  var GROUPS = [['open', 'مفتوحة — محتاجة تسليم'], ['sub', 'مستنية مراجعة'], ['done', 'خلصت']];
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function ic(p) { return '<span class="rsv-ico ' + p[0] + '" aria-hidden="true">' + p[1] + '</span>'; }
  function diffHtml(m, v) { var n = num(v), cls = n === 0 ? 'z' : n > 0 ? 'p' : 'n', t = n === 0 ? 'مظبوطة' : n > 0 ? 'زيادة' : 'عجز'; return '<span class="rsv-diff ' + cls + '" dir="ltr">' + m(Math.abs(n) === 0 ? 0 : n) + '</span> — ' + t; }
  function panel(x) {
    var c = x.c, dd = x.d, b = x.b, e = x.e, m = x.m, list = (dd.shifts || []).slice(), total = 0, cnt = { open: 0, sub: 0, done: 0 };
    var rows = list.map(function (s) {
      var st = STATUS[s.status] || [String(s.status || ''), 'done', 'done'], g = st[2]; cnt[g]++; if (s.status !== 'open') total += num(s.difference);
      var reg = e(c.lookup('registers', s.register_id)), when = s.opened_at || s.created_at, sub = s.status === 'open' ? 'وردية مفتوحة' : s.status === 'submitted' ? 'اتسلمت — مستنية مراجعة مستقلة' : 'اتسلمت واتراجعت';
      var res = s.status === 'open' ? 'العدّ بيتم عند الإغلاق<small>الفرق هيظهر بعد التسليم</small>' : 'الفعلي: <b dir="ltr">' + m(s.counted) + '</b><small>الفرق: ' + diffHtml(m, s.difference) + '</small>';
      var act = s.status === 'open' ? b('shift_close', s.id, 'إغلاق وعد النقدية') : s.status === 'submitted' && dd.can_manage ? b('shift_review', s.id, 'مراجعة مستقلة') : s.status === 'submitted' ? '<span class="rsv-wait">مستنية مراجعة من المدير المالي</span>' : '';
      return { g: g, html: '<div class="rsv-row" data-rsv-row="' + g + '" data-rsv-text="' + e(norm(c.lookup('registers', s.register_id) + ' ' + st[0])) + '"><div class="rsv-who"><b>' + reg + '</b><small>' + sub + (when ? ' · ' + e(c.stamp ? c.stamp(when) : when) : '') + '</small></div><span class="rsv-chip ' + st[1] + '">' + e(st[0]) + '</span><div class="rsv-res">' + res + '</div><div class="rsv-act">' + act + '</div></div>' };
    });
    var tz = total === 0 ? 'ok' : total > 0 ? 'hot' : 'bad';
    var h = '<section class="rsv" data-rsv>' +
      '<div class="rsv-tiles"><button type="button" class="rsv-card rsv-tile blue" data-rsv-f="open">' + ic(['i1', '●']) + '<small>ورديات مفتوحة</small><b>' + cnt.open + '</b></button>' +
      '<button type="button" class="rsv-card rsv-tile ' + (cnt.sub ? 'hot' : 'blue') + '" data-rsv-f="sub">' + ic(['i2', '!']) + '<small>مستنية مراجعة</small><b>' + cnt.sub + '</b></button>' +
      '<div class="rsv-card rsv-tile ' + tz + '">' + ic(['i3', '✓']) + '<small>الفرق في كل الورديات</small><b dir="ltr">' + m(total) + '</b></div></div>' +
      '<div class="rsv-card rsv-bar"><input type="search" data-rsv-q placeholder="دوّر باسم الخزينة…" aria-label="بحث في الورديات" autocomplete="off"><span class="rsv-go">' + b('shift_open', '', 'فتح وردية') + '</span>' +
      '<div class="rsv-chips" role="group" aria-label="تصفية الورديات"><button type="button" class="rsv-fb on" data-rsv-f="all" aria-pressed="true">الكل (' + list.length + ')</button><button type="button" class="rsv-fb" data-rsv-f="open" aria-pressed="false">مفتوحة (' + cnt.open + ')</button><button type="button" class="rsv-fb" data-rsv-f="sub" aria-pressed="false">مستنية مراجعة (' + cnt.sub + ')</button><button type="button" class="rsv-fb" data-rsv-f="done" aria-pressed="false">اتراجعت (' + cnt.done + ')</button></div></div>';
    GROUPS.forEach(function (g) {
      var mine = rows.filter(function (r) { return r.g === g[0]; }); if (!mine.length) return;
      h += '<div class="rsv-card rsv-group" data-rsv-group="' + g[0] + '"><div class="rsv-gh"><h4>' + g[1] + '</h4><small>' + mine.length + ' وردية</small></div>' + mine.map(function (r) { return r.html; }).join('') + '</div>';
    });
    if (!list.length) h += '<div class="rsv-card rsv-empty"><p>مفيش ورديات لسه. دوس «فتح وردية» لما تبدأ.</p></div>';
    return h + '<p class="rsv-none" data-rsv-none hidden>مفيش وردية مطابقة للبحث.</p></section>';
  }
  function apply(root) {
    var f = root.getAttribute('data-rsv-filter') || 'all', q = norm((root.querySelector('[data-rsv-q]') || {}).value || '').trim(), shown = 0;
    root.querySelectorAll('[data-rsv-row]').forEach(function (r) { var ok = (f === 'all' || r.getAttribute('data-rsv-row') === f) && (!q || r.getAttribute('data-rsv-text').indexOf(q) >= 0); r.hidden = !ok; if (ok) shown++; });
    root.querySelectorAll('[data-rsv-group]').forEach(function (g) { g.hidden = !g.querySelector('[data-rsv-row]:not([hidden])'); });
    root.querySelectorAll('.rsv-fb').forEach(function (b) { var on = b.getAttribute('data-rsv-f') === f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    var none = root.querySelector('[data-rsv-none]'); if (none) none.hidden = shown > 0 || !root.querySelector('[data-rsv-row]');
  }
  var TOOLS = [['طلبات الخدمة', /طلبات الخدمة|طلب الخدمة|المزوّدين|المزودين/], ['التأمين والتواصل', /تأمين|مطالبة|التواصل|الليد/], ['التقارير والفريق', /تقارير|مؤشرات|الفريق|مهمة/]];
  function regroup(host) {
    var body = host.querySelector('details.rx-more-tools .rx-more-body'); if (!body || body.__rsvDone) return;
    var btns = [].slice.call(body.querySelectorAll('button')); if (!btns.length) return;
    var secs = TOOLS.map(function (t) { var s = d.createElement('section'); s.className = 'rsv-card rsv-tg'; s.innerHTML = '<h5>' + t[0] + '</h5>'; return s; }), other = d.createElement('section'); other.className = 'rsv-card rsv-tg'; other.innerHTML = '<h5>أدوات أخرى</h5>';
    btns.forEach(function (bt) { var t = bt.textContent, i = TOOLS.findIndex(function (x) { return x[1].test(t); }); (i < 0 ? other : secs[i]).appendChild(bt); });
    var wrap = d.createElement('div'); wrap.className = 'rsv-tools'; secs.concat([other]).forEach(function (s) { if (s.querySelector('button')) wrap.appendChild(s); });
    body.appendChild(wrap); body.__rsvDone = true;
    var sm = host.querySelector('details.rx-more-tools > summary'); if (sm && !/\(\d+\)/.test(sm.textContent)) sm.textContent = 'أدوات إضافية (' + btns.length + ')';
  }
  function decorate(c) { if (c && c.host && c.host.querySelector('[data-rsv]')) regroup(c.host); }
  if (!w.__rsvBound) {
    w.__rsvBound = true;
    d.addEventListener('click', function (ev) { var t = ev.target.closest && ev.target.closest('[data-rsv-f]'); if (!t) return; var root = t.closest('[data-rsv]'); if (!root) return; var f = t.getAttribute('data-rsv-f'); root.setAttribute('data-rsv-filter', root.getAttribute('data-rsv-filter') === f && t.classList.contains('rsv-tile') ? 'all' : f); apply(root); });
    d.addEventListener('input', function (ev) { var t = ev.target; if (t && t.matches && t.matches('[data-rsv-q]')) { var root = t.closest('[data-rsv]'); if (root) apply(root); } });
  }
  w.SSMPDReceptionShiftsView = { panel: panel, decorate: decorate, apply: apply };
})(window, document);
