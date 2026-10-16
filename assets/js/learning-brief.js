/* SSMPD — «ذاكرة الأداء» كجزء من الـBrief: بتتجاب من القاعدة (content_learning_brief_staff) وبتتحط في نص الـBrief
   اللي بيتنسخ لوكيل ChatGPT وفي مولّد الأفكار. الـBrief بيبقى دايمًا فيه آخر قواعد متعلّمة + مناسبات قريبة + توصيات تقرير الجمعة. */
(function () {
  "use strict";
  var cache = {};
  var DIM = { format: "النوع", daypart: "فترة النشر", weekday: "يوم النشر", cta_type: "نوع الدعوة للإجراء (CTA)", specialty: "التخصص", angle: "الزاوية", note: "ملاحظة" };
  var FORMATS = { image_post: "بوست صورة", carousel: "كاروسيل", video: "فيديو/ريل", link_post: "بوست رابط" };
  var DAYPART = { morning: "الصبح 5–11", noon: "الضهر 12–3", evening: "العصر/المغرب 4–7", night: "بالليل 8م فصاعدًا" };
  var WEEKDAY = { 1: "الاثنين", 2: "الثلاثاء", 3: "الأربعاء", 4: "الخميس", 5: "الجمعة", 6: "السبت", 7: "الأحد" };
  var SPEC = { obgyn: "نساء وتوليد", pediatrics: "أطفال", dermatology: "جلدية", internal: "باطنة", neurology: "مخ وأعصاب", ent: "أنف وأذن", dentistry: "أسنان", nutrition: "تغذية", physio: "علاج طبيعي", psychiatry: "نفسية", general: "عام" };
  function val(r) { var v = r.value; return r.dimension === "format" ? (FORMATS[v] || v) : r.dimension === "daypart" ? (DAYPART[v] || v) : r.dimension === "weekday" ? (WEEKDAY[v] || v) : r.dimension === "specialty" ? (SPEC[v] || v) : v; }
  function item(r) { var ev = r.evidence || {}; return (DIM[r.dimension] || r.dimension) + " = " + val(r) + " (" + (r.confidence === "strong" ? "قوي" : "مبدئي") + (ev.posts ? "، " + ev.posts + " منشورات" : "") + (ev.ratio ? "، " + ev.ratio + "× متوسط الصفحة" : "") + ")"; }
  function build(j) {
    if (!j || !j.mix) return "";
    var L = [], up = (j.do_more || []).slice(0, 8), down = (j.do_less || []).slice(0, 8), tests = (j.experiments || []).slice(0, 3);
    var weak = (j.staff_weak_ratings_30d || []).slice(0, 4), strong = (j.staff_strong_ratings_30d || []).slice(0, 3);
    var occ = (j.upcoming_occasions || []).slice(0, 4), recs = Array.isArray(j.weekly_recommendations) ? j.weekly_recommendations.slice(0, 3) : [];
    var titles = (j.recent_titles_45d || []).slice(0, 25);
    if (!up.length && !down.length && !occ.length && !recs.length && !weak.length) return "";
    L.push("=== PERFORMANCE MEMORY (من أداء منشوراتنا الفعلية — استرشاد فقط، الـBrief الحالي والسلامة الطبية أعلى منها) ===");
    L.push("MIX: 70% كرّر نمطًا ناجحًا بموضوع جديد · 20% جرّب زاوية/نوعًا/تخصصًا مختلفًا · 10% تجربة محددة (متغيّر واحد).");
    if (up.length) L.push("DO MORE: " + up.map(item).join(" ؛ "));
    if (down.length) L.push("DO LESS / AVOID: " + down.map(item).join(" ؛ "));
    if (tests.length) L.push("EXPERIMENTS: " + tests.map(function (t) { return (DIM[t.dimension] || t.dimension) + " = " + t.value + (t.note ? " — " + t.note : ""); }).join(" ؛ "));
    if (weak.length) L.push("STAFF MARKED WEAK (لا تكرر): " + weak.map(function (w) { return "«" + w.title + "»" + (w.reason ? " — " + w.reason : ""); }).join(" ؛ "));
    if (strong.length) L.push("STAFF MARKED STRONG: " + strong.map(function (w) { return "«" + w.title + "»"; }).join(" ؛ "));
    if (recs.length) L.push("WEEKLY REPORT RECOMMENDATIONS" + (j.weekly_report_week_end ? " (أسبوع " + j.weekly_report_week_end + ")" : "") + ": " + recs.map(function (r) { return typeof r === "string" ? r : (r.text || r.title || JSON.stringify(r)); }).join(" ؛ "));
    if (occ.length) L.push("UPCOMING HEALTH OCCASIONS: " + occ.map(function (o) { return o.name + " (" + o.from + (o.to && o.to !== o.from ? " → " + o.to : "") + ")" + (o.specialty ? " [" + (SPEC[o.specialty] || o.specialty) + "]" : ""); }).join(" ؛ "));
    if (titles.length) L.push("RECENT TITLES (لا تكرر): " + titles.join(" | "));
    L.push("MEMORY RULES: tentative = فرضية مش قاعدة · لا تذكر أرقامًا من الذاكرة كمعلومة طبية · اذكر في hypothesis_reason القاعدة اللي استخدمتها (مثال: «اخترت كاروسيل لأن الذاكرة بتقول DO MORE: النوع=كاروسيل»).");
    return L.join("\n");
  }
  function load(brand) {
    if (!brand || !window.SSMPDDb || !window.SSMPDDb.getContentLearningBrief) return Promise.resolve("");
    var c = cache[brand]; if (c && Date.now() - c.at < 5 * 60000) return Promise.resolve(c.text);
    return window.SSMPDDb.getContentLearningBrief(brand).then(function (j) { var t = build(j); cache[brand] = { text: t, at: Date.now() }; return t; }).catch(function () { return ""; });
  }
  function block(brand) { return brand && cache[brand] ? cache[brand].text : ""; }
  window.SSMPDLearningBrief = { load: load, block: block, build: build };
})();
