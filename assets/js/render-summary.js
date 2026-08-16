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

  function openMetricsModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var today = new Date();
    var monday = new Date(today); monday.setDate(today.getDate() - today.getDay() + 1);
    var iso = monday.toISOString().slice(0, 10);
    backdrop.innerHTML = '<div class="modal" style="max-width:420px;"><div class="modal-head"><h3>بيانات الأسبوع</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>بداية الأسبوع</label><input type="date" id="wm-week" value="' + iso + '"></div>' +
      '<div class="field"><label>الوصول (Reach)</label><input type="number" id="wm-reach"></div>' +
      '<div class="field"><label>نسبة التفاعل %</label><input type="number" step="0.1" id="wm-eng"></div>' +
      '<div class="field"><label>متابعين جدد</label><input type="number" id="wm-followers"></div>' +
      '<div style="text-align:left;"><button class="btn" id="wm-save">حفظ</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

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
