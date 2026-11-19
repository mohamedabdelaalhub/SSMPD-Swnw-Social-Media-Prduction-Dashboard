/* Reception: booking requests from the patient portal, waiting for «تأكيد».
 * Confirming creates the official booking through the booking bridge (server side, in
 * patient-portal-booking op staff_confirm). Nothing is booked before a staff click. */
(function (w, d) {
  "use strict";
  var STATUS = {
    pending: ["محتاج تأكيد", "received"], confirming: ["جاري التأكيد", "received"],
    confirmed: ["اتأكد", "approved"], cancelled_by_patient: ["ألغاه المريض", "rejected"],
    cancelled_by_staff: ["اتلغى من الاستقبال", "rejected"], slot_unavailable: ["الموعد مبقاش متاح", "rejected"]
  };
  var ERR = {
    REQUEST_NOT_PENDING: "الطلب ده اتراجع بالفعل من حد تاني.",
    SLOT_NO_LONGER_AVAILABLE: "الموعد اتاخد. كلّم المريض واتفق على موعد تاني.",
    PATIENT_PHONE_REQUIRED: "رقم تليفون المريض مش مسجل في ملفه.",
    BOOKING_BRIDGE_NOT_CONFIGURED: "الربط مع نظام الحجز مش متفعّل.",
    NOT_ALLOWED: "مش مسموح لك تراجع طلبات الحجز."
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function call(body) {
    return w.SSMPDDb.client.functions.invoke("patient-portal-booking", { body: body }).then(function (r) {
      if (r.error) {
        var ctx = r.error.context;
        if (ctx && ctx.json) return ctx.json().then(function (j) { throw new Error((j && j.error) || r.error.message); }, function () { throw r.error; });
        throw r.error;
      }
      if (r.data && r.data.error) throw new Error(r.data.error);
      return r.data;
    });
  }
  function errText(e) { var m = String((e && e.message) || e); var k = Object.keys(ERR).filter(function (x) { return m.indexOf(x) >= 0; })[0]; return k ? ERR[k] : "حصل خطأ: " + m; }
  function when(r) {
    var dt = new Date(r.requested_date + "T00:00:00");
    return (isNaN(dt.getTime()) ? r.requested_date : dt.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" })) + " · " + (r.requested_time || "");
  }

  function render(box) {
    if (!box) return;
    box.innerHTML = '<div class="section"><div class="loading">بيحمّل طلبات البوابة…</div></div>';
    call({ op: "staff_list" }).then(function (data) {
      var rows = (data && data.requests) || [];
      var pending = rows.filter(function (r) { return r.status === "pending" || r.status === "confirming" || r.status === "slot_unavailable"; });
      var recent = rows.filter(function (r) { return pending.indexOf(r) < 0; }).slice(0, 15);
      var row = function (r, actions) {
        var p = r.patients || {}, st = STATUS[r.status] || [r.status, "received"];
        return '<tr data-ppbr="' + esc(r.id) + '"><td><b>' + esc(p.full_name || "—") + '</b><div class="meta">' + esc(p.patient_code || "") + (p.phone ? " · " + esc(p.phone) : "") + '</div></td>' +
          '<td>' + esc(r.specialty_name || "—") + '<div class="meta">د/ ' + esc(r.doctor_name || "—") + '</div></td>' +
          '<td>' + esc(when(r)) + '</td><td><span class="status-pill ' + st[1] + '">' + esc(st[0]) + '</span>' +
          (r.official_booking_id ? '<div class="meta">رقم الحجز ' + esc(r.official_booking_id) + '</div>' : '') +
          (r.last_error && r.status !== "confirmed" ? '<div class="meta">' + esc(errText(r.last_error)) + '</div>' : '') + '</td>' +
          '<td>' + (actions && r.status === "pending" ? '<button class="btn sm" data-ppbr-confirm="' + esc(r.id) + '">تأكيد الحجز</button> <button class="btn ghost sm" data-ppbr-cancel="' + esc(r.id) + '">إلغاء</button>' : '') + '</td></tr>';
      };
      var table = function (list, actions) {
        return '<div style="overflow:auto;"><table class="simple"><thead><tr><th>المريض</th><th>التخصص / الطبيب</th><th>الموعد المطلوب</th><th>الحالة</th><th></th></tr></thead><tbody>' +
          list.map(function (r) { return row(r, actions); }).join("") + '</tbody></table></div>';
      };
      box.innerHTML = '<div class="section" style="margin-bottom:14px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
        '<h3 style="margin:0;">طلبات حجز من بوابة المرضى <span class="status-pill received">' + pending.filter(function (r) { return r.status === "pending"; }).length + ' محتاج تأكيد</span></h3>' +
        '<button class="btn ghost sm" data-ppbr-refresh>تحديث</button></div>' +
        (pending.length ? table(pending, true) : '<div class="empty-state">مفيش طلبات محتاجة تأكيد.</div>') +
        (recent.length ? '<details style="margin-top:10px;"><summary>آخر الطلبات اللي اتراجعت</summary>' + table(recent, false) + '</details>' : '') + '</div>';
      box.querySelector("[data-ppbr-refresh]").onclick = function () { render(box); };
      box.querySelectorAll("[data-ppbr-confirm]").forEach(function (b) {
        b.onclick = function () {
          if (!w.confirm("هيتعمل حجز رسمي في نظام الحجز للمريض ده. تأكيد؟")) return;
          b.disabled = true; b.textContent = "جاري الحجز…";
          call({ op: "staff_confirm", request_id: b.getAttribute("data-ppbr-confirm") })
            .then(function () { render(box); })
            .catch(function (e) { w.alert(errText(e)); render(box); });
        };
      });
      box.querySelectorAll("[data-ppbr-cancel]").forEach(function (b) {
        b.onclick = function () {
          var note = w.prompt("سبب الإلغاء (هيظهر للمريض):", "");
          if (note === null) return;
          b.disabled = true;
          call({ op: "staff_cancel", request_id: b.getAttribute("data-ppbr-cancel"), note: note })
            .then(function () { render(box); })
            .catch(function (e) { w.alert(errText(e)); render(box); });
        };
      });
    }).catch(function (e) {
      var m = String((e && e.message) || e);
      box.innerHTML = /NOT_ALLOWED/.test(m) ? "" : '<div class="section"><div class="err-msg">' + esc(errText(e)) + '</div></div>';
    });
  }
  // Mount at the top of the reception workspace (and the bookings screen if present) for roles
  // that may review requests; the server re-checks (can_access_leads).
  function mayReview() {
    var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin, R = w.SSMPDRoles;
    return !!(a && R && R.hasAnyRole && R.hasAnyRole(a, ["reception", "customer_service", "general_manager", "super_admin"]));
  }
  var lastMount = null;
  function mount() {
    var shell = d.querySelector(".rx-shell");
    if (w.SSMPDAutoBookings) return; // owner 2026-11-17: shown inside «طلبات الحجز الآلية» instead
    if (!shell || shell === lastMount || !mayReview() || !w.SSMPDDb || !w.SSMPDDb.client) return;
    lastMount = shell;
    var box = d.createElement("div");
    box.id = "portal-booking-requests-rx";
    var head = shell.querySelector(".rx-header");
    if (head && head.parentNode === shell) head.insertAdjacentElement("afterend", box); else shell.insertBefore(box, shell.firstChild);
    render(box);
  }
  var queued = false;
  function schedule() { if (queued) return; queued = true; setTimeout(function () { queued = false; mount(); }, 200); }
  function start() { mount(); new MutationObserver(schedule).observe(d.body, { childList: true, subtree: true }); }
  w.SSMPDPortalBookingRequests = { render: render, mount: mount };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start); else start();
})(window, document);
