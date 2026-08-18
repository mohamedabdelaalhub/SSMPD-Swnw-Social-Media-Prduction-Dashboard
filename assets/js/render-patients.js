/* SSMPD — قطاع أرشيف المرضى: ٤ شاشات داخلية (داشبورد عام / رفع ملفات / مراجعة قبل الاعتماد /
   تصفح وفلترة) — كل عملية بتعدّي من Supabase Edge Functions (db.js)، مفيش أي وصول مباشر لـ
   Drive من المتصفح ومفيش أي رابط مشاركة مباشر يوصل للموظف. */
(function () {
  "use strict";
  var T = window.SSMPDToast;

  var CATEGORIES = [
    { key: "id_document", label: "تحقيق شخصية" },
    { key: "insurance", label: "تأمين" },
    { key: "radiology", label: "أشعة" },
    { key: "lab_result", label: "تحاليل" },
    { key: "prescription", label: "وصفة طبية (روشتة)" },
    { key: "eeg", label: "رسم مخ" },
    { key: "other", label: "أخرى" }
  ];
  var REVIEW_LABELS = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" };
  var REVIEW_PILL = { pending: "approval", approved: "approved", rejected: "revision" };

  function categoryLabel(key) {
    var c = CATEGORIES.filter(function (c) { return c.key === key; })[0];
    return c ? c.label : key;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return "—";
    if (n < 1024) return n + " بايت";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " ك.ب";
    return (n / (1024 * 1024)).toFixed(1) + " م.ب";
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return iso; }
  }
  function fmtNum(n) { return (n || 0).toLocaleString("en-US"); }

  var me = null; // window.SSMPDAuth.currentAdmin
  function canReview() { return !!(me && (me.has_archive_review_access || window.SSMPDRoles.hasRole(me, "super_admin"))); }
  function canUpload() { return !!(me && (me.has_archive_access || window.SSMPDRoles.hasRole(me, "super_admin"))); }

  var SUB_SCREENS = [
    { key: "dashboard", label: "الداشبورد العام" },
    { key: "upload", label: "رفع ملف" },
    { key: "review", label: "مراجعة قبل الاعتماد" },
    { key: "browse", label: "تصفح وفلترة" }
  ];

  var state = {
    subTab: "dashboard",
    browseSearch: "", browsePage: 1, browsePageSize: 20,
    reviewFilter: "pending", reviewPage: 1,
    uploadPatient: null, uploadSearch: "", uploadResults: []
  };

  function visibleSubScreens() {
    return SUB_SCREENS.filter(function (s) {
      if (s.key === "upload") return canUpload();
      if (s.key === "review") return canReview();
      return true;
    });
  }

  function render(container) {
    me = window.SSMPDAuth.currentAdmin;
    var subs = visibleSubScreens();
    if (subs.indexOf(state.subTab) === -1 && !subs.some(function (s) { return s.key === state.subTab; })) {
      state.subTab = subs[0] ? subs[0].key : "dashboard";
    }

    var html = '<div class="tabs" style="margin-bottom:16px;">' +
      subs.map(function (s) {
        return '<button class="tab-btn ' + (state.subTab === s.key ? "active" : "") + '" data-sub="' + s.key + '">' + s.label + '</button>';
      }).join("") + '</div>';
    html += '<div id="pt-sub-view"></div>';
    container.innerHTML = html;

    container.querySelectorAll("[data-sub]").forEach(function (btn) {
      btn.onclick = function () {
        state.subTab = btn.getAttribute("data-sub");
        render(container);
      };
    });

    var subView = document.getElementById("pt-sub-view");
    if (state.subTab === "dashboard") renderDashboard(subView, container);
    else if (state.subTab === "upload") renderUploadScreen(subView, container);
    else if (state.subTab === "review") renderReviewScreen(subView, container);
    else renderBrowseScreen(subView, container);
  }

  // ============ ١) الداشبورد العام ============
  function renderDashboard(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.getPatientArchiveStats().then(function (res) {
      var html = '<div class="kpi-grid">' +
        '<div class="kpi-card"><div class="label">إجمالي المرضى</div><div class="value">' + fmtNum(res.total_patients) + '</div></div>' +
        '<div class="kpi-card"><div class="label">إجمالي الملفات</div><div class="value">' + fmtNum(res.total_files) + '</div></div>' +
        '<div class="kpi-card"><div class="label">قيد المراجعة</div><div class="value small">' + fmtNum(res.pending_review) + '</div></div>' +
        '</div>';

      html += '<div class="section"><h3>آخر المرضى المُضافين</h3>';
      var patients = res.recent_patients || [];
      if (!patients.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش إضافات لسه.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>كود المريض</th><th>الاسم</th><th>الهاتف</th><th>تاريخ</th></tr></thead><tbody>';
        patients.forEach(function (p) {
          html += '<tr><td>' + escapeHtml(p.patient_code || "—") + '</td><td>' + escapeHtml(p.full_name) + '</td>' +
            '<td>' + escapeHtml(p.phone || "—") + '</td><td style="font-size:11px;color:var(--c-muted);">' + fmtDate(p.created_at) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      html += '<div class="section"><h3>آخر الملفات المرفوعة</h3>';
      var files = res.recent_files || [];
      if (!files.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش ملفات لسه.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>الملف</th><th>الفئة</th><th>حالة المراجعة</th><th>تاريخ</th></tr></thead><tbody>';
        files.forEach(function (f) {
          html += '<tr><td>' + escapeHtml(f.file_name) + '</td><td>' + categoryLabel(f.category) + '</td>' +
            '<td><span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span></td>' +
            '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(f.uploaded_at) + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      view.innerHTML = html;
    }).catch(function (e) {
      view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  // ============ ٢) شاشة رفع ملف ============
  function renderUploadScreen(view, container) {
    var html = '<div class="section"><h3>اختيار المريض</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">' +
      '<input id="up-search" placeholder="بحث بالاسم / الهاتف / كود المريض" value="' + escapeHtml(state.uploadSearch) + '" style="flex:1;min-width:220px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
      '<button class="btn ghost sm" id="up-search-btn">بحث</button>' +
      '<button class="btn sm" id="up-new-patient-btn">+ مريض جديد</button></div>' +
      '<div id="up-search-results"></div></div>';
    html += '<div id="up-form-wrap"></div>';
    view.innerHTML = html;

    document.getElementById("up-search-btn").onclick = doSearch;
    document.getElementById("up-search").onkeydown = function (e) { if (e.key === "Enter") doSearch(); };
    document.getElementById("up-new-patient-btn").onclick = function () { openNewPatientModal(container, function (patient) { selectPatientForUpload(patient); }); };

    function doSearch() {
      state.uploadSearch = document.getElementById("up-search").value.trim();
      var resBox = document.getElementById("up-search-results");
      resBox.innerHTML = '<div class="loading">بيدوّر…</div>';
      window.SSMPDDb.listPatientsArchive({ search: state.uploadSearch || undefined, page: 1, page_size: 10 })
        .then(function (res) {
          var patients = res.patients || [];
          if (!patients.length) { resBox.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش نتائج.</p>'; return; }
          resBox.innerHTML = patients.map(function (p) {
            return '<button class="btn ghost sm" style="margin:2px;" data-pick="' + p.id + '" data-name="' + escapeHtml(p.full_name) + '" data-code="' + escapeHtml(p.patient_code || "") + '">' +
              escapeHtml(p.full_name) + ' (' + escapeHtml(p.patient_code || "—") + ')</button>';
          }).join("");
          resBox.querySelectorAll("[data-pick]").forEach(function (btn) {
            btn.onclick = function () { selectPatientForUpload({ id: btn.getAttribute("data-pick"), full_name: btn.getAttribute("data-name"), patient_code: btn.getAttribute("data-code") }); };
          });
        }).catch(function (e) { resBox.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>'; });
    }

    function selectPatientForUpload(patient) {
      state.uploadPatient = patient;
      var wrap = document.getElementById("up-form-wrap");
      wrap.innerHTML = '<div class="section"><h3>رفع ملف لـ ' + escapeHtml(patient.full_name) + ' (' + escapeHtml(patient.patient_code || "—") + ')</h3>' +
        '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
        '<div style="flex:1;min-width:140px;"><label>الفئة</label><select id="uf-category">' +
        CATEGORIES.map(function (c) { return '<option value="' + c.key + '">' + c.label + '</option>'; }).join("") +
        '</select></div>' +
        '<div style="flex:2;min-width:180px;"><label>الملف</label><input type="file" id="uf-file"></div>' +
        '<button class="btn sm" id="uf-btn">رفع</button></div>' +
        '<div class="field" id="uf-other-wrap" style="display:none;"><label>وصف نوع الملف</label><input id="uf-other-desc" placeholder="اكتب نوع الملف"></div>' +
        '<div id="uf-status" style="font-size:12px;color:var(--c-muted);"></div></div>';

      var catSelect = document.getElementById("uf-category");
      var otherWrap = document.getElementById("uf-other-wrap");
      function syncOther() { otherWrap.style.display = catSelect.value === "other" ? "" : "none"; }
      catSelect.onchange = syncOther;
      syncOther();

      document.getElementById("uf-btn").onclick = function () {
        var category = catSelect.value;
        var otherDesc = document.getElementById("uf-other-desc").value.trim();
        var file = document.getElementById("uf-file").files[0];
        var statusEl = document.getElementById("uf-status");
        if (!file) { statusEl.textContent = "اختار ملف الأول"; return; }
        if (category === "other" && !otherDesc) { statusEl.textContent = "اكتب وصف نوع الملف"; return; }
        var fd = new FormData();
        fd.append("patient_id", patient.id);
        fd.append("category", category);
        if (category === "other") fd.append("other_description", otherDesc);
        fd.append("file", file);
        statusEl.textContent = "بيرفع…";
        window.SSMPDDb.uploadPatientFile(fd).then(function () {
          T.show("اترفع الملف بنجاح، وهيبقى قيد المراجعة لحد ما مسؤول تاني يعتمده");
          selectPatientForUpload(patient);
        }).catch(function (e) { statusEl.textContent = "خطأ: " + e.message; });
      };
    }
  }

  function openNewPatientModal(container, onCreated) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>مريض جديد</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>الاسم بالكامل</label><input id="np-name"></div>' +
      '<div class="field"><label>رقم الهاتف</label><input id="np-phone" placeholder="01xxxxxxxxx"></div>' +
      '<div class="field"><label>الرقم القومي (اختياري)</label><input id="np-nid" maxlength="14"></div>' +
      '<button class="btn block" id="np-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("np-save").onclick = function () {
      var full_name = document.getElementById("np-name").value.trim();
      var phone = document.getElementById("np-phone").value.trim();
      var national_id = document.getElementById("np-nid").value.trim();
      if (!full_name) { T.show("اكتب اسم المريض", "error"); return; }
      if (!phone) { T.show("اكتب رقم الهاتف", "error"); return; }
      window.SSMPDDb.createPatientArchive({ full_name: full_name, phone: phone, national_id: national_id || undefined })
        .then(function (res) {
          T.show("اتضاف المريض بكود " + (res.patient_code || ""));
          backdrop.remove();
          if (onCreated) onCreated({ id: res.id, full_name: full_name, patient_code: res.patient_code });
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ============ ٣) شاشة المراجعة ============
  function renderReviewScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.listFilesForReview({ review_status: state.reviewFilter, page: state.reviewPage, page_size: 20 })
      .then(function (res) {
        var files = res.files || [];
        var total = res.total || 0;
        var totalPages = Math.max(1, Math.ceil(total / 20));

        var html = '<div class="section">';
        html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">' +
          '<select id="rv-filter">' +
          Object.keys(REVIEW_LABELS).map(function (k) { return '<option value="' + k + '" ' + (state.reviewFilter === k ? "selected" : "") + '>' + REVIEW_LABELS[k] + '</option>'; }).join("") +
          '</select></div>';

        if (!files.length) {
          html += '<p style="color:var(--c-muted);font-size:13px;">مفيش ملفات في الحالة دي.</p>';
        } else {
          html += '<table class="simple"><thead><tr><th>المريض</th><th>الملف</th><th>الفئة</th><th>رافع الملف</th><th>تاريخ الرفع</th><th></th></tr></thead><tbody>';
          files.forEach(function (f) {
            html += '<tr><td>' + escapeHtml((f.patients && f.patients.full_name) || "—") + '</td>' +
              '<td>' + escapeHtml(f.file_name) + (f.category === "other" && f.other_description ? ' — ' + escapeHtml(f.other_description) : '') + '</td>' +
              '<td>' + categoryLabel(f.category) + '</td>' +
              '<td style="font-size:11px;">' + escapeHtml(f.uploaded_by_name || "—") + '</td>' +
              '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(f.uploaded_at) + '</td>' +
              '<td>' + (state.reviewFilter === "pending" ?
                '<button class="btn sm" data-approve="' + f.id + '">اعتماد</button> <button class="btn danger sm" data-reject="' + f.id + '">رفض</button>' :
                '<span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span>') +
              '</td></tr>';
          });
          html += '</tbody></table>';
          html += '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:14px;">' +
            '<button class="btn ghost sm" id="rv-prev" ' + (state.reviewPage <= 1 ? "disabled" : "") + '>السابق</button>' +
            '<span style="font-size:12px;color:var(--c-muted);">صفحة ' + state.reviewPage + ' من ' + totalPages + ' (' + total + ')</span>' +
            '<button class="btn ghost sm" id="rv-next" ' + (state.reviewPage >= totalPages ? "disabled" : "") + '>التالي</button></div>';
        }
        html += '</div>';
        view.innerHTML = html;

        document.getElementById("rv-filter").onchange = function () {
          state.reviewFilter = this.value; state.reviewPage = 1; renderReviewScreen(view, container);
        };
        var prevBtn = document.getElementById("rv-prev");
        var nextBtn = document.getElementById("rv-next");
        if (prevBtn) prevBtn.onclick = function () { if (state.reviewPage > 1) { state.reviewPage--; renderReviewScreen(view, container); } };
        if (nextBtn) nextBtn.onclick = function () { state.reviewPage++; renderReviewScreen(view, container); };

        view.querySelectorAll("[data-approve]").forEach(function (btn) {
          btn.onclick = function () { doReview(btn.getAttribute("data-approve"), "approve"); };
        });
        view.querySelectorAll("[data-reject]").forEach(function (btn) {
          btn.onclick = function () {
            var fileId = btn.getAttribute("data-reject");
            var row = btn.closest("tr");
            if (row.querySelector(".rv-reject-inline")) return;
            var wrap = document.createElement("tr");
            wrap.className = "rv-reject-inline";
            var td = document.createElement("td");
            td.colSpan = 6;
            td.style.padding = "8px 4px";
            td.innerHTML = '<div style="display:flex;gap:8px;align-items:center;">' +
              '<input class="rv-reject-notes" placeholder="سبب الرفض (اختياري)" style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid var(--c-border);">' +
              '<button class="btn danger sm rv-reject-confirm">تأكيد الرفض</button>' +
              '<button class="btn ghost sm rv-reject-cancel">إلغاء</button></div>';
            wrap.appendChild(td);
            row.parentNode.insertBefore(wrap, row.nextSibling);
            var notesInput = td.querySelector(".rv-reject-notes");
            notesInput.focus();
            td.querySelector(".rv-reject-cancel").onclick = function () { wrap.remove(); };
            td.querySelector(".rv-reject-confirm").onclick = function () {
              doReview(fileId, "reject", notesInput.value.trim());
            };
          };
        });

        function doReview(fileId, decision, notes) {
          window.SSMPDDb.reviewPatientFile({ file_id: fileId, decision: decision, notes: notes || undefined })
            .then(function () {
              T.show(decision === "approve" ? "اتاعتمد الملف" : "اترفض الملف");
              renderReviewScreen(view, container);
            }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
        }
      }).catch(function (e) {
        view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  // ============ ٤) شاشة تصفح وفلترة ============
  function renderBrowseScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.listPatientsArchive({ search: state.browseSearch || undefined, page: state.browsePage, page_size: state.browsePageSize })
      .then(function (res) {
        var patients = res.patients || [];
        var total = res.total || 0;
        var totalPages = Math.max(1, Math.ceil(total / state.browsePageSize));

        var html = '<div class="section">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
          '<input id="pt-search" placeholder="بحث بالاسم / الهاتف / كود المريض" value="' + escapeHtml(state.browseSearch) + '" style="flex:1;min-width:220px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
          '<button class="btn ghost sm" id="pt-search-btn">بحث</button></div>';

        if (!patients.length) {
          html += '<p style="color:var(--c-muted);font-size:13px;">مفيش مرضى مطابقين.</p>';
        } else {
          html += '<table class="simple"><thead><tr><th>كود المريض</th><th>الاسم</th><th>الهاتف</th><th>الحالة</th><th></th></tr></thead><tbody>';
          patients.forEach(function (p) {
            html += '<tr><td>' + escapeHtml(p.patient_code || "—") + '</td><td>' + escapeHtml(p.full_name) + '</td>' +
              '<td>' + escapeHtml(p.phone || "—") + '</td>' +
              '<td>' + (p.status === "archived" ? '<span class="status-pill draft">مؤرشف</span>' : '<span class="status-pill approved">نشط</span>') + '</td>' +
              '<td><button class="btn ghost sm" data-open="' + p.id + '">فتح</button></td></tr>';
          });
          html += '</tbody></table>';
          html += '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:14px;">' +
            '<button class="btn ghost sm" id="pt-prev" ' + (state.browsePage <= 1 ? "disabled" : "") + '>السابق</button>' +
            '<span style="font-size:12px;color:var(--c-muted);">صفحة ' + state.browsePage + ' من ' + totalPages + ' (' + total + ' مريض)</span>' +
            '<button class="btn ghost sm" id="pt-next" ' + (state.browsePage >= totalPages ? "disabled" : "") + '>التالي</button></div>';
        }
        html += '</div>';
        view.innerHTML = html;

        document.getElementById("pt-search-btn").onclick = function () {
          state.browseSearch = document.getElementById("pt-search").value.trim();
          state.browsePage = 1;
          renderBrowseScreen(view, container);
        };
        document.getElementById("pt-search").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("pt-search-btn").click(); };
        var prevBtn = document.getElementById("pt-prev");
        var nextBtn = document.getElementById("pt-next");
        if (prevBtn) prevBtn.onclick = function () { if (state.browsePage > 1) { state.browsePage--; renderBrowseScreen(view, container); } };
        if (nextBtn) nextBtn.onclick = function () { state.browsePage++; renderBrowseScreen(view, container); };

        view.querySelectorAll("[data-open]").forEach(function (btn) {
          btn.onclick = function () { openPatientModal(view, container, btn.getAttribute("data-open")); };
        });
      }).catch(function (e) {
        view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  function openPatientModal(view, container, patientId) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function reload() {
      window.SSMPDDb.getPatientFiles(patientId).then(function (res) {
        renderPatientModal(backdrop, view, container, res.patient, res.files || []);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();
  }

  function renderPatientModal(backdrop, view, container, patient, files) {
    var byCategory = {};
    CATEGORIES.forEach(function (c) { byCategory[c.key] = []; });
    files.forEach(function (f) { (byCategory[f.category] || (byCategory[f.category] = [])).push(f); });

    var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(patient.full_name) +
      ' <span style="font-size:12px;color:var(--c-muted);">(' + escapeHtml(patient.patient_code || "") + ')</span></h3>' +
      '<button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin-bottom:14px;">الهاتف: ' + escapeHtml(patient.phone || "—") + '</p>';

    var canUp = canUpload();
    CATEGORIES.forEach(function (c) {
      var list = byCategory[c.key] || [];
      html += '<div class="section" style="padding:12px 14px;">' +
        '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span>' + c.label + ' (' + list.length + ')</span>' +
        (canUp ? '<span><button class="btn ghost sm" data-upload-cat="' + c.key + '">+ رفع</button>' +
          '<input type="file" accept="image/*,application/pdf" data-file-input-cat="' + c.key + '" style="display:none;"></span>' : '') +
        '</h3>';
      if (canUp && c.key === "other") {
        html += '<div class="field" data-other-wrap-cat style="display:none;margin-bottom:8px;">' +
          '<label>وصف نوع الملف</label><input data-other-desc-cat placeholder="اكتب نوع الملف"></div>';
      }
      html += '<div data-cat-status style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>';
      if (!list.length) {
        html += '<p style="font-size:12px;color:var(--c-muted);">مفيش ملفات.</p>';
      } else {
        list.forEach(function (f) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
            '<div><b>' + escapeHtml(f.file_name) + '</b>' + (f.category === "other" && f.other_description ? ' — ' + escapeHtml(f.other_description) : '') +
            ' <span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '" style="font-size:10px;">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span>' +
            '<br><span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) +
            (f.uploaded_by_name ? ' · رفعه: ' + escapeHtml(f.uploaded_by_name) : '') +
            (f.reviewed_by_name ? ' · راجعه: ' + escapeHtml(f.reviewed_by_name) : '') + '</span></div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0;">' +
            '<button class="btn ghost sm" data-dl="' + f.id + '">تنزيل</button>' +
            '<button class="btn danger sm" data-del-file="' + f.id + '">حذف</button></div></div>';
        });
      }
      html += '</div>';
    });

    html += '</div>';
    backdrop.innerHTML = html;
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };

    // ---------- زرار الرفع المستقل لكل تصنيف مستند ----------
    backdrop.querySelectorAll("[data-upload-cat]").forEach(function (btn) {
      var catKey = btn.getAttribute("data-upload-cat");
      var section = btn.closest(".section");
      var fileInput = section.querySelector('[data-file-input-cat="' + catKey + '"]');
      var otherWrap = section.querySelector("[data-other-wrap-cat]");
      var statusEl = section.querySelector("[data-cat-status]");

      btn.onclick = function () {
        if (catKey === "other" && otherWrap && otherWrap.style.display === "none") {
          otherWrap.style.display = "";
          return;
        }
        fileInput.click();
      };

      fileInput.onchange = function () {
        var file = fileInput.files[0];
        if (!file) return;
        var otherDesc = "";
        if (catKey === "other") {
          otherDesc = (section.querySelector("[data-other-desc-cat]") || {}).value || "";
          otherDesc = otherDesc.trim();
          if (!otherDesc) { statusEl.textContent = "اكتب وصف نوع الملف الأول"; fileInput.value = ""; return; }
        }
        var fd = new FormData();
        fd.append("patient_id", patient.id);
        fd.append("category", catKey);
        if (catKey === "other") fd.append("other_description", otherDesc);
        fd.append("file", file);
        statusEl.textContent = "بيرفع…";
        btn.disabled = true;
        window.SSMPDDb.uploadPatientFile(fd).then(function () {
          T.show("اترفع الملف بنجاح، وهيبقى قيد المراجعة لحد ما مسؤول تاني يعتمده");
          window.SSMPDDb.getPatientFiles(patient.id).then(function (res) {
            renderPatientModal(backdrop, view, container, res.patient, res.files || []);
          });
        }).catch(function (e) {
          statusEl.textContent = "خطأ: " + e.message;
          btn.disabled = false;
          fileInput.value = "";
        });
      };
    });

    backdrop.querySelectorAll("[data-dl]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-dl");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          var a = document.createElement("a");
          a.href = url; a.download = res.filename;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          btn.disabled = false;
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; });
      };
    });

    backdrop.querySelectorAll("[data-del-file]").forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains("confirm-pending")) {
          var fileId = btn.getAttribute("data-del-file");
          window.SSMPDDb.deletePatientFile(fileId).then(function () {
            T.show("اتحذف الملف");
            window.SSMPDDb.getPatientFiles(patient.id).then(function (res) {
              renderPatientModal(backdrop, view, container, res.patient, res.files || []);
            });
          }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
        } else {
          btn.classList.add("confirm-pending");
          btn.textContent = "متأكد؟ اضغط تاني";
          setTimeout(function () { btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; }, 3000);
        }
      };
    });
  }

  window.SSMPDRenderPatients = { render: render };
})();
