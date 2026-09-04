/* SSMPD — شاشة إعلانات Meta Ads (قسم ٣٥: جداول meta_* + Views، ad_campaigns القديم فضل زي ما هو) */
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtNum(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function fmtMoney(n) { return n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ج.م"; }
  function fmtPct(n) { return n == null || isNaN(n) ? "—" : (Number(n) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%"; }
  function fmtDate(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch (e) { return d; } }
  function div(a, b) { return b ? a / b : null; }

  function kpiCard(label, value) {
    return '<div class="kpi-card"><div class="label">' + label + '</div><div class="value small">' + value + '</div></div>';
  }
  function uniqSorted(arr) {
    var s = {}; arr.forEach(function (v) { if (v) s[v] = true; });
    return Object.keys(s).sort();
  }

  // بيانات محمّلة مرة واحدة وبتتفلتر في المتصفح (الداتا كلها ~110 إعلان، فمفيش داعي لأي fetch إضافي عند تغيير فلتر)
  var adRows = [], specialtyRows = [], creativeRows = [], leadRows = [], contentLinkRows = [];
  var contentByAdId = {}, contentByGroupId = {};
  var filters = { account: "", campaign: "", specialty: "", objective: "", status: "", fromDate: "" };

  // ربط عكسي (قسم ٣٦): لكل إعلان/مجموعة كرييتف مرتبطة بمحتوى، بنبني خريطة id → أسماء المواد
  function buildContentLinkMaps() {
    contentByAdId = {}; contentByGroupId = {};
    contentLinkRows.forEach(function (r) {
      if (r.meta_ad_id) {
        contentByAdId[r.meta_ad_id] = contentByAdId[r.meta_ad_id] || { id: r.content_id, titles: {} };
        contentByAdId[r.meta_ad_id].titles[r.content_title] = true;
      }
      if (r.creative_group_id) {
        contentByGroupId[r.creative_group_id] = contentByGroupId[r.creative_group_id] || { id: r.content_id, titles: {} };
        contentByGroupId[r.creative_group_id].titles[r.content_title] = true;
      }
    });
  }
  function contentLinkCellHtml(entry) {
    if (!entry) return "—";
    var titles = Object.keys(entry.titles).join("، ");
    return '<button class="btn ghost sm" data-goto-content="' + entry.id + '" style="font-size:10px;padding:2px 6px;">' + escapeHtml(titles) + '</button>';
  }
  function wireGotoContentButtons(root) {
    if (!window.SSMPDGotoContent) return;
    root.querySelectorAll("[data-goto-content]").forEach(function (btn) {
      btn.onclick = function () { window.SSMPDGotoContent(btn.getAttribute("data-goto-content")); };
    });
  }

  function applyFilters(rows) {
    return rows.filter(function (r) {
      if (filters.account && r.account_name !== filters.account) return false;
      if (filters.campaign && r.campaign_name !== filters.campaign) return false;
      if (filters.specialty && r.specialty !== filters.specialty) return false;
      if (filters.objective && r.objective !== filters.objective) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.fromDate && (!r.start_date || r.start_date < filters.fromDate)) return false;
      return true;
    });
  }

  function computeKpis(rows) {
    var sum = function (k) { return rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); };
    var spend = sum("spend"), reach = sum("reach"), impressions = sum("impressions"), clicks = sum("clicks"),
      msgConv = sum("msg_conv"), leads = sum("leads");
    var adsCount = uniqSorted(rows.map(function (r) { return r.ad_id; })).length;
    var campaignCount = uniqSorted(rows.map(function (r) { return r.campaign_id; })).length;
    return {
      spend: spend, adsCount: adsCount, campaignCount: campaignCount, reach: reach, impressions: impressions,
      clicks: clicks, msgConv: msgConv, leads: leads,
      costPerMsg: div(spend, msgConv), costPerLead: div(spend, leads)
    };
  }

  function filterBarHtml() {
    var accounts = uniqSorted(adRows.map(function (r) { return r.account_name; }));
    var campaigns = uniqSorted(adRows.map(function (r) { return r.campaign_name; }));
    var specialties = uniqSorted(adRows.map(function (r) { return r.specialty; }));
    var objectives = uniqSorted(adRows.map(function (r) { return r.objective; }));
    var statuses = uniqSorted(adRows.map(function (r) { return r.status; }));
    function opts(list, current) {
      return '<option value="">الكل</option>' + list.map(function (v) {
        return '<option value="' + escapeHtml(v) + '" ' + (current === v ? "selected" : "") + '>' + escapeHtml(v) + '</option>';
      }).join("");
    }
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
      '<div class="field"><label style="font-size:11px;">الحساب</label><select id="ma-f-account">' + opts(accounts, filters.account) + '</select></div>' +
      '<div class="field"><label style="font-size:11px;">الحملة</label><select id="ma-f-campaign">' + opts(campaigns, filters.campaign) + '</select></div>' +
      '<div class="field"><label style="font-size:11px;">التخصص</label><select id="ma-f-specialty">' + opts(specialties, filters.specialty) + '</select></div>' +
      '<div class="field"><label style="font-size:11px;">الهدف (Objective)</label><select id="ma-f-objective">' + opts(objectives, filters.objective) + '</select></div>' +
      '<div class="field"><label style="font-size:11px;">الحالة</label><select id="ma-f-status">' + opts(statuses, filters.status) + '</select></div>' +
      '<div class="field"><label style="font-size:11px;">من تاريخ البدء</label><input type="date" id="ma-f-date" value="' + escapeHtml(filters.fromDate) + '"></div>' +
      '<button class="btn ghost sm" id="ma-f-reset">تصفير الفلاتر</button>' +
      '</div>';
  }

  function kpiSectionHtml(k) {
    return '<div class="kpi-grid">' +
      kpiCard("إجمالي الإنفاق", fmtMoney(k.spend)) +
      kpiCard("عدد الإعلانات", fmtNum(k.adsCount)) +
      kpiCard("عدد الحملات", fmtNum(k.campaignCount)) +
      kpiCard("الوصول (Reach)", fmtNum(k.reach)) +
      kpiCard("الظهور (Impressions)", fmtNum(k.impressions)) +
      kpiCard("النقرات", fmtNum(k.clicks)) +
      kpiCard("محادثات ماسنجر", fmtNum(k.msgConv)) +
      kpiCard("بيانات تواصل (Leads)", fmtNum(k.leads)) +
      kpiCard("تكلفة المحادثة", k.costPerMsg == null ? "—" : fmtMoney(k.costPerMsg)) +
      kpiCard("تكلفة الـ Lead", k.costPerLead == null ? "—" : fmtMoney(k.costPerLead)) +
      '</div>';
  }

  function specialtyTableHtml() {
    if (!specialtyRows.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد بيانات.</p>';
    var html = '<div style="max-height:360px;overflow:auto;"><table class="simple"><thead><tr>' +
      '<th>التخصص</th><th>الهدف</th><th>إعلانات</th><th>الإنفاق</th><th>محادثات</th><th>Leads</th>' +
      '<th>تكلفة المحادثة</th><th>CPL</th><th>CTR</th><th>CPC</th><th>CPM</th></tr></thead><tbody>';
    specialtyRows.forEach(function (r) {
      html += '<tr><td>' + escapeHtml(r.specialty) + '</td><td>' + escapeHtml(r.objective) + '</td>' +
        '<td>' + fmtNum(r.ads) + '</td><td>' + fmtMoney(r.spend) + '</td><td>' + fmtNum(r.msg_conv) + '</td><td>' + fmtNum(r.leads) + '</td>' +
        '<td>' + (r.weighted_cost_per_msg_conv == null ? "—" : fmtMoney(r.weighted_cost_per_msg_conv)) + '</td>' +
        '<td>' + (r.weighted_cost_per_lead == null ? "—" : fmtMoney(r.weighted_cost_per_lead)) + '</td>' +
        '<td>' + (r.ctr_pct == null ? "—" : r.ctr_pct + "%") + '</td>' +
        '<td>' + (r.cpc == null ? "—" : fmtMoney(r.cpc)) + '</td>' +
        '<td>' + (r.cpm == null ? "—" : fmtMoney(r.cpm)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function creativeTableHtml() {
    if (!creativeRows.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد بيانات.</p>';
    var html = '<div style="max-height:360px;overflow:auto;"><table class="simple"><thead><tr>' +
      '<th>Creative Group</th><th>التخصص</th><th>Hook</th><th>الزاوية</th><th>النوع</th><th>مرّات التشغيل</th>' +
      '<th>الإنفاق</th><th>النتائج</th><th>محادثات</th><th>Leads</th><th>تكلفة النتيجة</th><th>المحتوى المرتبط</th></tr></thead><tbody>';
    creativeRows.forEach(function (r) {
      html += '<tr><td style="font-size:11px;">' + escapeHtml(r.creative_group_id) + '</td><td>' + escapeHtml(r.specialty) + '</td>' +
        '<td>' + escapeHtml(r.hook_type) + '</td><td>' + escapeHtml(r.content_angle) + '</td><td>' + escapeHtml(r.creative_type) + '</td>' +
        '<td>' + fmtNum(r.runs) + '</td><td>' + fmtMoney(r.spend) + '</td><td>' + fmtNum(r.results) + '</td>' +
        '<td>' + fmtNum(r.msg_conv) + '</td><td>' + fmtNum(r.leads) + '</td>' +
        '<td>' + (r.weighted_cost_per_result == null ? "—" : fmtMoney(r.weighted_cost_per_result)) + '</td>' +
        '<td>' + contentLinkCellHtml(contentByGroupId[r.creative_group_id]) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function adsTableHtml(rows) {
    if (!rows.length) return '<p style="color:var(--c-muted);font-size:13px;">لا توجد إعلانات مطابقة للفلاتر.</p>';
    var html = '<div style="max-height:460px;overflow:auto;"><table class="simple"><thead><tr>' +
      '<th>الحملة</th><th>المجموعة الإعلانية</th><th>الإعلان</th><th>الكرييتف</th><th>التخصص</th><th>الهدف</th>' +
      '<th>الإنفاق</th><th>الوصول</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>CPC</th><th>CPM</th>' +
      '<th>محادثات</th><th>تكلفة المحادثة</th><th>Leads</th><th>CPL</th><th>الحالة</th><th>المحتوى المرتبط</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td style="font-size:11px;">' + escapeHtml(r.campaign_name) + '</td><td style="font-size:11px;">' + escapeHtml(r.adset_name) + '</td>' +
        '<td style="font-size:11px;">' + escapeHtml(r.ad_name) + '</td><td style="font-size:11px;">' + escapeHtml(r.creative_title) + '</td>' +
        '<td>' + escapeHtml(r.specialty) + '</td><td>' + escapeHtml(r.objective) + '</td>' +
        '<td>' + fmtMoney(r.spend) + '</td><td>' + fmtNum(r.reach) + '</td><td>' + fmtNum(r.impressions) + '</td><td>' + fmtNum(r.clicks) + '</td>' +
        '<td>' + fmtPct(r.ctr) + '</td><td>' + (r.cpc == null ? "—" : fmtMoney(r.cpc)) + '</td><td>' + (r.cpm == null ? "—" : fmtMoney(r.cpm)) + '</td>' +
        '<td>' + fmtNum(r.msg_conv) + '</td><td>' + (r.cost_per_msg_conv == null ? "—" : fmtMoney(r.cost_per_msg_conv)) + '</td>' +
        '<td>' + fmtNum(r.leads) + '</td><td>' + (r.cost_per_lead == null ? "—" : fmtMoney(r.cost_per_lead)) + '</td>' +
        '<td>' + escapeHtml(r.status) + '</td><td>' + contentLinkCellHtml(contentByAdId[r.ad_id]) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function leadAttributionHtml() {
    var total = leadRows.length;
    var attributed = leadRows.filter(function (l) { return l.matched_meta_ad_id; }).length;
    var recent = leadRows.filter(function (l) { return l.matched_meta_ad_id; }).slice(0, 30);
    var html = '<div class="kpi-grid">' +
      kpiCard("إجمالي الليدز", fmtNum(total)) +
      kpiCard("ليدز مرتبطة بإعلان Meta", fmtNum(attributed)) +
      kpiCard("ليدز من غير إسناد", fmtNum(total - attributed)) +
      '</div>';
    html += '<p style="font-size:12px;color:var(--c-muted);margin:8px 0;">الإسناد بيعتمد على عمود meta_ad_id على الليد (ما بيتحطش تلقائي على الليدز القديمة) — الليدز من غير إسناد فضلت زي ما هي وظاهرة عادي في تاب «إدارة الليدز والتواصل».</p>';
    if (recent.length) {
      html += '<div style="max-height:300px;overflow:auto;"><table class="simple"><thead><tr><th>العميل</th><th>تاريخ الاستلام</th><th>الإعلان</th><th>الحملة</th><th>التخصص</th></tr></thead><tbody>';
      recent.forEach(function (l) {
        html += '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + fmtDate(l.received_at) + '</td>' +
          '<td style="font-size:11px;">' + escapeHtml(l.matched_ad_name) + '</td>' +
          '<td style="font-size:11px;">' + escapeHtml(l.matched_campaign_name) + '</td>' +
          '<td>' + escapeHtml(l.matched_specialty) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    return html;
  }

  function renderFilteredParts() {
    var filtered = applyFilters(adRows);
    var kpiBox = document.getElementById("ma-kpis");
    var tableBox = document.getElementById("ma-ads-table");
    if (kpiBox) kpiBox.innerHTML = kpiSectionHtml(computeKpis(filtered));
    if (tableBox) { tableBox.innerHTML = adsTableHtml(filtered); wireGotoContentButtons(tableBox); }
  }

  function wireFilters() {
    var ids = ["account", "campaign", "specialty", "objective", "status"];
    ids.forEach(function (k) {
      var el = document.getElementById("ma-f-" + k);
      if (el) el.onchange = function () { filters[k] = el.value; renderFilteredParts(); };
    });
    var dateEl = document.getElementById("ma-f-date");
    if (dateEl) dateEl.onchange = function () { filters.fromDate = dateEl.value; renderFilteredParts(); };
    var resetBtn = document.getElementById("ma-f-reset");
    if (resetBtn) resetBtn.onclick = function () {
      filters = { account: "", campaign: "", specialty: "", objective: "", status: "", fromDate: "" };
      render(document.getElementById("view-container"));
    };
  }

  function renderAll(el) {
    var filtered = applyFilters(adRows);
    var html = '<div class="section"><h3>إعلانات Meta Ads</h3>' + filterBarHtml() +
      '<div id="ma-kpis">' + kpiSectionHtml(computeKpis(filtered)) + '</div></div>' +
      '<div class="section"><h3>الأداء حسب التخصص</h3>' + specialtyTableHtml() + '</div>' +
      '<div class="section"><h3>أداء الكرييتف (حسب Creative Group)</h3>' + creativeTableHtml() + '</div>' +
      '<div class="section"><h3>تفاصيل الإعلانات</h3><div id="ma-ads-table">' + adsTableHtml(filtered) + '</div></div>' +
      '<div class="section"><h3>إسناد الليدز لإعلانات Meta</h3>' + leadAttributionHtml() + '</div>' +
      '<div class="section"><h3>الربط بالمحتوى</h3>' +
      '<p style="font-size:12px;color:var(--c-muted);">الربط بيتم يدويًا من مودال المادة نفسها (تابات إنتاج المحتوى/إدارة المحتوى/التصميم — قسم «أداء إعلانات Meta»). ' +
      'لما مادة تبقى مرتبطة، اسمها بيظهر في عمود «المحتوى المرتبط» بجداول الكرييتف والإعلانات فوق — دوس عليه للفتح.</p></div>';
    el.innerHTML = html;
    wireFilters();
    wireGotoContentButtons(el);
  }

  function render(el) {
    el.innerHTML = '<div class="loading">بيحمّل بيانات Meta Ads…</div>';
    Promise.all([
      window.SSMPDDb.listMetaAdPerformance(),
      window.SSMPDDb.listMetaSpecialtyPerformance(),
      window.SSMPDDb.listMetaCreativePerformance(),
      window.SSMPDDb.listMetaLeadAttribution(),
      window.SSMPDDb.listContentMetaPerformance()
    ]).then(function (res) {
      adRows = res[0] || []; specialtyRows = res[1] || []; creativeRows = res[2] || []; leadRows = res[3] || [];
      contentLinkRows = res[4] || []; buildContentLinkMaps();
      renderAll(el);
    }).catch(function (e) {
      el.innerHTML = '<div class="section"><p style="color:var(--c-negative);">تعذّر تحميل بيانات Meta Ads: ' + escapeHtml(e.message || e) + '</p></div>';
    });
  }

  window.SSMPDRenderMetaAds = { render: render };
})();
