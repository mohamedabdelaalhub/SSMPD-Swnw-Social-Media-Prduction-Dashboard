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
  /* owner-approved redesign (2026-11-18, mockup docs/ui-references/mockups/team-performance.html):
     no hero banner, KPI tiles 4/2/1, ranking chart, plain-sentence «محتاج متابعة», 2-up employee cards, low-data folded.
     Every number comes from staff_kpis() for this period and the previous one of the same length — nothing estimated. */
  var GOOD = "#6CC49A", MID = "#FF8800", BAD = "#D0402A";
  function color(score) { return score == null ? "#CBD3E1" : score >= 80 ? GOOD : score >= 50 ? MID : BAD; }
  function change(adminId, k) {
    var p = prevValue(adminId, k.kpi);
    if (k.value == null || p == null || p === 0 && k.value === 0) return null;
    return p === 0 ? 100 : (k.value - p) / Math.abs(p) * 100;
  }
  function delta(adminId, k) {
    var d = state.defs[k.kpi] || {}, ch = change(adminId, k);
    if (ch == null) return "";
    if (Math.abs(ch) < 1) return '<em class="sk2-chip eq" title="مقارنة بالفترة اللي قبلها">—</em>';
    var better = d.direction === "lower" ? ch < 0 : ch > 0;
    var txt = ch >= 100 ? "أكتر من الضعف" : (ch > 0 ? "↑ " : "↓ ") + num(Math.min(Math.abs(ch), 99), 0) + "٪";
    return '<em class="sk2-chip ' + (better ? "up" : "dn") + '" title="مقارنة بالفترة اللي قبلها">' + txt + '</em>';
  }
  function stars(n) { var s = ""; for (var i = 1; i <= 5; i++) s += i <= n ? "★" : "☆"; return s; }
  function roleLabel(role) { return window.SSMPDRoles && window.SSMPDRoles.label ? window.SSMPDRoles.label(role) : role; }
  function initial(name) { return esc(String(name || "؟").trim().charAt(0)); }
  function ring(score) {
    if (!state.points) return "";
    var c = 2 * Math.PI * 22, off = score == null ? c : c * (1 - Math.max(0, Math.min(100, score)) / 100);
    return '<span class="sk-ring sk2-ring" style="--c:' + color(score) + '"><svg viewBox="0 0 54 54" aria-hidden="true"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" style="stroke-dasharray:' + c.toFixed(1) + ';--off:' + off.toFixed(1) + '"/></svg><b>' + (score == null ? "—" : score) + '</b></span>';
  }
  function kpiLine(adminId, k) {
    var d = state.defs[k.kpi] || {}, small = k.sample < (d.min_sample || 0);
    var note = k.value == null ? "لا توجد بيانات" : small ? "عينة صغيرة (" + k.sample + ")" : "المستهدف " + num(k.target, 1) + (d.direction === "lower" ? " · أقل أحسن" : "");
    return '<div class="sk2-m"><div class="sk2-ml"><span title="' + esc(d.hint_ar || d.label_ar || "") + '">' + esc(d.label_ar || k.kpi) + '</span><b>' + esc(fmt(k)) + '</b>' + delta(adminId, k) + '</div>' +
      '<span class="sk2-track" style="--c:' + color(k.score) + '"><i data-w="' + (k.score == null ? 0 : Math.max(3, Math.min(100, k.score))) + '"></i></span><small>' + esc(note) + '</small></div>';
  }
  function card(g) {
    var shown = g.kpis.filter(function (k) { return k.sample > 0 || k.value != null; }).slice(0, 4);
    var rv = state.reviews[g.id];
    return '<article class="sk-card sk2-card" data-staff="' + esc(g.id) + '" role="button" tabindex="0"><header><span class="sk2-av">' + initial(g.name) + '</span><div><b>' + esc(g.name) + '</b><small>' + esc(roleLabel(g.role)) + (rv ? ' · <span class="sk-rate" title="تقييم الإدارة">' + stars(rv.rating) + '</span>' : "") + '</small></div>' + ring(g.score) + '</header>' +
      '<div class="sk2-ms">' + (shown.length ? shown.map(function (k) { return kpiLine(g.id, k); }).join("") : '<p class="sk-none">لا يوجد نشاط في الفترة دي</p>') + '</div>' +
      '<footer><span>' + (g.counted >= 2 ? "محسوبة من " + g.counted + " مؤشرات" : "بيانات مش كفاية لتقييم عام") + '</span><span class="sk2-lnk">التفاصيل</span></footer></article>';
  }
  function tile(o) {
    return '<div class="sk2-k" style="--c:' + o.c + ';--t:' + o.t + '"><span class="sk2-ic" aria-hidden="true">' + o.icon + '</span><small>' + o.label + '</small><b>' + o.value + (o.unit ? '<u>' + o.unit + '</u>' : "") + '</b><i' + (o.tone ? ' class="' + o.tone + '"' : "") + '>' + (o.sub || "") + '</i>' + (o.extra || '<span class="sk2-gap"></span>') + '</div>';
  }
  var IC = { avg: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>', ok: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>', warn: '<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>', idle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>' };
  function faces(list, c, t) { return '<span class="sk2-faces">' + list.slice(0, 6).map(function (g) { return '<span style="--c:' + c + ';--t:' + t + '" title="' + esc(g.name) + '">' + initial(g.name) + '</span>'; }).join("") + (list.length > 6 ? '<span style="--c:#525B6F;--t:#EEF1F5">+' + (list.length - 6) + '</span>' : "") + '</span>'; }
  function summary(list, prevList, weakPeople, idle) {
    var scored = list.filter(function (g) { return g.score != null; });
    var avg = scored.length ? Math.round(scored.reduce(function (a, g) { return a + g.score; }, 0) / scored.length) : null;
    var pScored = prevList.filter(function (g) { return g.score != null; }), pAvg = pScored.length ? Math.round(pScored.reduce(function (a, g) { return a + g.score; }, 0) / pScored.length) : null;
    var good = scored.filter(function (g) { return g.score >= 80; });
    var diff = avg != null && pAvg != null ? avg - pAvg : null;
    var cmp = avg != null && pAvg != null && state.points ? '<span class="sk2-cmp"><span><em>الفترة دي</em><span class="sk2-track" style="--c:#0F369D"><i data-w="' + avg + '"></i></span><b>' + avg + '</b></span><span><em>اللي قبلها</em><span class="sk2-track" style="--c:#9DB2E6"><i data-w="' + pAvg + '"></i></span><b>' + pAvg + '</b></span></span>' : "";
    return '<section class="sk2-kpis sk-summary">' +
      tile({ label: "متوسط الفريق", value: state.points && avg != null ? avg : "—", unit: state.points && avg != null ? "من 100" : "", sub: diff == null ? scored.length + " موظف ليهم تقييم" : diff === 0 ? "زي الفترة اللي قبلها" : (diff > 0 ? "↑ " : "↓ ") + Math.abs(diff) + " عن الفترة اللي قبلها", tone: diff > 0 ? "up" : diff < 0 ? "dn" : "", c: "#0F369D", t: "#E8EEFB", icon: IC.avg, extra: cmp }) +
      tile({ label: "أداء جيد (80 فأكتر)", value: good.length, unit: "من " + scored.length + " موظفين", sub: "اللي ليهم تقييم في الفترة", c: "#4FA97E", t: "#EAF6F0", icon: IC.ok, extra: good.length ? faces(good, "#4FA97E", "#EAF6F0") : "" }) +
      tile({ label: "محتاجين متابعة", value: weakPeople.length, unit: "موظفين", sub: weakPeople.length ? "مؤشر تحت 60٪" : "كله فوق 60٪", tone: weakPeople.length ? "dn" : "", c: BAD, t: "#FBE7E4", icon: IC.warn, extra: weakPeople.length ? faces(weakPeople, BAD, "#FBE7E4") : "" }) +
      tile({ label: "نشاط قليل", value: idle.length, unit: "موظفين", sub: "بيانات مش كفاية للتقييم", c: "#525B6F", t: "#EEF1F5", icon: IC.idle, extra: idle.length ? faces(idle, "#525B6F", "#EEF1F5") : "" }) +
      '</section>';
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
    var c = color(w.k.score), t = w.k.score < 50 ? "#FBE7E4" : "#FFF0DD";
    return '<li><button type="button" class="sk-weak" data-staff="' + esc(w.g.id) + '" style="--c:' + c + ';--t:' + t + '"><span class="sk2-av">' + initial(w.g.name) + '</span><span class="sk2-wt"><b>' + esc(w.g.name) + '</b><small>' + esc(w.d.label_ar || w.k.kpi) + ' ' + esc(fmt(w.k)) + ' · المستهدف ' + num(w.k.target, 1) + '</small></span>' + (state.points ? '<em>' + Math.round(w.k.score) + '٪</em>' : '') + '</button></li>';
  }
  function rankRow(g, prevScore) {
    var d = prevScore == null || g.score == null ? null : g.score - prevScore;
    return '<li><button type="button" data-staff="' + esc(g.id) + '"><span class="sk2-who"><span class="sk2-av">' + initial(g.name) + '</span><b>' + esc(g.name) + '</b></span><span class="sk2-track sk2-rt" style="--c:' + color(g.score) + '"><i data-w="' + g.score + '"></i><span class="sk2-tgt"></span></span><span class="sk2-score"><b>' + g.score + '</b>' + (d == null ? "" : d === 0 ? '<em class="sk2-chip eq">—</em>' : '<em class="sk2-chip ' + (d > 0 ? "up" : "dn") + '">' + (d > 0 ? "↑ " : "↓ ") + Math.abs(d) + '</em>') + '</span></button></li>';
  }
  function fmtDay(d) { var c = cairoParts(d); return c.d + " " + MONTHS[c.m - 1]; }
  function draw() {
    var c = state.container; if (!c) return;
    var all = group(state.rows), list = all.filter(function (g) { return !state.role || g.role === state.role; });
    var prevAll = group(state.prev), prevList = prevAll.filter(function (g) { return !state.role || g.role === state.role; }), prevScore = {};
    prevAll.forEach(function (g) { prevScore[g.id] = g.score; });
    var roles = {}; all.forEach(function (g) { roles[g.role] = 1; });
    var active = list.filter(function (g) { return g.active; }).sort(function (a, b) { return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score); });
    var idle = list.filter(function (g) { return !g.active; });
    var weak = weakItems(active), seen = {}, weakPeople = [];
    weak.forEach(function (w) { if (!seen[w.g.id]) { seen[w.g.id] = 1; weakPeople.push(w.g); } });
    var r = range(), ranked = active.filter(function (g) { return g.score != null; });
    var nameOf = {}; all.forEach(function (g) { nameOf[g.id] = g.name; });
    var alertsHtml = state.alerts.length ? '<section class="sk-alerts sk2-alerts" aria-label="تنبيهات الأداء"><h2>تنبيهات أداء جديدة</h2><div>' + state.alerts.map(function (a) { return '<div class="sk-alert"><span>' + esc(a.message) + '</span><button type="button" class="btn" data-sk-ack="' + esc(a.id) + '">تمت المراجعة</button></div>'; }).join("") + '</div></section>' : "";
    var sumRows = Object.keys(state.summaries).map(function (id) { var x = state.summaries[id]; return '<details class="sk-sum"><summary><b>' + esc(nameOf[id] || "—") + '</b>' + (x.score != null && state.points ? '<em>' + x.score + '</em>' : "") + '<span class="sk-src">' + (x.source === "claude" ? "تحليل ذكي" : "تلقائي") + '</span></summary><p>نقطة قوة: ' + esc(x.strength) + '</p><p>محتاج يتحسن: ' + esc(x.improve) + '</p><p>الخطوة الجاية: ' + esc(x.action) + '</p></details>'; }).join("");
    var rankCard = ranked.length && state.points ? '<article class="sk2-card2 sk2-wide"><div class="sk2-ch"><div><h2>ترتيب الفريق</h2><small>النقاط من 100 · الخط الرفيع = 80</small></div></div><ul class="sk2-rank">' + ranked.map(function (g) { return rankRow(g, prevScore[g.id]); }).join("") + '</ul><div class="sk2-lg"><span><i style="background:' + GOOD + '"></i>80 فأكتر</span><span><i style="background:' + MID + '"></i>من 50 لـ 79</span><span><i style="background:' + BAD + '"></i>أقل من 50</span></div></article>' : "";
    var needCard = '<article class="sk2-card2 sk-side"><div class="sk2-ch"><div><h2>محتاج متابعة</h2><small>' + (weak.length ? "مرتبة بالأهم" : "") + '</small></div></div>' + (weak.length ? '<ul class="sk2-need">' + weak.slice(0, 6).map(weakRow).join("") + '</ul>' : '<p class="sk2-clear">مفيش مؤشر تحت 60٪ في الفترة دي 👌</p>') + '</article>';
    var people = active.length ? '<section class="sk-grid sk2-people">' + active.map(card).join("") + '</section>' : '<p class="sk-none">لا توجد بيانات في الفترة دي</p>';
    var low = idle.length ? '<details class="sk2-low"><summary><span class="sk2-av">' + idle.length + '</span>نشاط قليل في الفترة<small>مش هيتقيّموا لحد ما يبقى فيه بيانات كفاية</small></summary><div class="sk2-lowlist">' + idle.map(function (g) { return '<button type="button" class="sk-chip" data-staff="' + esc(g.id) + '"><span class="sk2-av">' + initial(g.name) + '</span>' + esc(g.name) + ' · ' + esc(roleLabel(g.role)) + '</button>'; }).join("") + '</div></details>' : "";
    c.innerHTML = '<section class="sk sk2" dir="rtl"><header class="sk2-ph"><div><p>الإدارة · مؤشرات الأداء</p><h1>أداء الفريق</h1><span>' + fmtDay(r.from) + ' ← ' + fmtDay(r.to) + ' · مقارنة بالفترة اللي قبلها بنفس الطول</span></div>' +
      '<div class="sk2-acts">' + (state.isSuper ? '<button type="button" class="sk2-sw" data-sk="selfview" aria-pressed="' + state.selfView + '" title="لما تتفعّل كل موظف بيشوف أرقامه هو بس في تاب أدائي"><i aria-hidden="true"></i>أدائي للموظفين</button><button type="button" class="btn" data-sk="targets">المستهدفات</button>' : "") + '<button type="button" class="btn" data-sk="csv">تصدير</button></div></header>' +
      '<div class="sk2-tools"><div class="sk2-seg" role="tablist">' + PRESETS.map(function (p) { return '<button type="button" class="sk-preset' + (state.preset === p[0] ? " on" : "") + '" data-sk-preset="' + p[0] + '" aria-pressed="' + (state.preset === p[0]) + '">' + p[1] + '</button>'; }).join("") + '</div>' +
      (state.preset === "custom" ? '<div class="sk-custom"><label>من <input type="date" data-sk-from value="' + esc(state.from) + '"></label><label>إلى <input type="date" data-sk-to value="' + esc(state.to) + '"></label></div>' : "") +
      '<select data-sk-role aria-label="الدور"><option value="">كل الأدوار</option>' + Object.keys(roles).map(function (x) { return '<option value="' + esc(x) + '"' + (state.role === x ? " selected" : "") + '>' + esc(roleLabel(x)) + '</option>'; }).join("") + '</select>' +
      '<label class="sk2-pts"><input type="checkbox" data-sk-points' + (state.points ? " checked" : "") + '> إظهار النقاط</label></div>' +
      (state.error ? '<div class="sk-err">' + esc(state.error) + '</div>' : "") + alertsHtml +
      (state.loading && !state.rows.length ? '<div class="sk-loading">جاري حساب المؤشرات…</div>' :
        summary(list, prevList, weakPeople, idle) + '<div class="sk2-grid">' + rankCard + needCard + '</div>' + people + low +
        (sumRows ? '<details class="sk2-low sk2-sums"><summary>ملخص الشهر اللي فات<small>نقطة قوة ومحتاج يتحسن والخطوة الجاية لكل موظف</small></summary><div>' + sumRows + '</div></details>' : "")) +
      '<details class="sk2-explain"><summary>إزاي بتتحسب النقاط؟</summary><p>الأرقام بتعتمد على اللي بيتسجّل في الداشبورد؛ أي مؤشر عينته أقل من الحد الأدنى بيظهر «عينة صغيرة» ومبيدخلش في النقاط. الأعداد بتتناسب مع طول الفترة. النقاط = متوسط مرجّح لنسبة تحقيق كل مستهدف (حد أقصى 100). التنبيهات بتتولّد يوميًا لما مؤشر مهم ينزل تحت 40٪ خلال آخر أسبوعين.</p></details></section>';
    if (window.SSMPDSharedReception) window.SSMPDSharedReception.append(c.querySelector('.sk'), { context: 'staff', from: r.from.toISOString().slice(0, 10), to: r.to.toISOString().slice(0, 10) });
    wire();
    animate(c);
  }
  function animate(c) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(function () { c.querySelectorAll('[data-w]').forEach(function (i) { i.style.width = i.getAttribute('data-w') + '%'; }); c.querySelectorAll('.sk2-ring .fg').forEach(function (f) { f.style.strokeDashoffset = f.style.getPropertyValue('--off'); }); }, reduce ? 0 : 80);
  }
  function wire() {
    var c = state.container;
    c.querySelectorAll("[data-sk-preset]").forEach(function (b) { b.onclick = function () { if (window.SSMPDMotion && window.SSMPDMotion.sound) try { window.SSMPDMotion.sound.toggle(); } catch (e) {} state.preset = b.getAttribute("data-sk-preset"); store("preset", state.preset); if (state.preset === "custom") { draw(); return; } load(); }; });
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
