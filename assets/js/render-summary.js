/* SSMPD — شاشة الملخص العام */
(function () {
  "use strict";

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  function kpiCard(label, value, extra) {
    return '<div class="kpi-card"><div class="label">' + label + '</div>' +
      '<div class="value' + (extra && extra.small ? ' small' : '') + '">' + value + '</div>' +
      (extra && extra.delta ? '<div class="delta ' + extra.deltaClass + '">' + extra.delta + '</div>' : '') +
      '</div>';
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل المؤشرات…</div>';

    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listWeeklyMetrics(2)
    ]).then(function (res) {
      var items = res[0], metrics = res[1];

      var total = items.length;
      var planned = items.filter(function (i) { return i.stage === "idea_selection" || i.stage === "initial_approval"; }).length;
      var inDesign = items.filter(function (i) { return ["in_design", "final_approval", "needs_revision"].indexOf(i.stage) !== -1; }).length;
      var readyOrPublished = items.filter(function (i) { return i.stage === "ready_to_publish"; }).length;
      var published = items.filter(function (i) { return i.stage === "published"; }).length;
      var completion = pct(published, total);

      var current = metrics[0], prev = metrics[1];

      function deltaHtml(cur, prv) {
        if (cur == null || prv == null) return { delta: "", deltaClass: "" };
        var diff = cur - prv;
        if (diff === 0) return { delta: "بدون تغيير", deltaClass: "" };
        return { delta: (diff > 0 ? "▲ " : "▼ ") + Math.abs(diff), deltaClass: diff > 0 ? "up" : "down" };
      }

      var html = '<h2 style="margin-bottom:16px;">الملخص العام</h2>';

      html += '<div class="section"><h3>إنتاج المحتوى</h3><div class="kpi-grid">';
      html += kpiCard("إجمالي المحتوى", total);
      html += kpiCard("مخطط له", planned);
      html += kpiCard("قيد التصميم", inDesign);
      html += kpiCard("جاهز للنشر", readyOrPublished);
      html += kpiCard("تم النشر", published);
      html += kpiCard("نسبة الإنجاز", completion + "%");
      html += '</div></div>';

      html += '<div class="section"><h3>مؤشرات السوشيال ميديا (آخر تحديث أسبوعي)</h3>';
      if (!current) {
        html += '<div class="empty-state">لسه مفيش بيانات مُدخَلة — مسؤول الاعتماد يقدر يضيفها من هنا لاحقاً.</div>';
      } else {
        html += '<div class="kpi-grid">';
        var dR = deltaHtml(current.reach, prev && prev.reach);
        var dE = deltaHtml(current.engagement_rate, prev && prev.engagement_rate);
        var dF = deltaHtml(current.new_followers, prev && prev.new_followers);
        html += kpiCard("الوصول (Reach)", current.reach || 0, dR);
        html += kpiCard("نسبة التفاعل", (current.engagement_rate || 0) + "%", dE);
        html += kpiCard("متابعين جدد", current.new_followers || 0, dF);
        html += '</div><p style="font-size:11px;color:var(--c-muted);margin-top:8px;">آخر أسبوع مُدخَل: ' + current.week_start + '</p>';
      }
      var role = window.SSMPDAuth.currentAdmin.role;
      if (role === "approver" || role === "super_admin") {
        html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="add-week-metrics-btn">+ إدخال بيانات أسبوع جديد</button></div>';
      }
      html += '</div>';

      container.innerHTML = html;
      var btn = document.getElementById("add-week-metrics-btn");
      if (btn) btn.onclick = openMetricsModal;
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">تعذّر تحميل الملخص: ' + e.message + '</div>';
    });
  }

  // ---------- استيراد CSV من Meta Business Suite / Meta Ads / Google Ads ----------
  // أعمدة الملفات دي بتختلف بحسب المصدر، فبنعمل مطابقة بالكلمات المفتاحية (عربي/إنجليزي)
  // بدل الاعتماد على شكل ملف واحد بعينه.
  var REACH_KEYS = ["reach", "الوصول", "impressions", "ظهور"];
  var ENGAGE_KEYS = ["engagement rate", "engagement", "نسبة التفاعل", "تفاعل"];
  var FOLLOWERS_KEYS = ["new followers", "followers", "متابعين جدد", "متابعين"];

  function splitCsvLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  function toNumber(s) {
    if (s == null) return null;
    var n = Number(String(s).replace(/[,%\s]/g, ""));
    return isNaN(n) ? null : n;
  }

  function matchCol(header, keys) {
    var h = String(header || "").toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      if (h.indexOf(keys[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  // بيرجع { reach, engagement, followers } — أي قيمة معرفناش نلاقيها بترجع null وتفضل الخانة يدوية
  function parseMetricsCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (lines.length < 2) throw new Error("الملف فاضي أو مش بصيغة CSV مفهومة");
    var headers = splitCsvLine(lines[0]);
    var reachIdx = -1, engageIdx = -1, followersIdx = -1;
    headers.forEach(function (h, idx) {
      if (reachIdx === -1 && matchCol(h, REACH_KEYS)) reachIdx = idx;
      if (engageIdx === -1 && matchCol(h, ENGAGE_KEYS)) engageIdx = idx;
      if (followersIdx === -1 && matchCol(h, FOLLOWERS_KEYS)) followersIdx = idx;
    });
    var dataLines = lines.slice(1).map(splitCsvLine);
    var result = { reach: null, engagement: null, followers: null };

    if (reachIdx !== -1) {
      var sumReach = 0, gotReach = false;
      dataLines.forEach(function (r) { var n = toNumber(r[reachIdx]); if (n != null) { sumReach += n; gotReach = true; } });
      if (gotReach) result.reach = sumReach;
    }
    if (followersIdx !== -1) {
      var sumF = 0, gotF = false;
      dataLines.forEach(function (r) { var n = toNumber(r[followersIdx]); if (n != null) { sumF += n; gotF = true; } });
      if (gotF) result.followers = sumF;
    }
    if (engageIdx !== -1) {
      var vals = dataLines.map(function (r) { return toNumber(r[engageIdx]); }).filter(function (n) { return n != null; });
      if (vals.length) result.engagement = Math.round((vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) * 10) / 10;
    }
    return result;
  }

  function openMetricsModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var today = new Date();
    var monday = new Date(today); monday.setDate(today.getDate() - today.getDay() + 1);
    var iso = monday.toISOString().slice(0, 10);
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;"><div class="modal-head"><h3>بيانات الأسبوع</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>بداية الأسبوع</label><input type="date" id="wm-week" value="' + iso + '"></div>' +
      '<div class="field"><label>أو ارفع تقرير CSV (Meta Business Suite / Meta Ads / Google Ads)</label>' +
      '<input type="file" id="wm-csv-file" accept=".csv,text/csv"></div>' +
      '<div id="wm-csv-status" style="font-size:11px;color:var(--c-muted);margin-bottom:10px;"></div>' +
      '<div class="field"><label>الوصول (Reach)</label><input type="number" id="wm-reach"></div>' +
      '<div class="field"><label>نسبة التفاعل %</label><input type="number" step="0.1" id="wm-eng"></div>' +
      '<div class="field"><label>متابعين جدد</label><input type="number" id="wm-followers"></div>' +
      '<div style="text-align:left;"><button class="btn" id="wm-save">حفظ</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var csvInput = document.getElementById("wm-csv-file");
    var csvStatus = document.getElementById("wm-csv-status");
    csvInput.onchange = function () {
      var file = csvInput.files[0];
      if (!file) return;
      csvStatus.textContent = "بيقرأ الملف…";
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = parseMetricsCsv(String(reader.result));
          var found = [];
          if (parsed.reach != null) { document.getElementById("wm-reach").value = parsed.reach; found.push("الوصول"); }
          if (parsed.engagement != null) { document.getElementById("wm-eng").value = parsed.engagement; found.push("نسبة التفاعل"); }
          if (parsed.followers != null) { document.getElementById("wm-followers").value = parsed.followers; found.push("متابعين جدد"); }
          csvStatus.textContent = found.length
            ? "اتقرا من الملف: " + found.join("، ") + " — راجع الأرقام تحت قبل الحفظ"
            : "معرفناش نلاقي أعمدة معروفة في الملف — أدخل الأرقام يدوي أو جرّب تصدير تاني";
        } catch (e) {
          csvStatus.textContent = "تعذّر قراءة الملف: " + e.message;
        }
      };
      reader.readAsText(file);
    };

    document.getElementById("wm-save").onclick = function () {
      var me = window.SSMPDAuth.currentAdmin;
      window.SSMPDDb.upsertWeeklyMetrics({
        week_start: document.getElementById("wm-week").value,
        reach: Number(document.getElementById("wm-reach").value) || 0,
        engagement_rate: Number(document.getElementById("wm-eng").value) || 0,
        new_followers: Number(document.getElementById("wm-followers").value) || 0,
        entered_by: me.id
      }).then(function () {
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  window.SSMPDRenderSummary = { render: render };
})();
