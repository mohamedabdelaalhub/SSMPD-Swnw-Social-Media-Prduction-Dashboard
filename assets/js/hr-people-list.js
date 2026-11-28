/* «شؤون الموظفين → الموظفون والأطباء» — clear list (owner «طبّق شكل قايمة الموظفين» 2026-11-28, mockup docs/ui-references/mockups/hr-people-clear.html, Sonu Glass).
   Post-processes the people shell that hr-navigation.js builds (same data, same handlers; nothing removed — rule 11):
   - 4 summary tiles (all / working / incomplete / ended) that set the existing status filter;
   - ONE toolbar card: search + «إضافة موظف أو طبيب» (primary), the existing filters, removable chips for active filters, and the secondary buttons (export / tasks / performance)
     moved under «خيارات متقدمة»;
   - the person cards become compact rows with an initial avatar;
   - the open person file (inline detail) becomes a popup with ✕ and a back arrow at the far left (owner decision); both press the file's own «إغلاق التفاصيل». */
(function (w, d) {
  'use strict';
  var KEY = { kind: 'نوع التعاقد', department: 'القسم', branch: 'الفرع', status: 'الحالة' },
    NAMES = { employee: 'موظف', doctor: 'طبيب متعاون', both: 'طبيب وموظف', unclassified: 'يحتاج استكمالًا', active: 'يعمل', needs_setup: 'ملف ناقص', on_leave: 'إجازة', ended: 'انتهت الخدمة' };
  function el(tag, cls, html) { var n = d.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var popEsc = null;
  function closePopEsc() { if (popEsc) { d.removeEventListener('keydown', popEsc, true); popEsc = null; } }
  function tiles(shell, data, state, redraw) {
    var ps = data.people || [], c = { all: ps.length, active: 0, needs_setup: 0, ended: 0 };
    ps.forEach(function (p) { if (p.status === 'active') c.active++; else if (p.status === 'needs_setup') c.needs_setup++; else if (p.status === 'ended') c.ended++; });
    var T = [['all', 'إجمالي الملفات', 'i1', '●', 'blue'], ['active', 'على رأس العمل', 'i2', '✓', 'ok'], ['needs_setup', 'ملفات محتاجة استكمال', 'i3', '!', 'hot'], ['ended', 'انتهت خدمتهم', 'i4', '–', 'mute']];
    var box = el('section', 'hpl-tiles'); box.setAttribute('data-hpl-tiles', ''); box.setAttribute('aria-label', 'ملخص الملفات');
    T.forEach(function (t) {
      var on = t[0] === 'all' ? !(state.status || state.kind || state.department || state.branch) : state.status === t[0];
      var b = el('button', 'hpl-card hpl-tile ' + t[4] + (on ? ' on' : ''), '<span class="hpl-ico ' + t[2] + '" aria-hidden="true">' + t[3] + '</span><small>' + t[1] + '</small><b>' + c[t[0]] + '</b>'); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('data-hpl-tile', t[0]);
      b.onclick = function () { if (t[0] === 'all') { state.kind = state.department = state.branch = state.status = ''; } else state.status = state.status === t[0] ? '' : t[0]; redraw(); };
      box.appendChild(b);
    });
    return box;
  }
  function toolbar(shell, data, state, redraw) {
    var bar = el('section', 'hpl-card hpl-bar'); bar.setAttribute('data-hpl-bar', '');
    var r1 = el('div', 'hpl-r1'), sin = shell.querySelector(':scope > label input[name=search]'), sw = sin && sin.closest('label');
    if (sw) { sw.classList.add('hpl-search'); r1.appendChild(sw); }
    var add = shell.querySelector(':scope > [data-wp=new]'); if (add) { add.classList.add('hpl-add'); r1.appendChild(add); }
    bar.appendChild(r1);
    var filters = shell.querySelector(':scope > .wn-filters'); if (filters) { filters.classList.add('hpl-filters'); bar.appendChild(filters); }
    var act = [];
    Object.keys(KEY).forEach(function (k) { if (state[k]) act.push([k, KEY[k] + ': ' + (NAMES[state[k]] || state[k])]); });
    if (act.length) {
      var chips = el('div', 'hpl-chips'); act.forEach(function (a) { var c = el('button', 'hpl-chip', esc(a[1]) + ' ✕'); c.type = 'button'; c.setAttribute('aria-label', 'إلغاء فلتر ' + a[1]); c.onclick = function () { state[a[0]] = ''; redraw(); }; chips.appendChild(c); });
      var clr = el('button', 'hpl-clear', 'مسح الفلاتر'); clr.type = 'button'; clr.onclick = function () { state.kind = state.department = state.branch = state.status = ''; redraw(); }; chips.appendChild(clr); bar.appendChild(chips);
    }
    var more = [].slice.call(shell.querySelectorAll(':scope > [data-wp=export],:scope > [data-wp=tasks],:scope > [data-wp=performance]'));
    if (more.length) { var det = el('details', 'hpl-adv', '<summary class="btn">خيارات متقدمة</summary>'), body = el('div', 'hpl-advbody'); more.forEach(function (b) { body.appendChild(b); }); det.appendChild(body); bar.appendChild(det); }
    return bar;
  }
  function rows(shell) {
    shell.querySelectorAll('[data-wp=person]').forEach(function (c) {
      c.classList.add('hpl-row'); if (c.querySelector('.hpl-av')) return;
      var nm = (c.querySelector('b') || {}).textContent || '', init = nm.replace(/^د\.\s*/, '').trim().charAt(0) || '·', isDr = /طبيب/.test((c.querySelector('span') || {}).textContent || '') || /^د\./.test(nm);
      var av = el('span', 'hpl-av' + (isDr ? ' dr' : ''), esc(init)); av.setAttribute('aria-hidden', 'true'); c.insertBefore(av, c.firstChild);
    });
  }
  function popup(shell) {
    var detail = shell.querySelector(':scope > .wp-detail:not([data-hr-payroll])'); if (!detail || detail.closest('.hpl-pop')) return;
    var close = detail.querySelector('[data-wp=close]'), nm = ((detail.querySelector('h2,h3') || {}).textContent || 'ملف الموظف').trim();
    var box = el('div', 'modal-backdrop hpl-pop'), card = el('section', 'modal hpl-modal'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-label', nm);
    var head = el('div', 'modal-head hpl-head', '<button type="button" class="modal-close hpl-x" data-hpl-x aria-label="إغلاق">✕</button><h3>' + esc(nm) + '</h3><button type="button" class="hpl-back" data-hpl-back aria-label="رجوع">←</button>');
    var shut = function () { closePopEsc(); if (close) close.click(); };
    head.querySelector('[data-hpl-x]').onclick = shut; head.querySelector('[data-hpl-back]').onclick = shut;
    card.appendChild(head); var body = el('div', 'hpl-body'); body.appendChild(detail); card.appendChild(body); box.appendChild(card); shell.appendChild(box);
    box.addEventListener('click', function (e) { if (e.target === box) shut(); });
    closePopEsc(); popEsc = function (e) { if (e.key === 'Escape' && !d.querySelector('.rx-modal,.wp-overlay,.modal-backdrop:not(.hpl-pop)')) { e.preventDefault(); shut(); } }; d.addEventListener('keydown', popEsc, true);
    var x = head.querySelector('[data-hpl-x]'); if (x && x.focus) x.focus();
  }
  function decorate(shell, data, state, redraw) {
    if (!shell || !data || !data.can_manage || shell.querySelector('[data-hpl-tiles]')) return;
    var anchor = shell.firstChild, t = tiles(shell, data, state, redraw), bar = toolbar(shell, data, state, redraw);
    shell.insertBefore(t, anchor); shell.insertBefore(bar, anchor); rows(shell); popup(shell);
    if (!shell.querySelector('.hpl-pop')) closePopEsc();
  }
  w.SSMPDHRPeopleList = { decorate: decorate };
})(window, document);
