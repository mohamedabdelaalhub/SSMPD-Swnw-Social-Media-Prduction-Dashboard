/* SSMPD — شاشة الأرشيف (كالندر شهري) */
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var state = { view: "month", cursor: new Date() };

  function dayKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل الأرشيف…</div>';
    window.SSMPDDb.listContentItems({ stage: "published" }).then(function (items) {
      window.SSMPDDb.listAdminsBasic().then(function (admins) {
        var map = {}; admins.forEach(function (a) { map[a.id] = a; });
        renderCalendar(container, items, map);
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function renderCalendar(container, items, adminsById) {
    var W = window.SSMPDWorkflow;
    var byDay = {};
    items.forEach(function (i) {
      if (!i.published_at) return;
      var k = dayKey(new Date(i.published_at));
      (byDay[k] = byDay[k] || []).push(i);
    });

    var cursor = state.cursor;
    var year = cursor.getFullYear(), month = cursor.getMonth();
    var monthLabel = cursor.toLocaleDateString("ar-EG", { month: "long", year: "numeric" });

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
      '<h2>' + monthLabel + '</h2>' +
      '<div style="display:flex;gap:6px;">' +
      "<button class=\"btn ghost sm\" id=\"arch-prev\"> <!--ssmpd-i18n:%E2%80%B9%20%D8%A7%D9%84%D8%B3%D8%A7%D8%A8%D9%82-->‹ السابق</button>" +
      "<button class=\"btn ghost sm\" id=\"arch-next\"> <!--ssmpd-i18n:%D8%A7%D9%84%D8%AA%D8%A7%D9%84%D9%8A%20%E2%80%BA-->التالي ›</button>" +
      '<button class="btn ' + (state.view === "month" ? "" : "ghost") + " sm\" id=\"arch-month\"> <!--ssmpd-i18n:%D8%B4%D9%87%D8%B1-->شهر</button>" +
      '<button class="btn ' + (state.view === "week" ? "" : "ghost") + " sm\" id=\"arch-week\"> <!--ssmpd-i18n:%D8%A3%D8%B3%D8%A8%D9%88%D8%B9-->أسبوع</button>" +
      '</div></div>';

    var firstOfMonth = new Date(year, month, 1);
    var startOffset = firstOfMonth.getDay(); // 0=Sunday
    var daysInMonth = new Date(year, month + 1, 0).getDate();

    var cellsStart, cellsEnd;
    if (state.view === "week") {
      var wd = cursor.getDay();
      var weekStart = new Date(cursor); weekStart.setDate(cursor.getDate() - wd);
      cellsStart = weekStart; cellsEnd = new Date(weekStart); cellsEnd.setDate(weekStart.getDate() + 6);
    }

    html += '<div class="calendar-grid">';
    ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"].forEach(function (d) {
      html += '<div style="text-align:center;font-size:11px;font-weight:700;color:var(--c-muted);">' + d + '</div>';
    });

    var cellsToRender = [];
    if (state.view === "month") {
      for (var i = 0; i < startOffset; i++) cellsToRender.push(null);
      for (var d = 1; d <= daysInMonth; d++) cellsToRender.push(new Date(year, month, d));
    } else {
      for (var wdi = 0; wdi < 7; wdi++) {
        var dd = new Date(cellsStart); dd.setDate(cellsStart.getDate() + wdi);
        cellsToRender.push(dd);
      }
    }

    cellsToRender.forEach(function (d) {
      if (!d) { html += '<div class="calendar-cell" style="background:transparent;border:none;"></div>'; return; }
      var k = dayKey(d);
      var dayItems = byDay[k] || [];
      html += '<div class="calendar-cell"><div class="day-num">' + d.getDate() + '</div>';
      dayItems.forEach(function (it) {
        html += '<div class="item" data-open="' + it.id + '" title="' + escapeHtml(it.title) + '">' + escapeHtml(it.title) + W.brandBadgeHtml(it.brand) + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;

    document.getElementById("arch-prev").onclick = function () {
      if (state.view === "month") cursor.setMonth(cursor.getMonth() - 1); else cursor.setDate(cursor.getDate() - 7);
      render(container);
    };
    document.getElementById("arch-next").onclick = function () {
      if (state.view === "month") cursor.setMonth(cursor.getMonth() + 1); else cursor.setDate(cursor.getDate() + 7);
      render(container);
    };
    document.getElementById("arch-month").onclick = function () { state.view = "month"; render(container); };
    document.getElementById("arch-week").onclick = function () { state.view = "week"; render(container); };

    container.querySelectorAll("[data-open]").forEach(function (el) {
      el.onclick = function () { openDetail(el.getAttribute("data-open"), items, adminsById); };
    });
  }

  function openDetail(id, items, adminsById) {
    var W = window.SSMPDWorkflow;
    var item = items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    var publisher = adminsById[item.published_by] ? adminsById[item.published_by].name :
      (item.scheduled_by ? "نشر تلقائي (Meta)" : "—");
    var scheduler = adminsById[item.scheduled_by] ? adminsById[item.scheduled_by].name : "—";
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(item.title) + W.brandBadgeHtml(item.brand) + '</h3>' +
      '<button class="modal-close">×</button></div>' +
      W.contentFormatDetailsHtml(item) +
      '<div id="archive-publication-preview"></div>' +
      '<div id="archive-website-publish"></div>' +
      (item.published_url ? '<p><a href="' + item.published_url + '" target="_blank" class="btn ghost sm">رابط المنشور</a></p>' : '') +
      "<table class=\"simple\" style=\"margin-top:12px;\"><tr><th> <!--ssmpd-i18n:%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE%20%D8%A7%D9%84%D9%86%D8%B4%D8%B1-->تاريخ النشر</th><td>" +
      (item.published_at ? new Date(item.published_at).toLocaleString("ar-EG") : "—") + '</td></tr>' +
      '<tr><th>نُشر بواسطة</th><td>' + escapeHtml(publisher) + '</td></tr>' +
      (item.scheduled_by ? '<tr><th>جدولها</th><td>' + escapeHtml(scheduler) + '</td></tr>' : '') +
      "<tr><th> <!--ssmpd-i18n:%D8%A7%D9%84%D9%85%D9%86%D8%B5%D8%A9-->المنصة</th><td>" + W.platformsLabel(item.publish_platforms && item.publish_platforms.length ? item.publish_platforms : item.publish_platform) + '</td></tr></table>' +
      '<div style="margin-top:12px;">' + W.itemActionsHtml(item, window.SSMPDAuth.currentAdmin) + '</div></div>';
    document.body.appendChild(backdrop);
    window.SSMPDPublicationPreview.mount(backdrop.querySelector("#archive-publication-preview"),item);
    window.SSMPDWebsite.mountAction(backdrop.querySelector("#archive-website-publish"),item);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
    W.wireItemActions(backdrop, item, function () { backdrop.remove(); render(document.getElementById("view-container")); });
  }

  window.SSMPDRenderArchive = { render: render };
})();


