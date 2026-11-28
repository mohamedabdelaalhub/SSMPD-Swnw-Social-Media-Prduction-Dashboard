/* «شغل اليوم — التمريض»: the buttons a nurse / storekeeper uses every day, visible on the nursing screen (owner «جميل طبقه» 2026-11-28,
   mockup docs/ui-references/mockups/nursing-home.html, Sonu Glass). No section tree: each button lands straight on its action.
   Nothing new on the server: every button reuses an existing flow (rule 11) and appears ONLY when this role can use it (rule 9):
   - «استهلاك الزيارة / طقم الفيتلة / العلامات الحيوية»: the nursing screen's own buttons and triage (clicked for you);
   - «صرف داخلي من مخزني / فتحت عبوة جديدة / صرف مستلزم إضافي / طلب توريد / تحويل واستلام / جرد / رصيد مخزني / سجل الحركات»:
     open the matching view of «المخزون» directly (inventory_consume_at kind issue, as the usage form does). «فتحت عبوة جديدة» pre-fills quantity 1 and the
     purpose «فتح عبوة جديدة — <القسم>». No cost price is shown by this panel. */
(function (w, d) {
  'use strict';
  if (w.__SWNWNursingHomeV1) return; w.__SWNWNursingHomeV1 = true;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function admin() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin; }
  function invOk() { var R = w.SSMPDRoles, a = admin(); return !!(R && a && R.canSeeTab && R.canSeeTab(a, 'inventory') && (!R.canModuleAction || R.canModuleAction(a, 'inventory', 'create')) && w.SSMPDRenderInventory && w.SSMPDRenderInventory.go); }
  /* rule 9: the inventory buttons appear only when THIS user works in a store: the inventory snapshot says can_receive / can_manage for their own location
     (inventory_location_staff row, the same test the usage form of the inventory screen makes). A nurse without a store never sees them. */
  var store = { id: null, ok: null, loc: null, at: 0, busy: false }, last = {};
  function snapshot() { var db = w.SSMPDDb, c = db && db.client; return c && c.rpc ? c.rpc('inventory_workspace_snapshot', { p_location: null }) : Promise.reject(new Error('no db')); }
  function ensure() {
    var a = admin(), id = a && a.id; if (!id || !invOk()) return;
    if (store.id === id && store.ok !== null && Date.now() - store.at < 60000) return; if (store.busy) return;
    store.busy = true;
    snapshot().then(function (r) { var dd = (r && r.data !== undefined ? r.data : r) || {}; store = { id: id, ok: !!(dd.can_receive || dd.can_manage), loc: dd.location_id || null, at: Date.now(), busy: false }; refresh(); })
      .catch(function () { store = { id: id, ok: false, loc: null, at: Date.now(), busy: false }; refresh(); });
  }
  function refresh() { var host = d.querySelector('[data-nh]'); if (host) host.innerHTML = inner(last); }
  function storeOk() { var a = admin(); return !!(a && store.id === a.id && store.ok === true); }
  var ICON = { i1: '#EAF0FF|#0F369D', i2: '#FFF1E8|#F15A22', i3: '#E6F3EC|#2F7D5C', i4: '#EEE9FB|#5B3FB5' };
  function btn(key, cls, ico, glyph, title, hint, pri) { return '<button type="button" class="nh-act' + (pri ? ' pri' : '') + '" data-nd="nh" data-act="' + key + '"><span class="nh-ico ' + ico + '" aria-hidden="true">' + glyph + '</span><b>' + esc(title) + '</b><small>' + esc(hint) + '</small></button>'; }
  function inner(o) {
    o = o || {};
    var inv = invOk() && storeOk(), g1 = '', g2 = '';
    if (o.performer) g1 += btn('visit', '', 'i1', '＋', 'استهلاك الزيارة', 'سجّل المستلزمات اللي اتصرفت على زيارة المريض', true);
    if (inv) {
      g1 += btn('issue', '', 'i3', '↗', 'صرف داخلي من مخزني', 'صرف صنف من مخزنك لاستخدام داخلي', true);
      g1 += btn('pack', '', 'i3', '◨', 'فتحت عبوة جديدة', 'اختار الصنف والكمية 1 والغرض بيتكتب لوحده', true);
      g1 += btn('patient', '', 'i1', '✚', 'صرف مستلزم إضافي لمريض', 'مستلزم زيادة على الخدمة');
    }
    if (o.kit) g1 += btn('kit', '', 'i4', '♥', 'طقم الفيتلة', 'مستلزمات قياس العلامات الحيوية');
    if (inv) {
      g2 += btn('request', '', 'i1', '▦', 'طلب توريد', 'اطلب أصناف ناقصة');
      g2 += btn('transfer', '', 'i4', '⇄', 'تحويل / استلام من مخزن', 'حوّل لمخزن تاني أو استلم تحويل واصل');
      g2 += btn('count', '', 'i3', '✓', 'جرد', 'عدّ الأصناف وسجّل الفرق');
      g2 += btn('balance', '', 'i1', '▤', 'رصيد مخزني', 'الكمية المتاحة والصلاحيات');
      g2 += btn('moves', '', 'i1', '≡', 'سجل الحركات', 'كل الصرف والاستلام');
    }
    var g3 = o.triage ? btn('vitals', '', 'i3', '♥', 'العلامات الحيوية', 'قياس وتسجيل وإبلاغ الدكتور لأول مريض مستني', true) : '';
    function grp(t, sub, b) { return b ? '<section class="nh-grp" data-nh-grp><div class="nh-gh"><h4>' + t + '</h4><small>' + sub + '</small></div><div class="nh-btns">' + b + '</div></section>' : ''; }
    var out = grp('الصرف والاستهلاك', 'اللي بتعمله كل يوم', g1) + grp('المخزن والتوريد', 'مخزنك', g2) + grp('المريض', 'قبل الدكتور', g3);
    return out;
  }
  function html(o) { last = o || {}; ensure(); return '<div class="nh" data-nh>' + inner(last) + '</div>'; }
  function gotoInventory(view, after) {
    var nav = d.querySelector('[data-goto=inventory]'); if (!nav) return false;
    nav.click(); setTimeout(function () { w.SSMPDRenderInventory.go(view); if (after) waitFor(after); }, 60); return true;
  }
  var waiter = null;
  function waitFor(fn) { if (waiter) clearInterval(waiter); var n = 0; waiter = setInterval(function () { if (fn() || ++n > 40) { clearInterval(waiter); waiter = null; } }, 150); }
  function section() { var a = d.querySelector('[data-nd-root] .nd-tab.on,[data-nd-root] [data-nd=tab].on,[data-nd-root] [aria-selected=true]'); return a ? a.textContent.trim() : ''; }
  function act(name, root) {
    root = root || d;
    if (name === 'visit') { var p = root.querySelector('[data-nd=performer]'); if (p) p.click(); return; }
    if (name === 'kit') { var k = root.querySelector('[data-nd=kit]'); if (k) k.click(); return; }
    if (name === 'vitals') { var t = root.querySelector('[data-nd=triage]'); if (t) t.click(); else if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show('مفيش مريض مستني دلوقتي', 'error'); return; }
    var map = { issue: 'usage', pack: 'usage', patient: 'usage', request: 'requests', transfer: 'transfers', count: 'counts', balance: 'balances', moves: 'movements' };
    if (!map[name]) return;
    if (!storeOk()) return;
    if (store.loc && w.SSMPDInventoryWorkspace && w.SSMPDInventoryWorkspace.select) w.SSMPDInventoryWorkspace.select(store.loc);
    if (waiter) { clearInterval(waiter); waiter = null; }
    var after = name === 'pack' ? function () { var f = d.querySelector('[data-w-usage]'); if (!f) return false; var q = f.querySelector('[name=quantity]'), n = f.querySelector('[name=note]'), sec = section(); if (q) q.value = '1'; if (n) n.value = 'فتح عبوة جديدة' + (sec ? ' — ' + sec : ''); var it = f.querySelector('[name=item]'); if (it && it.focus) it.focus(); return true; }
      : name === 'patient' ? function () { var b = d.querySelector('[data-w-usage-patient]'); if (!b) return false; b.click(); return true; } : null;
    gotoInventory(map[name], after);
  }
  w.SSMPDNursingHome = { html: html, act: act, _inv: invOk, _store: function () { return store; } };
})(window, document);
