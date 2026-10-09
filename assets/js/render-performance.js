/* SSMPD — تاب "أداء البوستات": أرقام فيسبوك/انستجرام لكل بوست اتنشر من الداشبورد + أفضل أوقات وأنواع */
(function () {
  "use strict";

  var state = { brand: "" };
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var FORMATS = { image_post: "بوست صورة", carousel: "كاروسيل", video: "فيديو / ريل", link_post: "رابط" };
  var DAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
  var MIN_RELIABLE = 30; // أقل عدد بوستات لنتيجة نعتمد عليها

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(v) { return v == null ? "—" : Number(v).toLocaleString("en-US"); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%"; }
  function num(v) { return Number(v) || 0; }
  function db() { return window.SSMPDDb.client; }

  // وقت القاهرة (يوم + ساعة) من غير مكتبات
  function cairo(d) {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date(d));
    var wd = parts.find(function (p) { return p.type === "weekday"; }).value;
    var hr = Number(parts.find(function (p) { return p.type === "hour"; }).value) % 24;
    return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour: hr };
  }
  function slotLabel(h) {
    if (h < 6) return "بعد نص الليل (١٢–٦ص)";
    if (h < 12) return "الصبح (٦–١٢ظ)";
    if (h < 17) return "الضهر (١٢–٥م)";
    if (h < 21) return "بالليل بدري (٥–٩م)";
    return "آخر الليل (٩م–١٢)";
  }
  function slotOf(h) { return h < 6 ? 0 : h < 12 ? 1 : h < 17 ? 2 : h < 21 ? 3 : 4; }

  function metrics(r) {
    var reach = num(r.fb_reach) + num(r.ig_reach);
    var eng = num(r.fb_reactions) + num(r.fb_comments) + num(r.fb_shares) + num(r.fb_clicks) +
      num(r.ig_likes) + num(r.ig_comments) + num(r.ig_saves) + num(r.ig_shares);
    return { reach: reach, eng: eng, rate: reach ? eng / reach : null, saves: num(r.ig_saves), shares: num(r.fb_shares) + num(r.ig_shares) };
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    Promise.all([
      db().from("post_insights").select("*").order("published_at", { ascending: false }),
      db().from("content_items").select("id,title,content_format,brand")
    ]).then(function (r) {
      if (r[0].error) throw r[0].error;
      var items = {}; (r[1].data || []).forEach(function (c) { items[c.id] = c; });
      draw(container, (r[0].data || []).map(function (row) { row.item = items[row.content_id] || {}; row.m = metrics(row); return row; }));
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">' + (/post_insights|permission|does not exist/i.test(e.message || "") ? "تاب الأداء لسه محتاج تفعيل في قاعدة البيانات." : "خطأ: " + esc(e.message)) + "</div>";
    });
  }

  function groupAvg(rows, keyFn) {
    var g = {};
    rows.forEach(function (r) {
      var k = keyFn(r); if (k == null) return;
      g[k] = g[k] || { n: 0, reach: 0, eng: 0 };
      g[k].n++; g[k].reach += r.m.reach; g[k].eng += r.m.eng;
    });
    return Object.keys(g).map(function (k) {
      var x = g[k]; return { key: k, n: x.n, reach: x.reach / x.n, eng: x.eng / x.n, rate: x.reach ? x.eng / x.reach : null };
    }).sort(function (a, b) { return b.reach - a.reach; });
  }

  function draw(container, all) {
    var rows = all.filter(function (r) { return !state.brand || r.brand === state.brand; });
    var total = rows.reduce(function (a, r) { a.reach += r.m.reach; a.eng += r.m.eng; return a; }, { reach: 0, eng: 0 });
    var reliable = rows.length >= MIN_RELIABLE;
    var byFormat = groupAvg(rows, function (r) { return r.item.content_format || null; });
    var bySlot = groupAvg(rows, function (r) { return r.published_at ? slotOf(cairo(r.published_at).hour) : null; });
    var byDay = groupAvg(rows, function (r) { return r.published_at ? cairo(r.published_at).day : null; });

    var html = '<div class="cm-wrap pf-wrap" dir="rtl"><div class="cm-head"><div><h2>أداء البوستات</h2>' +
      '<p class="muted">أرقام فيسبوك وانستجرام لكل بوست اتنشر من الداشبورد (آخر ٦٠ يوم) — بتتحدث كل ساعة.</p></div>' +
      '<select id="pf-brand"><option value="">كل الصفحات</option><option value="sono"' + (state.brand === "sono" ? " selected" : "") + '>سونو</option><option value="dr_dina"' + (state.brand === "dr_dina" ? " selected" : "") + ">د. دينا</option></select></div>";

    html += '<div class="pf-kpis">' +
      kpi("عدد البوستات", n(rows.length)) +
      kpi("متوسط الوصول للبوست", n(rows.length ? Math.round(total.reach / rows.length) : null)) +
      kpi("متوسط التفاعل للبوست", n(rows.length ? Math.round(total.eng / rows.length) : null)) +
      kpi("نسبة التفاعل", pct(total.reach ? total.eng / total.reach : null)) + "</div>";

    if (!reliable) html += '<div class="pf-note">النتايج دي <b>أولية</b> — مبنية على ' + rows.length + " بوست بس. بعد " + MIN_RELIABLE + " بوست على الأقل هتبقى المقارنات دي يُعتمد عليها في تحديد المواعيد والأنواع.</div>";

    html += '<div class="pf-grid">' +
      tableCard("أنهي نوع محتوى بيوصل أكتر؟", byFormat, function (k) { return FORMATS[k] || k; }) +
      tableCard("أنهي وقت في اليوم أحسن؟ (توقيت القاهرة)", bySlot, function (k) { return slotLabel([3, 9, 14, 19, 22][k]); }) +
      tableCard("أنهي يوم في الأسبوع أحسن؟", byDay, function (k) { return DAYS[k]; }) + "</div>";

    html += '<h3 class="pf-h">كل البوستات</h3><div class="pf-table-wrap"><table class="pf-table"><thead><tr>' +
      "<th>البوست</th><th>الصفحة</th><th>النوع</th><th>اتنشر</th><th>وصول فيسبوك</th><th>تفاعل فيسبوك</th><th>وصول انستجرام</th><th>حفظ</th><th>مشاركة</th><th>نسبة التفاعل</th></tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><td>" + esc(r.item.title || "—") + "</td><td>" + (BRANDS[r.brand] || r.brand) + "</td><td>" + (FORMATS[r.item.content_format] || "—") + "</td>" +
          "<td>" + (r.published_at ? new Date(r.published_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—") + "</td>" +
          "<td>" + n(r.fb_reach) + "</td><td>" + n(num(r.fb_reactions) + num(r.fb_comments) + num(r.fb_shares)) + "</td><td>" + n(r.ig_reach) + "</td>" +
          "<td>" + n(r.ig_saves) + "</td><td>" + n(r.m.shares) + "</td><td>" + pct(r.m.rate) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
    container.innerHTML = html;
    var sel = container.querySelector("#pf-brand"); if (sel) sel.onchange = function () { state.brand = sel.value; draw(container, all); };
  }

  function kpi(label, value) { return '<div class="kpi-card"><div class="label">' + label + '</div><div class="value small">' + value + "</div></div>"; }
  function tableCard(title, groups, labelFn) {
    if (!groups.length) return '<div class="cm-card"><h4>' + title + '</h4><p class="muted">لسه مفيش بيانات كفاية.</p></div>';
    return '<div class="cm-card"><h4>' + title + "</h4><table class=\"pf-mini\"><thead><tr><th></th><th>متوسط الوصول</th><th>نسبة التفاعل</th><th>بوستات</th></tr></thead><tbody>" +
      groups.map(function (g, i) {
        return "<tr" + (i === 0 && groups.length > 1 ? ' class="best"' : "") + "><td>" + esc(labelFn(g.key)) + "</td><td>" + n(Math.round(g.reach)) + "</td><td>" + pct(g.rate) + "</td><td>" + g.n + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  window.SSMPDRenderPerformance = { render: render };
})();
