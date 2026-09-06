/* SSMPD — حجوزات الوكيل: مرآة قراءة فقط للحجوزات المؤكدة من AI Customer Agent */
(function () {
  "use strict";

  var rowsCache = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function statusLabel(s) {
    return ({
      confirmed: "مؤكد",
      rescheduled: "أُعيدت الجدولة",
      cancelled: "ملغي",
      arrived: "حضر",
      completed: "تمت الزيارة",
      no_show: "لم يحضر"
    })[s] || s || "—";
  }
  function statusClass(s) {
    if (s === "confirmed" || s === "arrived" || s === "completed") return "approved";
    if (s === "cancelled" || s === "no_show") return "rejected";
    return "received";
  }
  function dateText(r) {
    if (!r.appointment_date) return "—";
    var d = new Date(r.appointment_date + "T00:00:00");
    var ds = isNaN(d.getTime()) ? r.appointment_date : d.toLocaleDateString("ar-EG");
    return ds + (r.appointment_time ? " · " + r.appointment_time : "");
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل الحجوزات…</div>';
    window.SSMPDDb.listCustomerBookings({ limit: 500 }).then(function (rows) {
      rowsCache = rows || [];
      draw(container);
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + esc(e.message || e) + '</div>';
    });
  }

  function draw(container) {
    var today = new Date();
    var todayKey = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
    var confirmed = rowsCache.filter(function (r) { return r.status === "confirmed"; }).length;
    var todayCount = rowsCache.filter(function (r) { return r.appointment_date === todayKey && r.status !== "cancelled"; }).length;
    var futureCount = rowsCache.filter(function (r) { return r.appointment_date && r.appointment_date > todayKey && r.status !== "cancelled"; }).length;

    var html = '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">' +
      '<div><h2 style="margin:0;">حجوزات الوكيل</h2><div style="font-size:12px;color:var(--c-muted);margin-top:4px;">مرآة متابعة فقط — نظام الحجز الرسمي هو مصدر الحقيقة.</div></div>' +
      '<button class="btn ghost sm" id="bookings-refresh">تحديث</button></div>' +
      '<div class="kpi-grid" style="margin-bottom:14px;">' +
        '<div class="kpi-card"><div class="label">إجمالي الظاهر</div><div class="value small">' + rowsCache.length + '</div></div>' +
        '<div class="kpi-card"><div class="label">مؤكد</div><div class="value small">' + confirmed + '</div></div>' +
        '<div class="kpi-card"><div class="label">اليوم</div><div class="value small">' + todayCount + '</div></div>' +
        '<div class="kpi-card"><div class="label">قادمة</div><div class="value small">' + futureCount + '</div></div>' +
      '</div>' +
      '<div class="section">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
          '<input id="booking-search" type="search" placeholder="بحث بالاسم / الهاتف / المرجع / الطبيب…" style="flex:1;min-width:240px;">' +
          '<select id="booking-status"><option value="">كل الحالات</option>' +
            '<option value="confirmed">مؤكد</option><option value="rescheduled">أُعيدت الجدولة</option>' +
            '<option value="cancelled">ملغي</option><option value="arrived">حضر</option>' +
            '<option value="completed">تمت الزيارة</option><option value="no_show">لم يحضر</option>' +
          '</select>' +
        '</div>' +
        '<div id="bookings-list"></div>' +
      '</div>';

    container.innerHTML = html;
    document.getElementById("bookings-refresh").onclick = function () { render(container); };
    document.getElementById("booking-search").oninput = applyFilters;
    document.getElementById("booking-status").onchange = applyFilters;
    applyFilters();
  }

  function applyFilters() {
    var q = (document.getElementById("booking-search").value || "").trim().toLowerCase();
    var st = document.getElementById("booking-status").value;
    var rows = rowsCache.filter(function (r) {
      if (st && r.status !== st) return false;
      if (!q) return true;
      return [
        r.customer_name, r.phone, r.wa_id, r.booking_reference,
        r.official_booking_id, r.specialty_name, r.doctor_name
      ].some(function (v) { return String(v || "").toLowerCase().indexOf(q) !== -1; });
    });
    renderRows(rows);
  }

  function renderRows(rows) {
    var box = document.getElementById("bookings-list");
    if (!rows.length) {
      box.innerHTML = '<div class="empty-state">مفيش حجوزات مطابقة.</div>';
      return;
    }
    box.innerHTML = '<div style="overflow:auto;"><table class="simple"><thead><tr>' +
      '<th>المريض</th><th>التخصص / الطبيب</th><th>الموعد</th><th>الحالة</th><th>المرجع</th><th>القناة</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="booking-row" data-booking-id="' + r.id + '" style="cursor:pointer;">' +
          '<td><b>' + esc(r.customer_name || "—") + '</b><div class="meta">' + esc(r.phone || r.wa_id || "—") + '</div></td>' +
          '<td>' + esc(r.specialty_name || "—") + '<div class="meta">' + esc(r.doctor_name || "—") + '</div></td>' +
          '<td>' + esc(dateText(r)) + '</td>' +
          '<td><span class="status-pill ' + statusClass(r.status) + '">' + esc(statusLabel(r.status)) + '</span></td>' +
          '<td>' + esc(r.booking_reference || r.official_booking_id || "—") + '</td>' +
          '<td>' + esc(r.channel || "—") + '</td>' +
        '</tr>';
      }).join("") + '</tbody></table></div>';

    box.querySelectorAll("[data-booking-id]").forEach(function (row) {
      row.onclick = function () {
        var id = row.getAttribute("data-booking-id");
        var b = rowsCache.filter(function (x) { return x.id === id; })[0];
        if (b) openDetails(b);
      };
    });
  }

  function openDetails(b) {
    var modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = '<div class="modal"><div class="modal-head"><h3>تفاصيل الحجز</h3><button class="modal-close">×</button></div>' +
      '<table class="simple">' +
      '<tr><th>المريض</th><td>' + esc(b.customer_name || "—") + '</td></tr>' +
      '<tr><th>الهاتف</th><td>' + esc(b.phone || b.wa_id || "—") + '</td></tr>' +
      '<tr><th>التخصص</th><td>' + esc(b.specialty_name || "—") + '</td></tr>' +
      '<tr><th>الطبيب</th><td>' + esc(b.doctor_name || "—") + '</td></tr>' +
      '<tr><th>الموعد</th><td>' + esc(dateText(b)) + '</td></tr>' +
      '<tr><th>السعر</th><td>' + (b.price == null ? "—" : esc(b.price) + " " + esc(b.currency || "EGP")) + '</td></tr>' +
      '<tr><th>الحالة</th><td>' + esc(statusLabel(b.status)) + '</td></tr>' +
      '<tr><th>مرجع الحجز</th><td>' + esc(b.booking_reference || b.official_booking_id || "—") + '</td></tr>' +
      '<tr><th>Booking Request ID</th><td style="direction:ltr;text-align:left;">' + esc(b.booking_request_id) + '</td></tr>' +
      '<tr><th>القناة</th><td>' + esc(b.channel || "—") + '</td></tr>' +
      '<tr><th>آخر مزامنة</th><td>' + (b.last_synced_at ? new Date(b.last_synced_at).toLocaleString("ar-EG") : "—") + '</td></tr>' +
      '</table></div>';
    document.body.appendChild(modal);
    modal.querySelector(".modal-close").onclick = function () { modal.remove(); };
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  }

  window.SSMPDRenderBookings = { render: render };
})();
