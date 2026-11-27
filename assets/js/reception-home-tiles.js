/* Reception home — tidy tiles (owner «طبّق شكل الريسبشن أ» 2026-11-27, mockup docs/ui-references/mockups/reception-home-a.html).
   The three cards that reception-shift-expenses.js / drawer-requests.js / month-end-accounts.js put inside the blue hero become three tiles in a row UNDER the hero.
   Nothing is removed (rule 11): the original cards stay in the page (hidden) and keep all their logic; tapping a tile opens a popup that shows the real card
   (with every list and button), and the tile's action button presses the card's own button. «اتصرف» is the big number of the expenses tile:
   navy while it is 0, orange (#F15A22) once anything was spent. */
(function (w, d) {
  'use strict';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { return Number(v) || 0; }
  function money(v) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n(v)); }
  function ic(p) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var ICON = { rse: ic('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'), rdr: ic('<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/><path d="M7 3.5h10"/>'), mea: ic('<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>') };
  var KINDS = [
    { key: 'rse', sel: '[data-rse]', cls: 'a1', title: 'مصروفات الوردية', go: 'سجّل مصروف', btn: '[data-rse-spend]' },
    { key: 'rdr', sel: '[data-rdr]', cls: 'a2', title: 'طلب صرف من الدرج', go: 'اطلب صرف', btn: '[data-rdr-new]' },
    { key: 'mea', sel: '[data-mea-card]', cls: 'a3', title: 'تحويلات ومعمل الأسنان', go: 'سجّل تحويل', btn: null }
  ];
  function at(card, k) { return card.getAttribute('data-rht-' + k); }
  function chip(label, val, hot) { return '<div' + (hot ? ' class="hot"' : '') + '><small>' + esc(label) + '</small><b dir="ltr">' + esc(val) + '</b></div>'; }
  function view(kind, card) {
    if (kind.key === 'rse') {
      var spent = n(at(card, 'spent')), allow = n(at(card, 'allow')), left = n(at(card, 'left'));
      return { sub: at(card, 'reg') || '', label: 'اتصرف في الوردية', num: money(spent), unit: 'ج', hot: spent > 0, can: at(card, 'can') === '1',
        facts: '<span>هامش <b dir="ltr">' + money(allow) + '</b></span><span>باقي <b dir="ltr">' + money(left) + '</b></span>',
        sum: chip('هامش الوردية', money(allow)) + chip('اتصرف', money(spent), spent > 0) + chip('باقي', money(left)) };
    }
    if (kind.key === 'rdr') {
      var p = n(at(card, 'pending')), a = n(at(card, 'approved')), t = n(at(card, 'total'));
      return { sub: 'سلفة · حافز · فاتورة مورد', label: 'طلبات منتظرة الاعتماد', num: String(p), unit: 'طلب', hot: false, can: at(card, 'can') === '1',
        facts: (p ? '<span class="rht-chip warn">منتظر اعتماد</span>' : '') + (a ? '<span class="rht-chip ok">جاهز للصرف ' + a + '</span>' : '') + (!p && !a ? '<span>مفيش طلبات منتظرة</span>' : ''),
        sum: chip('منتظرة', p) + chip('جاهزة للصرف', a) + chip('كل طلباتك', t) };
    }
    var c = n(at(card, 'count')), th = n(at(card, 'tahera')), lab = n(at(card, 'lab'));
    return { sub: 'بتتحسب آخر الشهر', label: 'مسجّل هذا الشهر', num: String(c), unit: 'حالة', hot: false, can: true,
      facts: '<span>الطاهرة <b dir="ltr">' + th + '</b></span><span>معمل الأسنان <b dir="ltr">' + lab + '</b></span>', sum: chip('الكل', c) + chip('الطاهرة', th) + chip('معمل الأسنان', lab) };
  }
  function tileHtml(kind, v) {
    return '<div class="rht-top"><span class="rht-ico" aria-hidden="true">' + ICON[kind.key] + '</span><div class="rht-tt"><h4>' + esc(kind.title) + '</h4><div class="rht-sub">' + esc(v.sub) + '</div></div><span class="rht-chev" aria-hidden="true">‹</span></div>' +
      '<div class="rht-lbl">' + esc(v.label) + '</div><div class="rht-num' + (v.hot ? ' rht-hot' : '') + '"><bdi>' + esc(v.num) + '</bdi><small>' + esc(v.unit) + '</small></div>' +
      '<div class="rht-facts">' + v.facts + '</div><button type="button" class="rht-go" data-rht-go="' + kind.key + '"' + (v.can ? '' : ' disabled') + '>' + esc(kind.go) + '</button>';
  }
  function cardOf(host, kind) { return host.querySelector(kind.sel); }

  /* ---------- popup: the real card, moved in and put back ---------- */
  var openPop = null;
  function closePop() {
    var p = openPop; if (!p) return; openPop = null;
    p.obs.disconnect(); d.removeEventListener('keydown', p.key, true);
    var card = p.card;
    if (card && card.isConnected && p.ph && p.ph.isConnected) {
      var fresh = p.host.querySelector(p.kind.sel);
      if (fresh && fresh !== card) card.remove(); else { p.ph.replaceWith(card); card.hidden = true; }
    }
    if (p.ph && p.ph.isConnected) p.ph.remove();
    p.box.remove(); if (p.opener && p.opener.isConnected) p.opener.focus();
  }
  function openPopup(host, kind, opener) {
    if (openPop) closePop();
    var card = cardOf(host, kind); if (!card) return;
    var v = view(kind, card), box = d.createElement('div'); box.className = 'modal-backdrop rht-pop'; box.dataset.rhtPop = kind.key;
    box.innerHTML = '<section class="modal" role="dialog" aria-modal="true" dir="rtl" aria-label="' + esc(kind.title) + '"><div class="modal-head"><h3>' + esc(kind.title) + '</h3><button type="button" class="modal-close" data-rht-x aria-label="إغلاق">×</button></div><div class="rht-sum">' + v.sum + '</div><div class="rht-body"></div></section>';
    var body = box.querySelector('.rht-body'), ph = d.createComment('rht');
    card.parentNode.insertBefore(ph, card); body.appendChild(card); card.hidden = false; d.body.appendChild(box);
    var obs = new w.MutationObserver(function () { if (!body.querySelector(kind.sel)) closePop(); }); obs.observe(body, { childList: true });
    var key = function (e) { if (e.key === 'Escape' && !d.querySelector('.rx-modal,.wp-overlay')) { e.preventDefault(); closePop(); } };
    d.addEventListener('keydown', key, true);
    box.addEventListener('click', function (e) { if (e.target === box || e.target.closest('[data-rht-x]')) closePop(); });
    openPop = { box: box, card: card, ph: ph, host: host, kind: kind, obs: obs, key: key, opener: opener };
    var x = box.querySelector('[data-rht-x]'); if (x) x.focus();
  }

  /* ---------- tiles row ---------- */
  function enhance(host) {
    var st = host.__rht; if (!st) return;
    if (!host.isConnected) { st.obs.disconnect(); host.__rht = null; return; }
    var found = KINDS.map(function (k) { return [k, cardOf(host, k)]; }).filter(function (x) { return x[1]; });
    var row = host.querySelector('[data-rht]');
    if (!row && !found.length) return;
    if (!row) {
      row = d.createElement('section'); row.className = 'rht'; row.dataset.rht = ''; row.setAttribute('aria-label', 'الصرف والتحويلات');
      var head = host.querySelector('.rx-header'); if (head && head.parentNode) head.parentNode.insertBefore(row, head.nextSibling); else host.prepend(row);
      row.addEventListener('click', function (e) {
        var go = e.target.closest('[data-rht-go]'), tile = e.target.closest('[data-rht-tile]'); if (!tile) return;
        var kind = KINDS.filter(function (k) { return k.key === tile.dataset.rhtTile; })[0];
        if (go) { e.stopPropagation(); if (go.disabled) return; var btn = kind.btn && cardOf(host, kind) && cardOf(host, kind).querySelector(kind.btn); if (btn) { if (!btn.disabled) btn.click(); } else openPopup(host, kind, go); return; }
        openPopup(host, kind, tile);
      });
      row.addEventListener('keydown', function (e) { var tile = e.target.closest && e.target.closest('[data-rht-tile]'); if (tile && e.target === tile && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tile.click(); } });
    }
    var stash = host.querySelector('[data-rht-stash]');
    if (!stash) { stash = d.createElement('div'); stash.hidden = true; stash.dataset.rhtStash = ''; row.parentNode.insertBefore(stash, row.nextSibling); }
    found.forEach(function (x) {
      var kind = x[0], card = x[1];
      if (!card.hasAttribute('data-rht-src')) { card.setAttribute('data-rht-src', kind.key); card.hidden = true; }
      /* the cards leave the hero (they stay in the page, inside the hidden stash, where the modules still find them) */
      if (card.parentNode !== stash) stash.appendChild(card);
      var tile = row.querySelector('[data-rht-tile="' + kind.key + '"]');
      if (!tile) {
        tile = d.createElement('article'); tile.className = 'rx-card rht-tile ' + kind.cls; tile.dataset.rhtTile = kind.key; tile.tabIndex = 0; tile.setAttribute('role', 'group'); tile.setAttribute('aria-label', kind.title);
        var after = null; KINDS.forEach(function (k) { if (KINDS.indexOf(k) < KINDS.indexOf(kind)) { var t = row.querySelector('[data-rht-tile="' + k.key + '"]'); if (t) after = t; } });
        row.insertBefore(tile, after ? after.nextSibling : row.firstChild);
      }
      var v = view(kind, card), html = tileHtml(kind, v); if (tile.__html !== html) { tile.innerHTML = html; tile.__html = html; }
    });
  }
  var timers = [];
  function schedule(host) { if (host.__rhtQ) return; host.__rhtQ = true; w.requestAnimationFrame(function () { host.__rhtQ = false; enhance(host); }); }
  function attach(host) {
    if (!host || !host.querySelector) return;
    if (host.__rht) { schedule(host); return; }
    var obs = new w.MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m.type !== 'childList') continue; for (var j = 0; j < m.addedNodes.length; j++) { var x = m.addedNodes[j]; if (x.nodeType === 1 && (x.matches && KINDS.some(function (k) { return x.matches(k.sel); }) || x.querySelector && KINDS.some(function (k) { return x.querySelector(k.sel); }))) { schedule(host); return; } } }
    });
    host.__rht = { obs: obs }; obs.observe(host, { childList: true, subtree: true }); schedule(host);
  }
  var se = w.SSMPDShiftExpenses;
  if (se && se.decorate && !se._rht) { var orig = se.decorate; se.decorate = function (c, section) { orig(c, section); if (c && c.host) attach(c.host); }; se._rht = true; }
  w.SSMPDReceptionHome = { attach: attach, enhance: enhance, close: closePop, _kinds: KINDS };
})(window, document);
