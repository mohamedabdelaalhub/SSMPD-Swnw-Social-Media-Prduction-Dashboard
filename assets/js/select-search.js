/* Type-to-search on every big list (owner rule 12, 2026-11-26: «اي زرار بيفتح عدد كبير من البيانات دايما يبقي فيه اوبشن كتابة»).
   ONE shared enhancer, applied automatically to any <select> that can hold many items: 9+ options, or 5+ when it is clearly a data list
   (patients, invoices, doctors, employees, suppliers, accounts…). A search box appears right above it; typing shrinks the list to the matches.
   - Arabic-friendly: أ/إ/آ→ا، ة→ه، ى→ي، no tashkeel, Arabic-Indic digits → 0-9, every word must match.
   - Matches the visible text plus data-code / data-phone / data-file / data-alias / data-department / data-search and short non-UUID values.
   - The <select> stays the real form field: same options, same data-* , same value. Filtering never silently changes the chosen value —
     the original choice comes back when the box is cleared or the form is sent without picking.
   - Keyboard: ↓ goes into the list, Enter picks the first match, Esc clears. Opt out with data-ss-off. Force with data-searchable.
   Service lists keep their own enhancer (service-select-search.js). */
(function (w, d) {
  'use strict';
  var MIN_ANY = 9, MIN_DATA = 5, DATA = /(patient|invoice|doctor|employee|person|supplier|vendor|account|user|admin|item|register|contract|case|visit|booking|appointment|advance|payer|company|insurer|file|shift|drawer|branch|department|clinic|room|device|template|campaign|lead|order|request)/i;
  var OFF = /^(month|year|hour|minute|lang|language|per_?page|page_?size|limit|sort|order_by|period|day|days|tz|timezone)$/i;
  function norm(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); }).replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 1776); })
      .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  }
  var ATTRS = ['data-code', 'data-phone', 'data-file', 'data-alias', 'data-department', 'data-search', 'data-name'];
  function entries(sel) {
    var all = [];
    Array.prototype.forEach.call(sel.children, function (ch) {
      if (ch.tagName === 'OPTGROUP') Array.prototype.forEach.call(ch.children, function (o) { all.push({ o: o, g: ch.label }); }); else if (ch.tagName === 'OPTION') all.push({ o: ch, g: '' });
    });
    all.forEach(function (x) {
      var v = x.o.value, extra = ATTRS.map(function (a) { return x.o.getAttribute(a); }).join(' ');
      if (v && v.length <= 24 && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) extra += ' ' + v;
      x.key = norm([x.o.textContent, x.g, extra].join(' '));
    });
    return all;
  }
  function plain(sel) {
    var opts = Array.prototype.filter.call(sel.options, function (o) { return o.value !== ''; });
    return opts.length && opts.every(function (o) { return /^[\d:.,\s\-\/]+$/.test(o.textContent.trim()); });
  }
  function eligible(sel) {
    if (!sel || sel.tagName !== 'SELECT' || sel.multiple || (sel.size && sel.size > 1) || sel.disabled) return false;
    if (sel.__ss || sel.hasAttribute('data-sss') || sel.hasAttribute('data-ss-off') || sel.hasAttribute('data-sss-off')) return false;
    if (sel.name === 'service_id' || sel.hasAttribute('data-service-select')) return false;
    if (sel.closest && (sel.closest('.sss,.ss-box,template') || sel.closest('[data-ss-off]'))) return false;
    var id = (sel.name || sel.id || '');
    if (OFF.test(id)) return false;
    var n = Array.prototype.filter.call(sel.options, function (o) { return o.value !== ''; }).length;
    if (sel.hasAttribute('data-searchable')) return n >= 2;
    if (plain(sel)) return false;
    return n >= MIN_ANY || (n >= MIN_DATA && DATA.test(id + ' ' + (sel.className || '') + ' ' + (sel.getAttribute('aria-label') || '')));
  }
  function enhance(sel) {
    if (!eligible(sel)) return;
    var st = { all: entries(sel), chosen: sel.value, query: '' };
    sel.__ss = st; sel.setAttribute('data-ss', '');
    var box = d.createElement('div'); box.className = 'sss ss-box';
    box.innerHTML = '<input type="search" class="sss-q" data-ss-q placeholder="اكتب للبحث…" autocomplete="off" aria-label="بحث في القايمة"><small class="sss-n" data-ss-n role="status"></small>';
    sel.parentNode.insertBefore(box, sel);
    var q = box.querySelector('input'), note = box.querySelector('small');
    function rebuild(list, keep) {
      var groups = {}, order = [];
      list.forEach(function (x) { if (x.o.value === '' && !x.g) return; var g = x.g || ''; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(x.o); });
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      var ph = st.all.filter(function (x) { return x.o.value === '' && !x.g; })[0]; if (ph) sel.appendChild(ph.o);
      order.forEach(function (g) {
        if (!g) { groups[g].forEach(function (o) { sel.appendChild(o); }); return; }
        var og = d.createElement('optgroup'); og.label = g; groups[g].forEach(function (o) { og.appendChild(o); }); sel.appendChild(og);
      });
      if (keep && list.some(function (x) { return x.o.value === keep; })) sel.value = keep; else sel.selectedIndex = -1;
      /* our own option moves must not look like the app changing the list: drop those records now, hand every other pending record on */
      if (mo) handle(mo.takeRecords().filter(function (r) { return r.target !== sel; }));
    }
    function reset() { q.value = ''; st.query = ''; rebuild(st.all, st.chosen); sel.removeAttribute('size'); note.textContent = ''; }
    st.reindex = function () { st.all = entries(sel); st.chosen = sel.value; q.value = ''; st.query = ''; sel.removeAttribute('size'); note.textContent = ''; };
    q.addEventListener('input', function () {
      var t = norm(q.value).split(' ').filter(Boolean); st.query = t.join(' ');
      if (!t.length) { reset(); return; }
      var hit = st.all.filter(function (x) { return x.o.value !== '' && t.every(function (k) { return x.key.indexOf(k) >= 0; }); });
      rebuild(hit, st.chosen); sel.size = Math.max(2, Math.min(8, hit.length + 1));
      note.textContent = hit.length ? hit.length + ' نتيجة' : 'مفيش نتيجة — جرّب كلمة تانية';
      if (hit.length === 1) { sel.value = hit[0].o.value; st.chosen = sel.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && q.value) { e.preventDefault(); e.stopPropagation(); reset(); }
      else if (e.key === 'Enter') { e.preventDefault(); var f = Array.prototype.filter.call(sel.options, function (o) { return o.value; })[0]; if (f) { sel.value = f.value; st.chosen = sel.value; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.focus(); } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel.focus(); if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0; }
    });
    sel.addEventListener('change', function () {
      if (sel.value) { st.chosen = sel.value; if (q.value) { var o = sel.options[sel.selectedIndex]; note.textContent = 'اخترت: ' + (o ? o.textContent : ''); } }
    });
    if (sel.form && !sel.form.__ssSubmit) {
      sel.form.__ssSubmit = true;
      // a half-finished search must never change what the form sends: put the original choice back before submit
      sel.form.addEventListener('submit', function () { Array.prototype.forEach.call(sel.form.querySelectorAll('select[data-ss]'), function (s) { var z = s.__ss; if (z && z.query && s.selectedIndex < 0) { var qq = s.previousElementSibling && s.previousElementSibling.querySelector('input'); if (qq) { qq.value = ''; qq.dispatchEvent(new Event('input')); } } }); }, true);
    }
  }
  var queue = [], queued = false, mo = null;
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'SELECT') enhance(root);
    Array.prototype.forEach.call(root.querySelectorAll('select'), enhance);
  }
  function flush() { queued = false; var n = queue; queue = []; n.forEach(function (x) { if (x.isConnected) scan(x); }); }
  function handle(ms) {
    var add = false;
    ms.forEach(function (m) {
      if (m.target && m.target.tagName === 'SELECT' && m.target.__ss) m.target.__ss.reindex();
      m.addedNodes.forEach(function (x) { if (x.nodeType === 1 && (x.tagName === 'SELECT' || x.querySelector && x.querySelector('select'))) { queue.push(x); add = true; } });
      if (m.target && m.target.tagName === 'SELECT' && !m.target.__ss) { queue.push(m.target); add = true; }
    });
    if (add && !queued) { queued = true; w.requestAnimationFrame(flush); }
  }
  function start() {
    scan(d.body);
    mo = new w.MutationObserver(handle);
    mo.observe(d.body, { childList: true, subtree: true });
  }
  if (d.body) start(); else d.addEventListener('DOMContentLoaded', start);
  w.SSMPDSelectSearch = { enhance: enhance, scan: scan, norm: norm };
})(window, document);
