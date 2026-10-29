/* SSMPD — تاب "أداء البوستات": أرقام فيسبوك/انستجرام لكل بوست اتنشر من الداشبورد + أفضل أوقات وأنواع */
(function () {
  "use strict";

  var state = { brand: "", mode: "all", count: 50, from: "", to: "" };
  var requests = new WeakMap();
  var dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var FORMATS = { image_post: "بوست صورة", carousel: "كاروسيل", video: "فيديو / ريل", link_post: "رابط" };
  var DAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
  var MIN_RELIABLE = 30; // أقل عدد بوستات لنتيجة نعتمد عليها

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function n(v) { return v == null ? "—" : Number(v).toLocaleString("en-US"); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%"; }
  function num(v) { return Number(v) || 0; }
  function db() { return window.SSMPDDb.client; }
  function dateKey(value) {
    var date = new Date(value);
    if (!value || !isFinite(date.getTime())) return "";
    var parts = dateFormat.formatToParts(date), get = function (type) { return parts.find(function (p) { return p.type === type; }).value; };
    return get("year") + "-" + get("month") + "-" + get("day");
  }
  function dates() {
    var today = dateKey(new Date()), first = new Date(today + "T12:00:00Z");
    first.setUTCDate(first.getUTCDate() - 29);
    return { from: first.toISOString().slice(0, 10), to: today };
  }

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
    var ticket = {}, loading = container.firstChild;
    requests.set(container, ticket);
    function active() { return requests.get(container) === ticket && loading.parentNode === container; }
    // Read all available snapshots, including those beyond the API's first page.
    // The content relation uses the same existing RLS as the previous separate read.
    async function load() {
      var all = [], offset = 0, size = 500, total = null;
      do {
        var q = db().from("post_insights").select("job_id,brand,content_id,published_at,fb_reach,fb_clicks,fb_reactions,fb_comments,fb_shares,ig_reach,ig_likes,ig_comments,ig_saves,ig_shares,item:content_items(title,content_format)", offset === 0 ? { count: "exact" } : {});
        var result = await q.order("published_at", { ascending: false, nullsFirst: false }).order("job_id", { ascending: false }).range(offset, offset + size - 1);
        if (!active()) return null;
        if (result.error) throw result.error;
        if (offset === 0 && typeof result.count === "number") total = result.count;
        var part = result.data || [];
        if (!part.length) {
          if (total !== null && offset < total) throw Error("البيانات اتغيرت أثناء التحميل. افتح التاب مرة أخرى.");
          break;
        }
        all = all.concat(part); offset += part.length;
        if (total === null && part.length < size) break;
      } while (total === null || offset < total);
      return all;
    }
    return load().then(function (all) {
      if (!active() || !all) return;
      draw(container, all.map(function (row) { row.item = row.item || {}; row.m = metrics(row); row.date = dateKey(row.published_at); return row; }));
    }).catch(function (e) {
      if (!active()) return;
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
    var available = rows.length;
    if (state.mode === "count") rows = rows.slice(0, state.count);
    if (state.mode === "dates") rows = rows.filter(function (r) { return r.date && r.date >= state.from && r.date <= state.to; });
    var total = rows.reduce(function (a, r) { a.reach += r.m.reach; a.eng += r.m.eng; return a; }, { reach: 0, eng: 0 });
    var reliable = rows.length >= MIN_RELIABLE;
    var byFormat = groupAvg(rows, function (r) { return r.item.content_format || null; });
    var bySlot = groupAvg(rows, function (r) { return r.published_at ? slotOf(cairo(r.published_at).hour) : null; });
    var byDay = groupAvg(rows, function (r) { return r.published_at ? cairo(r.published_at).day : null; });

    var html = '<div class="cm-wrap pf-wrap" dir="rtl"><div class="cm-head"><div><h2>أداء البوستات</h2>' +
      '<p class="muted">إحصائيات البوستات المنشورة من الداشبورد حسب بيانات الأداء المتاحة.</p></div></div>';
    var defaults = dates();
    html += '<form class="pf-filters" aria-label="فلترة أداء البوستات"><label for="pf-brand">الصفحة<select id="pf-brand" name="brand" aria-label="الصفحة"><option value="">كل الصفحات</option><option value="sono"' + (state.brand === "sono" ? " selected" : "") + '>سونو</option><option value="dr_dina"' + (state.brand === "dr_dina" ? " selected" : "") + '>د. دينا</option></select></label>' +
      '<label for="pf-mode">نطاق العرض<select id="pf-mode" name="mode" aria-label="نطاق العرض"><option value="all"' + (state.mode === "all" ? " selected" : "") + '>كل البوستات</option><option value="count"' + (state.mode === "count" ? " selected" : "") + '>آخر عدد بوستات</option><option value="dates"' + (state.mode === "dates" ? " selected" : "") + '>فترة من تاريخ لتاريخ</option></select></label>' +
      '<label for="pf-count" data-pf-count>عدد البوستات<input id="pf-count" name="count" type="number" min="1" step="1" value="' + state.count + '"></label>' +
      '<label for="pf-from" data-pf-date>من تاريخ<input id="pf-from" name="from" type="date" value="' + esc(state.from || defaults.from) + '"></label>' +
      '<label for="pf-to" data-pf-date>إلى تاريخ<input id="pf-to" name="to" type="date" value="' + esc(state.to || defaults.to) + '"></label>' +
      '<div class="pf-filter-actions"><button class="btn" type="submit">عرض النتائج</button><button class="btn ghost" type="button" data-pf-reset>إلغاء الفلترة</button></div></form>';
    var scope = state.mode === "count" ? 'آخر ' + n(state.count) + ' بوست من الصفحة المختارة' : state.mode === "dates" ? 'من ' + state.from + ' إلى ' + state.to + ' شامل اليومين بتوقيت القاهرة' : 'كل البوستات المتاحة للصفحة المختارة';
    html += '<p class="pf-scope" role="status">' + esc(scope) + ' — المعروض ' + n(rows.length) + ' بوست' + (state.mode === "count" && rows.length < state.count ? '، المتاح ' + n(available) + ' فقط' : '') + '.</p>';

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
      (rows.length ? rows.map(function (r) {
        return "<tr><td>" + esc(r.item.title || "—") + "</td><td>" + (BRANDS[r.brand] || r.brand) + "</td><td>" + (FORMATS[r.item.content_format] || "—") + "</td>" +
          "<td>" + (r.published_at ? new Date(r.published_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—") + "</td>" +
          "<td>" + n(r.fb_reach) + "</td><td>" + n(num(r.fb_reactions) + num(r.fb_comments) + num(r.fb_shares)) + "</td><td>" + n(r.ig_reach) + "</td>" +
          "<td>" + n(r.ig_saves) + "</td><td>" + n(r.m.shares) + "</td><td>" + pct(r.m.rate) + "</td></tr>";
      }).join("") : '<tr><td colspan="10">لا توجد بوستات ضمن الاختيار الحالي.</td></tr>') + "</tbody></table></div></div>";
    container.innerHTML = html;
    if (window.SSMPDOpsPanels) window.SSMPDOpsPanels.learningPanel(container);
    var form = container.querySelector(".pf-filters"), fields = form.elements;
    function sync() {
      var count = fields.mode.value === "count", period = fields.mode.value === "dates";
      form.querySelector("[data-pf-count]").hidden = !count;
      form.querySelectorAll("[data-pf-date]").forEach(function (label) { label.hidden = !period; });
      fields.count.disabled = !count; fields.count.required = count;
      fields.from.disabled = fields.to.disabled = !period; fields.from.required = fields.to.required = period;
      fields.to.setCustomValidity(period && fields.from.value && fields.to.value && fields.from.value > fields.to.value ? "تاريخ النهاية لازم يكون بعد تاريخ البداية أو نفس اليوم." : "");
      fields.count.setCustomValidity(count && (!Number.isSafeInteger(Number(fields.count.value)) || Number(fields.count.value) < 1) ? "اكتب عدد بوستات أكبر من صفر بدون كسور." : "");
    }
    fields.mode.onchange = sync; fields.from.oninput = fields.to.oninput = fields.count.oninput = sync;
    form.onsubmit = function (event) {
      event.preventDefault(); sync(); if (!form.reportValidity()) return;
      state.brand = fields.brand.value; state.mode = fields.mode.value;
      if (state.mode === "count") state.count = Number(fields.count.value);
      state.from = fields.from.value; state.to = fields.to.value;
      draw(container, all); container.querySelector(".pf-filters button[type=submit]").focus({ preventScroll: true });
    };
    form.querySelector("[data-pf-reset]").onclick = function () { state = { brand: "", mode: "all", count: 50, from: "", to: "" }; draw(container, all); container.querySelector("[data-pf-reset]").focus({ preventScroll: true }); };
    sync();
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
