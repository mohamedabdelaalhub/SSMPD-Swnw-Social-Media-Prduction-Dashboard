/* «تشغيل اليوم» shortcut tiles (owner 2026-11-22, mockup docs/ui-references/mockups/today-shortcuts-* approved «طبق يلا»).
 * The sections that used to sit at the bottom of the page (الأطباء · الغرف والطابور · حجوزات آلية · مكالمات تحتاج متابعة ·
 * رسائل في انتظار الإرسال للمرضى · إدارة الغرف) stay where their layers render them, marked [data-tds-panel] with a count
 * ([data-tds-count]). This layer only draws a row of tiles under the filters and opens one panel at a time as a sheet
 * (phone: from the bottom, computer: a side drawer). No data is loaded here and nothing is moved in the DOM, so every
 * layer keeps refreshing its own section. */
(function () {
  'use strict';
  if (window.__SWNWTodayShortcuts) return;
  window.__SWNWTodayShortcuts = true;
  var TILES = [
    ['doctors', 'الأطباء النهارده'],
    ['rooms', 'الغرف والطابور', 'منتظرين'],
    ['auto', 'حجوزات آلية'],
    ['calls', 'مكالمات تحتاج متابعة'],
    ['outbox', 'رسائل في انتظار الإرسال للمرضى'],
    ['admin', 'إدارة الغرف', 'غرفة']
  ];
  var ATTENTION = { auto: 1, calls: 1, outbox: 1 };
  var timer = null, observer = null, lastHtml = '';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* hotfix 2026-11-23 (reception: «الغرف والطابور» did nothing): never act on a hidden / trial / detached copy of the board —
     use the live board the tile belongs to (or the visible one). */
  var current = null;
  function usable(r) { return r && r.isConnected && r.dataset.journeyMode !== 'trial' && r.querySelector('[data-tds-tiles]'); }
  function root() {
    if (usable(current)) return current;
    var all = Array.prototype.slice.call(document.querySelectorAll('[data-journey-root]')).filter(usable);
    current = all.filter(function (r) { return r.getClientRects().length > 0; })[0] || all[0] || document.querySelector('[data-journey-root]');
    return current;
  }
  function panel(r, key) { return r && r.querySelector('[data-tds-panel~="' + key + '"]'); }
  function count(r, key) {
    var p = panel(r, key); if (!p) return null;
    if (key === 'admin') { var part = p.querySelector('[data-qr-part="admin"]'); if (!part || !part.innerHTML.trim()) return null; return Number(p.dataset.tdsRooms || 0); }
    return Number(p.dataset.tdsCount || 0);
  }
  function tilesHtml(r) {
    var open = r.dataset.tdsOpen || '';
    return TILES.map(function (t) {
      var n = count(r, t[0]); if (n === null) return '';
      var att = ATTENTION[t[0]] && n > 0, p = panel(r, t[0]), extra = t[0] === 'auto' && p && Number(p.dataset.tdsAttention || 0) > 0;
      return '<button type="button" class="tds-tile' + (att ? ' is-att' : '') + (open === t[0] ? ' is-on' : '') + '" data-tds-tile="' + t[0] + '" aria-pressed="' + (open === t[0]) + '">' +
        (extra ? '<i class="tds-dot" aria-hidden="true"></i>' : '') + '<span class="tds-n">' + Number(n).toLocaleString('en-US') + '</span><span class="tds-l">' + esc(t[1]) + (t[2] ? ' <small>' + esc(t[2]) + '</small>' : '') + '</span></button>';
    }).join('');
  }
  function paint() {
    var r = root(); if (!r) return;
    var host = r.querySelector('[data-tds-tiles]'); if (!host) return;
    /* hotfix 2026-11-23 (tiles «مش شغالة»): compare with the HTML written last, never with host.innerHTML. ui-motion.js adds
       «fx-pressed» / a ripple <span> to a tile on pointerdown, so the serialized DOM differed during every press and any page
       mutation in that window rewrote the row, detaching the pressed button: the browser then fired no click (dead tap). */
    var h = tilesHtml(r); if (h !== host.__tdsHtml) { host.innerHTML = h; host.__tdsHtml = h; }
    var key = r.dataset.tdsOpen;
    if (key) {
      var p = panel(r, key);
      if (!p) { close(); return; }
      var head = p.querySelector('.journey-section-head');
      if (head && !head.querySelector('[data-tds-close]')) head.insertAdjacentHTML('beforeend', '<button type="button" class="tds-close" data-tds-close aria-label="إغلاق">✕</button>');
      if (key === 'admin') { var m = p.querySelector('details[data-qr-mgr]'); if (m && !m.open) m.open = true; }
      var sw = head && head.querySelector('[data-tds-switch]'), canAdmin = count(r, 'admin') !== null;
      if (head && key === 'rooms' && canAdmin && !sw) head.insertAdjacentHTML('beforeend', '<button type="button" class="btn sm" data-tds-switch="admin">إدارة الغرف</button>');
      else if (sw && (key !== 'rooms' || !canAdmin)) sw.remove();
      if (!r.querySelector('[data-tds-veil]')) r.insertAdjacentHTML('beforeend', '<div class="tds-veil" data-tds-veil></div>');
    } else { var v = r.querySelector('[data-tds-veil]'); if (v) v.remove(); }
  }
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; paint(); }, 60); }
  function open(key, retried) {
    var r = root(); if (!r) return;
    if (!panel(r, key) && (key === 'rooms' || key === 'admin')) {
      /* the rooms section is re-attached by its own layer; load it now instead of silently doing nothing */
      var Q = window.__SWNWQueueTest;
      if (!retried && Q && Q.refresh) { Q.refresh(true).then(function () { setTimeout(function () { open(key, true); }, 80); }); return; }
      if (window.SSMPDToast) window.SSMPDToast.show('الغرف والطابور لسه بتحمّل — جرّب كمان ثانية', 'error');
      return;
    }
    r.dataset.tdsOpen = key; document.documentElement.classList.add('tds-locked');
    paint();
    var p = panel(r, key); if (p) { p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.scrollTop = 0; var c = p.querySelector('[data-tds-close]'); if (c) c.focus(); }
    if (key === 'auto' && window.SSMPDTodayAuto) window.SSMPDTodayAuto.refresh();
  }
  function close() {
    var r = root(); if (r) { var key = r.dataset.tdsOpen; delete r.dataset.tdsOpen; var p = key && panel(r, key); if (p) { p.removeAttribute('role'); p.removeAttribute('aria-modal'); } var t = key && r.querySelector('[data-tds-tile="' + key + '"]'); paint(); if (t) { t = r.querySelector('[data-tds-tile="' + key + '"]'); if (t) t.focus(); } }
    document.documentElement.classList.remove('tds-locked');
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-tds-tile]');
    var sw = e.target.closest && e.target.closest('[data-tds-switch]');
    if (sw) { e.preventDefault(); open(sw.dataset.tdsSwitch); return; }
    if (t && t.closest('[data-journey-root]')) { e.preventDefault(); current = t.closest('[data-journey-root]'); var r = root(); if (r && r.dataset.tdsOpen === t.dataset.tdsTile) close(); else open(t.dataset.tdsTile); return; }
    if (e.target.closest && (e.target.closest('[data-tds-close]') || e.target.closest('[data-tds-veil]'))) { e.preventDefault(); close(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.rx-modal,.qr-big') && root() && root().dataset.tdsOpen) close(); });
  function watch() {
    if (observer) return;
    observer = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { var n = list[i].target; if (n.closest && n.closest('[data-tds-tiles]')) continue; schedule(); return; }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tds-count', 'data-tds-attention', 'data-tds-rooms'] });
    paint();
  }
  window.SSMPDTodayShortcuts = { open: open, close: close, refresh: paint };
  if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
})();
