/* SSMPD — ميعاد جدولة المادة + سجل تعديلات الجدولة ومين عملها.
   المصدر: content_items.scheduled_publish_at / scheduled_by للميعاد الحالي، و activity_log (جدولة، تعديل ميعاد، إلغاء، تأكيد نشر، نشر)
   للسجل — من غير أي جداول جديدة. السجل بيتحمّل لما المستخدم يفتح القسم عشان القوائم الطويلة ما تعملش استعلام لكل مادة. */
(function () {
  "use strict";
  var RELEVANT = /جدول|ميعاد|تأكيد نشر|^نشر/;
  var ZONE = "Africa/Cairo";

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmt(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleString("ar-EG", { timeZone: ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function nameOf(adminsById, id) {
    var a = adminsById && adminsById[id];
    return a ? (a.name || a.email || "—") : (id ? "مستخدم محذوف" : "—");
  }
  function currentLine(item, adminsById) {
    var lines = [];
    if (item.scheduled_publish_at) {
      lines.push("ميعاد النشر المجدول: <b>" + esc(fmt(item.scheduled_publish_at)) + "</b> (توقيت القاهرة)" + (item.scheduled_by ? " — حدّده: <b>" + esc(nameOf(adminsById, item.scheduled_by)) + "</b>" : ""));
    } else if (item.stage === "published") {
      lines.push("اتنشرت من غير ميعاد مجدول.");
    } else {
      lines.push("مفيش ميعاد مجدول دلوقتي.");
    }
    if (item.stage === "published" && item.published_at) lines.push("وقت النشر الفعلي: <b>" + esc(fmt(item.published_at)) + "</b>");
    return lines.map(function (l) { return '<div style="margin-bottom:3px;">' + l + "</div>"; }).join("");
  }
  function timelineHtml(rows, adminsById) {
    var list = (rows || []).filter(function (r) { return RELEVANT.test(String(r.action || "")); });
    if (!list.length) return '<div style="color:var(--c-muted);">مفيش سجل جدولة مسجّل للمادة دي.</div>';
    return '<ol style="list-style:none;margin:0;padding:0;">' + list.map(function (r) {
      return '<li style="border-inline-start:3px solid var(--c-primary);padding:2px 10px;margin-bottom:6px;">' +
        '<div><b>' + esc(nameOf(adminsById, r.actor_id)) + "</b> — " + esc(r.action) + "</div>" +
        '<div style="color:var(--c-muted);font-size:11px;">' + esc(fmt(r.created_at)) + "</div></li>";
    }).join("") + "</ol>";
  }

  function sectionHtml(item, adminsById) {
    return '<details class="sched-hist" data-sched-hist="' + esc(item.id) + '" style="margin:10px 0;font-size:12px;">' +
      '<summary style="cursor:pointer;font-weight:700;">الجدولة وسجل التعديلات</summary>' +
      '<div style="margin-top:8px;">' + currentLine(item, adminsById) + '<div data-sched-log style="margin-top:8px;"><span style="color:var(--c-muted);">افتح القسم لتحميل السجل…</span></div></div></details>';
  }

  function mountAll(root, items, adminsById) {
    if (!root) return;
    var byId = {}; (items || []).forEach(function (i) { byId[i.id] = i; });
    root.querySelectorAll("[data-sched-hist]").forEach(function (box) {
      var item = byId[box.getAttribute("data-sched-hist")];
      if (!item || box.__schedWired) return;
      box.__schedWired = true;
      var loaded = false;
      box.addEventListener("toggle", function () {
        if (!box.open || loaded) return;
        loaded = true;
        var slot = box.querySelector("[data-sched-log]");
        slot.innerHTML = '<span style="color:var(--c-muted);">بيحمّل…</span>';
        window.SSMPDDb.listActivity(item.id).then(function (rows) {
          rows = (rows || []).slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
          slot.innerHTML = timelineHtml(rows, adminsById);
        }).catch(function (e) { loaded = false; slot.innerHTML = '<span style="color:var(--c-negative);">تعذّر تحميل السجل: ' + esc(e.message || e) + "</span>"; });
      });
    });
  }

  window.SSMPDScheduleHistory = { sectionHtml: sectionHtml, mountAll: mountAll, timelineHtml: timelineHtml, currentLine: currentLine, fmt: fmt };
})();
