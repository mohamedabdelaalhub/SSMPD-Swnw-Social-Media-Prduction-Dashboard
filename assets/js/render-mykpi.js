/* SSMPD — تاب "أدائي": الموظف يشوف أرقامه هو بس (مقارنة بنفسه في الفترة اللي قبلها) — من غير ترتيب مع زملاؤه.
   بيشتغل بس لما الإدارة تفعّل «إتاحة أدائي للموظفين» من تاب أداء الفريق (افتراضيًا مقفول). */
(function () {
  "use strict";
  var PRESETS = [["30d", "آخر 30 يوم"], ["month", "الشهر الحالي"], ["prev_month", "الشهر اللي فات"]];
  var state = { preset: "30d", data: null, prev: null, error: "", loading: true, seq: 0, container: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v, d) { return v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 1 : d }); }
  function cairoParts(d) { var p = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-"); return { y: +p[0], m: +p[1] }; }
  function midnight(y, m) { return new Date(Date.UTC(y, m - 1, 1, -3, 0, 0)); }
  function range() {
    var now = new Date(), c = cairoParts(now), from, to = now;
    if (state.preset === "month") from = midnight(c.y, c.m);
    else if (state.preset === "prev_month") { from = midnight(c.m === 1 ? c.y - 1 : c.y, c.m === 1 ? 12 : c.m - 1); to = midnight(c.y, c.m); }
    else from = new Date(now - 30 * 864e5);
    return { from: from, to: to, pf: new Date(from - (to - from)), pt: from };
  }
  function tone(s) { return s == null ? "na" : s >= 80 ? "good" : s >= 50 ? "mid" : "bad"; }
  function fmt(k, def) { if (k.value == null) return "—"; var u = def.unit || ""; return num(k.value, u === "× متوسط الصفحة" ? 2 : 1) + (u === "%" ? "%" : u === "× متوسط الصفحة" ? "×" : " " + u); }
  function render(container) { state.container = container; state.preset = state.preset || "30d"; draw(); load(); }
  function load() {
    var seq = ++state.seq, r = range(); state.loading = true; state.error = "";
    Promise.all([window.SSMPDDb.myStaffKpis(r.from.toISOString(), r.to.toISOString()), window.SSMPDDb.myStaffKpis(r.pf.toISOString(), r.pt.toISOString())]).then(function (res) {
      if (seq !== state.seq) return; state.data = res[0]; state.prev = res[1]; state.loading = false; draw();
    }).catch(function (e) { if (seq !== state.seq) return; state.loading = false; state.error = /42883|PGRST202|does not exist/i.test(String(e && (e.code || e.message))) ? "الميزة دي محتاجة تفعيل في قاعدة البيانات." : (e && e.message) || "تعذر تحميل البيانات"; draw(); });
  }
  function draw() {
    var c = state.container; if (!c) return;
    var d = state.data, head = '<header class="sk-hero"><div><p>صفحتي الشخصية</p><h1>أدائي</h1><span>مقارنة بنفسي في الفترة اللي قبلها — مش بزملائي</span></div></header>';
    var body;
    if (state.loading && !d) body = '<div class="sk-loading">جاري التحميل…</div>';
    else if (state.error) body = '<div class="sk-err">' + esc(state.error) + '</div>';
    else if (!d || d.enabled === false) body = '<section class="sk-box"><h2>صفحة أدائك لسه ماتفعلتش</h2><p class="sk-note">الإدارة هتفعّلها قريبًا. لما تتفعّل هتشوف هنا أرقامك ومستهدفاتك وتقدمك مقارنة بالفترة اللي فاتت.</p></section>';
    else {
      var defs = {}; (d.defs || []).forEach(function (x) { defs[x.kpi] = x; });
      var prev = {}; ((state.prev && state.prev.rows) || []).forEach(function (x) { if (x.sample > 0) prev[x.kpi] = x.value; });
      var rows = (d.rows || []).slice().sort(function (a, b) { return ((defs[a.kpi] || {}).sort_order || 0) - ((defs[b.kpi] || {}).sort_order || 0); });
      var sw = 0, w = 0, n = 0; rows.forEach(function (k) { if (k.score != null) { sw += k.score * k.weight; w += Number(k.weight); n++; } });
      var score = n >= 2 && w > 0 ? Math.round(sw / w) : null;
      var cards = rows.filter(function (k) { return k.sample > 0 || k.value != null; }).map(function (k) {
        var df = defs[k.kpi] || {}, p = prev[k.kpi], ch = "";
        if (k.value != null && p != null && !(p === 0 && k.value === 0)) { var pc = p === 0 ? 100 : (k.value - p) / Math.abs(p) * 100; if (Math.abs(pc) >= 1) { var better = df.direction === "lower" ? pc < 0 : pc > 0; ch = '<em class="sk-d ' + (better ? "up" : "down") + '">' + (pc > 0 ? "▲" : "▼") + " " + num(Math.abs(pc), 0) + "% عن الفترة اللي فاتت</em>"; } }
        var small = k.sample < (df.min_sample || 0);
        return '<article class="sk-card sk-static"><div class="sk-kl"><span title="' + esc(df.hint_ar || "") + '">' + esc(df.label_ar || k.kpi) + '</span><b>' + esc(fmt(k, df)) + '</b></div>' + ch +
          '<div class="sk-bar sk-' + tone(k.score) + '"><i style="width:' + (k.score == null ? 0 : Math.max(3, k.score)) + '%"></i></div><small>' + (small ? "عينة صغيرة (" + k.sample + ")" : "المستهدف " + num(k.target, 1) + " · العينة " + k.sample) + '</small></article>';
      }).join("");
      var sm = d.summary && d.summary.month ? d.summary : null;
      body = (score != null ? '<section class="sk-summary"><div class="sk-tile"><i>📊</i><b>' + score + '</b><span>مستوى الأداء العام</span><small>محسوب من ' + n + ' مؤشرات</small></div></section>' : "") +
        '<section class="sk-grid">' + (cards || '<p class="sk-none">لا توجد بيانات مسجّلة باسمك في الفترة دي. سجّل شغلك في الداشبورد أولًا بأول عشان يظهر هنا.</p>') + '</section>' +
        (sm ? '<section class="sk-box"><h2>ملخص الشهر اللي فات</h2><p class="sk-msum-p">💪 ' + esc(sm.strength) + '</p><p class="sk-msum-p">🔧 ' + esc(sm.improve) + '</p><p class="sk-msum-p">➡️ ' + esc(sm.action) + '</p></section>' : "");
    }
    c.innerHTML = '<section class="sk" dir="rtl">' + head + '<div data-my-task-performance></div><div class="sk-tools"><div class="sk-presets">' + PRESETS.map(function (p) { return '<button type="button" class="sk-preset' + (state.preset === p[0] ? " on" : "") + '" data-p="' + p[0] + '">' + p[1] + '</button>'; }).join("") + '</div></div>' + body + '<p class="sk-foot">الأرقام بتتحسب من اللي بتسجّله في الداشبورد. الهدف إنك تشوف تقدّمك أنت، مش مقارنة مع حد.</p></section>';
    if(window.SSMPDEmployeePerformance)window.SSMPDEmployeePerformance.mount(c.querySelector("[data-my-task-performance]"),window.SSMPDAuth.currentAdmin.id);
    c.querySelectorAll("[data-p]").forEach(function (b) { b.onclick = function () { state.preset = b.getAttribute("data-p"); load(); draw(); }; });
  }
  window.SSMPDRenderMyKpi = { render: render };
})();
