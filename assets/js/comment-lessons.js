/* SSMPD — «اللي اتعلمته من تعليقاتك» (موافقة المالك 2026-11-14).
   Claude Creative بيقرا تعليقات التعديل ويطلّع منها دروس عامة؛ الدرس بيتفعّل تلقائي لما الملاحظة تتكرر مرتين.
   الشاشة دي بتعرض الدروس، والمالك/المدير العام يقدر يقفل أي درس أو يرجّعه. */
(function () {
  "use strict";
  var FORMATS = { video: "فيديو / ريل", image_post: "بوست", carousel: "كاروسيل", link_post: "بوست رابط" };
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var CATS = { font: "الخط", text: "النص", voice: "الصوت", music: "المزيكا", visual: "الصورة/المشاهد", layout: "التنسيق", branding: "الهوية", ending: "النهاية", caption: "الكابشن", medical: "المعلومة الطبية", other: "عام" };
  var STATUS = { active: "بيتطبّق", candidate: "مستني يتكرر", disabled: "مقفول" };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function canManage() { var r = ((window.SSMPDAuth || {}).currentAdmin || {}).role; return r === "super_admin" || r === "general_manager"; }
  function scope(l) { return (BRANDS[l.brand] || "الصفحتين") + " · " + (FORMATS[l.content_format] || "كل الأنواع"); }

  function rowHtml(l) {
    var btn = !canManage() ? "" : l.status === "disabled"
      ? '<button class="btn ghost sm" data-cl-status="active" data-cl-id="' + l.id + '">رجّعه</button>'
      : '<button class="btn ghost sm" data-cl-status="disabled" data-cl-id="' + l.id + '">اقفله</button>';
    return '<div class="cl-row" data-cl-row="' + l.id + '" style="padding:10px 0;border-bottom:1px solid var(--c-border,#e5e7eb);">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;"><div style="font-weight:700;">' + esc(l.lesson) + "</div>" + btn + "</div>" +
      '<div class="muted" style="font-size:12px;margin-top:4px;">' + esc(CATS[l.category] || "عام") + " · " + esc(scope(l)) + " · اتكرر " + (l.hits || 0) + " مرة" +
      (l.example_comment ? " · مثال: «" + esc(l.example_comment) + "»" : "") + "</div></div>";
  }
  function listHtml(lessons) {
    if (!lessons.length) return '<div class="empty-state">لسه مفيش دروس. Claude بيراجع تعليقاتك القديمة والجديدة، وأول ما ملاحظة تتكرر مرتين هتظهر هنا وتتطبّق تلقائي.</div>';
    return ["active", "candidate", "disabled"].map(function (st) {
      var part = lessons.filter(function (l) { return l.status === st; });
      return part.length ? '<h4 style="margin:14px 0 4px;">' + STATUS[st] + " (" + part.length + ")</h4>" + part.map(rowHtml).join("") : "";
    }).join("");
  }
  function open() {
    var back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = '<div class="modal" dir="rtl" style="max-width:720px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
      '<h3 style="margin:0;">اللي اتعلمته من تعليقاتك</h3><button class="btn ghost sm" data-cl-close>إغلاق</button></div>' +
      '<p class="muted" style="font-size:12px;">من تعليقات التعديل على الفيديوهات والتصميمات. الدرس اللي «بيتطبّق» بيتنفّذ في أي مادة جديدة من أول نسخة.</p>' +
      '<div data-cl-body><div class="loading">بيحمّل…</div></div></div>';
    document.body.appendChild(back);
    var body = back.querySelector("[data-cl-body]");
    function load() {
      return window.SSMPDDb.listCommentLessons().then(function (rows) { body.innerHTML = listHtml(rows || []); }, function (e) {
        body.innerHTML = '<div class="err-msg">' + (/content_comment_lessons/.test(e.message || "") ? "الخاصية دي لسه محتاجة تفعيل على السيرفر." : "خطأ: " + esc(e.message)) + "</div>";
      });
    }
    back.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t === back || t.hasAttribute("data-cl-close")) { back.remove(); return; }
      var st = t.getAttribute("data-cl-status");
      if (!st) return;
      t.disabled = true;
      window.SSMPDDb.setCommentLessonStatus(t.getAttribute("data-cl-id"), st).then(load, function (e) { t.disabled = false; alert("خطأ: " + e.message); });
    });
    return load();
  }
  function buttonHtml() { return '<button class="btn ghost sm" data-cl-open>🧠 اللي اتعلمته من تعليقاتك</button>'; }
  function wire(root) { var b = root.querySelector("[data-cl-open]"); if (b) b.onclick = function () { open(); }; }
  window.SSMPDCommentLessons = { open: open, buttonHtml: buttonHtml, wire: wire, listHtml: listHtml };
})();
