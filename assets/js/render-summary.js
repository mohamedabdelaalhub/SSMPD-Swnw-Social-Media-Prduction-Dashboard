/* SSMPD — شاشة الملخص العام */
(function () {
  "use strict";

  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // بالإنجليزي دايماً (حتى لو الصفحة عربي) — طلب صريح من المستخدم لأرقام سكشن الإعلانات المدفوعة
  function fmtNum(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return iso; }
  }

  // نص عربي مبسّط لمؤشر النتيجة الخام من تقرير Meta Ads (زي "reach" أو
  // "actions:onsite_conversion.messaging_conversation_started_7d")
  function resultLabel(indicator) {
    var s = String(indicator || "").toLowerCase();
    if (!s) return "نتائج";
    if (s.indexOf("reach") !== -1) return "وصول";
    if (s.indexOf("thruplay") !== -1 || s.indexOf("video") !== -1) return "مشاهدات فيديو";
    if (s.indexOf("messaging") !== -1) return "محادثات ماسنجر";
    if (s.indexOf("link_click") !== -1) return "نقرات على الرابط";
    if (s.indexOf("purchase") !== -1) return "عمليات شراء";
    if (s.indexOf("lead") !== -1) return "بيانات تواصل (Leads)";
    return "نتائج";
  }

  function kpiCard(label, value, extra) {
    return '<div class="kpi-card"><div class="label">' + label + '</div>' +
      '<div class="value' + (extra && extra.small ? ' small' : '') + '">' + value + '</div>' +
      (extra && extra.delta ? '<div class="delta ' + extra.deltaClass + '">' + extra.delta + '</div>' : '') +
      '</div>';
  }

  // اختيارات مقارنة الأرشيف (أسابيع المؤشرات / دفعات تقارير الإعلانات) — محفوظة
  // على مستوى الموديول عشان تفضل زي ما هي بين كل إعادة رسم للشاشة
  var cmp = { weekA: null, weekB: null, batchA: null, batchB: null };

  // ---------- فلتر مؤشرات عمود في جدول حملات Meta Ads ----------
  // بيتنادى لما حد يدوس على رأس عمود في جدول الحملات — بيحسب إجمالي/متوسط/
  // أعلى/أقل حملة لنفس العمود، كله من البيانات المُحمّلة بالفعل (بدون أي
  // نداء إضافي للسيرفر)
  function renderAdsColumnStats(col, label, unit, rows) {
    var box = document.getElementById("ads-col-stats");
    if (!box) return;
    if (col === "campaign_name") {
      box.innerHTML = '<div class="kpi-card"><div class="label">عدد الحملات</div><div class="value small">' + rows.length + '</div></div>';
      return;
    }
    var vals = rows.map(function (r) { return { name: r.campaign_name, v: Number(r[col]) }; })
      .filter(function (x) { return !isNaN(x.v); });
    if (!vals.length) { box.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">لا توجد بيانات رقمية لعمود «' + escapeHtml(label) + '»</p>'; return; }
    var sum = vals.reduce(function (s, x) { return s + x.v; }, 0);
    var avg = Math.round((sum / vals.length) * 100) / 100;
    var max = vals.reduce(function (m, x) { return x.v > m.v ? x : m; }, vals[0]);
    var min = vals.reduce(function (m, x) { return x.v < m.v ? x : m; }, vals[0]);
    box.innerHTML = '<h4 style="font-size:13px;margin-bottom:8px;">مؤشرات عمود «' + escapeHtml(label) + '»</h4><div class="kpi-grid">' +
      kpiCard("الإجمالي", fmtNum(sum) + " " + unit, { small: true }) +
      kpiCard("المتوسط", fmtNum(avg) + " " + unit) +
      kpiCard("الأعلى", fmtNum(max.v) + " " + unit) +
      kpiCard("أعلى حملة", escapeHtml(max.name)) +
      kpiCard("الأقل", fmtNum(min.v) + " " + unit) +
      kpiCard("أقل حملة", escapeHtml(min.name)) +
      '</div>';
  }

  // ---------- مصروفات الإعلانات الفعلية — Apps Script Web App (JSON جاهز) ----------
  // كانت بتتقرا مباشرة من ملف Google Drive (xlsx) بمفتاح API مقيّد — استُبدلت
  // لأن قراءة alt=media بمفتاح API بس (من غير OAuth) كانت بترجع 503 بشكل
  // متكرر مش مضمون. دلوقتي بتتقرا عن طريق Apps Script Web App منشور من حساب
  // المركز (OAuth، Execute as: Me) وبيرجّع الملخص الشهري جاهز كـJSON مباشرة —
  // راجع config.js → adsExpensesWebAppUrl و apps-script/ads-expenses-bridge.gs
  var adsExpensesCache = null; // { monthly: [...], lastRecordAt: iso, error: null }

  function fetchAdsExpensesData() {
    var url = (window.SSMPD_CONFIG || {}).adsExpensesWebAppUrl;
    if (!url) return Promise.reject(new Error("رابط جسر مصروفات الإعلانات مش متظبط في config.js"));
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("تعذّر الوصول لجسر مصروفات الإعلانات (" + res.status + ")");
      return res.json();
    }).then(function (data) {
      return {
        monthly: (data.monthly || []).map(function (m) {
          return {
            month: m.month, fbSpend: Number(m.fbSpend || 0), paid: Number(m.paid || 0),
            otherExpenses: Number(m.otherExpenses || 0), closingBalance: Number(m.closingBalance || 0)
          };
        }),
        transactions: data.transactions || [],
        lastRecordAt: data.lastRecordAt || null
      };
    });
  }

  // نص تاريخ حركة سجل الحركات — بيتقرا من قيمة تاريخ خام (ممكن تيجي بأي صيغة
  // من Apps Script) وبيتحول لصيغة يوم/شهر/سنة مقروءة، أو "—" لو فاضي/مش مفهوم
  function fmtTxDate(v) {
    if (!v) return "—";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  // بيرجع حركات سجل الحركات الخاصة بشهر وعمود معيّن من جدول الإقفال الشهري —
  // سحوبات فيسبوك بتتفلتر بنوع "سحب" بالظبط، المسدد بنوع "سداد" بالظبط.
  // "مصروفات أخرى" و"الرصيد الختامي" مفيش ليهم تفصيل حركات مستقل: الأول رقم
  // بييجي جاهز من شيت "الإقفال الشهري" نفسه (مش من سجل الحركات)، والتاني
  // رصيد تراكمي مش عملية واحدة — فمعالجهم بيرجعوا null (مفيش جدول، رسالة بس)
  function filterTransactionsForCell(month, field) {
    var all = (adsExpensesCache && adsExpensesCache.transactions) || [];
    var monthTx = all.filter(function (t) { return String(t.month) === String(month); });
    if (field === "fbSpend") return monthTx.filter(function (t) { return t.type === "سحب"; });
    if (field === "paid") return monthTx.filter(function (t) { return t.type === "سداد"; });
    return null;
  }

  var CELL_FIELD_LABELS = { fbSpend: "سحوبات فيسبوك", paid: "المسدد", otherExpenses: "مصروفات أخرى", closingBalance: "الرصيد الختامي" };
  var CELL_FIELD_NOTES = {
    otherExpenses: "رقم «مصروفات أخرى» بييجي جاهز من شيت «الإقفال الشهري» في ملف الإكسل مباشرة (رسوم بنكية/تعديلات يدوية غالباً) — مش مبني على حركات فردية في «سجل الحركات»، فمفيش تفصيل نعرضه هنا.",
    closingBalance: "«الرصيد الختامي» رصيد تراكمي (كل السحوبات والمسدد من أول الملف لحد آخر الشهر ده) — مش قيمة عملية واحدة، فمفيش «حركة» بعينها تتربط بيه. لتفاصيل حركات الشهر ده استخدم عمودي «سحوبات فيسبوك» و«المسدد» فوق."
  };

  function openTransactionsModal(month, field) {
    var rows = filterTransactionsForCell(month, field);
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var bodyHtml;
    if (rows === null) {
      bodyHtml = '<p style="font-size:12px;color:var(--c-muted);">' + escapeHtml(CELL_FIELD_NOTES[field] || "") + '</p>';
    } else if (!rows.length) {
      bodyHtml = '<div class="empty-state">مفيش حركات مسجّلة لهذا البند في هذا الشهر.</div>';
    } else {
      var sum = rows.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0);
      bodyHtml = '<p style="font-size:12px;color:var(--c-muted);">عدد الحركات: ' + rows.length + ' — الإجمالي: ' + fmtNum(sum) + ' ج.م</p>' +
        '<div style="max-height:360px;overflow:auto;"><table class="simple"><thead><tr><th>التاريخ</th><th>الوقت</th><th>النوع</th><th>القيمة</th><th>البيان</th><th>الكود</th></tr></thead><tbody>' +
        rows.map(function (t) {
          return '<tr><td>' + fmtTxDate(t.date) + '</td><td>' + escapeHtml(t.time || "—") + '</td><td>' + escapeHtml(t.type || "—") + '</td>' +
            '<td>' + fmtNum(t.amount) + '</td><td>' + escapeHtml(t.description || "—") + '</td><td>' + escapeHtml(t.opCode || "—") + '</td></tr>';
        }).join("") + '</tbody></table></div>';
    }
    backdrop.innerHTML = '<div class="modal" style="max-width:640px;"><div class="modal-head"><h3>' + (rows === null ? "" : "حركات ") + escapeHtml(CELL_FIELD_LABELS[field] || "") + ' — ' + escapeHtml(String(month)) + '</h3>' +
      '<button class="modal-close">×</button></div>' + bodyHtml + '</div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
  }

  // بيبني جدول/ملخص شهور الإقفال حسب الفلتر المختار: "" (كل الشهور)، اسم شهر
  // بعينه، أو "__total__" (إجمالي كل المصروفات المعروضة). الخلايا الرقمية
  // كليكابل (data-month/data-field) وبتتوصّل بمعالج نقر واحد على مستوى الـ body
  function monthlyRowHtml(m) {
    var cbColor = m.closingBalance < 0 ? "var(--c-negative)" : m.closingBalance > 0 ? "var(--c-positive)" : "inherit";
    var pointer = "cursor:pointer;text-decoration:underline dotted;";
    return '<tr><td>' + escapeHtml(String(m.month)) + '</td>' +
      '<td data-month="' + escapeHtml(String(m.month)) + '" data-field="fbSpend" style="' + pointer + '">' + fmtNum(m.fbSpend) + '</td>' +
      '<td data-month="' + escapeHtml(String(m.month)) + '" data-field="paid" style="' + pointer + '">' + fmtNum(m.paid) + '</td>' +
      '<td data-month="' + escapeHtml(String(m.month)) + '" data-field="otherExpenses" style="' + pointer + '">' + fmtNum(m.otherExpenses) + '</td>' +
      '<td data-month="' + escapeHtml(String(m.month)) + '" data-field="closingBalance" style="' + pointer + 'color:' + cbColor + ';font-weight:600;">' + fmtNum(m.closingBalance) + '</td></tr>';
  }

  function buildMonthlySectionHtml(months, filterVal) {
    if (filterVal === "__total__") {
      var sumFb = 0, sumPaid = 0, sumOther = 0;
      months.forEach(function (m) { sumFb += m.fbSpend; sumPaid += m.paid; sumOther += m.otherExpenses; });
      var latestCb = months.length ? months[0].closingBalance : 0;
      return '<div class="kpi-grid">' +
        kpiCard("إجمالي سحوبات فيسبوك (كل الشهور)", fmtNum(sumFb) + " ج.م") +
        kpiCard("إجمالي المسدد (كل الشهور)", fmtNum(sumPaid) + " ج.م") +
        kpiCard("إجمالي مصروفات أخرى (كل الشهور)", fmtNum(sumOther) + " ج.م") +
        kpiCard("الرصيد الختامي الحالي", '<span style="color:' + (latestCb < 0 ? "var(--c-negative)" : latestCb > 0 ? "var(--c-positive)" : "inherit") + ';">' + fmtNum(latestCb) + " ج.م</span>") +
        '</div>';
    }
    var shown = filterVal ? months.filter(function (m) { return String(m.month) === filterVal; }) : months;
    if (!shown.length) return '<div class="empty-state">مفيش بيانات لهذا الشهر.</div>';
    return '<table class="simple"><thead><tr><th>الشهر</th><th>سحوبات فيسبوك</th><th>المسدد</th><th>مصروفات أخرى</th><th>الرصيد الختامي</th></tr></thead><tbody>' +
      shown.map(monthlyRowHtml).join("") + '</tbody></table>';
  }

  function fmtMonthDate(v) {
    if (v == null) return "—";
    if (v instanceof Date) return v.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
    return String(v);
  }

  function loadAdsExpenses(latestAdsBatchTotals) {
    var body = document.getElementById("ads-expenses-body");
    if (!body) return;
    fetchAdsExpensesData().then(function (data) {
      adsExpensesCache = data;
      var html = "";
      if (data.lastRecordAt) {
        html += '<p style="font-size:11px;color:var(--c-muted);">آخر حركة مسجّلة في الملف — ' + fmtMonthDate(data.lastRecordAt) + '</p>';
      }
      // الملف فيه صفوف شهور مجهّزة مسبقاً لسنين قدام (لسه مالهاش بيانات) — بنعرض
      // بس الشهر الحالي وما قبله (الحاضر فوق)، والشهور القادمة (المستقبل) مش
      // معروضة في الجدول الرئيسي خالص لحد ما ييجي وقتها
      var nowStr = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      var pastAndCurrent = data.monthly.filter(function (m) { return String(m.month) <= nowStr; })
        .sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); });
      var futureCount = data.monthly.length - pastAndCurrent.length;
      if (!data.monthly.length) {
        html += '<div class="empty-state">لسه مفيش إقفال شهري متسجل في الملف.</div>';
      } else if (!pastAndCurrent.length) {
        html += '<div class="empty-state">مفيش بيانات لشهور فاتت أو الشهر الحالي — الملف فيه بس شهور مستقبلية لسه معلّقة.</div>';
      } else {
        var lastMonth = pastAndCurrent[0];
        var totalFbSpendAllMonths = pastAndCurrent.reduce(function (s, m) { return s + m.fbSpend; }, 0);
        html += '<div class="kpi-grid">' +
          kpiCard("إجمالي سحوبات فيسبوك (" + escapeHtml(String(lastMonth.month)) + ")", fmtNum(lastMonth.fbSpend) + " ج.م", { small: true }) +
          kpiCard("إجمالي المصروفات الكلي", fmtNum(totalFbSpendAllMonths) + " ج.م", { small: true }) +
          kpiCard("الرصيد الختامي", '<span style="color:' + (lastMonth.closingBalance < 0 ? "var(--c-negative)" : lastMonth.closingBalance > 0 ? "var(--c-positive)" : "inherit") + ';">' + fmtNum(lastMonth.closingBalance) + " ج.م</span>") +
          '</div>';
        if (latestAdsBatchTotals && lastMonth.fbSpend) {
          var diff = lastMonth.fbSpend - latestAdsBatchTotals.spent;
          html += '<h4 style="margin-top:14px;font-size:13px;">مقارنة مع آخر تقرير Meta Ads مستورد</h4>' +
            '<table class="simple"><thead><tr><th>المصدر</th><th>المبلغ</th></tr></thead><tbody>' +
            '<tr><td>سحوبات البنك الفعلية (' + escapeHtml(String(lastMonth.month)) + ')</td><td>' + fmtNum(lastMonth.fbSpend) + ' ج.م</td></tr>' +
            '<tr><td>المبلغ المُنفق حسب تقرير Meta Ads</td><td>' + fmtNum(latestAdsBatchTotals.spent) + ' ج.م</td></tr>' +
            '<tr><td>الفرق</td><td class="' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + fmtNum(Math.abs(diff)) + ' ج.م</td></tr>' +
            '</tbody></table>' +
            '<p style="font-size:11px;color:var(--c-muted);margin-top:6px;">لو الفرق كبير، السبب غالباً اختلاف فترة تقرير Meta Ads عن الشهر البنكي، أو رسوم/عمولات إضافية على السحب.</p>';
        }
        html += '<h4 style="margin-top:14px;font-size:13px;">الإقفال الشهري (الحاضر فوق، الماضي تحته)</h4>' +
          '<p style="font-size:11px;color:var(--c-muted);">دوس على أي رقم في الجدول عشان تشوف الحركات التفصيلية بتاعته.</p>' +
          '<div class="field" style="max-width:260px;margin-bottom:8px;"><label>فلترة بالشهر</label><select id="ads-month-filter">' +
          '<option value="">كل الشهور</option>' +
          pastAndCurrent.map(function (m) { return '<option value="' + escapeHtml(String(m.month)) + '">' + escapeHtml(String(m.month)) + '</option>'; }).join("") +
          '<option value="__total__">إجمالي كل المصروفات</option>' +
          '</select></div>' +
          '<div id="ads-monthly-wrap">' + buildMonthlySectionHtml(pastAndCurrent, "") + '</div>';
        if (futureCount > 0) {
          html += '<p style="font-size:11px;color:var(--c-muted);margin-top:6px;">فيه ' + futureCount + ' شهر مستقبلي مجهّز مسبقاً في الملف (لسه من غير بيانات) — مش معروض هنا لحد ما ييجي وقته.</p>';
        }
      }
      html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="ads-expenses-refresh-btn">↻ تحديث الآن</button></div>';
      body.innerHTML = html;
      var refreshBtn = document.getElementById("ads-expenses-refresh-btn");
      if (refreshBtn) refreshBtn.onclick = function () { body.innerHTML = '<div class="loading" style="font-size:13px;">بيتحمّل من Google Drive…</div>'; loadAdsExpenses(latestAdsBatchTotals); };
      var monthFilterEl = document.getElementById("ads-month-filter");
      if (monthFilterEl) monthFilterEl.onchange = function () {
        var wrap = document.getElementById("ads-monthly-wrap");
        if (wrap) wrap.innerHTML = buildMonthlySectionHtml(pastAndCurrent, monthFilterEl.value);
      };
      // معالج نقر واحد على مستوى صندوق مصروفات الإعلانات كله — بيغطي أي جدول
      // شهري بيتبني بعد كده كمان (بعد تغيير الفلتر) لأن body نفسه مش بيتغيّر
      if (!body.dataset.txClickBound) {
        body.dataset.txClickBound = "1";
        body.addEventListener("click", function (e) {
          var cell = e.target.closest("[data-field]");
          if (!cell) return;
          openTransactionsModal(cell.getAttribute("data-month"), cell.getAttribute("data-field"));
        });
      }
    }).catch(function (e) {
      body.innerHTML = '<div class="err-msg">تعذّر تحميل ملف المصروفات: ' + escapeHtml(e.message) + '</div>' +
        '<div style="text-align:left;margin-top:6px;"><button class="btn ghost sm" id="ads-expenses-refresh-btn">↻ إعادة محاولة</button></div>';
      var retryBtn = document.getElementById("ads-expenses-refresh-btn");
      if (retryBtn) retryBtn.onclick = function () { body.innerHTML = '<div class="loading" style="font-size:13px;">بيتحمّل من Google Drive…</div>'; loadAdsExpenses(latestAdsBatchTotals); };
    });
  }

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل المؤشرات…</div>';

    var me0 = window.SSMPDAuth.currentAdmin;
    var isManager = window.SSMPDRoles.hasAnyRole(me0, ["general_manager", "super_admin"]);

    Promise.all([
      window.SSMPDDb.listContentItems({}),
      window.SSMPDDb.listWeeklyMetrics(500),
      window.SSMPDDb.listAdCampaigns(),
      isManager ? window.SSMPDDb.getLeadsStats({}) : Promise.resolve(null),
      isManager ? window.SSMPDDb.listLeads({ status: "new", page_size: 50 }) : Promise.resolve(null),
      isManager ? window.SSMPDDb.getPatientArchiveStats().catch(function () { return null; }) : Promise.resolve(null),
      isManager ? window.SSMPDDb.getAppSettings().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (res) {
      var items = res[0], metrics = res[1], ads = res[2];
      var leadsStats = res[3], newLeadsRes = res[4], patientStats = res[5], appSettings = res[6];

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

      // نظرة عامة على النظام كله — للمدير العام/السوبر أدمن بس: نبضة واحدة
      // عبر الموديولات التلاتة (محتوى/ليدز/أرشيف مرضى) بدل ما يفتح كل شاشة
      // لوحده عشان يتابع. بيجمع نفس تنبيهات SLA الموجودة أصلاً في الشاشتين
      // المتخصصتين (إدارة المحتوى وداشبورد الليدز) هنا في مكان واحد.
      if (isManager) {
        var contentSlaHours = (appSettings && appSettings.content_sla_hours) || 48;
        var leadsSlaHours = (appSettings && appSettings.leads_sla_hours) || 24;
        var slaMs48 = contentSlaHours * 60 * 60 * 1000, slaMs24 = leadsSlaHours * 60 * 60 * 1000, nowTs = Date.now();
        var stuckContent = items.filter(function (i) {
          return (i.stage === "initial_approval" || i.stage === "final_approval") &&
            i.updated_at && (nowTs - new Date(i.updated_at).getTime()) > slaMs48;
        }).length;
        var newLeads = (newLeadsRes && newLeadsRes.leads) || [];
        var overdueLeads = newLeads.filter(function (l) {
          return l.created_at && (nowTs - new Date(l.created_at).getTime()) > slaMs24;
        }).length;
        var pendingFiles = patientStats ? (patientStats.pending_review || 0) : null;
        var openLeads = leadsStats ? (leadsStats.open || 0) : 0;
        var awaitingApproval = items.filter(function (i) {
          return i.stage === "initial_approval" || i.stage === "final_approval";
        }).length;

        html += '<div class="section"><h3>نظرة عامة على النظام</h3><div class="kpi-grid">';
        html += kpiCard("مواد قيد الاعتماد", awaitingApproval);
        html += kpiCard("ليدز مفتوحة", openLeads);
        if (pendingFiles != null) html += kpiCard("ملفات مرضى قيد المراجعة", pendingFiles);
        html += '</div>';
        if (stuckContent || overdueLeads) {
          html += '<div style="margin-top:10px;border-inline-start:3px solid var(--c-negative);padding-inline-start:10px;">' +
            '<strong style="color:var(--c-negative);">⚠ يحتاج متابعة:</strong> ';
          var alerts = [];
          if (stuckContent) alerts.push(stuckContent + ' مادة متأخرة في الاعتماد (تاب "إدارة المحتوى")');
          if (overdueLeads) alerts.push(overdueLeads + ' ليد من غير رد لأكتر من ' + leadsSlaHours + ' ساعة (موديول إدارة الليدز)');
          html += alerts.join(" — ") + '</div>';
        } else {
          html += '<p style="font-size:12px;color:var(--c-positive);margin-top:8px;">✓ مفيش تنبيهات متأخرة دلوقتي.</p>';
        }
        html += '</div>';
      }

      html += '<div class="section"><h3>إنتاج المحتوى</h3><div class="kpi-grid">';
      html += kpiCard("إجمالي المحتوى", total);
      html += kpiCard("مخطط له", planned);
      html += kpiCard("قيد التصميم", inDesign);
      html += kpiCard("جاهز للنشر", readyOrPublished);
      html += kpiCard("تم النشر", published);
      html += kpiCard("نسبة الإنجاز", completion + "%");
      html += '</div></div>';

      // ---------- المحتوى حسب التخصص ----------
      var W = window.SSMPDWorkflow;
      var specialtyCounts = {};
      items.forEach(function (i) {
        var key = i.specialty && W.SPECIALTIES[i.specialty] ? i.specialty : "__none__";
        specialtyCounts[key] = (specialtyCounts[key] || 0) + 1;
      });
      var specialtyKeysOrdered = Object.keys(W.SPECIALTIES).filter(function (k) { return specialtyCounts[k]; })
        .sort(function (a, b) { return specialtyCounts[b] - specialtyCounts[a]; });

      html += '<div class="section"><h3>المحتوى حسب التخصص</h3>';
      html += '<div class="field" style="max-width:260px;"><label>فلترة المؤشرات بتخصص معيّن</label>' +
        W.specialtySelectHtml("sm-specialty-filter", "") + '</div>';
      html += '<div class="kpi-grid" id="sm-specialty-kpis"></div>';
      if (!specialtyKeysOrdered.length && !specialtyCounts.__none__) {
        html += '<div class="empty-state">لسه مفيش مواد متصنّفة بتخصص</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>التخصص</th><th>عدد المواد</th></tr></thead><tbody>';
        specialtyKeysOrdered.forEach(function (k) {
          html += '<tr><td>' + W.SPECIALTIES[k].label + '</td><td>' + specialtyCounts[k] + '</td></tr>';
        });
        if (specialtyCounts.__none__) {
          html += '<tr><td>بدون تخصص</td><td>' + specialtyCounts.__none__ + '</td></tr>';
        }
        html += '</tbody></table>';
      }
      html += '</div>';

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
      var me = window.SSMPDAuth.currentAdmin;
      var canManageMetrics = window.SSMPDRoles.hasAnyRole(me, ["approver", "general_manager", "super_admin"]);
      if (canManageMetrics) {
        html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="add-week-metrics-btn">+ إدخال بيانات أسبوع جديد</button></div>';
      }
      html += '</div>';

      // ---------- أرشيف + مقارنة + إجماليات مؤشرات السوشيال ميديا الأسبوعية ----------
      html += '<div class="section"><h3>أرشيف مؤشرات السوشيال ميديا</h3>';
      if (metrics.length < 2) {
        html += '<div class="empty-state">محتاج بيانات أسبوعين على الأقل عشان يظهر أرشيف/مقارنة.</div>';
      } else {
        var wTotalReach = 0, wTotalFollowers = 0, wEngSum = 0, wEngCount = 0;
        metrics.forEach(function (m) {
          wTotalReach += Number(m.reach || 0);
          wTotalFollowers += Number(m.new_followers || 0);
          if (m.engagement_rate != null) { wEngSum += Number(m.engagement_rate); wEngCount++; }
        });
        html += '<div class="kpi-grid">';
        html += kpiCard("إجمالي الوصول (كل الأسابيع)", fmtNum(wTotalReach));
        html += kpiCard("إجمالي متابعين جدد (كل الأسابيع)", fmtNum(wTotalFollowers));
        html += kpiCard("متوسط نسبة التفاعل", (wEngCount ? Math.round((wEngSum / wEngCount) * 10) / 10 : 0) + "%");
        html += kpiCard("عدد الأسابيع المُدخَلة", metrics.length);
        html += '</div>';

        if (!cmp.weekA) cmp.weekA = metrics[1].week_start;
        if (!cmp.weekB) cmp.weekB = metrics[0].week_start;
        var wOptions = metrics.map(function (m) { return '<option value="' + m.week_start + '">' + m.week_start + '</option>'; }).join("");
        html += '<h4 style="margin-top:16px;font-size:13px;">مقارنة بين أسبوعين</h4>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
          '<select id="wcmp-a">' + wOptions + '</select><span style="font-size:12px;color:var(--c-muted);">مقابل</span>' +
          '<select id="wcmp-b">' + wOptions + '</select></div>';
        var mA = metrics.filter(function (m) { return m.week_start === cmp.weekA; })[0];
        var mB = metrics.filter(function (m) { return m.week_start === cmp.weekB; })[0];
        if (mA && mB) {
          html += '<table class="simple"><thead><tr><th>المؤشر</th><th>' + mA.week_start + '</th><th>' + mB.week_start + '</th><th>الفرق</th></tr></thead><tbody>';
          [
            { k: "reach", label: "الوصول" },
            { k: "engagement_rate", label: "نسبة التفاعل %" },
            { k: "new_followers", label: "متابعين جدد" }
          ].forEach(function (f) {
            var va = Number(mA[f.k] || 0), vb = Number(mB[f.k] || 0), diff = vb - va;
            html += '<tr><td>' + f.label + '</td><td>' + fmtNum(va) + '</td><td>' + fmtNum(vb) + '</td>' +
              '<td class="' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + fmtNum(Math.abs(diff)) + '</td></tr>';
          });
          html += '</tbody></table>';
        }

        html += '<h4 style="margin-top:16px;font-size:13px;">كل الأسابيع</h4>' +
          '<div style="max-height:260px;overflow:auto;"><table class="simple"><thead><tr><th>الأسبوع</th><th>الوصول</th><th>نسبة التفاعل</th><th>متابعين جدد</th></tr></thead><tbody>' +
          metrics.map(function (m) {
            return '<tr><td>' + m.week_start + '</td><td>' + fmtNum(m.reach) + '</td><td>' + (m.engagement_rate || 0) + '%</td><td>' + fmtNum(m.new_followers) + '</td></tr>';
          }).join("") + '</tbody></table></div>';
      }
      html += '</div>';

      // ---------- الإعلانات المدفوعة (Meta Ads) — دفعة حالية + أرشيف دفعات + مقارنة ----------
      var batchesMap = {};
      var batchOrder = [];
      ads.forEach(function (a) {
        var bid = a.report_batch_id || "بدون دفعة";
        if (!batchesMap[bid]) { batchesMap[bid] = { id: bid, rows: [], createdAt: a.created_at }; batchOrder.push(bid); }
        batchesMap[bid].rows.push(a);
        if (a.created_at && a.created_at > batchesMap[bid].createdAt) batchesMap[bid].createdAt = a.created_at;
      });
      var batches = batchOrder.map(function (id) { return batchesMap[id]; })
        .sort(function (x, y) { return (y.createdAt || "").localeCompare(x.createdAt || ""); });

      function batchTotals(rows) {
        var t = { spent: 0, reach: 0, clicks: 0, impressions: 0, ctrSum: 0, ctrCount: 0, minStart: null, maxEnd: null };
        rows.forEach(function (a) {
          t.spent += Number(a.amount_spent || 0);
          t.reach += Number(a.reach || 0);
          t.clicks += Number(a.link_clicks || 0);
          t.impressions += Number(a.impressions || 0);
          if (a.ctr != null) { t.ctrSum += Number(a.ctr); t.ctrCount++; }
          if (a.reporting_start && (!t.minStart || a.reporting_start < t.minStart)) t.minStart = a.reporting_start;
          if (a.reporting_end && (!t.maxEnd || a.reporting_end > t.maxEnd)) t.maxEnd = a.reporting_end;
        });
        t.avgCtr = t.ctrCount ? Math.round((t.ctrSum / t.ctrCount) * 100) / 100 : 0;
        return t;
      }

      html += '<div class="section"><h3>الإعلانات المدفوعة (Meta Ads)</h3>';
      if (!batches.length) {
        html += '<div class="empty-state">لسه مفيش تقرير حملات إعلانات مستورد.</div>';
      } else {
        var latest = batches[0];
        var lt = batchTotals(latest.rows);
        html += '<p style="font-size:12px;color:var(--c-muted);">آخر تقرير مستورد — ' + fmtDate(latest.createdAt) + '</p>';
        html += '<div class="kpi-grid">';
        html += kpiCard("إجمالي المبلغ المُنفق", fmtNum(lt.spent) + " ج.م", { small: true });
        html += kpiCard("إجمالي الوصول", fmtNum(lt.reach));
        html += kpiCard("إجمالي النقرات", fmtNum(lt.clicks));
        html += kpiCard("متوسط نسبة النقر", lt.avgCtr + "%");
        html += '</div>';

        html += '<p style="font-size:11px;color:var(--c-muted);margin:8px 0 0;">دوس على اسم أي عمود في الجدول تحت عشان تشوف مؤشراته (الإجمالي/المتوسط/الأعلى/الأقل حملة).</p>';
        html += '<table class="simple ads-col-table" style="margin-top:6px;"><thead><tr>' +
          '<th data-col="campaign_name">الحملة</th>' +
          '<th data-col="amount_spent" data-unit="ج.م">المبلغ المُنفق</th>' +
          '<th data-col="results">النتائج</th>' +
          '<th data-col="cost_per_result" data-unit="ج.م">تكلفة النتيجة</th>' +
          '<th data-col="reach">الوصول</th>' +
          '<th data-col="link_clicks">النقرات</th>' +
          '<th data-col="ctr" data-unit="%">نسبة النقر</th>' +
          '</tr></thead><tbody>';
        latest.rows.forEach(function (a) {
          html += '<tr><td>' + escapeHtml(a.campaign_name) + '</td>' +
            '<td>' + fmtNum(a.amount_spent) + ' ج.م</td>' +
            '<td>' + fmtNum(a.results) + ' ' + resultLabel(a.result_indicator) + '</td>' +
            '<td>' + (a.cost_per_result != null ? fmtNum(a.cost_per_result) + ' ج.م' : '—') + '</td>' +
            '<td>' + fmtNum(a.reach) + '</td>' +
            '<td>' + fmtNum(a.link_clicks) + '</td>' +
            '<td>' + (a.ctr != null ? a.ctr + '%' : '—') + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<div id="ads-col-stats" style="margin-top:8px;"></div>';
        if (lt.minStart && lt.maxEnd) {
          html += '<p style="font-size:11px;color:var(--c-muted);margin-top:8px;">بيانات التقرير من ' + lt.minStart + ' لحد ' + lt.maxEnd + '</p>';
        }

        // إجمالي كل التقارير من أول استيراد لحد دلوقتي (كل الدفعات مع بعض)
        var allTotals = batchTotals(ads);
        html += '<h4 style="margin-top:16px;font-size:13px;">إجمالي كل التقارير (' + batches.length + ' تقرير)</h4><div class="kpi-grid">';
        html += kpiCard("إجمالي الإنفاق الكلي", fmtNum(allTotals.spent) + " ج.م", { small: true });
        html += kpiCard("إجمالي الوصول الكلي", fmtNum(allTotals.reach));
        html += kpiCard("إجمالي النقرات الكلي", fmtNum(allTotals.clicks));
        html += '</div>';

        if (batches.length >= 2) {
          if (!cmp.batchA) cmp.batchA = batches[1].id;
          if (!cmp.batchB) cmp.batchB = batches[0].id;
          var bOptions = batches.map(function (b) {
            return '<option value="' + escapeHtml(b.id) + '">' + fmtDate(b.createdAt) + ' (' + b.rows.length + ' حملة)</option>';
          }).join("");
          html += '<h4 style="margin-top:16px;font-size:13px;">مقارنة بين تقريرين</h4>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
            '<select id="acmp-a">' + bOptions + '</select><span style="font-size:12px;color:var(--c-muted);">مقابل</span>' +
            '<select id="acmp-b">' + bOptions + '</select></div>';
          var bA = batchesMap[cmp.batchA], bB = batchesMap[cmp.batchB];
          if (bA && bB) {
            var tA = batchTotals(bA.rows), tB = batchTotals(bB.rows);
            html += '<table class="simple"><thead><tr><th>المؤشر</th><th>' + fmtDate(bA.createdAt) + '</th><th>' + fmtDate(bB.createdAt) + '</th><th>الفرق</th></tr></thead><tbody>';
            [
              { a: tA.spent, b: tB.spent, label: "المبلغ المُنفق (ج.م)" },
              { a: tA.reach, b: tB.reach, label: "الوصول" },
              { a: tA.clicks, b: tB.clicks, label: "النقرات" }
            ].forEach(function (f) {
              var diff = f.b - f.a;
              html += '<tr><td>' + f.label + '</td><td>' + fmtNum(f.a) + '</td><td>' + fmtNum(f.b) + '</td>' +
                '<td class="' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ " : diff < 0 ? "▼ " : "") + fmtNum(Math.abs(diff)) + '</td></tr>';
            });
            html += '</tbody></table>';
          }
        }

        html += '<h4 style="margin-top:16px;font-size:13px;">أرشيف التقارير</h4>' +
          '<table class="simple"><thead><tr><th>تاريخ الاستيراد</th><th>عدد الحملات</th><th>الإنفاق</th><th>الوصول</th></tr></thead><tbody>' +
          batches.map(function (b) {
            var t = batchTotals(b.rows);
            return '<tr><td>' + fmtDate(b.createdAt) + '</td><td>' + b.rows.length + '</td><td>' + fmtNum(t.spent) + ' ج.م</td><td>' + fmtNum(t.reach) + '</td></tr>';
          }).join("") + '</tbody></table>';
      }
      if (canManageMetrics) {
        html += '<div style="text-align:left;margin-top:10px;"><button class="btn ghost sm" id="import-ads-btn">+ استيراد تقرير حملات إعلانات</button></div>';
      }
      html += '</div>';

      // ---------- مصروفات الإعلانات الفعلية (من كشف الحساب البنكي — ملف Google Drive) ----------
      html += '<div class="section" id="ads-expenses-section">' +
        '<h3>💰 مصروفات الإعلانات الفعلية (من كشف الحساب البنكي)</h3>' +
        '<div id="ads-expenses-body"><div class="loading" style="font-size:13px;">بيتحمّل من Google Drive…</div></div>' +
        '</div>';

      container.innerHTML = html;

      // إجمالي آخر تقرير Meta Ads مستورد — يُستخدم في المقارنة مع المصروفات الفعلية
      var latestAdsBatch = batches.length ? batchTotals(batches[0].rows) : null;
      loadAdsExpenses(latestAdsBatch);

      // مؤشرات جودة/نوعية مفلترة بتخصص معيّن — بتتحدّث لحظياً مع تغيير الفلتر من غير إعادة رسم الشاشة كلها
      function renderSpecialtyKpis(specialty) {
        var kpisEl = document.getElementById("sm-specialty-kpis");
        if (!kpisEl) return;
        var filtered = specialty ? items.filter(function (i) { return i.specialty === specialty; }) : items;
        var fTotal = filtered.length;
        var fPlanned = filtered.filter(function (i) { return i.stage === "idea_selection" || i.stage === "initial_approval"; }).length;
        var fInDesign = filtered.filter(function (i) { return ["in_design", "final_approval", "needs_revision"].indexOf(i.stage) !== -1; }).length;
        var fPublished = filtered.filter(function (i) { return i.stage === "published"; }).length;
        var fCompletion = pct(fPublished, fTotal);
        kpisEl.innerHTML = kpiCard("إجمالي المحتوى" + (specialty ? " (" + W.SPECIALTIES[specialty].label + ")" : ""), fTotal) +
          kpiCard("مخطط له", fPlanned) + kpiCard("قيد التصميم/الاعتماد", fInDesign) +
          kpiCard("تم النشر", fPublished) + kpiCard("نسبة الإنجاز", fCompletion + "%");
      }
      renderSpecialtyKpis("");
      var specialtyFilterEl = document.getElementById("sm-specialty-filter");
      if (specialtyFilterEl) specialtyFilterEl.onchange = function () { renderSpecialtyKpis(specialtyFilterEl.value); };

      var btn = document.getElementById("add-week-metrics-btn");
      if (btn) btn.onclick = openMetricsModal;
      var adsBtn = document.getElementById("import-ads-btn");
      if (adsBtn) adsBtn.onclick = openAdImportModal;

      // فلتر مؤشرات لكل عمود في جدول الحملات — دوس على رأس أي عمود يطلعلك
      // إجمالي/متوسط/أعلى/أقل حملة لنفس العمود ده (latest.rows من الإغلاق فوق)
      var adsTable = container.querySelector(".ads-col-table");
      if (adsTable && typeof latest !== "undefined") {
        adsTable.querySelectorAll("th[data-col]").forEach(function (th) {
          th.style.cursor = "pointer";
          th.title = "دوس لعرض مؤشرات العمود ده";
          th.onclick = function () { renderAdsColumnStats(th.getAttribute("data-col"), th.textContent, th.getAttribute("data-unit") || "", latest.rows); };
        });
      }

      var wcmpA = document.getElementById("wcmp-a"), wcmpB = document.getElementById("wcmp-b");
      if (wcmpA) { wcmpA.value = cmp.weekA; wcmpA.onchange = function () { cmp.weekA = wcmpA.value; render(container); }; }
      if (wcmpB) { wcmpB.value = cmp.weekB; wcmpB.onchange = function () { cmp.weekB = wcmpB.value; render(container); }; }
      var acmpA = document.getElementById("acmp-a"), acmpB = document.getElementById("acmp-b");
      if (acmpA) { acmpA.value = cmp.batchA; acmpA.onchange = function () { cmp.batchA = acmpA.value; render(container); }; }
      if (acmpB) { acmpB.value = cmp.batchB; acmpB.onchange = function () { cmp.batchB = acmpB.value; render(container); }; }
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

  // ---------- استيراد تقرير حملات إعلانات مدفوعة (Meta Ads Manager — Campaigns export) ----------
  // مختلف عن استيراد المؤشرات الأسبوعية فوق: أعمدة ثابتة معروفة (تصدير Meta Ads نفسه)،
  // فبنعتمد على تطابق تام لاسم العمود (مش كلمات مفتاحية) لتفادي أي لخبطة.
  // بيدوّر على أول candidate (بالترتيب — الأولوية للأول) له تطابق تام مع عمود في الهيدر.
  // مهم إن الدور يبقى على الـ candidates مش على أعمدة الهيدر، عشان مثلاً "CTR (all)"
  // ظاهر في الملف قبل "CTR (link click-through rate)" بس إحنا عايزين التاني بالأولوية.
  function findExactCol(headers, candidates) {
    var lowerHeaders = headers.map(function (h) { return String(h || "").trim().toLowerCase(); });
    for (var c = 0; c < candidates.length; c++) {
      var i = lowerHeaders.indexOf(candidates[c]);
      if (i !== -1) return i;
    }
    return -1;
  }

  // بيرجع مصفوفة صفوف — صف واحد لكل حملة (campaign_name)، الأرقام مجمّعة (sum) لو
  // نفس الحملة ظهرت أكتر من مرة في الملف (بيحصل لأن التصدير بيبقى على مستوى مجموعة الإعلان)
  function parseAdCampaignsCsv(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length; });
    if (lines.length < 2) throw new Error("الملف فاضي أو مش بصيغة CSV مفهومة");
    var headers = splitCsvLine(lines[0]);
    var idx = {
      name: findExactCol(headers, ["campaign name"]),
      spent: findExactCol(headers, ["amount spent (egp)", "amount spent"]),
      impressions: findExactCol(headers, ["impressions"]),
      reach: findExactCol(headers, ["reach"]),
      results: findExactCol(headers, ["results"]),
      resultIndicator: findExactCol(headers, ["result indicator"]),
      linkClicks: findExactCol(headers, ["link clicks"]),
      ctr: findExactCol(headers, ["ctr (link click-through rate)", "ctr (all)"]),
      reportStart: findExactCol(headers, ["reporting starts"]),
      reportEnd: findExactCol(headers, ["reporting ends"])
    };
    if (idx.name === -1) throw new Error('معرفناش نلاقي عمود "Campaign name" في الملف — تأكد إنه تصدير حملات من Meta Ads Manager');

    var byName = {}, order = [];
    lines.slice(1).map(splitCsvLine).forEach(function (r) {
      var name = (r[idx.name] || "").trim();
      if (!name) return;
      var spent = idx.spent !== -1 ? (toNumber(r[idx.spent]) || 0) : 0;
      var impressions = idx.impressions !== -1 ? (toNumber(r[idx.impressions]) || 0) : 0;
      var reach = idx.reach !== -1 ? (toNumber(r[idx.reach]) || 0) : 0;
      if (!spent && !impressions && !reach) return; // تجاهل صفوف إعلانات مش شغالة (كل الأرقام صفر)

      if (!byName[name]) {
        byName[name] = {
          campaign_name: name, amount_spent: 0, impressions: 0, reach: 0, results: 0,
          result_indicator: idx.resultIndicator !== -1 ? (r[idx.resultIndicator] || null) : null,
          link_clicks: 0, ctrSum: 0, ctrCount: 0, reporting_start: null, reporting_end: null
        };
        order.push(name);
      }
      var row = byName[name];
      row.amount_spent += spent;
      row.impressions += impressions;
      row.reach += reach;
      if (idx.results !== -1) row.results += (toNumber(r[idx.results]) || 0);
      if (idx.linkClicks !== -1) row.link_clicks += (toNumber(r[idx.linkClicks]) || 0);
      if (idx.ctr !== -1) { var c = toNumber(r[idx.ctr]); if (c != null) { row.ctrSum += c; row.ctrCount++; } }
      if (idx.reportStart !== -1 && r[idx.reportStart] && (!row.reporting_start || r[idx.reportStart] < row.reporting_start)) row.reporting_start = r[idx.reportStart];
      if (idx.reportEnd !== -1 && r[idx.reportEnd] && (!row.reporting_end || r[idx.reportEnd] > row.reporting_end)) row.reporting_end = r[idx.reportEnd];
    });

    return order.map(function (name) {
      var row = byName[name];
      return {
        campaign_name: row.campaign_name,
        amount_spent: Math.round(row.amount_spent * 100) / 100,
        impressions: row.impressions,
        reach: row.reach,
        results: row.results,
        result_indicator: row.result_indicator,
        cost_per_result: row.results > 0 ? Math.round((row.amount_spent / row.results) * 100) / 100 : null,
        link_clicks: row.link_clicks,
        ctr: row.ctrCount ? Math.round((row.ctrSum / row.ctrCount) * 1000) / 1000 : null,
        reporting_start: row.reporting_start,
        reporting_end: row.reporting_end
      };
    });
  }

  function openAdImportModal() {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal" style="max-width:460px;"><div class="modal-head"><h3>استيراد تقرير حملات إعلانات</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);">ارفع ملف CSV تصدير الحملات من Meta Ads Manager — هيتحفظ كتقرير جديد في الأرشيف من غير ما يمسح التقارير القديمة.</p>' +
      '<div class="field"><input type="file" id="ad-csv-file" accept=".csv,text/csv"></div>' +
      '<div id="ad-csv-status" style="font-size:11px;color:var(--c-muted);margin-bottom:10px;"></div>' +
      '<div style="text-align:left;"><button class="btn" id="ad-csv-save" disabled>حفظ كتقرير جديد</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var parsedRows = null;
    var fileInput = document.getElementById("ad-csv-file");
    var status = document.getElementById("ad-csv-status");
    var saveBtn = document.getElementById("ad-csv-save");

    fileInput.onchange = function () {
      var file = fileInput.files[0];
      if (!file) return;
      status.textContent = "بيقرأ الملف…";
      saveBtn.disabled = true;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          parsedRows = parseAdCampaignsCsv(String(reader.result));
          if (!parsedRows.length) {
            status.textContent = "معرفناش نلاقي بيانات حملات شغالة في الملف";
            return;
          }
          status.textContent = "لقينا " + parsedRows.length + " حملة — اضغط حفظ عشان يتضاف كتقرير جديد في الأرشيف";
          saveBtn.disabled = false;
        } catch (e) {
          status.textContent = "تعذّر قراءة الملف: " + e.message;
        }
      };
      reader.readAsText(file);
    };

    saveBtn.onclick = function () {
      if (!parsedRows || !parsedRows.length) return;
      var me = window.SSMPDAuth.currentAdmin;
      var batchId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() :
        "b-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      saveBtn.disabled = true;
      // كل استيراد بقى دفعة (report_batch_id) جديدة منفصلة في الأرشيف — مفيش
      // مسح للتقارير القديمة بعد كده (كانت clearAdCampaigns() بتمسح كل حاجة قبل الحفظ)
      window.SSMPDDb.insertAdCampaigns(parsedRows.map(function (r) {
        return Object.assign({}, r, { imported_by: me.id, report_batch_id: batchId });
      })).then(function () {
        window.SSMPDDb.logUsageActivity(me.id, "استيراد تقرير حملات إعلانات", parsedRows.length + " حملة (Meta Ads)").catch(function () {});
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { alert("خطأ: " + e.message); saveBtn.disabled = false; });
    };
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
        window.SSMPDDb.logUsageActivity(me.id, "إدخال/رفع بيانات أسبوع", document.getElementById("wm-week").value).catch(function () {});
        backdrop.remove();
        render(document.getElementById("view-container"));
      }).catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  window.SSMPDRenderSummary = { render: render };
})();
