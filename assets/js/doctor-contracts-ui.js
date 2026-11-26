/* «عقود الأطباء» layout (owner 2026-11-26 «طبقه», mockup docs/ui-references/mockups/doctor-contracts.html). Additive only (rule 11): nothing is removed.
   - the per-doctor buttons move into one «⋯» menu (same buttons, same data-fin-action, still in the DOM);
   - contract texts / start dates, and doctors without a contract, sit in folded sections under the list;
   - «استحقاق الفواتير» is folded and paged (50 rows per page) so thousands of rows never render at once;
   - «20.00%» reads «20%».
   Everything runs through ONE observer on the accounting view, debounced, and writes only when something is missing (no churn loops). */
(function (w, d) {
  'use strict';
  var PAGE = 50, allocRows = null, view = null, observer = null, queued = false;
  function el(tag, cls, html) { var n = d.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

  function menus(root) {
    root.querySelectorAll('.fc-doctor-group > summary').forEach(function (sum) {
      if (sum.querySelector('.dcu-more')) return;
      var btns = Array.prototype.filter.call(sum.children, function (n) { return n.tagName === 'BUTTON'; });
      if (!btns.length) return;
      var menu = el('span', 'dcu-menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
      btns.forEach(function (b) { menu.appendChild(b); });
      var more = el('button', 'dcu-more', '⋯'); more.type = 'button'; more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', 'خيارات الدكتور'); more.title = 'خيارات الدكتور';
      sum.appendChild(more); sum.appendChild(menu);
    });
  }
  function rates(root) {
    root.querySelectorAll('.fc-doctor-group > summary > span:not(.dc-pills)').forEach(function (sp) {
      var t = sp.textContent; if (!/\d\.00(?!\d)/.test(t)) return;
      var n = t.replace(/(\d+)\.00(?!\d)/g, '$1'); if (n !== t && !sp.children.length) sp.textContent = n;
    });
  }
  function fold(id, title, sub, nodes, anchor) {
    var f = view.querySelector('[data-dcu-fold="' + id + '"]');
    if (!f) {
      f = el('details', 'dcu-fold'); f.dataset.dcuFold = id;
      f.innerHTML = '<summary><span>' + title + '<small>' + sub + '</small></span></summary><div class="dcu-fold-body"></div>';
      anchor.parentNode.insertBefore(f, anchor.nextSibling);
    }
    var body = f.querySelector('.dcu-fold-body');
    nodes.forEach(function (n) { if (n && n.parentNode !== body) body.appendChild(n); });
    return f;
  }
  function folds(root) {
    var groups = root.querySelectorAll('.fc-doctor-group'); if (!groups.length) return;
    var last = groups[groups.length - 1];
    var tpl = root.querySelector('[data-sig-templates]'); if (tpl && !tpl.closest('.dcu-fold')) fold('settings', 'إعدادات العقود', 'نص العقد، إقرار المسؤولية، بداية التطبيق', [tpl], last);
    var need = root.querySelector('[data-da-needs]'); if (need && !need.closest('.dcu-fold')) {
      var n = (need.querySelector('h4') || {}).textContent || ''; var m = n.match(/\((\d+)\)/);
      fold('needs', 'أطباء لسه ماعندهمش عقد' + (m ? ' (' + m[1] + ')' : ''), 'اتسجلوا في الموارد البشرية', [need], last);
    }
  }
  function trHtml(cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }
  function alloc(root) {
    Array.prototype.forEach.call(root.querySelectorAll('h4'), function (h) {
      if (h.textContent.trim() !== 'استحقاق الفواتير' || h.closest('.dcu-fold')) return;
      var next = h.nextElementSibling, shown = next && next.querySelectorAll ? next.querySelectorAll('tbody tr') : [];
      if (!next || !shown.length) return;
      var total = allocRows && allocRows.length > PAGE ? allocRows.length : shown.length;
      var f = el('details', 'dcu-fold'); f.dataset.dcuFold = 'alloc';
      f.innerHTML = '<summary><span>استحقاق الفواتير<small>' + total + ' صف</small></span></summary><div class="dcu-fold-body"></div>';
      h.parentNode.insertBefore(f, h); var body = f.querySelector('.dcu-fold-body'); body.appendChild(next); h.hidden = true;
      if (allocRows && allocRows.length > PAGE) pageData(body, next, allocRows.slice());
      else if (shown.length > PAGE) page(body, next, shown);
    });
  }
  /* rows kept as data (only the first page is in the DOM): build each page on demand */
  function pageData(body, tableBox, data) {
    var cur = 0, pages = Math.ceil(data.length / PAGE), tb = tableBox.querySelector('tbody');
    var bar = el('div', 'dcu-pg', '<button type="button" class="btn ghost" data-dcu-prev>السابق</button><span data-dcu-of></span><button type="button" class="btn" data-dcu-next>التالي</button>');
    body.appendChild(bar);
    function show() {
      tb.innerHTML = data.slice(cur * PAGE, (cur + 1) * PAGE).map(trHtml).join('');
      bar.querySelector('[data-dcu-of]').textContent = 'صفحة ' + (cur + 1) + ' من ' + pages;
      bar.querySelector('[data-dcu-prev]').disabled = cur === 0; bar.querySelector('[data-dcu-next]').disabled = cur === pages - 1;
    }
    bar.addEventListener('click', function (e) { if (e.target.closest('[data-dcu-prev]') && cur > 0) cur--; else if (e.target.closest('[data-dcu-next]') && cur < pages - 1) cur++; else return; show(); });
    bar.querySelector('[data-dcu-prev]').disabled = true; bar.querySelector('[data-dcu-of]').textContent = 'صفحة 1 من ' + pages;
  }
  function page(body, tableBox, rows) {
    var cur = 0, pages = Math.ceil(rows.length / PAGE);
    var bar = el('div', 'dcu-pg', '<button type="button" class="btn ghost" data-dcu-prev>السابق</button><span data-dcu-of></span><button type="button" class="btn" data-dcu-next>التالي</button>');
    body.appendChild(bar);
    function show() {
      rows.forEach(function (r, i) { r.hidden = Math.floor(i / PAGE) !== cur; });
      bar.querySelector('[data-dcu-of]').textContent = 'صفحة ' + (cur + 1) + ' من ' + pages;
      bar.querySelector('[data-dcu-prev]').disabled = cur === 0; bar.querySelector('[data-dcu-next]').disabled = cur === pages - 1;
    }
    bar.addEventListener('click', function (e) { if (e.target.closest('[data-dcu-prev]') && cur > 0) cur--; else if (e.target.closest('[data-dcu-next]') && cur < pages - 1) cur++; else return; show(); });
    show();
  }
  function run() {
    queued = false; if (!view || !view.isConnected) return;
    if (!view.querySelector('.fc-doctor-group')) return;
    menus(view); rates(view); folds(view); alloc(view);
  }
  function schedule() { if (queued) return; queued = true; w.requestAnimationFrame(run); }
  function start() {
    var v = d.getElementById('acc-sub-view') || d.querySelector('[data-fc-root]') || d.body;
    if (v !== view) { if (observer) observer.disconnect(); view = v; observer = new w.MutationObserver(schedule); observer.observe(view, { childList: true, subtree: true }); }
    schedule();
  }
  if (!w.__dcuBound) {
    w.__dcuBound = true;
    d.addEventListener('click', function (e) {
      var more = e.target.closest && e.target.closest('.dcu-more');
      d.querySelectorAll('.dcu-menu:not([hidden])').forEach(function (m) { if (!more || m.previousElementSibling !== more) { m.hidden = true; var b = m.previousElementSibling; if (b) b.setAttribute('aria-expanded', 'false'); } });
      if (more) { e.preventDefault(); e.stopPropagation(); var m = more.nextElementSibling; m.hidden = !m.hidden; more.setAttribute('aria-expanded', String(!m.hidden)); return; }
      if (e.target.closest && e.target.closest('.dcu-menu button')) { var mm = e.target.closest('.dcu-menu'); setTimeout(function () { mm.hidden = true; }, 0); }
    }, true);
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape') d.querySelectorAll('.dcu-menu:not([hidden])').forEach(function (m) { m.hidden = true; }); });
  }
  w.SSMPDDoctorContractsUI = { setAlloc: function (rows) { allocRows = rows; }, start: start, run: function () { view = view || d.body; run(); } };
})(window, document);
