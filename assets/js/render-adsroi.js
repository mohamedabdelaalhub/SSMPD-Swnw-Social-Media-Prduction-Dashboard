/* SSMPD — «العائد على الصرف» داخل شاشة إعلانات Meta.
   قراءة فقط: دالة ads_roi_by_campaign (الصرف ← الليدز ← الحجوزات ← الفواتير) + حالة الحدود بالصرف الفعلي.
   لو الدالة لسه مش متطبقة على السيرفر بتظهر رسالة واضحة ومبتكسرش باقي الشاشة. */
(function () {
  "use strict";

  // أهداف تكلفة الحجز: بتتقرا من report_campaign_targets() (جدول الأهداف المعتمدة بتاع شات التقارير). القيم دي احتياطي
  // لحد ما الدالة تتطبق على السيرفر (من الخطة الإعلانية المعتمدة 2026-11-13).
  var DEFAULT_TARGETS = { "PHY1": 120, "LZF1-F": 45, "DEN1": 105 };
  var CODE_RE = /(?:^|[\s|])([A-Z]{2,4}\d(?:-[A-Z])?)(?=$|[\s|])/;

  var state = { period: "7", brand: "", rows: [], limits: [], targets: DEFAULT_TARGETS, error: "" };

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(n) { return n == null || isNaN(n) ? 0 : Number(n); }
  function fmtN(n) { return num(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function fmtEgp(n) { return n == null || isNaN(n) ? "—" : fmtN(n) + " ج"; }
  function ltr(t) { return '<bdi dir="ltr">' + esc(t) + "</bdi>"; }

  function cairoToday() { return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }); }
  function addDays(iso, d) { var t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
  function range(period) {
    var today = cairoToday();
    if (period === "7") return { from: addDays(today, -6), to: today };
    if (period === "28") return { from: addDays(today, -27), to: today };
    if (period === "month") return { from: today.slice(0, 8) + "01", to: today };
    return { from: null, to: null };
  }

  function codeOf(name) { var m = CODE_RE.exec(String(name || "")); return m ? m[1] : ""; }
  function targetOf(name) { var c = codeOf(name); return c && state.targets[c] ? state.targets[c] : null; }

  function visibleRows() {
    return state.rows.filter(function (r) { return !state.brand || r.brand === state.brand; });
  }

  function totals(rows) {
    var t = { spend: 0, leads: 0, booked: 0, attended: 0, revenue: 0, msg: 0, form: 0 };
    rows.forEach(function (r) {
      t.spend += num(r.spend); t.leads += num(r.attributed_leads); t.booked += num(r.booked_leads);
      t.attended += num(r.attended_leads); t.revenue += num(r.revenue); t.msg += num(r.msg_started); t.form += num(r.form_leads);
    });
    t.cpb = t.booked > 0 ? t.spend / t.booked : null;
    t.cpa = t.attended > 0 ? t.spend / t.attended : null;
    t.roas = t.spend > 0 ? t.revenue / t.spend : null;
    return t;
  }

  function pill(group, value, label, on) {
    return '<button type="button" class="roi-pill' + (on ? " on" : "") + '" data-roi-' + group + '="' + value + '">' + esc(label) + "</button>";
  }

  function kpi(label, value, note, hero) {
    return '<div class="roi-kpi' + (hero ? " hero" : "") + '"><span class="l">' + esc(label) + '</span><span class="v">' + value + '</span><span class="n">' + note + "</span></div>";
  }

  function limitsHtml() {
    var rows = state.limits.filter(function (l) { return !state.brand || l.brand === state.brand; });
    if (!rows.length) return '<p class="roi-muted">مفيش حدود صرف مفعّلة.</p>';
    return rows.map(function (l) {
      var pct = Math.max(0, num(l.pct)), spent = num(l.spent), cls, chip;
      if (spent === 0) { cls = "mut"; chip = "مفيش صرف"; }
      else if (pct >= 100) { cls = "bad"; chip = "وصل الحد"; }
      else if (pct >= 80) { cls = "warn"; chip = "قرّب يوصل"; }
      else { cls = "ok"; chip = "آمن"; }
      return '<div class="roi-meter"><div class="t"><span>' + esc(l.label) + "</span><span><b>" + fmtN(spent) + " من " + fmtN(l.amount) + ' ج</b> <span class="roi-chip ' + cls + '">' + chip + '</span></span></div>' +
        '<div class="roi-track"><div class="roi-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div></div></div>';
    }).join("");
  }

  function summaryHtml(rows) {
    var items = rows.filter(function (r) { return targetOf(r.campaign_name) && r.cost_per_booking != null; });
    if (!items.length) return '<p class="roi-muted">لسه مفيش حجوزات منسوبة لحملات ليها هدف — الملخص هيظهر أول ما يبقى فيه حجز.</p>';
    return items.map(function (r) {
      var tg = targetOf(r.campaign_name), c = num(r.cost_per_booking), ok = c <= tg, diff = Math.abs(Math.round(tg - c));
      return '<div class="roi-meter"><div class="t"><span>' + esc(codeOf(r.campaign_name)) + '</span><span class="roi-chip ' + (ok ? "ok" : "bad") + '">' + (ok ? "داخل الهدف" : "فوق الهدف") + "</span></div>" +
        '<div class="roi-muted">تكلفة الحجز ' + fmtN(c) + " ج والهدف " + fmtN(tg) + " ج — " + (ok ? "وفّرت " : "زيادة ") + diff + " ج لكل حجز</div></div>";
    }).join("");
  }

  function tableHtml(rows) {
    var body = rows.map(function (r) {
      var name = r.campaign_name || ("حملة غير معروفة (" + r.campaign_id + ")"), code = codeOf(r.campaign_name), tg = targetOf(r.campaign_name);
      var cell = "—";
      if (r.cost_per_booking != null) {
        var c = num(r.cost_per_booking);
        if (tg) {
          var ok = c <= tg, w = Math.min(100, Math.round(100 * c / (tg * 2)));
          cell = '<div class="roi-tc"><div class="top"><b>' + fmtN(c) + ' ج</b><span class="roi-chip ' + (ok ? "ok" : "bad") + '">الهدف ' + tg + '</span></div>' +
            '<div class="roi-scale"><i class="' + (ok ? "ok" : "bad") + '" style="width:' + w + '%"></i><u></u></div></div>';
        } else cell = "<b>" + fmtN(c) + " ج</b>";
      }
      return "<tr><td><div class=\"name\">" + esc(name) + "</div>" + (code ? '<div class="code">' + esc(code) + "</div>" : "") + "</td>" +
        "<td>" + fmtEgp(r.spend) + "</td><td>" + fmtN(r.attributed_leads) + "</td>" +
        "<td>" + fmtN(r.booked_leads) + '<div class="code">حضر ' + fmtN(r.attended_leads) + "</div></td>" +
        "<td>" + cell + "</td><td>" + (r.roas == null ? "—" : "<b>" + ltr(num(r.roas).toFixed(1) + "×") + "</b>") + "</td></tr>";
    }).join("");
    return '<div class="roi-tbl"><table><thead><tr><th>الحملة</th><th>الصرف</th><th>ليدز</th><th>حجوزات</th><th>تكلفة الحجز مقابل الهدف</th><th>العائد</th></tr></thead><tbody>' + body + "</tbody></table></div>";
  }

  function html() {
    var head = '<h3>العائد على الصرف</h3><p class="roi-sub">كل جنيه اتصرف على الإعلانات رجع كام ليد وكام حجز وكام إيراد</p>' +
      '<div class="roi-bar"><div class="roi-pills">' + pill("period", "7", "آخر 7 أيام", state.period === "7") + pill("period", "28", "آخر 28 يوم", state.period === "28") +
      pill("period", "month", "الشهر الحالي", state.period === "month") + pill("period", "all", "من البداية", state.period === "all") + "</div>" +
      '<div class="roi-pills">' + pill("brand", "", "الكل", state.brand === "") + pill("brand", "sono", "سونو", state.brand === "sono") + pill("brand", "dr_dina", "د. دينا", state.brand === "dr_dina") + "</div></div>";
    if (state.error) return head + '<div class="roi-card"><p class="roi-muted">' + esc(state.error) + "</p></div>";
    var rows = visibleRows(), t = totals(rows), empty = !rows.length || (t.spend === 0 && t.leads === 0);
    var out = head;
    if (empty) {
      out += '<div class="roi-card roi-empty"><h4>لسه مفيش صرف على الإعلانات</h4><p>أول ما تفعّل حملة وتبدأ تصرف، الأرقام هتظهر هنا لوحدها (المزامنة كل يوم الساعة 6 الصبح).</p></div>';
      out += '<div class="roi-card"><h4>حدود الصرف</h4>' + limitsHtml() + "</div>";
      return out;
    }
    out += '<div class="roi-kpis">' +
      kpi("الصرف", fmtN(t.spend) + "<small>ج</small>", "&nbsp;") +
      kpi("الليدز", fmtN(t.leads), fmtN(t.msg) + " ماسنجر · " + fmtN(t.form) + " فورم") +
      kpi("الحجوزات", fmtN(t.booked), (t.leads ? Math.round(100 * t.booked / t.leads) + "% من الليدز" : "—") + " · حضر " + fmtN(t.attended)) +
      kpi("تكلفة الحجز", t.cpb == null ? "—" : fmtN(t.cpb) + "<small>ج</small>", t.cpa == null ? "تكلفة الحضور —" : "تكلفة الحضور " + fmtN(t.cpa) + " ج", true) +
      kpi("العائد على الصرف", t.roas == null ? "—" : ltr(t.roas.toFixed(1)) + "<small>×</small>", "إيراد " + fmtN(t.revenue) + " ج") + "</div>";
    out += '<div class="roi-row2"><div class="roi-card"><h4>حدود الصرف</h4>' + limitsHtml() + '</div><div class="roi-card"><h4>ملخص الحالة</h4>' + summaryHtml(rows) + "</div></div>";
    out += '<div class="roi-card"><h4>الحملات</h4>' + tableHtml(rows) + "</div>";
    return out;
  }

  function wire(el) {
    el.querySelectorAll("[data-roi-period]").forEach(function (b) { b.onclick = function () { state.period = b.getAttribute("data-roi-period"); load(el); }; });
    el.querySelectorAll("[data-roi-brand]").forEach(function (b) { b.onclick = function () { state.brand = b.getAttribute("data-roi-brand"); paint(el); }; });
  }
  function paint(el) { el.innerHTML = html(); wire(el); }

  function load(el) {
    el.innerHTML = '<div class="loading">بيحمّل العائد على الصرف…</div>';
    var r = range(state.period), db = window.SSMPDDb;
    Promise.all([
      db.adsRoiByCampaign(r.from, r.to),
      db.adsActualLimitsStatus().catch(function () { return []; }),
      (db.adsRoiTargets ? db.adsRoiTargets() : Promise.resolve(null)).catch(function () { return null; })
    ]).then(function (res) {
      state.rows = res[0] || []; state.limits = res[1] || []; state.error = "";
      var t = res[2];
      state.targets = Object.assign({}, DEFAULT_TARGETS);
      if (t && t.length) { state.targets = {}; t.forEach(function (x) { if (x && x.code && Number(x.target) > 0) state.targets[x.code] = Number(x.target); }); }
      paint(el);
    }).catch(function (e) {
      var m = String((e && e.message) || e || "");
      state.rows = []; state.limits = [];
      state.error = /ads_roi_by_campaign|schema cache|does not exist|PGRST202|404/i.test(m)
        ? "حساب العائد على الصرف لسه مش مفعّل على السيرفر. هيشتغل بعد تطبيق التحديث بموافقة مدير المركز."
        : "تعذّر تحميل العائد على الصرف: " + m;
      paint(el);
    });
  }

  function mount(el) { if (el && window.SSMPDDb && window.SSMPDDb.adsRoiByCampaign) load(el); }

  window.SSMPDAdsRoi = { mount: mount, _html: html, _state: state, _totals: totals, _codeOf: codeOf, _targetOf: targetOf };
})();
