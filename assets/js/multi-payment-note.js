/* «الملاحظة جنب الدفعة اللي غطّت أكتر من زيارة» (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/multi-payment-note-everywhere.*).
   One look everywhere: a badge «دفعة واحدة لـN زيارات» (orange «— لأكتر من مريض» when it paid another patient's visit) + the note,
   and under any receipts count a line that says why receipts ≠ visits, opening the list of those payments with their notes.
   Data: public.clinic_reception_multi_payments(p jsonb) (20261122390000). */
(function () {
  'use strict';
  if (window.SSMPDMultiPay) return;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function css() {
    if (document.getElementById('mpn-style')) return;
    var s = document.createElement('style'); s.id = 'mpn-style';
    s.textContent = '.mpn-badge{display:inline-block;margin-top:4px;background:#EAF0FF;color:#0F369D;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;line-height:1.6}' +
      '.mpn-badge.x{background:#FFF1EA;color:#B5410F}' +
      '.mpn-note{display:block;margin-top:4px;font-size:12px;color:#16212E;background:#F6F8FC;border-right:3px solid #0F369D;border-radius:6px;padding:4px 8px;line-height:1.7;overflow-wrap:anywhere}' +
      '.mpn-note.x{border-color:#F15A22}.mpn-lines{display:block;font-size:12px;color:#5b6577;margin-top:2px}' +
      '.mpn-why{font-size:12px;color:#5b6577;line-height:1.7;margin:4px 0 0}.mpn-why button{background:none;border:0;padding:0;color:#0F369D;text-decoration:underline;cursor:pointer;font:inherit}' +
      '.mpn-modal{position:fixed;inset:0;background:rgba(22,33,46,.45);display:grid;place-items:center;padding:16px;z-index:9998}' +
      '.mpn-box{background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:85vh;overflow:auto;padding:16px;display:grid;gap:10px;direction:rtl}' +
      '.mpn-box h3{margin:0;color:#0F369D;font-size:16px}.mpn-row{border:1px solid #D5DEEE;border-radius:12px;padding:10px 12px}' +
      '.mpn-row .top{display:flex;justify-content:space-between;gap:8px;font-weight:700}';
    document.head.appendChild(s);
  }
  function badge(visits, cross) {
    css();
    return '<span class="mpn-badge' + (cross ? ' x' : '') + '" data-mpn-badge>دفعة واحدة لـ' + num(visits) + ' زيارات' + (cross ? ' — لأكتر من مريض' : '') + '</span>';
  }
  function note(text, cross) { css(); return text ? '<span class="mpn-note' + (cross ? ' x' : '') + '" data-mpn-note>' + esc(text) + '</span>' : ''; }
  /* badge + note, only when the payment covered more than one visit */
  function block(visits, text, cross) { return Number(visits) > 1 ? badge(visits, cross) + note(text, cross) : ''; }
  /* distinct visits of a list of allocations [{visit_no|invoice_id|...}] */
  function countVisits(list, keyOf) {
    var seen = {}; (list || []).forEach(function (a) { var k = keyOf ? keyOf(a) : (a.visit_no != null ? 'v' + a.visit_no : 'i' + (a.invoice_id || a.id)); if (k) seen[k] = 1; });
    return Object.keys(seen).length;
  }
  function rpc(args) {
    var c = window.SSMPDDb && window.SSMPDDb.client; if (!c) return Promise.resolve(null);
    return Promise.resolve(c.rpc('clinic_reception_multi_payments', { p: args || {} })).then(function (r) { if (r && r.error) throw new Error(r.error.message || 'حصل خطأ'); return r ? r.data : null; });
  }
  var cache = {};
  function load(args) { var k = JSON.stringify(args || {}); if (!cache[k]) cache[k] = rpc(args).catch(function () { delete cache[k]; return null; }); return cache[k]; }
  /* «41 إيصال — منهم 3 دفعات غطّت أكتر من زيارة (7 زيارات) اعرضها» */
  function why(sum) {
    if (!sum || !Number(sum.multi)) return '';
    css();
    return '<p class="mpn-why" data-mpn-why>' + num(sum.receipts) + ' إيصال — منهم ' + num(sum.multi) + (Number(sum.multi) === 1 ? ' دفعة غطّت' : ' دفعات غطّت') + ' أكتر من زيارة (' + num(sum.multi_visits) + ' زيارة) <button type="button" data-mpn-open>اعرضها</button></p>';
  }
  function listHtml(sum) {
    return '<div class="mpn-box" role="dialog" aria-modal="true" aria-label="دفعات غطّت أكتر من زيارة"><h3>دفعات غطّت أكتر من زيارة</h3>' +
      (sum.rows || []).map(function (r) {
        return '<div class="mpn-row"><div class="top"><span dir="ltr">' + esc(r.receipt_no || r.reference || '') + '</span><span>' + num(r.amount) + ' ج.م</span></div>' +
          badge(r.visits, r.cross_patient) + note(r.note, r.cross_patient) +
          '<span class="mpn-lines">' + (r.lines || []).map(function (l) { return esc(l.patient) + ' — ' + esc(l.no || '') + ' (' + num(l.applied) + ')'; }).join(' + ') + ' · ' + esc(r.by || '') + '</span></div>';
      }).join('') + '<button type="button" class="btn" data-mpn-close>إغلاق</button></div>';
  }
  function openList(sum) {
    css(); var m = document.createElement('div'); m.className = 'mpn-modal'; m.innerHTML = listHtml(sum); document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-mpn-close]')) m.remove(); });
  }
  /* put the «why» line right after `host` for this scope; idempotent */
  var seq = 0;
  function explain(host, args) {
    if (!host) return Promise.resolve(null);
    if (!host.dataset.mpnFor) host.dataset.mpnFor = 'm' + (++seq);
    return load(args).then(function (sum) {
      if (!host.isConnected) return sum;
      var old = host.parentNode && host.parentNode.querySelector('[data-mpn-why][data-mpn-of="' + host.dataset.mpnFor + '"]'); if (old) old.remove();
      var h = why(sum); if (!h) return sum;
      host.insertAdjacentHTML('afterend', h.replace('data-mpn-why', 'data-mpn-why data-mpn-of="' + host.dataset.mpnFor + '"'));
      var line = host.nextElementSibling; line.querySelector('[data-mpn-open]').onclick = function () { openList(sum); };
      return sum;
    });
  }
  window.SSMPDMultiPay = { badge: badge, note: note, block: block, countVisits: countVisits, load: load, why: why, explain: explain, openList: openList, _reset: function () { cache = {}; } };
})();
