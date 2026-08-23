/* SSMPD — قطاع إدارة الليدز والتواصل مع العملاء: شاشات داخلية (استقبال / خدمة عملاء /
   داشبورد الإدارة / الحجوزات الفعلية / أرشيف الليدز / رفع إكسيل جماعي) — كل عملية حساسة
   بتعدّي من Supabase Edge Functions (db.js). */
(function () {
  "use strict";
  var T = window.SSMPDToast;

  var STATUS_LABELS = {
    new: "جديد", in_progress: "قيد المتابعة", booked: "تم الحجز",
    booked_on_system: "تم الحجز على سيستم المركز", service_done: "تم إجراء الخدمة",
    interested_undecided: "مهتم لسه مقررش", rejected: "مرفوض",
    no_response: "لا يوجد رد", invalid_number: "رقم غير صحيح"
  };
  var STATUS_PILL_CLASS = {
    new: "received", in_progress: "approval", booked: "approved",
    booked_on_system: "approved", service_done: "approved",
    interested_undecided: "approval", rejected: "revision",
    no_response: "draft", invalid_number: "revision"
  };
  // الليدز اللي في مرحلة "شغالة" مع الاستقبال (بعد ما خدمة العملاء تخلص وقبل ما
  // الخدمة تتم فعلياً) — رفع فاتورة الخدمة متاح خلالها (نفس ALLOWED_STATUSES_FOR_INVOICE
  // في lead-invoice-upload Edge Function)
  var INVOICE_ALLOWED_STATUSES = ["booked", "booked_on_system", "service_done"];
  var SOURCE_LABELS = { whatsapp: "واتساب", messenger: "ماسنجر" };
  var SERVICE_LABELS = {
    checkup: "كشف", consultation: "استشارة", radiology: "أشعة", lab: "تحاليل", nursing: "تمريض",
    physiotherapy: "علاج طبيعي", treatment: "علاج", dental: "أسنان", speech_therapy: "تخاطب",
    psychiatry: "نفسية", cosmetic_laser: "ليزر تجميل", emergency: "طوارئ", other: "أخرى"
  };
  var PRIORITY_LABELS = { high: "عالية", medium: "متوسطة", normal: "عادية" };
  var RESULT_LABELS = { answered: "تم الرد", no_answer: "لا يوجد رد", busy: "مشغول", call_back_later: "اتصال لاحقاً", other: "أخرى" };
  // "booked"/"booked_on_system" بقوا حالات "لسه شغالة" (مش مغلقة) بعد إضافة خطوة
  // الاستقبال — الإقفال الفعلي بقى بس عند "تم إجراء الخدمة" أو أي حالة رفض/عدم رد
  var CLOSED_STATUSES = ["service_done", "rejected", "no_response", "invalid_number"];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return iso; }
  }
  function fmtDateOnly(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" }); }
    catch (e) { return iso; }
  }
  function fmtNum(n) { return (n || 0).toLocaleString("en-US"); }

  var me = null; // window.SSMPDAuth.currentAdmin
  function isManager() { return !!(me && window.SSMPDRoles.hasAnyRole(me, ["general_manager", "super_admin"])); }
  function isReception() { return !!(me && (window.SSMPDRoles.hasRole(me, "reception") || isManager())); }
  function isCS() { return !!(me && (window.SSMPDRoles.hasRole(me, "customer_service") || isManager())); }

  var SUB_SCREENS = [
    { key: "reception", label: "الاستقبال" },
    { key: "cs", label: "خدمة العملاء" },
    { key: "dashboard", label: "داشبورد الإدارة" },
    { key: "booked", label: "الحجوزات الفعلية" },
    { key: "archive", label: "أرشيف الليدز" },
    { key: "bulk", label: "رفع ملف إكسيل" }
  ];

  var state = {
    subTab: null,
    employees: [], employeesLoaded: false,
    cs: { status: "", search: "", openOnly: false, page: 1, pageSize: 20 },
    archive: { status: "", search: "", bookedBy: "", page: 1, pageSize: 20 },
    booked: { search: "", bookedBy: "", page: 1, pageSize: 20 },
    bulk: { rows: [], fileName: "", result: null }
  };

  function visibleSubScreens() {
    return SUB_SCREENS.filter(function (s) {
      if (s.key === "reception") return isReception();
      if (s.key === "cs") return isCS();
      if (s.key === "bulk") return isReception();
      return isManager();
    });
  }

  function ensureEmployees(cb) {
    if (state.employeesLoaded) { cb(); return; }
    window.SSMPDDb.listEmployees().then(function (res) {
      state.employees = res.employees || [];
      state.employeesLoaded = true;
      cb();
    }).catch(function () { state.employees = []; state.employeesLoaded = true; cb(); });
  }
  function employeeName(id) {
    if (!id) return "—";
    var e = state.employees.filter(function (x) { return x.id === id; })[0];
    return e ? e.name : "—";
  }

  function render(container) {
    me = window.SSMPDAuth.currentAdmin;
    var subs = visibleSubScreens();
    if (!state.subTab || !subs.some(function (s) { return s.key === state.subTab; })) {
      if (isReception() && !isManager()) state.subTab = "reception";
      else if (isCS() && !isManager()) state.subTab = "cs";
      else state.subTab = subs[0] ? subs[0].key : "dashboard";
    }

    var html = '<div class="tabs" style="margin-bottom:16px;">' +
      subs.map(function (s) {
        return '<button class="tab-btn ' + (state.subTab === s.key ? "active" : "") + '" data-sub="' + s.key + '">' + s.label + '</button>';
      }).join("") + '</div>';
    html += '<div id="ld-sub-view"></div>';
    container.innerHTML = html;

    container.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        state.subTab = btn.getAttribute("data-sub");
        render(container);
      };
    });

    var subView = document.getElementById("ld-sub-view");
    ensureEmployees(function () {
      if (state.subTab === "reception") renderReceptionScreen(subView, container);
      else if (state.subTab === "cs") renderCsScreen(subView, container);
      else if (state.subTab === "dashboard") renderDashboardScreen(subView, container);
      else if (state.subTab === "booked") renderBookedScreen(subView, container);
      else if (state.subTab === "archive") renderArchiveScreen(subView, container);
      else renderBulkScreen(subView, container);
    });
  }

  // ============ ١) شاشة الاستقبال ============
  function newLeadFormHtml() {
    return '<div class="field"><label>اسم العميل</label><input id="nl-name"></div>' +
      '<div class="field"><label>رقم الهاتف</label><input id="nl-phone" placeholder="01xxxxxxxxx"></div>' +
      '<div class="field"><label>المصدر</label><select id="nl-source"><option value="whatsapp">واتساب</option><option value="messenger">ماسنجر</option></select></div>' +
      '<div class="field"><label>نص الرسالة (اختياري)</label><textarea id="nl-message" rows="2"></textarea></div>' +
      '<div class="field"><label>الخدمة المهتم بيها (اختياري)</label><select id="nl-service"><option value="">— بدون —</option>' +
      Object.keys(SERVICE_LABELS).map(function (k) { return '<option value="' + k + '">' + SERVICE_LABELS[k] + '</option>'; }).join("") + '</select></div>' +
      '<div id="nl-dup-box"></div>';
  }

  function renderReceptionScreen(view, container) {
    var html = '<div class="section"><h3>استقبال رسالة جديدة</h3>' + newLeadFormHtml() +
      '<button class="btn" id="nl-save">حفظ الليد</button></div>' +
      '<div class="section"><h3>آخر الليدز المُضافة</h3><div id="nl-recent"><div class="loading">بيحمّل…</div></div></div>';
    view.innerHTML = html;

    function loadRecent() {
      window.SSMPDDb.listLeads({ page: 1, page_size: 10 }).then(function (res) {
        var leads = res.leads || [];
        var box = document.getElementById("nl-recent");
        if (!leads.length) { box.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش ليدز لسه.</p>'; return; }
        box.innerHTML = '<table class="simple"><thead><tr><th>العميل</th><th>الهاتف</th><th>المصدر</th><th>الحالة</th><th>تاريخ</th></tr></thead><tbody>' +
          leads.map(function (l) {
            return '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + escapeHtml(l.phone_raw || l.phone_normalized || "—") + '</td>' +
              '<td>' + (SOURCE_LABELS[l.source] || l.source) + '</td>' +
              '<td><span class="status-pill ' + (STATUS_PILL_CLASS[l.current_status] || "draft") + '">' + (STATUS_LABELS[l.current_status] || l.current_status) + '</span></td>' +
              '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(l.created_at) + '</td></tr>';
          }).join("") + '</tbody></table>';
      }).catch(function (e) { document.getElementById("nl-recent").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
    }
    loadRecent();

    function submit(extra) {
      var payload = {
        customer_name: document.getElementById("nl-name").value.trim(),
        phone: document.getElementById("nl-phone").value.trim(),
        source: document.getElementById("nl-source").value,
        message_text: document.getElementById("nl-message").value.trim() || undefined,
        interested_service: document.getElementById("nl-service").value || undefined
      };
      if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
      if (!payload.customer_name) { T.show("اكتب اسم العميل", "error"); return; }
      if (!payload.phone) { T.show("اكتب رقم الهاتف", "error"); return; }

      window.SSMPDDb.createLead(payload).then(function (res) {
        if (res.linked_to) { T.show("اترتبطت الرسالة بالليد الموجود"); }
        else { T.show("اتضاف الليد بنجاح"); }
        document.getElementById("nl-name").value = "";
        document.getElementById("nl-phone").value = "";
        document.getElementById("nl-message").value = "";
        document.getElementById("nl-service").value = "";
        document.getElementById("nl-dup-box").innerHTML = "";
        loadRecent();
      }).catch(function (e) {
        if (e.status === 409 && e.data && e.data.duplicate) {
          var dup = e.data.duplicate;
          document.getElementById("nl-dup-box").innerHTML =
            '<div class="err-msg">فيه ليد مفتوح بالفعل بنفس الرقم: <b>' + escapeHtml(dup.customer_name) + '</b> — ' +
            (STATUS_LABELS[dup.current_status] || dup.current_status) + '</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
            '<button class="btn ghost sm" id="nl-link">ربط الرسالة بالليد ده</button>' +
            '<button class="btn danger sm" id="nl-force">تجاهل وإنشاء ليد جديد</button></div>';
          document.getElementById("nl-link").onclick = function () { submit({ link_to_lead_id: dup.id }); };
          document.getElementById("nl-force").onclick = function () { submit({ confirm_duplicate: true }); };
        } else {
          T.show("خطأ: " + e.message, "error");
        }
      });
    }
    document.getElementById("nl-save").onclick = function () { submit(); };
  }

  // ============ ٢) شاشة خدمة العملاء ============
  function renderCsScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    var s = state.cs;
    window.SSMPDDb.listLeads({
      status: s.status || undefined, search: s.search || undefined,
      open_only: s.openOnly ? "true" : undefined, page: s.page, page_size: s.pageSize
    }).then(function (res) {
      var leads = res.leads || [];
      var total = res.total || 0;
      var totalPages = Math.max(1, Math.ceil(total / s.pageSize));

      var html = '<div class="section">';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
        '<input id="cs-search" placeholder="بحث بالاسم / الهاتف" value="' + escapeHtml(s.search) + '" style="flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<select id="cs-status"><option value="">كل الحالات</option>' +
        Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '" ' + (s.status === k ? "selected" : "") + '>' + STATUS_LABELS[k] + '</option>'; }).join("") +
        '</select>' +
        '<label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="cs-open-only" ' + (s.openOnly ? "checked" : "") + '> المفتوحة بس</label>' +
        '<button class="btn ghost sm" id="cs-search-btn">بحث</button></div>';

      if (!leads.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش ليدز مطابقة.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>العميل</th><th>الهاتف</th><th>المصدر</th><th>الحالة</th><th>معاد متابعة</th><th></th></tr></thead><tbody>';
        leads.forEach(function (l) {
          html += '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + escapeHtml(l.phone_raw || l.phone_normalized || "—") + '</td>' +
            '<td>' + (SOURCE_LABELS[l.source] || l.source) + '</td>' +
            '<td><span class="status-pill ' + (STATUS_PILL_CLASS[l.current_status] || "draft") + '">' + (STATUS_LABELS[l.current_status] || l.current_status) + '</span></td>' +
            '<td style="font-size:11px;color:var(--c-muted);">' + (l.next_follow_up_date ? fmtDateOnly(l.next_follow_up_date) : "—") + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + l.id + '">فتح</button></td></tr>';
        });
        html += '</tbody></table>';
        html += pagerHtml("cs", s.page, totalPages, total, "ليد");
      }
      html += '</div>';
      view.innerHTML = html;

      document.getElementById("cs-search-btn").onclick = function () {
        s.search = document.getElementById("cs-search").value.trim();
        s.status = document.getElementById("cs-status").value;
        s.openOnly = document.getElementById("cs-open-only").checked;
        s.page = 1; renderCsScreen(view, container);
      };
      document.getElementById("cs-search").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("cs-search-btn").click(); };
      wirePager(view, "cs", s, totalPages, function () { renderCsScreen(view, container); });
      view.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openLeadModal(view, container, btn.getAttribute("data-open"), function () { renderCsScreen(view, container); }); };
      });
    }).catch(function (e) { view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
  }

  function pagerHtml(prefix, page, totalPages, total, unitLabel) {
    return '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:14px;">' +
      '<button class="btn ghost sm" id="' + prefix + '-prev" ' + (page <= 1 ? "disabled" : "") + '>السابق</button>' +
      '<span style="font-size:12px;color:var(--c-muted);">صفحة ' + page + ' من ' + totalPages + ' (' + fmtNum(total) + ' ' + unitLabel + ')</span>' +
      '<button class="btn ghost sm" id="' + prefix + '-next" ' + (page >= totalPages ? "disabled" : "") + '>التالي</button></div>';
  }
  function wirePager(view, prefix, s, totalPages, rerender) {
    var prevBtn = document.getElementById(prefix + "-prev");
    var nextBtn = document.getElementById(prefix + "-next");
    if (prevBtn) prevBtn.onclick = function () { if (s.page > 1) { s.page--; rerender(); } };
    if (nextBtn) nextBtn.onclick = function () { if (s.page < totalPages) { s.page++; rerender(); } };
  }

  // ============ ٣) داشبورد الإدارة ============
  function renderDashboardScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.getLeadsStats().then(function (res) {
      var html = '<div class="kpi-grid">' +
        '<div class="kpi-card"><div class="label">ليدز مفتوحة</div><div class="value">' + fmtNum(res.open) + '</div></div>' +
        '<div class="kpi-card"><div class="label">ليدز مغلقة</div><div class="value">' + fmtNum(res.closed) + '</div></div>' +
        '<div class="kpi-card"><div class="label">تم الحجز</div><div class="value small">' + fmtNum(res.booked) + '</div></div>' +
        '<div class="kpi-card"><div class="label">إجمالي دخل الفواتير</div><div class="value small">' + fmtNum(res.total_income) + ' ج.م</div></div>' +
        '</div>';

      html += '<div class="section"><h3>توزيع حسب الحالة</h3>';
      var byStatus = res.by_status || {};
      var keys = Object.keys(STATUS_LABELS);
      html += '<table class="simple"><thead><tr><th>الحالة</th><th>العدد</th></tr></thead><tbody>';
      keys.forEach(function (k) {
        html += '<tr><td><span class="status-pill ' + (STATUS_PILL_CLASS[k] || "draft") + '">' + STATUS_LABELS[k] + '</span></td><td>' + fmtNum(byStatus[k] || 0) + '</td></tr>';
      });
      html += '</tbody></table></div>';

      // الدخل من فواتير الليدز مجمّع حسب الموظف اللي أنهى الحجز (booked_by)
      html += '<div class="section"><h3>الدخل حسب الموظف المسؤول عن إتمام الحجز</h3>';
      var byEmp = res.income_by_employee || [];
      if (!byEmp.length) {
        html += '<p style="font-size:13px;color:var(--c-muted);">مفيش فواتير مرفوعة لسه.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>الموظف</th><th>عدد الفواتير</th><th>إجمالي الدخل</th></tr></thead><tbody>';
        byEmp.forEach(function (e) {
          html += '<tr><td>' + escapeHtml(e.employee_name) + '</td><td>' + fmtNum(e.invoices_count) + '</td><td>' + fmtNum(e.total) + ' ج.م</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      view.innerHTML = html;
    }).catch(function (e) { view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
  }

  // ============ ٤) الحجوزات الفعلية ============
  function renderBookedScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    var s = state.booked;
    window.SSMPDDb.listLeads({
      status: "booked", search: s.search || undefined, booked_by: s.bookedBy || undefined,
      page: s.page, page_size: s.pageSize
    }).then(function (res) {
      var leads = res.leads || [];
      var total = res.total || 0;
      var totalPages = Math.max(1, Math.ceil(total / s.pageSize));

      var html = '<div class="section">';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
        '<input id="bk-search" placeholder="بحث بالاسم / الهاتف" value="' + escapeHtml(s.search) + '" style="flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<select id="bk-employee"><option value="">كل الموظفين</option>' +
        state.employees.map(function (e) { return '<option value="' + e.id + '" ' + (s.bookedBy === e.id ? "selected" : "") + '>' + escapeHtml(e.name) + '</option>'; }).join("") +
        '</select>' +
        '<button class="btn ghost sm" id="bk-search-btn">بحث</button></div>';

      if (!leads.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش حجوزات مطابقة.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>العميل</th><th>الهاتف</th><th>رقم الحجز</th><th>تاريخ الحجز</th><th>أنهى الحجز</th><th></th></tr></thead><tbody>';
        leads.forEach(function (l) {
          html += '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + escapeHtml(l.phone_raw || l.phone_normalized || "—") + '</td>' +
            '<td>' + escapeHtml(l.booking_reference || "—") + '</td>' +
            '<td style="font-size:11px;color:var(--c-muted);">' + fmtDateOnly(l.booking_date) + '</td>' +
            '<td style="font-size:11px;">' + escapeHtml(employeeName(l.booked_by)) + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + l.id + '">فتح</button></td></tr>';
        });
        html += '</tbody></table>';
        html += pagerHtml("bk", s.page, totalPages, total, "حجز");
      }
      html += '</div>';
      view.innerHTML = html;

      document.getElementById("bk-search-btn").onclick = function () {
        s.search = document.getElementById("bk-search").value.trim();
        s.bookedBy = document.getElementById("bk-employee").value;
        s.page = 1; renderBookedScreen(view, container);
      };
      document.getElementById("bk-search").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("bk-search-btn").click(); };
      wirePager(view, "bk", s, totalPages, function () { renderBookedScreen(view, container); });
      view.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openLeadModal(view, container, btn.getAttribute("data-open"), function () { renderBookedScreen(view, container); }); };
      });
    }).catch(function (e) { view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
  }

  // ============ ٥) أرشيف الليدز ============
  function renderArchiveScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    var s = state.archive;
    window.SSMPDDb.listLeads({
      status: s.status || undefined, search: s.search || undefined, booked_by: s.bookedBy || undefined,
      page: s.page, page_size: s.pageSize
    }).then(function (res) {
      var leads = res.leads || [];
      var total = res.total || 0;
      var totalPages = Math.max(1, Math.ceil(total / s.pageSize));

      var html = '<div class="section">';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
        '<input id="ar-search" placeholder="بحث بالاسم / الهاتف" value="' + escapeHtml(s.search) + '" style="flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<select id="ar-status"><option value="">كل الحالات</option>' +
        Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '" ' + (s.status === k ? "selected" : "") + '>' + STATUS_LABELS[k] + '</option>'; }).join("") +
        '</select>' +
        '<select id="ar-employee"><option value="">كل الموظفين (الحجز)</option>' +
        state.employees.map(function (e) { return '<option value="' + e.id + '" ' + (s.bookedBy === e.id ? "selected" : "") + '>' + escapeHtml(e.name) + '</option>'; }).join("") +
        '</select>' +
        '<button class="btn ghost sm" id="ar-search-btn">بحث</button></div>';

      if (!leads.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش ليدز مطابقة.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>العميل</th><th>الهاتف</th><th>المصدر</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead><tbody>';
        leads.forEach(function (l) {
          html += '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + escapeHtml(l.phone_raw || l.phone_normalized || "—") + '</td>' +
            '<td>' + (SOURCE_LABELS[l.source] || l.source) + '</td>' +
            '<td><span class="status-pill ' + (STATUS_PILL_CLASS[l.current_status] || "draft") + '">' + (STATUS_LABELS[l.current_status] || l.current_status) + '</span></td>' +
            '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(l.created_at) + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + l.id + '">فتح</button></td></tr>';
        });
        html += '</tbody></table>';
        html += pagerHtml("ar", s.page, totalPages, total, "ليد");
      }
      html += '</div>';
      view.innerHTML = html;

      document.getElementById("ar-search-btn").onclick = function () {
        s.search = document.getElementById("ar-search").value.trim();
        s.status = document.getElementById("ar-status").value;
        s.bookedBy = document.getElementById("ar-employee").value;
        s.page = 1; renderArchiveScreen(view, container);
      };
      document.getElementById("ar-search").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("ar-search-btn").click(); };
      wirePager(view, "ar", s, totalPages, function () { renderArchiveScreen(view, container); });
      view.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openLeadModal(view, container, btn.getAttribute("data-open"), function () { renderArchiveScreen(view, container); }); };
      });
    }).catch(function (e) { view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
  }

  // ============ ٦) رفع ملف إكسيل جماعي ============
  function renderBulkScreen(view, container) {
    var html = '<div class="section"><h3>رفع مجموعة ليدز من ملف إكسيل</h3>' +
      '<p style="font-size:12px;color:var(--c-muted);margin-bottom:12px;">الأعمدة المتوقعة: اسم العميل، رقم الهاتف، المصدر (واتساب/ماسنجر)، الخدمة (اختياري)، ملاحظات (اختياري). أول صف لازم يكون عناوين الأعمدة.</p>' +
      '<input type="file" id="bk-file" accept=".xlsx,.xls,.csv">' +
      '<div id="bk-preview" style="margin-top:14px;"></div></div>';
    view.innerHTML = html;

    document.getElementById("bk-file").onchange = function (e) {
      var file = e.target.files[0];
      if (!file) return;
      if (typeof XLSX === "undefined") {
        T.show("مكتبة قراءة الإكسيل لسه مش متحمّلة — جرب تعمل ريفريش للصفحة", "error");
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var wb = XLSX.read(ev.target.result, { type: "array" });
          var sheet = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          state.bulk.rows = rows;
          state.bulk.fileName = file.name;
          state.bulk.result = null;
          renderPreview();
        } catch (err) {
          T.show("تعذّر قراءة الملف: " + err.message, "error");
        }
      };
      reader.readAsArrayBuffer(file);
    };

    function renderPreview() {
      var box = document.getElementById("bk-preview");
      var rows = state.bulk.rows;
      if (!rows.length) { box.innerHTML = ""; return; }
      var cols = Object.keys(rows[0]);
      var html2 = '<p style="font-size:12px;">' + escapeHtml(state.bulk.fileName) + ' — ' + fmtNum(rows.length) + ' صف</p>';
      html2 += '<div class="section" style="max-height:260px;overflow:auto;"><table class="simple"><thead><tr>' +
        cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join("") + '</tr></thead><tbody>' +
        rows.slice(0, 30).map(function (r) {
          return '<tr>' + cols.map(function (c) { return '<td>' + escapeHtml(r[c]) + '</td>'; }).join("") + '</tr>';
        }).join("") + '</tbody></table></div>';
      if (rows.length > 30) html2 += '<p style="font-size:11px;color:var(--c-muted);">وعرض أول ٣٠ صف بس — كل الصفوف هتترفع فعلياً.</p>';
      html2 += '<button class="btn" id="bk-submit" style="margin-top:10px;">رفع الكل (' + fmtNum(rows.length) + ' ليد)</button>';
      html2 += '<div id="bk-result" style="margin-top:14px;"></div>';
      box.innerHTML = html2;

      document.getElementById("bk-submit").onclick = function () {
        var btn = document.getElementById("bk-submit");
        btn.disabled = true; btn.textContent = "بيرفع…";
        window.SSMPDDb.bulkCreateLeads(rows).then(function (res) {
          state.bulk.result = res;
          var resBox = document.getElementById("bk-result");
          var html3 = '<div class="section"><h3>النتيجة</h3>' +
            '<p>تم إنشاء <b>' + fmtNum(res.created_count) + '</b> ليد، وتم تخطي <b>' + fmtNum(res.skipped_count) + '</b> صف.</p>';
          if (res.skipped && res.skipped.length) {
            html3 += '<table class="simple"><thead><tr><th>الصف</th><th>السبب</th></tr></thead><tbody>' +
              res.skipped.map(function (sk) { return '<tr><td>' + fmtNum(sk.row) + '</td><td>' + escapeHtml(sk.reason) + '</td></tr>'; }).join("") +
              '</tbody></table>';
          }
          html3 += '</div>';
          resBox.innerHTML = html3;
          T.show("خلص الرفع الجماعي");
          btn.disabled = false; btn.textContent = "رفع الكل (" + fmtNum(rows.length) + " ليد)";
        }).catch(function (e) {
          T.show("خطأ: " + e.message, "error");
          btn.disabled = false; btn.textContent = "رفع الكل (" + fmtNum(rows.length) + " ليد)";
        });
      };
    }
    renderPreview();
  }

  // ============ مودال تفاصيل الليد (مشترك بين كل الشاشات) ============
  function openLeadModal(view, container, leadId, onChange) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function reload() {
      window.SSMPDDb.client.from("leads").select("*").eq("id", leadId).single().then(function (res) {
        if (res.error) throw res.error;
        var lead = res.data;
        var calls = [window.SSMPDDb.listLeadAttempts(leadId), window.SSMPDDb.listLeadStatusLog(leadId)];
        if (INVOICE_ALLOWED_STATUSES.indexOf(lead.current_status) !== -1) calls.push(window.SSMPDDb.listLeadInvoices(leadId));
        return Promise.all(calls).then(function (r) {
          return { lead: lead, attempts: r[0] || [], statusLog: r[1] || [], invoices: r[2] || [] };
        });
      }).then(function (data) {
        renderLeadModal(backdrop, view, container, data, onChange);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();

    function renderLeadModal(backdrop, view, container, data, onChange) {
      var lead = data.lead, attempts = data.attempts, statusLog = data.statusLog, invoices = data.invoices;
      var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(lead.customer_name) + '</h3><button class="modal-close">×</button></div>';
      html += '<div class="status-pill ' + (STATUS_PILL_CLASS[lead.current_status] || "draft") + '" id="lm-pill" style="margin-bottom:12px;">' + (STATUS_LABELS[lead.current_status] || lead.current_status) + '</div>';
      html += '<p style="font-size:13px;line-height:1.9;">' +
        'الهاتف: <b>' + escapeHtml(lead.phone_raw || lead.phone_normalized || "—") + '</b><br>' +
        'المصدر: ' + (SOURCE_LABELS[lead.source] || lead.source) + '<br>' +
        'مريض: ' + (lead.patient_type === "existing" ? "قديم" : "جديد") + '<br>' +
        (lead.interested_service ? ('مهتم بـ: ' + (SERVICE_LABELS[lead.interested_service] || lead.interested_service) + '<br>') : '') +
        (lead.message_text ? ('الرسالة: ' + escapeHtml(lead.message_text) + '<br>') : '') +
        (lead.assigned_to ? ('مُسند لـ: ' + escapeHtml(employeeName(lead.assigned_to)) + '<br>') : '') +
        'تاريخ الاستلام: ' + fmtDate(lead.created_at) +
        '</p>';

      // تحديث الحالة والأولوية وتفاصيل الحجز
      html += '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
        '<div><label>الحالة</label><select id="lm-status">' +
        Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '" ' + (k === lead.current_status ? "selected" : "") + '>' + STATUS_LABELS[k] + '</option>'; }).join("") +
        '</select></div>' +
        '<div><label>الأولوية</label><select id="lm-priority">' +
        Object.keys(PRIORITY_LABELS).map(function (k) { return '<option value="' + k + '" ' + (k === lead.priority ? "selected" : "") + '>' + PRIORITY_LABELS[k] + '</option>'; }).join("") +
        '</select></div>' +
        '<div id="lm-booking-wrap" style="display:' + (INVOICE_ALLOWED_STATUSES.indexOf(lead.current_status) !== -1 ? "flex" : "none") + ';gap:8px;">' +
        '<div><label>رقم/مرجع الحجز</label><input id="lm-booking" value="' + escapeHtml(lead.booking_reference || "") + '" style="width:140px;"></div>' +
        '<div><label>تاريخ الحجز</label><input id="lm-booking-date" type="date" value="' + (lead.booking_date || "") + '"></div></div>' +
        '<button class="btn ghost sm" id="lm-save-status">حفظ</button></div>' +
        '<div id="lm-status-err" class="err-msg" style="display:none;margin-bottom:10px;"></div>';

      // تسجيل محاولة تواصل جديدة
      html += '<div class="field" style="border-top:1px solid var(--c-border);padding-top:14px;">' +
        '<label>تسجيل محاولة تواصل</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
        '<select id="at-result">' + Object.keys(RESULT_LABELS).map(function (k) { return '<option value="' + k + '">' + RESULT_LABELS[k] + '</option>'; }).join("") + '</select>' +
        '<input id="at-notes" placeholder="ملاحظات (اختياري)" style="flex:1;min-width:160px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<input id="at-followup" type="date" title="معاد متابعة جاي (اختياري)">' +
        '<button class="btn sm" id="at-save">تسجيل</button></div></div>';

      // سجل المحاولات (يوضّح الموظف اللي تعامل + حالة الليد وقت المحاولة)
      html += '<div style="border-top:1px solid var(--c-border);padding-top:14px;margin-top:6px;"><label style="font-size:12px;color:var(--c-muted);display:block;margin-bottom:8px;">سجل المحاولات (' + attempts.length + ')</label>';
      if (!attempts.length) {
        html += '<p style="font-size:12px;color:var(--c-muted);">مفيش محاولات مسجّلة لسه.</p>';
      } else {
        attempts.forEach(function (a) {
          html += '<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--c-border);">' +
            '<b>' + (RESULT_LABELS[a.result] || a.result) + '</b> — ' + escapeHtml(employeeName(a.employee_id)) + ' — ' + fmtDate(a.attempt_date) +
            (a.status_at_attempt ? ('<br><span style="color:var(--c-muted);">حالة الليد وقتها: ' + (STATUS_LABELS[a.status_at_attempt] || a.status_at_attempt) + '</span>') : '') +
            (a.notes ? ('<br><span style="color:var(--c-muted);">' + escapeHtml(a.notes) + '</span>') : '') + '</div>';
        });
      }
      html += '</div>';

      // سجل تغييرات الحالة (Audit trail)
      html += '<div style="border-top:1px solid var(--c-border);padding-top:14px;margin-top:6px;"><label style="font-size:12px;color:var(--c-muted);display:block;margin-bottom:8px;">سجل تغييرات الحالة (' + statusLog.length + ')</label>';
      if (!statusLog.length) {
        html += '<p style="font-size:12px;color:var(--c-muted);">مفيش تغييرات مسجّلة لسه.</p>';
      } else {
        statusLog.forEach(function (l) {
          html += '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--c-border);color:var(--c-muted);">' +
            (l.old_status ? (STATUS_LABELS[l.old_status] || l.old_status) + ' ← ' : '') + '<b style="color:var(--c-dark);">' + (STATUS_LABELS[l.new_status] || l.new_status) + '</b>' +
            ' — ' + escapeHtml(employeeName(l.changed_by)) + ' — ' + fmtDate(l.changed_at) + '</div>';
        });
      }
      html += '</div>';

      // فاتورة الخدمة (متاحة من "تم الحجز" لحد "تم إجراء الخدمة") — رفعها هو نفسه
      // اللي بيعمل التحويل التلقائي لملف مريض في الأرشيف (مطابقة بالتليفون وإلا
      // إنشاء مريض جديد) وبيقفل الليد بـ"تم إجراء الخدمة" تلقائياً
      if (INVOICE_ALLOWED_STATUSES.indexOf(lead.current_status) !== -1) {
        html += '<div style="border-top:1px solid var(--c-border);padding-top:14px;margin-top:6px;"><label style="font-size:12px;color:var(--c-muted);display:block;margin-bottom:8px;">فاتورة الخدمة (' + invoices.length + ')</label>';
        if (lead.patient_id) {
          html += '<p style="font-size:12px;color:var(--c-muted);margin-bottom:8px;">✓ اتحوّل لملف مريض في الأرشيف (' + (lead.patient_type === "existing" ? "مريض قديم" : "مريض جديد") + ')</p>';
        }
        if (invoices.length) {
          invoices.forEach(function (inv) {
            html += '<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--c-border);">' +
              '<b>' + fmtNum(inv.amount) + ' ج.م</b>' + (inv.service_name ? (' — ' + escapeHtml(inv.service_name)) : '') +
              '<br><span style="color:var(--c-muted);">' + fmtDate(inv.uploaded_at) + '</span></div>';
          });
        } else {
          html += '<p style="font-size:12px;color:var(--c-muted);">مفيش فاتورة مرفوعة لسه.</p>';
        }
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;">' +
          '<div><label>المبلغ</label><input id="iv-amount" type="number" min="0" step="0.01" style="width:100px;"></div>' +
          '<div><label>اسم الخدمة</label><input id="iv-service" style="width:140px;"></div>' +
          '<div><label>الملف (صورة / PDF / إكسيل)</label><input type="file" id="iv-file" accept="image/*,.pdf,.xlsx,.xls"></div>' +
          '<button class="btn sm" id="iv-save">رفع الفاتورة (وإقفال الخدمة)</button></div>' +
          '<div id="iv-status" style="font-size:12px;color:var(--c-muted);margin-top:6px;"></div></div>';
      }

      html += '</div>';
      backdrop.innerHTML = html;
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };

      var statusSelect = document.getElementById("lm-status");
      var bookingWrap = document.getElementById("lm-booking-wrap");
      statusSelect.onchange = function () { bookingWrap.style.display = INVOICE_ALLOWED_STATUSES.indexOf(statusSelect.value) !== -1 ? "flex" : "none"; };

      document.getElementById("lm-save-status").onclick = function () {
        var errBox = document.getElementById("lm-status-err");
        errBox.style.display = "none";
        var payload = {
          lead_id: lead.id,
          current_status: statusSelect.value,
          priority: document.getElementById("lm-priority").value,
          booking_reference: document.getElementById("lm-booking") ? document.getElementById("lm-booking").value.trim() : "",
          booking_date: document.getElementById("lm-booking-date") ? document.getElementById("lm-booking-date").value : ""
        };
        window.SSMPDDb.updateLeadStatus(payload).then(function () {
          T.show("اتحدّثت بيانات الليد");
          // تصحيح باگ: بدل ما نقفل المودال، بنعيد تحميل بيانات الليد ونعيد رسم المودال
          // في مكانه عشان البادچ (status pill) يتحدّث فعلياً على الفور من غير قفل وفتح
          reload();
          if (onChange) onChange();
        }).catch(function (e) {
          errBox.textContent = "خطأ: " + e.message;
          errBox.style.display = "block";
        });
      };

      document.getElementById("at-save").onclick = function () {
        var payload = {
          lead_id: lead.id,
          result: document.getElementById("at-result").value,
          notes: document.getElementById("at-notes").value.trim() || undefined,
          next_follow_up_date: document.getElementById("at-followup").value || undefined
        };
        window.SSMPDDb.logLeadAttempt(payload).then(function () {
          T.show("اتسجّلت المحاولة");
          reload();
          if (onChange) onChange();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };

      var ivSaveBtn = document.getElementById("iv-save");
      if (ivSaveBtn) {
        ivSaveBtn.onclick = function () {
          var amount = parseFloat(document.getElementById("iv-amount").value);
          var serviceName = document.getElementById("iv-service").value.trim();
          var file = document.getElementById("iv-file").files[0];
          var statusEl = document.getElementById("iv-status");
          if (!amount || amount <= 0) { statusEl.textContent = "اكتب مبلغ صحيح"; return; }
          if (!file) { statusEl.textContent = "اختار ملف الفاتورة"; return; }
          var fd = new FormData();
          fd.append("lead_id", lead.id);
          fd.append("amount", amount);
          if (serviceName) fd.append("service_name", serviceName);
          fd.append("file", file);
          statusEl.textContent = "بيرفع…";
          window.SSMPDDb.uploadLeadInvoice(fd).then(function () {
            T.show("اترفعت الفاتورة");
            reload();
          }).catch(function (e) { statusEl.textContent = "خطأ: " + e.message; });
        };
      }
    }
  }

  window.SSMPDRenderLeads = { render: render };
})();
