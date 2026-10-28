/* SWNW — enhanced missing basic data workflow for Leads. */
(function () {
  "use strict";
  if (window.__SWNWLeadsMissingDataEnhancement) return;
  window.__SWNWLeadsMissingDataEnhancement = true;

  var SERVICE_LABELS = {
    checkup: "كشف", consultation: "استشارة", radiology: "أشعة", lab: "تحاليل", nursing: "تمريض",
    physiotherapy: "علاج طبيعي", treatment: "علاج", dental: "أسنان", speech_therapy: "تخاطب",
    psychiatry: "نفسية", cosmetic_laser: "ليزر تجميل", emergency: "طوارئ", other: "أخرى"
  };
  var STATUS_LABELS = {
    new: "جديد", in_progress: "قيد المتابعة", booked: "تم الحجز", booked_on_system: "تم الحجز على سيستم المركز",
    interested_undecided: "مهتم لسه مقررش", missing_data: "ناقص بيانات"
  };
  var MISSING_LABELS = { name: "الاسم الثلاثي", phone: "رقم التليفون", service: "الخدمة المهتم بها" };
  var state = { filter: "any", search: "", page: 1, pageSize: 20, request: 0 };
  var scheduled = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (_) { return iso; }
  }
  function active() {
    var btn = document.querySelector('.tab-btn.active[data-sub="missing_data"]');
    return !!btn;
  }
  function view() { return document.getElementById("ld-sub-view"); }
  function serviceName(v) { return SERVICE_LABELS[v] || v || "—"; }
  function missingBadges(fields) {
    return (fields || []).map(function (f) {
      return '<span class="swnw-missing-badge">ناقص: ' + esc(MISSING_LABELS[f] || f) + '</span>';
    }).join("");
  }
  function ensureStyles() {
    if (document.getElementById("swnw-missing-data-enhanced-css")) return;
    var st = document.createElement("style");
    st.id = "swnw-missing-data-enhanced-css";
    st.textContent = [
      '.swnw-md-toolbar{display:grid;grid-template-columns:minmax(180px,1fr) minmax(220px,1.3fr) auto;gap:10px;align-items:end;margin-top:14px}',
      '.swnw-md-toolbar label{font-size:12px;color:var(--c-muted);font-weight:700}',
      '.swnw-md-toolbar input,.swnw-md-toolbar select{width:100%;margin-top:6px}',
      '.swnw-md-summary{font-size:12px;color:var(--c-muted);margin:10px 0 0}',
      '.swnw-md-list{display:grid;gap:12px;margin-top:14px}',
      '.swnw-md-card{border:1px solid var(--c-border);border-radius:16px;background:var(--c-surface,#fff);padding:14px}',
      '.swnw-md-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.swnw-md-name{font-weight:900;font-size:17px;color:var(--c-text);line-height:1.5}',
      '.swnw-md-status{font-size:11px;font-weight:800;color:#0f369d;background:#eef4ff;border-radius:999px;padding:5px 9px;white-space:nowrap}',
      '.swnw-md-info{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}',
      '.swnw-md-info>div{border:1px solid var(--c-border);border-radius:11px;padding:9px;background:var(--c-bg,#fafbfe);min-width:0}',
      '.swnw-md-info b{display:block;color:var(--c-muted);font-size:10px;margin-bottom:4px}',
      '.swnw-md-info span{font-size:12px;font-weight:700;word-break:break-word}',
      '.swnw-md-missing{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}',
      '.swnw-missing-badge{display:inline-flex;align-items:center;background:#fff4ed;color:#b54708;border:1px solid #fed7aa;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800}',
      '.swnw-md-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}',
      '.swnw-md-pagination{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:14px;flex-wrap:wrap}',
      '.swnw-md-pagination span{font-size:12px;color:var(--c-muted)}',
      '@media(max-width:760px){.swnw-md-toolbar{grid-template-columns:1fr}.swnw-md-toolbar .btn{width:100%}.swnw-md-info{grid-template-columns:1fr 1fr}.swnw-md-head{gap:8px}.swnw-md-name{font-size:16px}}',
      '@media(max-width:420px){.swnw-md-info{grid-template-columns:1fr}.swnw-md-actions .btn{width:100%}}'
    ].join("\n");
    document.head.appendChild(st);
  }

  function filterOptions() {
    var opts = [
      ["any", "كل العملاء ناقصي البيانات"],
      ["name", "ناقص الاسم الثلاثي"],
      ["phone", "ناقص رقم التليفون"],
      ["service", "ناقص الخدمة المهتم بها"],
      ["name_only", "ناقص الاسم فقط"],
      ["phone_only", "ناقص رقم التليفون فقط"],
      ["service_only", "ناقص الخدمة فقط"],
      ["multiple", "ناقص أكثر من بيان"]
    ];
    return opts.map(function (x) { return '<option value="' + x[0] + '"' + (state.filter === x[0] ? " selected" : "") + '>' + x[1] + '</option>'; }).join("");
  }

  function renderKpis(stats) {
    stats = stats || {};
    return '<div class="section"><h3>مؤشرات البيانات الأساسية الناقصة</h3><div class="kpi-grid">' +
      '<div class="kpi-card"><div class="label">إجمالي العملاء الناقصين</div><div class="value">' + (stats.total || 0) + '</div></div>' +
      '<div class="kpi-card"><div class="label">ناقص الاسم الثلاثي</div><div class="value">' + (stats.name || 0) + '</div></div>' +
      '<div class="kpi-card"><div class="label">ناقص رقم التليفون</div><div class="value">' + (stats.phone || 0) + '</div></div>' +
      '<div class="kpi-card"><div class="label">ناقص الخدمة المهتم بها</div><div class="value">' + (stats.service || 0) + '</div></div>' +
      '<div class="kpi-card"><div class="label">ناقص أكثر من بيان</div><div class="value">' + (stats.multiple || 0) + '</div></div>' +
      '<div class="kpi-card"><div class="label">جدد خلال ٢٤ ساعة</div><div class="value">' + (stats.new_24h || 0) + '</div></div>' +
      '</div></div>';
  }

  function renderLeadCard(lead) {
    var fields = lead.missing_fields || [];
    var name = String(lead.customer_name || "").trim();
    var displayName = fields.indexOf("name") >= 0 ? (name && name !== "بدون اسم" ? name + ' <span style="color:#b54708;font-size:11px;">(غير ثلاثي)</span>' : "اسم غير مكتمل") : name;
    var phone = lead.phone_raw || lead.phone_normalized || "—";
    var actionLabel = lead.current_status === "missing_data" ? "استكمال البيانات" : "فتح واستكمال";
    return '<article class="swnw-md-card" data-missing-lead-card="' + esc(lead.id) + '">' +
      '<div class="swnw-md-head"><div class="swnw-md-name">' + displayName + '</div><span class="swnw-md-status">' + esc(STATUS_LABELS[lead.current_status] || lead.current_status || "—") + '</span></div>' +
      '<div class="swnw-md-info">' +
        '<div><b>رقم التليفون</b><span>' + esc(phone) + '</span></div>' +
        '<div><b>الخدمة المهتم بها</b><span>' + esc(serviceName(lead.interested_service)) + '</span></div>' +
        '<div><b>المصدر</b><span>' + esc(lead.source || "—") + '</span></div>' +
        '<div><b>تاريخ الإضافة</b><span>' + esc(fmtDate(lead.created_at)) + '</span></div>' +
      '</div>' +
      '<div class="swnw-md-missing">' + missingBadges(fields) + '</div>' +
      '<div class="swnw-md-actions"><button class="btn sm" type="button" data-missing-open="' + esc(lead.id) + '" data-status="' + esc(lead.current_status || "") + '">' + actionLabel + '</button></div>' +
    '</article>';
  }

  function draw(target, res) {
    if (!active() || target !== view()) return;
    var leads = res.leads || [], total = res.total || 0, stats = res.stats || {};
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages && total) { state.page = pages; load(target); return; }
    var html = '<div data-missing-data-enhanced="1">' + renderKpis(stats) +
      '<div class="section"><h3>قائمة العملاء ناقصي البيانات</h3>' +
        '<div class="swnw-md-toolbar">' +
          '<label>فلتر البيانات الناقصة<select id="swnw-md-filter">' + filterOptions() + '</select></label>' +
          '<label>بحث بالاسم أو رقم التليفون<input id="swnw-md-search" value="' + esc(state.search) + '" placeholder="اكتب اسم العميل أو الرقم"></label>' +
          '<button class="btn" id="swnw-md-search-btn" type="button">تطبيق</button>' +
        '</div>' +
        '<div class="swnw-md-summary">النتيجة الحالية: <b>' + total + '</b> عميل</div>';
    if (!leads.length) html += '<div class="empty" style="margin-top:14px;">لا يوجد عملاء مطابقون للفلتر الحالي.</div>';
    else html += '<div class="swnw-md-list">' + leads.map(renderLeadCard).join("") + '</div>';
    if (total > state.pageSize) {
      html += '<div class="swnw-md-pagination"><button class="btn ghost sm" id="swnw-md-prev"' + (state.page <= 1 ? " disabled" : "") + '>السابق</button><span>صفحة ' + state.page + ' من ' + pages + '</span><button class="btn ghost sm" id="swnw-md-next"' + (state.page >= pages ? " disabled" : "") + '>التالي</button></div>';
    }
    html += '</div></div>';
    target.innerHTML = html;
    target.dataset.missingDataEnhanced = "1";

    var filter = document.getElementById("swnw-md-filter");
    if (filter) filter.onchange = function () { state.filter = this.value; state.page = 1; load(target); };
    var search = document.getElementById("swnw-md-search");
    var apply = function () { state.search = search ? search.value.trim() : ""; state.page = 1; load(target); };
    if (search) search.onkeydown = function (e) { if (e.key === "Enter") apply(); };
    var btn = document.getElementById("swnw-md-search-btn"); if (btn) btn.onclick = apply;
    var prev = document.getElementById("swnw-md-prev"); if (prev) prev.onclick = function () { if (state.page > 1) { state.page--; load(target); } };
    var next = document.getElementById("swnw-md-next"); if (next) next.onclick = function () { if (state.page < pages) { state.page++; load(target); } };
    target.querySelectorAll("[data-missing-open]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-missing-open"), status = b.getAttribute("data-status");
        var lead = leads.filter(function (x) { return String(x.id) === String(id); })[0];
        if (!lead) return;
        if (status === "missing_data") openCompleteModal(lead, function () { load(target); });
        else if (window.SSMPDRenderLeads && typeof window.SSMPDRenderLeads.openLeadById === "function") window.SSMPDRenderLeads.openLeadById(id);
      };
    });
  }

  function parseInvokeError(error) {
    if (!error) return Promise.resolve("تعذر حفظ البيانات");
    var fallback = error.message || "تعذر حفظ البيانات";
    try {
      var ctx = error.context;
      if (ctx && typeof ctx.clone === "function") return ctx.clone().json().then(function (body) { return (body && (body.error || body.message)) || fallback; }).catch(function () { return fallback; });
    } catch (_) {}
    return Promise.resolve(fallback);
  }

  function openCompleteModal(lead, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var serviceOptions = '<option value="">— اختار الخدمة —</option>' + Object.keys(SERVICE_LABELS).map(function (k) { return '<option value="' + k + '"' + (lead.interested_service === k ? " selected" : "") + '>' + SERVICE_LABELS[k] + '</option>'; }).join("");
    backdrop.innerHTML = '<div class="modal" style="max-width:460px;"><div class="modal-head"><h3>استكمال البيانات الأساسية</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>الاسم الثلاثي على الأقل<input id="swnw-cmd-name" value="' + esc(lead.customer_name === "بدون اسم" ? "" : lead.customer_name || "") + '" placeholder="الاسم الأول اسم الأب اسم الجد"></label></div>' +
      '<div class="field"><label>رقم التليفون<input id="swnw-cmd-phone" value="' + esc(lead.phone_raw || lead.phone_normalized || "") + '" placeholder="01xxxxxxxxx"></label></div>' +
      '<div class="field"><label>الخدمة المهتم بها<select id="swnw-cmd-service">' + serviceOptions + '</select></label></div>' +
      '<div id="swnw-cmd-error" class="err-msg" style="display:none;"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn ghost" type="button" id="swnw-cmd-cancel">إلغاء</button><button class="btn" type="button" id="swnw-cmd-save">حفظ واستكمال</button></div></div>';
    document.body.appendChild(backdrop);
    function close() { if (backdrop.parentNode) backdrop.remove(); }
    backdrop.querySelector(".modal-close").onclick = close;
    backdrop.querySelector("#swnw-cmd-cancel").onclick = close;
    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    backdrop.querySelector("#swnw-cmd-save").onclick = function () {
      var name = backdrop.querySelector("#swnw-cmd-name").value.trim().replace(/\s+/g, " ");
      var phone = backdrop.querySelector("#swnw-cmd-phone").value.trim();
      var service = backdrop.querySelector("#swnw-cmd-service").value;
      var err = backdrop.querySelector("#swnw-cmd-error");
      if (name.split(" ").filter(Boolean).length < 3) { err.textContent = "اكتب اسم العميل ثلاثي على الأقل"; err.style.display = "block"; return; }
      if (!phone) { err.textContent = "اكتب رقم التليفون"; err.style.display = "block"; return; }
      if (!service) { err.textContent = "اختار الخدمة اللي العميل مهتم بيها"; err.style.display = "block"; return; }
      var save = backdrop.querySelector("#swnw-cmd-save"); save.disabled = true; save.textContent = "بيحفظ…"; err.style.display = "none";
      var client = window.SSMPDDb && window.SSMPDDb.client;
      if (!client || !client.functions) { err.textContent = "اتصال قاعدة البيانات غير متاح"; err.style.display = "block"; save.disabled = false; save.textContent = "حفظ واستكمال"; return; }
      client.functions.invoke("leads-complete-missing-data", { body: { lead_id: lead.id, customer_name: name, phone: phone, interested_service: service } }).then(function (res) {
        if (res.error) return parseInvokeError(res.error).then(function (m) { throw new Error(m); });
        if (res.data && res.data.error) throw new Error(res.data.error);
        if (window.SSMPDToast) window.SSMPDToast.show("تم استكمال بيانات العميل");
        close(); if (onSaved) onSaved();
      }).catch(function (e) {
        err.textContent = "خطأ: " + e.message; err.style.display = "block"; save.disabled = false; save.textContent = "حفظ واستكمال";
      });
    };
  }

  function load(target) {
    if (!target || !active()) return;
    ensureStyles();
    var req = ++state.request;
    target.dataset.missingDataEnhanced = "loading";
    target.innerHTML = '<div class="loading">بيحمّل العملاء ناقصي البيانات…</div>';
    if (!window.SSMPDDb || typeof window.SSMPDDb.listLeads !== "function") return;
    window.SSMPDDb.listLeads({ missing_basic: 1, missing_field: state.filter, search: state.search, page: state.page, page_size: state.pageSize }).then(function (res) {
      if (req !== state.request) return;
      draw(target, res || {});
    }).catch(function (e) {
      if (req !== state.request) return;
      target.dataset.missingDataEnhanced = "error";
      target.innerHTML = '<div class="err-msg">تعذر تحميل العملاء ناقصي البيانات: ' + esc(e.message || e) + '</div>';
    });
  }

  function maybeEnhance() {
    if (!active()) return;
    var target = view();
    if (!target) return;
    if (target.dataset.missingDataEnhanced === "loading") return;
    if (target.dataset.missingDataEnhanced === "1" && target.querySelector("[data-missing-data-enhanced]")) return;
    load(target);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () { scheduled = false; maybeEnhance(); }, 80);
  }
  function start() {
    ensureStyles();
    schedule();
    var root = document.getElementById("app-root") || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
