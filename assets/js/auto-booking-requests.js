/* «طلبات الحجز الآلية» (owner 2026-11-17): one card at the top of الاستقبال والخدمات with 3 buttons,
 * واتساب / الموقع / بوابة المرضى. Each shows «محتاج إجراء» and today's total, and opens that channel's list.
 * Sources (read-only here; nothing is booked or sent from this card):
 *   واتساب  : clinic_reception_fallback list (source whatsapp, when Masa was down) + public.customer_bookings (channel whatsapp, mirror of Masa bookings)
 *   الموقع  : clinic_reception_fallback list (source website)
 *   البوابة : patient-portal-booking edge op staff_list (the existing confirm/cancel screen is reused inside the panel)
 * Actions on fallback bookings stay in المواعيد ← الحجوزات الاحتياطية (button below jumps there). */
(function (w, d) {
  "use strict";
  var CH = [["whatsapp", "واتساب"], ["website", "الموقع"], ["portal", "بوابة المرضى"]];
  var FB = { pending: "مستني يتسجل على ماسا", replayed: "اتسجل على ماسا", conflict: "⚠ ماسا رفض الميعاد", cancel_pending: "اتلغى — مستني ماسا", cancelled: "ملغي" };
  var CB = { confirmed: "متأكد على ماسا", rescheduled: "اتغيّر ميعاده", cancelled: "ملغي", arrived: "وصل", completed: "خلص", no_show: "محضرش" };
  var state = { ws: null, open: "", data: null, busy: false };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function today() { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function fallback(ws) {
    var c = client(); if (!c || !ws) return Promise.resolve([]);
    return Promise.resolve(c.rpc("clinic_reception_fallback", { p_workspace: ws, p_action: "list", p_payload: {} }))
      .then(function (r) { return r && !r.error && r.data && r.data.bookings || []; }, function () { return []; });
  }
  function mirror() {
    var c = client(); if (!c || typeof c.from !== "function") return Promise.resolve([]);
    try {
      return Promise.resolve(c.from("customer_bookings").select("id,channel,customer_name,phone,doctor_name,specialty_name,appointment_date,appointment_time,status,booking_reference")
        .gte("appointment_date", today()).order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true }).limit(200))
        .then(function (r) { return r && !r.error && r.data || []; }, function () { return []; });
    } catch (e) { return Promise.resolve([]); }
  }
  function portal() {
    var c = client(); if (!c || !c.functions || typeof c.functions.invoke !== "function") return Promise.resolve(null);
    return Promise.resolve(c.functions.invoke("patient-portal-booking", { body: { op: "staff_list" } }))
      .then(function (r) { return r && !r.error && r.data && !r.data.error ? (r.data.requests || []) : null; }, function () { return null; });
  }
  function counts(data) {
    var t = today(), live = function (b) { return b.status !== "cancelled"; };
    var fb = function (src) { return data.fallback.filter(function (b) { return b.source === src && live(b); }); };
    var wf = fb("whatsapp"), sf = fb("website"), wm = data.mirror.filter(function (b) { return (b.channel || "whatsapp") === "whatsapp" && b.status !== "cancelled"; });
    var need = function (list) { return list.filter(function (b) { return b.status === "conflict" || (!b.reception_confirmed && b.status !== "cancel_pending"); }).length; };
    var p = data.portal || [];
    return {
      whatsapp: { need: need(wf), today: wf.filter(function (b) { return b.appointment_date === t; }).length + wm.filter(function (b) { return b.appointment_date === t; }).length, total: wf.length + wm.length },
      website: { need: need(sf), today: sf.filter(function (b) { return b.appointment_date === t; }).length, total: sf.length },
      portal: { need: p.filter(function (r) { return r.status === "pending" || r.status === "slot_unavailable"; }).length, today: p.filter(function (r) { return r.requested_date === t && r.status !== "cancelled_by_patient" && r.status !== "cancelled_by_staff"; }).length, total: p.length, off: data.portal === null }
    };
  }
  function fbRow(b) {
    return '<article class="ab-row' + (b.status === "conflict" ? " warn" : "") + '"><div><strong>' + esc(b.customer_name) + '</strong> <span dir="ltr">' + esc(b.phone) + '</span><br>' +
      esc(b.doctor_name) + ' — ' + esc(b.appointment_date) + ' ' + esc(b.appointment_time) + ' — ' + esc(b.needed_service || "") +
      '<br><small>' + esc(FB[b.status] || b.status) + (b.reception_confirmed ? " · اتأكد مع المريض" : " · محتاج تأكيد مع المريض") + '</small></div></article>';
  }
  function cbRow(b) {
    return '<article class="ab-row"><div><strong>' + esc(b.customer_name || "—") + '</strong> <span dir="ltr">' + esc(b.phone || "") + '</span><br>' +
      esc(b.doctor_name || "") + (b.specialty_name ? " (" + esc(b.specialty_name) + ")" : "") + ' — ' + esc(b.appointment_date || "") + ' ' + esc(b.appointment_time || "") +
      '<br><small>' + esc(CB[b.status] || b.status) + (b.booking_reference ? " · رقم " + esc(b.booking_reference) : "") + '</small></div></article>';
  }
  function panel(box, key) {
    var host = box.querySelector("[data-ab-panel]"); if (!host) return;
    if (!key) { host.innerHTML = ""; host.hidden = true; return; }
    host.hidden = false;
    if (key === "portal") {
      if (w.SSMPDPortalBookingRequests && w.SSMPDPortalBookingRequests.render) { host.innerHTML = '<div data-ab-portal></div>'; w.SSMPDPortalBookingRequests.render(host.querySelector("[data-ab-portal]")); }
      else host.innerHTML = '<p class="ab-empty">شاشة طلبات البوابة مش متاحة.</p>';
      return;
    }
    var data = state.data || { fallback: [], mirror: [] };
    var fb = data.fallback.filter(function (b) { return b.source === key && b.status !== "cancelled"; });
    var cb = key === "whatsapp" ? data.mirror.filter(function (b) { return (b.channel || "whatsapp") === "whatsapp" && b.status !== "cancelled"; }) : [];
    var html = "";
    if (fb.length) html += '<h5>حجوزات احتياطية (اتعملت من الداشبورد لما ماسا كان واقف)</h5>' + fb.map(fbRow).join("") +
      '<button type="button" class="btn" data-ab-goto="appointments">التعامل معاها: المواعيد ← الحجوزات الاحتياطية</button>';
    if (cb.length) html += '<h5>حجوزات اتسجلت على ماسا (للمتابعة)</h5>' + cb.map(cbRow).join("");
    host.innerHTML = html || '<p class="ab-empty">مفيش حجوزات جاية من ' + esc(key === "whatsapp" ? "الواتساب" : "الموقع") + ' دلوقتي.</p>';
    var go = host.querySelector("[data-ab-goto]");
    if (go) go.onclick = function () { var b = d.querySelector('[data-rx-section="appointments"]'); if (b) b.click(); };
  }
  function paint(box) {
    var c = state.data ? counts(state.data) : null;
    box.innerHTML = '<section class="ab-card" aria-labelledby="ab-title"><header><h3 id="ab-title">طلبات الحجز الآلية</h3><button type="button" class="btn ghost sm" data-ab-refresh>تحديث</button></header>' +
      '<div class="ab-buttons" role="tablist">' + CH.map(function (ch) {
        var k = ch[0], x = c && c[k], need = x ? x.need : 0;
        return '<button type="button" role="tab" class="ab-btn ab-' + k + (state.open === k ? " on" : "") + '" data-ab-open="' + k + '" aria-selected="' + (state.open === k) + '">' +
          '<span class="ab-name">' + ch[1] + '</span><strong class="ab-total">' + (x ? x.total : "…") + '</strong>' +
          '<span class="ab-sub">' + (x ? (need ? '<b class="ab-need">' + need + ' محتاج إجراء</b>' : 'مفيش حاجة مستنية') + ' · النهارده ' + x.today : "بيحمّل…") + '</span></button>';
      }).join("") + '</div><div data-ab-panel hidden></div></section>';
    box.querySelector("[data-ab-refresh]").onclick = function () { refresh(box); };
    box.querySelectorAll("[data-ab-open]").forEach(function (b) {
      b.onclick = function () { var k = b.getAttribute("data-ab-open"); state.open = state.open === k ? "" : k; paint(box); };
    });
    panel(box, state.open);
  }
  function refresh(box) {
    paint(box);
    return Promise.all([fallback(state.ws), mirror(), portal()]).then(function (r) {
      state.data = { fallback: r[0] || [], mirror: r[1] || [], portal: r[2] };
      if (box.isConnected) paint(box);
    });
  }
  function mayView() {
    var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin, R = w.SSMPDRoles;
    return !!(a && R && R.hasAnyRole && R.hasAnyRole(a, ["reception", "customer_service", "general_manager", "super_admin"]));
  }
  // Called by reception-workspace.js after every draw, with its context.
  function decorate(ctx) {
    if (!ctx || !ctx.data || !ctx.data.workspace || ctx.data.workspace.mode !== "live" || !mayView()) return;
    var shell = d.querySelector(".rx-shell") || (ctx.host && ctx.host.parentNode); if (!shell) return;
    var box = d.getElementById("auto-booking-requests-rx"), created = !box, fresh = state.ws !== ctx.workspace || !state.data;
    if (!box) {
      box = d.createElement("div"); box.id = "auto-booking-requests-rx";
      var head = shell.querySelector(".rx-header");
      if (head && head.parentNode === shell) head.insertAdjacentElement("afterend", box); else shell.insertBefore(box, shell.firstChild);
    }
    var old = d.getElementById("portal-booking-requests-rx"); if (old) old.remove();
    state.ws = ctx.workspace;
    if (fresh) refresh(box); else if (created) paint(box);
  }
  w.SSMPDAutoBookings = { decorate: decorate, counts: counts, refresh: refresh, state: state };
})(window, document);
