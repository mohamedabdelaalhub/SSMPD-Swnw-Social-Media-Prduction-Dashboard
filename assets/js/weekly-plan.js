/* SSMPD — «خطة الأسبوع القادم»: بيحضّر Brief مخصوص لوكيل المحتوى (ChatGPT) فيه الذاكرة (الأداء + تقييم الموظفين + توصيات تقرير الجمعة
   + المناسبات) + اللي متجدول فعلاً الأسبوع الجاي + الأيام/الأنواع الناقصة. النتيجة: جدول أسبوع + أفكار كاملة بنفس صيغة SSMPD_STRUCTURED_JSON. */
(function () {
  "use strict";
  var DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  var FORMATS = { image_post: "بوست صورة", carousel: "كاروسيل", video: "فيديو/ريل" };
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function iso(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  function dow(d) { return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "short" }).format(d)); }
  function hhmm(d) { return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d); }
  function week() { var out = [], base = Date.now(); for (var i = 1; i <= 7; i++) { var d = new Date(base + i * 864e5); out.push({ date: d, iso: iso(d), name: DAYS[dow(d)] }); } return out; }

  function build(brand, count, sched, readyCount, memory) {
    var days = week(), byDay = {};
    days.forEach(function (d) { byDay[d.iso] = []; });
    (sched || []).forEach(function (x) { var k = iso(new Date(x.scheduled_publish_at)); if (byDay[k]) byDay[k].push(x); });
    var L = [];
    L.push("=== Brief للوكيل — خطة الأسبوع القادم (WEEKLY PLAN) ===");
    L.push("Brand: " + brand);
    L.push("Mode: weekly_plan");
    L.push("Week: " + days[0].iso + " → " + days[6].iso + " (توقيت القاهرة)");
    L.push("Ideas requested: " + count + " (أنشئ " + count + " فكرة كاملة — الاستثناء الوحيد لقاعدة 3–5 أفكار)");
    L.push("Specialty: متنوع — وزّعه حسب الذاكرة وتنوّع التخصصات" + (brand === "dr_dina" ? " (مخ وأعصاب فقط لصفحة د. دينا)" : ""));
    L.push("Advertising Objective: مزيج (ثقة + توعية + رسائل واتساب) — لا تجعل كل الأفكار Sales");
    L.push("Preferred Format: مزيج من image_post / carousel / video حسب الفجوات أدناه");
    L.push("");
    L.push("ALREADY SCHEDULED THIS WEEK (لا تكرر مواضيعها):");
    var any = false;
    days.forEach(function (d) { byDay[d.iso].forEach(function (x) { any = true; L.push("- " + d.name + " " + d.iso + " " + hhmm(new Date(x.scheduled_publish_at)) + " — " + (FORMATS[x.content_format] || x.content_format || "—") + " — «" + (x.title || "") + "»"); }); });
    if (!any) L.push("- لا يوجد شيء متجدول للأسبوع الجاي.");
    if (readyCount) L.push("READY TO PUBLISH (بدون ميعاد بعد): " + readyCount + " مادة.");
    L.push("");
    L.push("COVERAGE GAPS (املأها أولًا — القاعدة: كل يوم بوست صورة + كاروسيل + فيديو للصفحة):");
    days.forEach(function (d) {
      var have = {}; byDay[d.iso].forEach(function (x) { have[x.content_format] = 1; });
      var miss = Object.keys(FORMATS).filter(function (f) { return !have[f]; });
      L.push("- " + d.name + " " + d.iso + ": " + (miss.length ? "ينقص " + miss.join(" + ") : "مكتمل"));
    });
    L.push("");
    if (memory) { L.push(memory); L.push(""); }
    L.push("WEEKLY PLAN OUTPUT (إلزامي):");
    L.push("1) قبل SSMPD_STRUCTURED_JSON اكتب جدول الأسبوع بالترتيب: اليوم — رقم الفكرة — Format — التخصص — وقت النشر المقترح — سبب الاختيار في جملة. وقت النشر من أفضل فترات الذاكرة (DO MORE) لو موجودة، وإلا اكتب «جدول مقترح للتنفيذ» بدون ادعاء أنه الأفضل.");
    L.push("2) بعد الجدول: الأفكار الكاملة بنفس الترتيب، و number لكل فكرة = رقمها في الجدول. كل فكرة JSON كامل بنفس الحقول المعتادة (بدون حقول جديدة) وبنفس قواعد CAROUSEL / VIDEO / MEDICAL SOURCES / السلامة الطبية.");
    L.push("3) غطّ الفجوات أولًا، ولا تكرر نفس التخصص في يومين ورا بعض، ولا تكرر أي عنوان من RECENT TITLES أو من الجدول الحالي، وطبّق مزيج 70/20/10 على مستوى الأسبوع كله مش كل فكرة.");
    L.push("4) لو في مناسبة صحية قريبة في الذاكرة ومناسبة للصفحة، خصّص لها فكرة قبلها بـ3–10 أيام.");
    return L.join("\n");
  }

  function open(startBrand) {
    var b = document.createElement("div"); b.className = "modal-backdrop";
    b.innerHTML = '<div class="modal wp-modal" dir="rtl"><div class="modal-head"><h3>خطة الأسبوع القادم</h3><button class="modal-close" aria-label="إغلاق">×</button></div>' +
      '<p class="wp-note">بيحضّر Brief جاهز للصقه في وكيل المحتوى. بيستخدم الذاكرة وتقرير الجمعة وجدول النشر الحالي.</p>' +
      '<div class="wp-form"><label>الصفحة <select data-wp-brand>' + Object.keys(BRANDS).map(function (k) { return '<option value="' + k + '"' + (k === (startBrand || "sono") ? " selected" : "") + '>' + BRANDS[k] + '</option>'; }).join("") + '</select></label>' +
      '<label>عدد الأفكار <select data-wp-count><option>7</option><option selected>10</option><option>14</option><option>21</option></select></label><button class="btn btn-primary" data-wp-go>تحضير الـBrief</button></div>' +
      '<div data-wp-out></div></div>';
    document.body.appendChild(b);
    function close() { b.remove(); }
    b.querySelector(".modal-close").onclick = close; b.onclick = function (e) { if (e.target === b) close(); };
    var out = b.querySelector("[data-wp-out]");
    b.querySelector("[data-wp-go]").onclick = function () {
      var brand = b.querySelector("[data-wp-brand]").value, count = Number(b.querySelector("[data-wp-count]").value), db = window.SSMPDDb, d = week();
      out.innerHTML = '<p class="wp-note">جاري التحضير…</p>';
      var from = new Date(d[0].date.getTime() - 12 * 36e5).toISOString(), to = new Date(d[6].date.getTime() + 36e5 * 24).toISOString();
      Promise.all([
        (window.SSMPDLearningBrief ? window.SSMPDLearningBrief.load(brand) : Promise.resolve("")),
        db.client.from("content_items").select("title,content_format,scheduled_publish_at").eq("brand", brand).eq("stage", "scheduled").gte("scheduled_publish_at", from).lte("scheduled_publish_at", to).order("scheduled_publish_at"),
        db.client.from("content_items").select("id", { count: "exact", head: true }).eq("brand", brand).eq("stage", "ready_to_publish")
      ]).then(function (res) {
        var text = build(brand, count, (res[1] && res[1].data) || [], (res[2] && res[2].count) || 0, window.SSMPDLearningBrief ? window.SSMPDLearningBrief.block(brand) : "");
        out.innerHTML = '<textarea class="wp-text" readonly rows="14">' + esc(text) + '</textarea><div class="wp-actions"><button class="btn btn-primary" data-wp-copy>نسخ الـBrief</button><button class="btn" data-wp-agent>افتح الوكيل</button><span data-wp-msg></span></div>';
        var msg = out.querySelector("[data-wp-msg]"), ta = out.querySelector(".wp-text");
        out.querySelector("[data-wp-copy]").onclick = function () {
          (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { msg.textContent = "✓ اتنسخ"; }).catch(function () { ta.select(); msg.textContent = "انسخ يدويًا (Ctrl+C)"; });
        };
        out.querySelector("[data-wp-agent]").onclick = function () {
          db.getAppSettings().then(function (s) { var u = s && s.content_agent_gpt_url; if (u) window.open(u, "_blank", "noopener,noreferrer"); else msg.textContent = "رابط الوكيل غير مُعد بعد"; }).catch(function () { msg.textContent = "تعذر فتح الوكيل"; });
        };
      }).catch(function (e) { out.innerHTML = '<p class="wp-err">تعذر التحضير: ' + esc((e && e.message) || "") + '</p>'; });
    };
  }
  window.SSMPDWeeklyPlan = { open: open, build: build };
})();
