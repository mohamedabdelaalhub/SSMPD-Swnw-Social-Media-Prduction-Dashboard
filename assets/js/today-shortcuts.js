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
  function root() { return document.querySelector('[data-journey-root]'); }
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
    var h = tilesHtml(r); if (h !== host.innerHTML) host.innerHTML = h;
    var key = r.dataset.tdsOpen;
    if (key) {
      var p = panel(r, key);
      if (!p) { close(); return; }
      var head = p.querySelector('.journey-section-head');
      if (head && !head.querySelector('[data-tds-close]')) head.insertAdjacentHTML('beforeend', '<button type="button" class="tds-close" data-tds-close aria-label="إغلاق">✕</button>');
      if (key === 'admin') { var m = p.querySelector('details[data-qr-mgr]'); if (m && !m.open) m.open = true; }
      if (!r.querySelector('[data-tds-veil]')) r.insertAdjacentHTML('beforeend', '<div class="tds-veil" data-tds-veil></div>');
    } else { var v = r.querySelector('[data-tds-veil]'); if (v) v.remove(); }
  }
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; paint(); }, 60); }
  function open(key) {
    var r = root(); if (!r) return;
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
    if (t && t.closest('[data-journey-root]')) { e.preventDefault(); var r = root(); if (r && r.dataset.tdsOpen === t.dataset.tdsTile) close(); else open(t.dataset.tdsTile); return; }
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
