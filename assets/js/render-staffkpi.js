/* SSMPD — تاب "أداء الفريق": KPIs لكل موظف خلال فترة، بمستهدفات قابلة للتعديل ومقارنة بالفترة اللي قبلها.
   كل الحسابات في القاعدة (دالة staff_kpis) — الواجهة بتعرض بس. للإدارة فقط (مدير عام / سوبر أدمن). */
(function () {
  "use strict";

  var PRESETS = [["7d", "آخر 7 أيام"], ["30d", "آخر 30 يوم"], ["month", "الشهر الحالي"], ["prev_month", "الشهر اللي فات"], ["custom", "فترة مخصصة"]];
  var MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  var state = { preset: "30d", from: "", to: "", role: "", points: true, rows: [], prev: [], defs: {}, reviews: {}, alerts: [], summaries: {}, selfView: false, error: "", loading: true, seq: 0 };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem("ssmpd_staffkpi_" + k); localStorage.setItem("ssmpd_staffkpi_" + k, v); } catch (e) { return null; } }
  function num(v, d) { return v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d }); }

  // ---- الفترات (بتوقيت القاهرة) ----
  function cairoParts(d) {
    var p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-");
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function cairoMidnight(y, m, d) { return new Date(Date.UTC(y, m - 1, d, -3, 0, 0)); } // مصر UTC+3 في الصيف؛ فرق ساعة في الشتا مقبول لتقارير الفترات
  function range() {
    var now = new Date(), c = cairoParts(now), from, to = now;
    if (state.preset === "7d") from = new Date(now - 7 * 864e5);
    else if (state.preset === "30d") from = new Date(now - 30 * 864e5);
    else if (state.preset === "month") from = cairoMidnight(c.y, c.m, 1);
    else if (state.preset === "prev_month") { from = cairoMidnight(c.m === 1 ? c.y - 1 : c.y, c.m === 1 ? 12 : c.m - 1, 1); to = cairoMidnight(c.y, c.m, 1); }
    else {
      var a = state.from ? new Date(state.from + "T00:00:00+03:00") : new Date(now - 30 * 864e5);
      var b = state.to ? new Date(state.to + "T23:59:59+03:00") : now;
      from = a; to = b > a ? b : now;
    }
    var len = to - from, prevFrom = new Date(from - len);
    return { from: from, to: to, prevFrom: prevFrom, prevTo: from };
  }
  function prevMonthIso() { var c = cairoParts(new Date()), y = c.m === 1 ? c.y - 1 : c.y, m = c.m === 1 ? 12 : c.m - 1; return y + "-" + String(m).padStart(2, "0") + "-01"; }
  function reviewMonth(r) { var c = cairoParts(new Date(r.to - 864e5)); return { iso: c.y + "-" + String(c.m).padStart(2, "0") + "-01", label: MONTHS[c.m - 1] + " " + c.y }; }

  // ---- التجميع ----
  function group(rows) {
    var map = {}, list = [];
    (rows || []).forEach(function (r) {
      var g = map[r.admin_id] || (map[r.admin_id] = { id: r.admin_id, name: r.admin_name, role: r.admin_role, kpis: [] });
      if (g.kpis.length === 0) list.push(g);
      g.kpis.push(r);
    });
    list.forEach(function (g) {
      var sw = 0, w = 0, n = 0, any = false;
      g.kpis.forEach(function (k) { if (k.sample > 0) any = true; if (k.score != null) { sw += k.score * k.weight; w += Number(k.weight); n++; } });
      g.score = n >= 2 && w > 0 ? Math.round(sw / w) : null; g.counted = n; g.active = any;
    });
    return list;
  }
  function prevValue(adminId, kpi) {
    var r = (state.prev || []).filter(function (x) { return x.admin_id === adminId && x.kpi === kpi; })[0];
    return r && r.sample > 0 ? r.value : null;
  }
  function fmt(k) {
    var d = state.defs[k.kpi] || {}, v = k.value;
    if (v == null) return "—";
    var out = num(v, d.unit === "× متوسط الصفحة" ? 2 : 1);
    return out + (d.unit === "%" ? "%" : d.unit === "× متوسط الصفحة" ? "×" : " " + (d.unit || ""));
  }
  function tone(score) { return score == null ? "na" : score >= 80 ? "good" : score >= 50 ? "mid" : "bad"; }
  function delta(adminId, k) {
    var d = state.defs[k.kpi] || {}, p = prevValue(adminId, k.kpi);
    if (k.value == null || p == null || p === 0 && k.value === 0) return "";
    var ch = p === 0 ? 100 : (k.value - p) / Math.abs(p) * 100;
    if (Math.abs(ch) < 1) return '<em class="sk-d">—</em>';
    var better = d.direction === "lower" ? ch < 0 : ch > 0;
    return '<em class="sk-d ' + (better ? "up" : "down") + '" title="مقارنة بالفترة اللي قبلها">' + (ch > 0 ? "▲" : "▼") + " " + num(Math.abs(ch), 0) + "%</em>";
  }
  function stars(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆"; return s; }
  function roleLabel(role) { return window.SSMPDRoles && window.SSMPDRoles.label ? window.SSMPDRoles.label(role) : role; }

  // ---- العرض ----
  function ring(score) {
    if (!state.points) return "";
    return '<div class="sk-ring sk-' + tone(score) + '" style="--p:' + (score == null ? 0 : score) + '"><b>' + (score == null ? "—" : score) + '</b></div>';
  }
  function kpiLine(adminId, k) {
    var d = state.defs[k.kpi] || {}, small = k.sample < (d.min_sample || 0);
    return '<div class="sk-kpi"><div class="sk-kl"><span title="' + esc(d.hint_ar || "") + '">' + esc(d.label_ar || k.kpi) + '</span><b>' + esc(fmt(k)) + '</b>' + delta(adminId, k) + '</div>' +
      '<div class="sk-bar sk-' + tone(k.score) + '"><i style="width:' + (k.score == null ? 0 : Math.max(3, k.score)) + '%"></i></div>' +
      '<small>' + (k.value == null ? "لا توجد بيانات" : small ? "عينة صغيرة (" + k.sample + ")" : "المستهدف " + num(k.target, 1) + " · العينة " + k.sample) + '</small></div>';
  }
  function card(g) {
    var shown = g.kpis.filter(function (k) { return k.sample > 0 || k.value != null; }).slice(0, 4);
    var rv = state.reviews[g.id];
    return '<article class="sk-card" data-staff="' + esc(g.id) + '" role="button" tabindex="0"><header><div class="sk-av">' + esc(String(g.name || "؟").trim().charAt(0)) + '</div><div class="sk-who"><b>' + esc(g.name) + '</b><span>' + esc(roleLabel(g.role)) + '</span>' +
      (rv ? '<span class="sk-rate" title="تقييم الإدارة">' + stars(rv.rating) + '</span>' : "") + '</div>' + ring(g.score) + '</header>' +
      '<div class="sk-kpis">' + (shown.length ? shown.map(function (k) { return kpiLine(g.id, k); }).join("") : '<p class="sk-none">لا يوجد نشاط في الفترة دي</p>') + '</div>' +
      '<footer>' + (g.counted >= 2 ? "محسوبة من " + g.counted + " مؤشرات" : "بيانات غير كافية لتقييم عام") + ' · اضغط للتفاصيل</footer></article>';
  }
  function summary(list) {
    var scored = list.filter(function (g) { return g.score != null; });
    var avg = scored.length ? Math.round(scored.reduce(function (a, g) { return a + g.score; }, 0) / scored.length) : null;
    var top = scored.slice().sort(function (a, b) { return b.score - a.score; })[0], low = scored.length > 1 ? scored.slice().sort(function (a, b) { return a.score - b.score; })[0] : null;
    var inactive = list.filter(function (g) { return !g.active; }).length;
    function tile(l, v, s, cls, ic) { return '<div class="sk-tile ' + (cls || "") + '"><i aria-hidden="true">' + ic + '</i><b>' + v + '</b><span>' + l + '</span><small>' + s + '</small></div>'; }
    return '<section class="sk-summary">' + tile("متوسط الفريق", state.points && avg != null ? avg : "—", scored.length + " موظف لديهم تقييم", "", "📊") +
      tile("الأعلى أداءً", top ? esc(top.name) : "—", top && state.points ? top.score + " نقطة" : "", "good", "🏆") +
      tile("يحتاج متابعة", low ? esc(low.name) : "—", low && state.points ? low.score + " نقطة" : "", "bad", "🎯") +
      tile("بدون نشاط", inactive, "موظفين في الفترة", "mute", "💤") + '</section>';
  }
  function render(container) {
    var admin = window.SSMPDAuth.currentAdmin, isSuper = window.SSMPDRoles.isSuperAdmin ? window.SSMPDRoles.isSuperAdmin(admin) : admin.role === "super_admin";
    state.points = store("points") !== "0";
    state.container = container; state.isSuper = isSuper;
    state.preset = store("preset") || state.preset;
    draw();
    load();
  }
  function weakItems(groups) {
    var out = [];
    groups.forEach(function (g) { g.kpis.forEach(function (k) { var d = state.defs[k.kpi] || {}; if (k.score != null && k.score < 60 && k.sample >= (d.min_sample || 0)) out.push({ g: g, k: k, d: d }); }); });
    return out.sort(function (a, b) { return a.k.score - b.k.score; });
  }
  function weakRow(w) {
    return '<button type="button" class="sk-weak" data-staff="' + esc(w.g.id) + '"><span class="sk-wdot sk-' + tone(w.k.score) + '"></span><span class="sk-wt"><b>' + esc(w.g.name) + '</b><small>' + esc(w.d.label_ar || w.k.kpi) + ': ' + esc(fmt(w.k)) + ' · المستهدف ' + num(w.k.target, 1) + '</small></span>' + (state.points ? '<em>' + Math.round(w.k.score) + '%</em>' : '') + '</button>';
  }
  function draw() {
    var c = state.container; if (!c) return;
    var all = group(state.rows), list = all.filter(function (g) { return !state.role || g.role === state.role; });
    var roles = {}; all.forEach(function (g) { roles[g.role] = 1; });
    var active = list.filter(function (g) { return g.active; }).sort(function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); });
    var idle = list.filter(function (g) { return !g.active; });
    var weak = weakItems(active), r = range();
    var nameOf = {}; all.forEach(function (g) { nameOf[g.id] = g.name; });
    var alertsHtml = state.alerts.length ? '<section class="sk-alerts" aria-label="تنبيهات الأداء"><h2>🚨 تنبيهات أداء جديدة</h2><div>' + state.alerts.map(function (a) { return '<div class="sk-alert"><span>' + esc(a.message) + '</span><button type="button" class="btn" data-sk-ack="' + esc(a.id) + '">تمت المراجعة</button></div>'; }).join("") + '</div></section>' : "";
    var attn = weak.length ? '<section class="sk-attn"><h2>محتاج متابعة</h2><div class="sk-pills">' + weak.slice(0, 4).map(function (w) { return '<button type="button" class="sk-pill" data-staff="' + esc(w.g.id) + '"><i>⚠️</i><b>' + esc(w.g.name) + '</b><span>' + esc(w.d.label_ar || w.k.kpi) + '</span></button>'; }).join("") + '</div></section>' : (state.loading ? "" : '<section class="sk-attn"><div class="sk-allgood"><i>✓</i><div><b>مفيش مؤشر تحت الحد</b><span>كل المؤشرات اللي ليها بيانات كافية فوق 60%</span></div></div></section>');
    var sumRows = Object.keys(state.summaries).map(function (id) { var x = state.summaries[id]; return '<details class="sk-sum"><summary><b>' + esc(nameOf[id] || "—") + '</b>' + (x.score != null && state.points ? '<em>' + x.score + '</em>' : "") + '<span class="sk-src">' + (x.source === "claude" ? "Claude" : "تلقائي") + '</span></summary><p>💪 ' + esc(x.strength) + '</p><p>🔧 ' + esc(x.improve) + '</p><p>➡️ ' + esc(x.action) + '</p></details>'; }).join("");
    c.innerHTML = '<section class="sk" dir="rtl"><header class="sk-hero"><div><p>الإدارة · مؤشرات الأداء</p><h1>أداء الفريق</h1><span>' + r.from.toLocaleDateString("ar-EG-u-nu-latn") + ' ← ' + r.to.toLocaleDateString("ar-EG-u-nu-latn") + ' · مقارنة بالفترة السابقة بنفس الطول</span></div>' +
      '<div class="sk-actions">' + (state.isSuper ? '<button class="btn" data-sk="selfview" aria-pressed="' + state.selfView + '" title="لما تتفعّل كل موظف بيشوف أرقامه هو بس في تاب أدائي">أدائي للموظفين: ' + (state.selfView ? "مفعّلة ✓" : "مقفولة") + '</button><button class="btn" data-sk="targets">المستهدفات</button>' : "") + '<button class="btn" data-sk="csv">تصدير CSV</button></div></header>' +
      '<div class="sk-tools"><div class="sk-presets" role="tablist">' + PRESETS.map(function (p) { return '<button type="button" class="sk-preset' + (state.preset === p[0] ? " on" : "") + '" data-sk-preset="' + p[0] + '">' + p[1] + '</button>'; }).join("") + '</div>' +
      (state.preset === "custom" ? '<div class="sk-custom"><label>من <input type="date" data-sk-from value="' + esc(state.from) + '"></label><label>إلى <input type="date" data-sk-to value="' + esc(state.to) + '"></label></div>' : "") +
      '<select data-sk-role aria-label="الدور"><option value="">كل الأدوار</option>' + Object.keys(roles).map(function (x) { return '<option value="' + esc(x) + '"' + (state.role === x ? " selected" : "") + '>' + esc(roleLabel(x)) + '</option>'; }).join("") + '</select>' +
      '<label class="sk-toggle"><input type="checkbox" data-sk-points' + (state.points ? " checked" : "") + '> إظهار النقاط</label></div>' +
      (state.error ? '<div class="sk-err">' + esc(state.error) + '</div>' : "") + alertsHtml +
      (state.loading && !state.rows.length ? '<div class="sk-loading">جاري حساب المؤشرات…</div>' : attn + summary(list) +
        '<div class="sk-layout"><div class="sk-main"><section class="sk-grid">' + (active.map(card).join("") || '<p class="sk-none">لا توجد بيانات في الفترة دي</p>') + '</section></div>' +
        '<aside class="sk-side">' + (weak.length ? '<section class="sk-box"><h2>أولويات المتابعة <span class="sk-count">' + weak.length + '</span></h2>' + weak.slice(0, 8).map(weakRow).join("") + '</section>' : "") +
        (sumRows ? '<section class="sk-box"><h2>ملخص الشهر اللي فات</h2>' + sumRows + '</section>' : "") +
        (idle.length ? '<section class="sk-box"><h2>بدون نشاط في الفترة <span class="sk-count">' + idle.length + '</span></h2><div class="sk-chips">' + idle.map(function (g) { return '<button type="button" class="sk-chip" data-staff="' + esc(g.id) + '">' + esc(g.name) + ' · ' + esc(roleLabel(g.role)) + '</button>'; }).join("") + '</div></section>' : "") + '</aside></div>') +
      '<p class="sk-foot">الأرقام بتعتمد على اللي بيتسجّل في الداشبورد؛ أي مؤشر عينته أقل من الحد الأدنى بيظهر «عينة صغيرة» ومبيدخلش في النقاط. الأعداد بتتناسب مع طول الفترة. النقاط = متوسط مرجّح لنسبة تحقيق كل مستهدف (حد أقصى 100). التنبيهات بتتولّد يوميًا لما مؤشر مهم ينزل تحت 40% خلال آخر أسبوعين.</p></section>';
    wire();
  }
  function wire() {
    var c = state.container;
    c.querySelectorAll("[data-sk-preset]").forEach(function (b) { b.onclick = function () { state.preset = b.getAttribute("data-sk-preset"); store("preset", state.preset); if (state.preset === "custom") { draw(); return; } load(); }; });
    var f = c.querySelector("[data-sk-from]"), t = c.querySelector("[data-sk-to]");
    if (f) f.onchange = function () { state.from = f.value; load(); };
    if (t) t.onchange = function () { state.to = t.value; load(); };
    var rs = c.querySelector("[data-sk-role]"); if (rs) rs.onchange = function () { state.role = rs.value; draw(); };
    var pt = c.querySelector("[data-sk-points]"); if (pt) pt.onchange = function () { state.points = pt.checked; store("points", pt.checked ? "1" : "0"); draw(); };
    c.querySelectorAll("[data-staff]").forEach(function (el) {
      function open() { detail(el.getAttribute("data-staff")); }
      el.onclick = open; el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    });
    c.querySelectorAll("[data-sk-ack]").forEach(function (b) { b.onclick = function () { b.disabled = true; window.SSMPDDb.ackStaffAlert(b.getAttribute("data-sk-ack")).then(function () { state.alerts = state.alerts.filter(function (a) { return a.id !== b.getAttribute("data-sk-ack"); }); draw(); }).catch(function () { b.disabled = false; }); }; });
    var sv = c.querySelector('[data-sk="selfview"]');
    if (sv) sv.onclick = function () { sv.disabled = true; window.SSMPDDb.setStaffKpiSelfView(!state.selfView).then(function () { state.selfView = !state.selfView; draw(); }).catch(function (e) { sv.disabled = false; alert((e && e.message) || "تعذر الحفظ (للسوبر أدمن فقط)"); }); };
    var tb = c.querySelector('[data-sk="targets"]'); if (tb) tb.onclick = targetsModal;
    var cb = c.querySelector('[data-sk="csv"]'); if (cb) cb.onclick = exportCsv;
  }
  function load() {
    var seq = ++state.seq, r = range(); state.loading = true; state.error = "";
    var db = window.SSMPDDb, rm = reviewMonth(r);
    Promise.all([db.staffKpis(r.from.toISOString(), r.to.toISOString()), db.staffKpis(r.prevFrom.toISOString(), r.prevTo.toISOString()), db.kpiDefs(), db.staffReviews(rm.iso), db.staffAlerts().catch(function () { return []; }), (db.staffKpiSelfView ? db.staffKpiSelfView().catch(function () { return null; }) : Promise.resolve(null)), db.staffSummaries(prevMonthIso()).catch(function () { return []; })]).then(function (res) {
      if (seq !== state.seq) return;
      state.rows = res[0] || []; state.prev = res[1] || [];
      state.defs = {}; (res[2] || []).forEach(function (d) { state.defs[d.kpi] = d; });
      state.reviews = {}; (res[3] || []).forEach(function (x) { state.reviews[x.admin_id] = x; });
      state.selfView = !!(res[5] && res[5].value === true); state.alerts = res[4] || []; state.summaries = {}; (res[6] || []).forEach(function (x) { state.summaries[x.admin_id] = x; });
      state.loading = false; draw();
    }).catch(function (e) {
      if (seq !== state.seq) return;
      state.loading = false; state.error = /42883|PGRST202|does not exist/i.test(String(e && (e.code || e.message))) ? "شغّل ملف تفعيل أداء الفريق في Supabase ثم حدّث الشاشة." : (e && e.message) || "تعذر تحميل البيانات";
      draw();
    });
  }
  // ---- نافذة الموظف ----
  function modal(title, body, cls) {
    var b = document.createElement("div"); b.className = "modal-backdrop";
    b.innerHTML = '<div class="modal sk-modal ' + (cls || "") + '" dir="rtl"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close" aria-label="إغلاق">×</button></div>' + body + '</div>';
    document.body.appendChild(b);
    function close() { b.remove(); }
    b.querySelector(".modal-close").onclick = close; b.onclick = function (e) { if (e.target === b) close(); };
    return { el: b, close: close };
  }
  function detail(id) {
    var g = group(state.rows).filter(function (x) { return x.id === id; })[0]; if (!g) return;
    var r = range(), rm = reviewMonth(r), rv = state.reviews[id] || {};
    var rows = g.kpis.map(function (k) {
      var d = state.defs[k.kpi] || {};
      return '<tr><td><b>' + esc(d.label_ar || k.kpi) + '</b><small>' + esc(d.hint_ar || "") + '</small></td><td>' + esc(fmt(k)) + ' ' + delta(id, k) + '</td><td>' + (k.target == null ? "—" : esc(num(k.target, 1))) + '</td><td><div class="sk-bar sk-' + tone(k.score) + '"><i style="width:' + (k.score == null ? 0 : Math.max(3, k.score)) + '%"></i></div>' + (state.points ? '<small>' + (k.score == null ? "—" : k.score + "%") + '</small>' : "") + '</td><td>' + k.sample + '</td></tr>';
    }).join("");
    var body = '<div class="sk-dh">' + ring(g.score) + '<div><b>' + esc(g.name) + '</b><span>' + esc(roleLabel(g.role)) + '</span></div></div>' +
      '<div class="sk-scroll"><table class="sk-table"><thead><tr><th>المؤشر</th><th>القيمة</th><th>المستهدف</th><th>تحقيق المستهدف</th><th>العينة</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (state.summaries[id] ? '<div class="sk-msum"><h4>ملخص الشهر اللي فات <span class="sk-src">' + (state.summaries[id].source === "claude" ? "Claude" : "تلقائي") + '</span></h4><p>💪 ' + esc(state.summaries[id].strength) + '</p><p>🔧 ' + esc(state.summaries[id].improve) + '</p><p>➡️ ' + esc(state.summaries[id].action) + '</p></div>' : "") +
      '<form class="sk-review" data-sk-review><h4>تقييم الإدارة — ' + esc(rm.label) + '</h4><div class="sk-stars" role="radiogroup" aria-label="التقييم">' + [1, 2, 3, 4, 5].map(function (i) { return '<label><input type="radio" name="rating" value="' + i + '"' + (rv.rating === i ? " checked" : "") + '><span>★</span></label>'; }).join("") + '</div>' +
      '<textarea name="note" rows="3" maxlength="1000" placeholder="ملاحظة مختصرة (نقطة قوة / نقطة تطوير)">' + esc(rv.note || "") + '</textarea><div class="sk-rv-foot"><button class="btn btn-primary" type="submit">حفظ التقييم</button><span data-sk-rv-msg></span></div></form><div data-sk-hist></div>';
    var m = modal("أداء " + g.name, body, "sk-wide");
    var form = m.el.querySelector("[data-sk-review]"), msg = m.el.querySelector("[data-sk-rv-msg]");
    form.onsubmit = function (e) {
      e.preventDefault();
      var rating = Number((form.querySelector('input[name="rating"]:checked') || {}).value || 0);
      if (!rating) { msg.textContent = "اختر عدد النجوم."; return; }
      msg.textContent = "جاري الحفظ…";
      window.SSMPDDb.saveStaffReview(id, rm.iso, rating, form.note.value).then(function () { msg.textContent = "✓ اتحفظ"; state.reviews[id] = { admin_id: id, rating: rating, note: form.note.value }; draw(); }).catch(function (er) { msg.textContent = (er && er.message) || "تعذر الحفظ"; });
    };
    window.SSMPDDb.staffReviewHistory(id).then(function (h) {
      var host = m.el.querySelector("[data-sk-hist]"); if (!host || !h || !h.length) return;
      host.innerHTML = '<h4>التقييمات السابقة</h4><ul class="sk-hist">' + h.map(function (x) { var p = String(x.month).split("-"); return '<li><b>' + MONTHS[(+p[1]) - 1] + " " + p[0] + '</b> <span class="sk-rate">' + stars(x.rating) + '</span>' + (x.note ? '<p>' + esc(x.note) + '</p>' : "") + '</li>'; }).join("") + '</ul>';
    }).catch(function () {});
  }
  // ---- المستهدفات (سوبر أدمن) ----
  function targetsModal() {
    var db = window.SSMPDDb;
    Promise.all([db.kpiTargets(), db.kpiDefs()]).then(function (res) {
      var tg = res[0] || [], defs = res[1] || [], byRole = {};
      tg.forEach(function (t) { (byRole[t.role] = byRole[t.role] || []).push(t); });
      var dmap = {}; defs.forEach(function (d) { dmap[d.kpi] = d; });
      var body = '<p class="sk-note">المستهدف لكل 30 يوم للمؤشرات العددية (بيتناسب تلقائيًا مع طول الفترة)، والنسب والأزمنة مستهدف ثابت. الوزن = أهمية المؤشر في النقاط (0 = لا يدخل).</p><form data-sk-targets>' +
        Object.keys(byRole).map(function (role) {
          return '<fieldset class="sk-tg"><legend>' + esc(roleLabel(role)) + '</legend>' + byRole[role].sort(function (a, b) { return ((dmap[a.kpi] || {}).sort_order || 0) - ((dmap[b.kpi] || {}).sort_order || 0); }).map(function (t) {
            var d = dmap[t.kpi] || {};
            return '<div class="sk-tr"><span>' + esc(d.label_ar || t.kpi) + ' <small>(' + (d.direction === "lower" ? "الأقل أفضل" : "الأعلى أفضل") + ' · ' + esc(d.unit || "") + ')</small></span><label>المستهدف <input type="number" step="any" min="0" data-role="' + esc(role) + '" data-kpi="' + esc(t.kpi) + '" data-f="target" value="' + esc(t.target) + '"></label><label>الوزن <input type="number" step="1" min="0" max="10" data-role="' + esc(role) + '" data-kpi="' + esc(t.kpi) + '" data-f="weight" value="' + esc(t.weight) + '"></label></div>';
          }).join("") + '</fieldset>';
        }).join("") + '<div class="sk-rv-foot"><button class="btn btn-primary" type="submit">حفظ المستهدفات</button><span data-sk-tg-msg></span></div></form>';
      var m = modal("مستهدفات المؤشرات", body, "sk-wide");
      var form = m.el.querySelector("[data-sk-targets]"), msg = m.el.querySelector("[data-sk-tg-msg]");
      form.onsubmit = function (e) {
        e.preventDefault();
        var map = {};
        form.querySelectorAll("input[data-kpi]").forEach(function (i) { var k = i.dataset.role + "|" + i.dataset.kpi; (map[k] = map[k] || { role: i.dataset.role, kpi: i.dataset.kpi })[i.dataset.f] = Number(i.value); });
        var rows = Object.keys(map).map(function (k) { return map[k]; }), bad = rows.some(function (r) { return !isFinite(r.target) || r.target < 0 || !isFinite(r.weight) || r.weight < 0 || r.weight > 10; });
        if (bad) { msg.textContent = "راجع الأرقام: المستهدف ≥ 0 والوزن بين 0 و10."; return; }
        msg.textContent = "جاري الحفظ…";
        db.saveKpiTargets(rows).then(function () { msg.textContent = "✓ اتحفظ"; load(); }).catch(function (er) { msg.textContent = (er && er.message) || "تعذر الحفظ (للسوبر أدمن فقط)"; });
      };
    }).catch(function (e) { alert((e && e.message) || "تعذر تحميل المستهدفات"); });
  }
  function exportCsv() {
    var head = ["الموظف", "الدور", "المؤشر", "القيمة", "العينة", "المستهدف", "النسبة %"];
    var lines = [head].concat(state.rows.map(function (r) { var d = state.defs[r.kpi] || {}; return [r.admin_name, roleLabel(r.admin_role), d.label_ar || r.kpi, r.value == null ? "" : Number(r.value).toFixed(2), r.sample, r.target == null ? "" : r.target, r.score == null ? "" : r.score]; }));
    var csv = "﻿" + lines.map(function (l) { return l.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "staff-kpi.csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.SSMPDRenderStaffKpi = { render: render };
})();
