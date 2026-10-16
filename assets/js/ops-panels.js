/* SSMPD — لوحتان صغيرتان بتتركّب فوق تابات موجودة:
   1) «نشر محتاج متابعة» فوق تاب النشر: منشورات فشلت/اتنشرت جزئيًا/الستوري ناقصة + إعادة محاولة بزرار.
   2) «ذاكرة المحتوى» فوق تاب أداء البوستات: القواعد النشطة اللي اتعلّمناها + تعطيل أي قاعدة (للإدارة). */
(function () {
  "use strict";
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var DIM = { format: "النوع", daypart: "فترة النشر", weekday: "يوم النشر", cta_type: "الدعوة للإجراء", specialty: "التخصص", angle: "الزاوية", note: "ملاحظة" };
  var FORMATS = { image_post: "بوست صورة", carousel: "كاروسيل", video: "فيديو / ريل", link_post: "رابط" };
  var DAYPART = { morning: "الصبح (5–11)", noon: "الضهر (12–3)", evening: "العصر/المغرب (4–7)", night: "بالليل (8 م فصاعدًا)" };
  var WEEKDAY = { 1: "الاثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة", 6: "السبت", 7: "الأحد" };
  var VERDICT = { do_more: ["كرّر", "good"], do_less: ["قلّل", "mid"], avoid: ["تجنّب", "bad"], test: ["تجربة", "info"] };
  var SPEC = { obgyn: "نساء وتوليد", pediatrics: "أطفال", dermatology: "جلدية", internal: "باطنة", neurology: "مخ وأعصاب", ent: "أنف وأذن", dentistry: "أسنان", nutrition: "تغذية", physio: "علاج طبيعي", psychiatry: "نفسية", general: "عام" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function role() { var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin; return a ? a.role : ""; }
  function place(container, el) { var old = container.querySelector("." + el.dataset.opsKey); if (old) old.remove(); container.insertBefore(el, container.firstChild); }
  function mk(key, html) { var el = document.createElement("section"); el.className = "ops-card " + key; el.dataset.opsKey = key; el.innerHTML = html; return el; }

  // ---- نشر محتاج متابعة ----
  var STATUS = { failed: ["فشل", "bad"], partial: ["نشر جزئي", "mid"], published: ["الستوري ناقصة", "info"] };
  function publishIssues(container) {
    if (!container || !window.SSMPDDb || !window.SSMPDDb.metaPublishIssues) return;
    window.SSMPDDb.metaPublishIssues().then(function (rows) {
      if (!container.isConnected) return;
      rows = Array.isArray(rows) ? rows : [];
      var old = container.querySelector(".ops-issues"); if (old) old.remove();
      if (!rows.length) return;
      var el = mk("ops-issues", '<h3>⚠️ نشر محتاج متابعة <span class="ops-count">' + rows.length + '</span></h3><div class="ops-rows">' + rows.map(function (r) {
        var st = STATUS[r.status] || [r.status, "mid"], why = r.status === "published" ? (r.story_error || "") : (r.error_message || "");
        return '<div class="ops-row"><div class="ops-main"><b>' + esc(r.title || "—") + '</b><span class="ops-meta"><span class="ops-chip ' + st[1] + '">' + esc(st[0]) + '</span><span class="ops-chip">' + esc(BRANDS[r.brand] || r.brand) + '</span>' +
          (r.exhausted ? '<span class="ops-chip bad">خلّصت المحاولات التلقائية</span>' : '<span class="ops-chip">محاولة ' + (r.attempt_count || 0) + '</span>') + '</span>' +
          '<small title="' + esc(why) + '">' + esc(String(why).slice(0, 180)) + '</small></div><button type="button" class="btn sm" data-ops-retry="' + esc(r.id) + '">إعادة المحاولة</button></div>';
      }).join("") + '</div><p class="ops-note">الأخطاء المؤقتة بتتعاد تلقائيًا (4 مرات). اضغط «إعادة المحاولة» بعد ما تصلّح السبب (مثلاً ملف التصميم). المنصة اللي نزل عليها المنشور بالفعل مبتتكررش.</p>');
      place(container, el);
      el.querySelectorAll("[data-ops-retry]").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true; b.textContent = "جاري…";
          window.SSMPDDb.metaJobRetry(b.getAttribute("data-ops-retry")).then(function () { publishIssues(container); }).catch(function (e) { b.disabled = false; b.textContent = "إعادة المحاولة"; alert((e && e.message) || "تعذرت إعادة المحاولة"); });
        };
      });
    }).catch(function () {});
  }

  // ---- ذاكرة المحتوى ----
  function valueLabel(r) {
    if (r.dimension === "format") return FORMATS[r.value] || r.value;
    if (r.dimension === "daypart") return DAYPART[r.value] || r.value;
    if (r.dimension === "weekday") return WEEKDAY[r.value] || r.value;
    if (r.dimension === "specialty") return SPEC[r.value] || r.value;
    return r.value;
  }
  function learningPanel(container) {
    if (!container || !window.SSMPDDb || !window.SSMPDDb.contentLearnings) return;
    var canEdit = role() === "super_admin" || role() === "general_manager";
    window.SSMPDDb.contentLearnings().then(function (rows) {
      if (!container.isConnected) return;
      rows = rows || [];
      var old = container.querySelector(".ops-learn"); if (old) old.remove();
      if (!rows.length) return;
      var byBrand = {}; rows.forEach(function (r) { (byBrand[r.brand] = byBrand[r.brand] || []).push(r); });
      var html = '<details class="ops-det"><summary>🧠 ذاكرة المحتوى — القواعد اللي اتعلّمناها <span class="ops-count">' + rows.length + '</span></summary><p class="ops-note">بتتحسب يوميًا من أداء المنشورات (3 منشورات فأكتر لكل قاعدة) وبتتقرا لمّا بنولّد أفكار جديدة. «قوي» = 5 منشورات فأكتر وفرق واضح. لو قاعدة مش منطقية، عطّلها.</p>';
      Object.keys(byBrand).forEach(function (b) {
        html += '<h4>' + esc(BRANDS[b] || (b === "all" ? "كل الصفحات" : b)) + '</h4><div class="ops-rules">' + byBrand[b].map(function (r) {
          var v = VERDICT[r.verdict] || [r.verdict, "info"], ev = r.evidence || {};
          return '<div class="ops-rule"><span class="ops-chip ' + v[1] + '">' + v[0] + '</span><b>' + esc(DIM[r.dimension] || r.dimension) + ': ' + esc(valueLabel(r)) + '</b>' + (r.confidence === "strong" ? '<span class="ops-chip good">قوي</span>' : '<span class="ops-chip">مبدئي</span>') +
            '<small>' + (ev.posts ? ev.posts + " منشورات" : "") + (ev.ratio ? " · " + ev.ratio + "× متوسط الصفحة" : "") + (r.source === "claude" ? " · Claude" : "") + '</small>' +
            (canEdit ? '<button type="button" class="ops-off" data-ops-off="' + esc(r.id) + '" title="تعطيل القاعدة">تعطيل</button>' : "") + '</div>';
        }).join("") + '</div>';
      });
      html += '</details>';
      var el = mk("ops-learn", html); place(container, el);
      el.querySelectorAll("[data-ops-off]").forEach(function (b) {
        b.onclick = function () { b.disabled = true; window.SSMPDDb.setLearningActive(b.getAttribute("data-ops-off"), false).then(function () { var r = b.closest(".ops-rule"); if (r) r.remove(); }).catch(function (e) { b.disabled = false; alert((e && e.message) || "تعذر التعطيل"); }); };
      });
    }).catch(function () {});
  }

  window.SSMPDOpsPanels = { publishIssues: publishIssues, learningPanel: learningPanel };
})();
