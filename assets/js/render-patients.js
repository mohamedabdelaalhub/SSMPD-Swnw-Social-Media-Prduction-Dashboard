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
    { key: "physical_therapy", label: "علاج طبيعي" },
    { key: "medical_report", label: "تقرير طبي" },
    { key: "eeg", label: "رسم مخ" },
    { key: "other", label: "أخرى" }
  ];
  var REVIEW_LABELS = { pending: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" };
  var REVIEW_PILL = { pending: "approval", approved: "approved", rejected: "revision" };

  // قائمة الأمراض المزمنة الثابتة من نماذج الفايلنج الورقية (كبار/اطفال/تجميل/كماوي) —
  // مخزنة jsonb في patient_medical_profile.chronic_conditions كـ [{name:key, has, medication}]
  var CHRONIC_CONDITIONS = [
    { key: "smoking", label: "التدخين" },
    { key: "blood_pressure", label: "الضغط" },
    { key: "diabetes", label: "السكر" },
    { key: "thyroid", label: "الغدة الدرقية" },
    { key: "kidney_disease", label: "أمراض الكلي" },
    { key: "tumors", label: "أورام" },
    { key: "drug_allergies", label: "حساسية من الأدوية" }
  ];

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
  // "طبيب سونو" (معاينة محالة فقط): عنده has_archive_view_only بس، من غير أرشيف كامل
  // ولا مراجعة — بيشوف شاشة مختلفة تماماً (طابور الإحالات) بدل الأرشيف العادي
  function isDoctorOnly() { return !!(me && me.has_archive_view_only && !canUpload() && !canReview()); }
  // مين يقدر يحيل مريض لطبيب سونو: التمريض، أو أي حد عنده أرشيف كامل، أو سوبر أدمن
  function canAssignDoctor() {
    return !!(me && (window.SSMPDRoles.hasRole(me, "nursing") || canUpload() || window.SSMPDRoles.hasRole(me, "super_admin")));
  }

  var SUB_SCREENS = [
    { key: "dashboard", label: "الداشبورد العام" },
    { key: "upload", label: "الاستقبال" },
    { key: "review", label: "مراجعة قبل الاعتماد" },
    { key: "browse", label: "تصفح وفلترة" }
  ];

  var state = {
    subTab: "dashboard",
    browseSearch: "", browsePage: 1, browsePageSize: 20,
    browseDateField: "created_at", browseDateFrom: "", browseDateTo: "",
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
    if (isDoctorOnly()) { renderDoctorQueue(container); return; }
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
      var sentToNursing = !!patient.sent_to_nursing_at;
      wrap.innerHTML = '<div class="section"><h3>ملف جديد — ' + escapeHtml(patient.full_name) + ' (' + escapeHtml(patient.patient_code || "—") + ')</h3>' +
        (sentToNursing ? '<p style="font-size:12px;color:var(--c-primary,#0a7);margin:0 0 8px;">✓ اتبعت للتمريض (' + fmtDate(patient.sent_to_nursing_at) + ')</p>' : '') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<button class="btn ghost sm" id="np-edit-btn">تعديل بيانات</button>' +
        '<button class="btn ghost sm" id="np-upload-btn">رفع مستندات</button>' +
        '<button class="btn ghost sm" id="np-nursing-btn">إرسال للتمريض</button>' +
        '<button class="btn ghost sm" id="np-delete-btn" style="color:var(--c-danger,#c33);">حذف</button>' +
        '</div>' +
        '<div id="np-upload-form-wrap"></div>' +
        '<div id="np-action-status" style="font-size:12px;color:var(--c-muted);"></div></div>';

      var statusEl = document.getElementById("np-action-status");

      document.getElementById("np-edit-btn").onclick = function () {
        openEditPatientModal(patient, function () {
          selectPatientForUpload(patient);
        });
      };

      document.getElementById("np-upload-btn").onclick = function () {
        var formWrap = document.getElementById("np-upload-form-wrap");
        if (formWrap.innerHTML) { formWrap.innerHTML = ""; return; }
        renderUploadForm(formWrap, patient);
      };

      document.getElementById("np-nursing-btn").onclick = function () {
        statusEl.textContent = "بيتبعت…";
        window.SSMPDDb.sendPatientToNursing(patient.id).then(function (updated) {
          T.show("اتبعت للتمريض بنجاح");
          state.uploadPatient = updated || patient;
          statusEl.textContent = "";
          selectPatientForUpload(state.uploadPatient);
        }).catch(function (e) { statusEl.textContent = "خطأ: " + e.message; });
      };

      document.getElementById("np-delete-btn").onclick = function () {
        if (!window.confirm("متأكد إنك عايز تمسح ملف " + patient.full_name + "؟ الإجراء ده مش هيترجع.")) return;
        statusEl.textContent = "بيتمسح…";
        window.SSMPDDb.deletePatientRecord(patient.id).then(function () {
          T.show("اتمسح الملف بنجاح");
          state.uploadPatient = null;
          wrap.innerHTML = "";
        }).catch(function (e) {
          var msg = e && e.message ? e.message : "";
          if (msg.indexOf("foreign key") !== -1 || msg.indexOf("violates") !== -1 || (e && e.code === "23503")) {
            statusEl.textContent = "متقدرش تمسح المريض ده — ليه بيانات مرتبطة (زي عملاء محتملين/leads) لازم تتشال الأول.";
          } else {
            statusEl.textContent = "خطأ: " + msg;
          }
        });
      };
    }

    function renderUploadForm(wrap, patient) {
      wrap.innerHTML = '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;">' +
        '<div style="flex:1;min-width:140px;"><label>الفئة</label><select id="uf-category">' +
        CATEGORIES.map(function (c) { return '<option value="' + c.key + '">' + c.label + '</option>'; }).join("") +
        '</select></div>' +
        '<div style="flex:2;min-width:180px;"><label>الملف</label><input type="file" id="uf-file"></div>' +
        '<div style="min-width:150px;"><label>تاريخ إصدار المستند (اختياري)</label><input type="date" id="uf-issued-at"></div>' +
        '<button class="btn sm" id="uf-btn">رفع</button></div>' +
        '<div class="field" id="uf-other-wrap"><label id="uf-other-label">ملاحظات / تفاصيل الملف (اختياري)</label><input id="uf-other-desc" placeholder="اكتب أي تفاصيل تخص الملف"></div>' +
        '<div id="uf-status" style="font-size:12px;color:var(--c-muted);"></div>';

      var catSelect = document.getElementById("uf-category");
      var otherLabel = document.getElementById("uf-other-label");
      // كل الفئات بقى معاها بوكس تكست اختياري لملاحظات/تفاصيل الملف — فئة "أخرى"
      // بس اللي بتحتاجه إجباري (بيوضّح نوع الملف نفسه)
      function syncOther() { otherLabel.textContent = catSelect.value === "other" ? "وصف نوع الملف" : "ملاحظات / تفاصيل الملف (اختياري)"; }
      catSelect.onchange = syncOther;
      syncOther();

      document.getElementById("uf-btn").onclick = function () {
        var category = catSelect.value;
        var otherDesc = document.getElementById("uf-other-desc").value.trim();
        var file = document.getElementById("uf-file").files[0];
        var statusEl = document.getElementById("uf-status");
        if (!file) { statusEl.textContent = "اختار ملف الأول"; return; }
        if (category === "other" && !otherDesc) { statusEl.textContent = "اكتب وصف نوع الملف"; return; }
        var issuedAt = (document.getElementById("uf-issued-at") || {}).value || "";
        var fd = new FormData();
        fd.append("patient_id", patient.id);
        fd.append("category", category);
        if (otherDesc) fd.append("other_description", otherDesc);
        if (issuedAt) fd.append("issued_at", issuedAt);
        fd.append("file", file);
        statusEl.textContent = "بيرفع…";
        window.SSMPDDb.uploadPatientFile(fd).then(function () {
          if (me) window.SSMPDDb.logUsageActivity(me.id, "رفع مستند مريض", file.name + " (" + categoryLabel(category) + ")").catch(function () {});
          T.show("اترفع الملف بنجاح، وهيبقى قيد المراجعة لحد ما مسؤول تاني يعتمده");
          wrap.innerHTML = "";
          renderUploadForm(wrap, patient);
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
      '<div class="field"><label>السن</label><input id="np-age" type="number" min="0"></div>' +
      '<div class="field"><label>النوع</label><select id="np-gender"><option value="">—</option><option value="male">ذكر</option><option value="female">أنثى</option></select></div>' +
      '<div class="field"><label>الرقم الطبي (اختياري)</label><input id="np-mrn"></div>' +
      '<div class="field"><label>الطبيب المعالج (اختياري)</label><input id="np-doctor"></div>' +
      '<div class="field"><label>التخصص (اختياري)</label><input id="np-specialty" placeholder="مثلاً: عام / اطفال / تجميل / كماوي"></div>' +
      '<button class="btn block" id="np-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("np-save").onclick = function () {
      var full_name = document.getElementById("np-name").value.trim();
      var phone = document.getElementById("np-phone").value.trim();
      var national_id = document.getElementById("np-nid").value.trim();
      var age = document.getElementById("np-age").value.trim();
      var gender = document.getElementById("np-gender").value;
      var medical_record_no = document.getElementById("np-mrn").value.trim();
      var treating_doctor = document.getElementById("np-doctor").value.trim();
      var specialty = document.getElementById("np-specialty").value.trim();
      if (!full_name) { T.show("اكتب اسم المريض", "error"); return; }
      if (!phone) { T.show("اكتب رقم الهاتف", "error"); return; }
      window.SSMPDDb.createPatientArchive({
        full_name: full_name, phone: phone, national_id: national_id || undefined,
        age: age || undefined, gender: gender || undefined, medical_record_no: medical_record_no || undefined
      })
        .then(function (res) {
          T.show("اتضاف المريض بكود " + (res.patient_code || ""));
          backdrop.remove();
          var created = { id: res.id, full_name: full_name, patient_code: res.patient_code };
          if (treating_doctor || specialty) {
            window.SSMPDDb.savePatientMedicalProfile(res.id, { treating_doctor: treating_doctor || null, specialty: specialty || null }, me && me.id)
              .catch(function () { /* البيانات الطبية اختيارية عند الإنشاء — مفيش داعي نوقف الفلو لو فشلت */ });
          }
          if (onCreated) onCreated(created);
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  function openEditPatientModal(patient, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>تعديل بيانات المريض</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>الاسم بالكامل</label><input id="ep-name" value="' + escapeHtml(patient.full_name || "") + '"></div>' +
      '<div class="field"><label>رقم الهاتف</label><input id="ep-phone" value="' + escapeHtml(patient.phone || "") + '"></div>' +
      '<div class="field"><label>السن</label><input id="ep-age" type="number" min="0" value="' + escapeHtml(patient.age != null ? String(patient.age) : "") + '"></div>' +
      '<div class="field"><label>النوع</label><select id="ep-gender">' +
        '<option value="" ' + (!patient.gender ? "selected" : "") + '>—</option>' +
        '<option value="male" ' + (patient.gender === "male" ? "selected" : "") + '>ذكر</option>' +
        '<option value="female" ' + (patient.gender === "female" ? "selected" : "") + '>أنثى</option>' +
      '</select></div>' +
      '<div class="field"><label>الرقم الطبي</label><input id="ep-mrn" value="' + escapeHtml(patient.medical_record_no || "") + '"></div>' +
      '<div class="field"><label>تاريخ آخر زيارة</label><input id="ep-visit" type="date" value="' + escapeHtml(patient.last_visit_date || "") + '"></div>' +
      '<button class="btn block" id="ep-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("ep-save").onclick = function () {
      var full_name = document.getElementById("ep-name").value.trim();
      var phone = document.getElementById("ep-phone").value.trim();
      var age = document.getElementById("ep-age").value.trim();
      var gender = document.getElementById("ep-gender").value;
      var medical_record_no = document.getElementById("ep-mrn").value.trim();
      var last_visit_date = document.getElementById("ep-visit").value;
      if (!full_name) { T.show("اكتب اسم المريض", "error"); return; }
      var patch = {
        full_name: full_name,
        phone: phone || null,
        age: age ? Number(age) : null,
        gender: gender || null,
        medical_record_no: medical_record_no || null,
        last_visit_date: last_visit_date || null
      };
      window.SSMPDDb.updatePatientRecord(patient.id, patch)
        .then(function () {
          T.show("اتحدثت بيانات المريض");
          backdrop.remove();
          if (onSaved) onSaved();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- تعديل البيانات الطبية (طبيب معالج/تخصص/علامات حيوية/أمراض مزمنة/عمليات/تاريخ عائلي) ----------
  function openEditMedicalProfileModal(patient, profile, onSaved) {
    profile = profile || {};
    var chronicByKey = {};
    (profile.chronic_conditions || []).forEach(function (c) { chronicByKey[c.name] = c; });
    var surgeries = (profile.surgeries || []).filter(function (s) { return s.has; }).map(function (s) { return { name: s.name || "", notes: s.notes || "" }; });
    var family = (profile.family_history || []).filter(function (f) { return f.has; }).map(function (f) { return { disease: f.disease || "" }; });

    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var html = '<div class="modal"><div class="modal-head"><h3>تعديل البيانات الطبية</h3><button class="modal-close">×</button></div>';

    html += '<div class="field"><label>الطبيب المعالج</label><input id="mp-doctor" value="' + escapeHtml(profile.treating_doctor || "") + '"></div>';
    html += '<div class="field"><label>التخصص</label><input id="mp-specialty" value="' + escapeHtml(profile.specialty || "") + '"></div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div class="field" style="flex:1;min-width:120px;"><label>ضغط الدم</label><input id="mp-bp" value="' + escapeHtml(profile.blood_pressure || "") + '"></div>' +
      '<div class="field" style="flex:1;min-width:120px;"><label>سكر الدم</label><input id="mp-sugar" value="' + escapeHtml(profile.blood_sugar || "") + '"></div>' +
      '<div class="field" style="flex:1;min-width:120px;"><label>الوزن</label><input id="mp-weight" value="' + escapeHtml(profile.weight || "") + '"></div>' +
      '<div class="field" style="flex:1;min-width:120px;"><label>النبض</label><input id="mp-pulse" value="' + escapeHtml(profile.pulse || "") + '"></div>' +
      '<div class="field" style="flex:1;min-width:120px;"><label>نسبة الأكسجين</label><input id="mp-oxygen" value="' + escapeHtml(profile.oxygen_percent || "") + '"></div>' +
      '</div>';

    html += '<div class="field"><label>الأمراض المزمنة</label>';
    CHRONIC_CONDITIONS.forEach(function (cc) {
      var existing = chronicByKey[cc.key];
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<label style="display:flex;align-items:center;gap:4px;min-width:130px;font-size:12px;">' +
        '<input type="checkbox" data-chronic-check="' + cc.key + '" ' + (existing ? "checked" : "") + '> ' + cc.label + '</label>' +
        '<input data-chronic-med="' + cc.key + '" placeholder="الدواء (اختياري)" style="flex:1;" value="' + escapeHtml(existing ? existing.medication || "" : "") + '">' +
        '</div>';
    });
    html += '</div>';

    html += '<div class="field"><label>العمليات الجراحية</label><div data-surgeries-list></div>' +
      '<button type="button" class="btn ghost sm" data-add-surgery-row="1">+ إضافة عملية</button></div>';

    html += '<div class="field"><label>تاريخ مرضي بالعائلة</label><div data-family-list></div>' +
      '<button type="button" class="btn ghost sm" data-add-family-row="1">+ إضافة</button></div>';

    html += '<button class="btn block" id="mp-save">حفظ</button></div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var surgeriesList = backdrop.querySelector("[data-surgeries-list]");
    var familyList = backdrop.querySelector("[data-family-list]");

    function addSurgeryRow(name, notes) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;margin-bottom:4px;";
      row.innerHTML = '<input data-surgery-name placeholder="اسم العملية" style="flex:1;" value="' + escapeHtml(name || "") + '">' +
        '<input data-surgery-notes placeholder="ملاحظات" style="flex:1;" value="' + escapeHtml(notes || "") + '">' +
        '<button type="button" class="btn danger sm" data-remove-row="1">حذف</button>';
      row.querySelector("[data-remove-row]").onclick = function () { row.remove(); };
      surgeriesList.appendChild(row);
    }
    function addFamilyRow(disease) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;margin-bottom:4px;";
      row.innerHTML = '<input data-family-disease placeholder="المرض" style="flex:1;" value="' + escapeHtml(disease || "") + '">' +
        '<button type="button" class="btn danger sm" data-remove-row="1">حذف</button>';
      row.querySelector("[data-remove-row]").onclick = function () { row.remove(); };
      familyList.appendChild(row);
    }
    surgeries.forEach(function (s) { addSurgeryRow(s.name, s.notes); });
    family.forEach(function (f) { addFamilyRow(f.disease); });
    backdrop.querySelector("[data-add-surgery-row]").onclick = function () { addSurgeryRow("", ""); };
    backdrop.querySelector("[data-add-family-row]").onclick = function () { addFamilyRow(""); };

    document.getElementById("mp-save").onclick = function () {
      var chronic_conditions = CHRONIC_CONDITIONS.map(function (cc) {
        var checked = backdrop.querySelector('[data-chronic-check="' + cc.key + '"]').checked;
        var med = backdrop.querySelector('[data-chronic-med="' + cc.key + '"]').value.trim();
        return { name: cc.key, has: checked, medication: checked ? med : "" };
      });
      var surgeriesOut = [];
      surgeriesList.querySelectorAll("div").forEach(function (row) {
        var name = row.querySelector("[data-surgery-name]").value.trim();
        var notes = row.querySelector("[data-surgery-notes]").value.trim();
        if (name) surgeriesOut.push({ name: name, notes: notes, has: true });
      });
      var familyOut = [];
      familyList.querySelectorAll("div").forEach(function (row) {
        var disease = row.querySelector("[data-family-disease]").value.trim();
        if (disease) familyOut.push({ disease: disease, has: true });
      });
      var patch = {
        treating_doctor: document.getElementById("mp-doctor").value.trim() || null,
        specialty: document.getElementById("mp-specialty").value.trim() || null,
        blood_pressure: document.getElementById("mp-bp").value.trim() || null,
        blood_sugar: document.getElementById("mp-sugar").value.trim() || null,
        weight: document.getElementById("mp-weight").value.trim() || null,
        pulse: document.getElementById("mp-pulse").value.trim() || null,
        oxygen_percent: document.getElementById("mp-oxygen").value.trim() || null,
        chronic_conditions: chronic_conditions,
        surgeries: surgeriesOut,
        family_history: familyOut
      };
      window.SSMPDDb.savePatientMedicalProfile(patient.id, patch, me && me.id).then(function () {
        T.show("اتحدثت البيانات الطبية");
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- إضافة/تعديل زيارة في سجل الزيارات ----------
  // existingVisit فاضي = وضع "إضافة"، وموجود = وضع "تعديل" (بيتعبّى بالقيم الحالية)
  function openVisitFormModal(patient, existingVisit, onSaved) {
    var v = existingVisit || {};
    var isEdit = !!existingVisit;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل الزيارة" : "زيارة جديدة") + '</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>تاريخ الزيارة</label><input id="vs-date" type="date" value="' + (v.visit_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field"><label>رقم الزيارة</label><input id="vs-number" value="' + escapeHtml(v.visit_number || '') + '"></div>' +
      '<div class="field"><label>الشكوى</label><input id="vs-complaint" value="' + escapeHtml(v.complaint || '') + '"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div class="field" style="flex:1;min-width:110px;"><label>ضغط الدم</label><input id="vs-bp" value="' + escapeHtml(v.blood_pressure || '') + '"></div>' +
      '<div class="field" style="flex:1;min-width:110px;"><label>سكر الدم</label><input id="vs-sugar" value="' + escapeHtml(v.blood_sugar || '') + '"></div>' +
      '<div class="field" style="flex:1;min-width:110px;"><label>النبض</label><input id="vs-pulse" value="' + escapeHtml(v.pulse || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>الأدوية</label><input id="vs-meds" value="' + escapeHtml(v.medications || '') + '"></div>' +
      '<div class="field"><label>الأشعة</label><input id="vs-xrays" value="' + escapeHtml(v.xrays || '') + '"></div>' +
      '<div class="field"><label>التحاليل</label><input id="vs-labs" value="' + escapeHtml(v.labs || '') + '"></div>' +
      '<div class="field"><label>توصيات أخرى</label><input id="vs-other" value="' + escapeHtml(v.other_recommendations || '') + '"></div>' +
      '<div class="field"><label>تاريخ المتابعة</label><input id="vs-followup" type="date" value="' + (v.follow_up_date || '') + '"></div>' +
      '<div class="field" style="border-top:1px solid var(--c-border);padding-top:10px;">' +
      '<label style="display:flex;align-items:center;gap:8px;font-weight:normal;"><input type="checkbox" id="vs-referred" ' + (v.referred_to_other_doctor ? "checked" : "") + '> محوّل لطبيب آخر</label>' +
      '<input id="vs-referred-doctor" placeholder="اسم الطبيب المحوّل له" value="' + escapeHtml(v.referred_doctor_name || '') + '" style="margin-top:8px;' + (v.referred_to_other_doctor ? "" : "display:none;") + '"></div>' +
      '<button class="btn block" id="vs-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    var referredBox = document.getElementById("vs-referred");
    var referredDoctorInput = document.getElementById("vs-referred-doctor");
    referredBox.onchange = function () { referredDoctorInput.style.display = referredBox.checked ? "" : "none"; };

    document.getElementById("vs-save").onclick = function () {
      var referred = referredBox.checked;
      var referredDoctorName = referredDoctorInput.value.trim();
      if (referred && !referredDoctorName) { T.show("اكتب اسم الطبيب المحوّل له", "error"); return; }
      var patch = {
        visit_date: document.getElementById("vs-date").value || new Date().toISOString().slice(0, 10),
        visit_number: document.getElementById("vs-number").value.trim() || null,
        complaint: document.getElementById("vs-complaint").value.trim() || null,
        blood_pressure: document.getElementById("vs-bp").value.trim() || null,
        blood_sugar: document.getElementById("vs-sugar").value.trim() || null,
        pulse: document.getElementById("vs-pulse").value.trim() || null,
        medications: document.getElementById("vs-meds").value.trim() || null,
        xrays: document.getElementById("vs-xrays").value.trim() || null,
        labs: document.getElementById("vs-labs").value.trim() || null,
        other_recommendations: document.getElementById("vs-other").value.trim() || null,
        follow_up_date: document.getElementById("vs-followup").value || null,
        referred_to_other_doctor: referred,
        referred_doctor_name: referred ? referredDoctorName : null
      };
      // لو "محوّل لطبيب آخر" اتفعّل جديد في الزيارة دي (مكانش مفعّل قبل كده) —
      // بنعمل ليد جديد بمصدر "تحويل من طبيب العيادة" عشان الريسبشن/خدمة
      // العملاء يحجزوا معاد جديد. لو الزيارة كانت أصلاً محوّلة (تعديل)، مش
      // بنكرر إنشاء الليد تاني.
      var shouldCreateReferralLead = referred && !(isEdit && v.referred_to_other_doctor);
      var req = isEdit ?
        window.SSMPDDb.updatePatientVisit(existingVisit.id, patch) :
        window.SSMPDDb.addPatientVisit(patient.id, patch, me && me.id);
      req.then(function () {
        if (shouldCreateReferralLead) {
          return window.SSMPDDb.createDoctorReferralLead(patient.id, referredDoctorName).then(function () {
            T.show(isEdit ? "اتحدثت الزيارة، واتعمل ليد تحويل جديد" : "اتضافت الزيارة، واتعمل ليد تحويل جديد");
          }).catch(function () {
            T.show(isEdit ? "اتحدثت الزيارة، بس فشل إنشاء ليد التحويل" : "اتضافت الزيارة، بس فشل إنشاء ليد التحويل", "error");
          });
        }
        T.show(isEdit ? "اتحدثت الزيارة" : "اتضافت الزيارة");
      }).then(function () {
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- فورم "تقرير طبي" (إنشاء/تعديل) — نص حر، بيتطبع بشكل الفورم الرسمي ----------
  function openMedicalReportFormModal(patient, existingReport, onSaved) {
    var r = existingReport || {};
    var isEdit = !!existingReport;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل التقرير الطبي" : "تقرير طبي جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + (patient.age != null ? (' — ' + patient.age + ' عام') : '') + '</p>' +
      '<div class="field"><label>تاريخ التقرير</label><input id="mr-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field"><label>التخصص (اختياري — لتمييز التقارير لو أكتر من تقرير لنفس المريض)</label><input id="mr-specialty" type="text" placeholder="مثال: عظام" value="' + escapeHtml(r.specialty || '') + '"></div>' +
      '<div class="field"><label>نص التقرير</label><textarea id="mr-body" rows="10" placeholder="اكتب نص التقرير كامل زي ما هيتطبع بالظبط...">' + escapeHtml(r.body_text || '') + '</textarea></div>' +
      '<p style="font-size:11px;color:var(--c-muted);">هيتطبع باسم "المدير الطبي: ' + escapeHtml(r.doctor_name || 'د.دينا حسني') + '" تلقائي في نهاية التقرير.</p>' +
      '<button class="btn block" id="mr-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("mr-save").onclick = function () {
      var body = document.getElementById("mr-body").value.trim();
      if (!body) { T.show("اكتب نص التقرير الأول", "error"); return; }
      var patch = {
        report_date: document.getElementById("mr-date").value || new Date().toISOString().slice(0, 10),
        specialty: document.getElementById("mr-specialty").value.trim(),
        body_text: body,
        doctor_name: r.doctor_name || "د.دينا حسني"
      };
      if (isEdit) patch.id = existingReport.id;
      window.SSMPDDb.saveMedicalReport(patient.id, patch, me && me.id).then(function () {
        T.show(isEdit ? "اتحدث التقرير" : "اتحفظ التقرير");
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- فورم روشتة (Prescription) — إنشاء/تعديل، نفس نمط تقرير طبي ----------
  function openPrescriptionFormModal(patient, existingRx, onSaved) {
    var r = existingRx || {};
    var isEdit = !!existingRx;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل الروشتة" : "روشتة جديدة") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + (patient.age != null ? (' — ' + patient.age + ' عام') : '') + '</p>' +
      '<div class="field"><label>تاريخ الروشتة</label><input id="rx-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field"><label>اسم الطبيب</label><input id="rx-doctor" type="text" placeholder="اسم الطبيب" value="' + escapeHtml(r.doctor_name || '') + '"></div>' +
      '<div class="field"><label>التخصص (اختياري)</label><input id="rx-specialty" type="text" placeholder="مثال: عظام" value="' + escapeHtml(r.specialty || '') + '"></div>' +
      '<div class="field"><label>التشخيص (اختياري)</label><input id="rx-diagnosis" type="text" placeholder="التشخيص" value="' + escapeHtml(r.diagnosis || '') + '"></div>' +
      '<div class="field"><label>الروشتة</label><textarea id="rx-body" rows="10" placeholder="اكتب تفاصيل الروشتة كاملة زي ما هتتطبع بالظبط...">' + escapeHtml(r.rx_text || '') + '</textarea></div>' +
      '<button class="btn block" id="rx-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("rx-save").onclick = function () {
      var body = document.getElementById("rx-body").value.trim();
      if (!body) { T.show("اكتب تفاصيل الروشتة الأول", "error"); return; }
      var patch = {
        report_date: document.getElementById("rx-date").value || new Date().toISOString().slice(0, 10),
        doctor_name: document.getElementById("rx-doctor").value.trim(),
        specialty: document.getElementById("rx-specialty").value.trim(),
        diagnosis: document.getElementById("rx-diagnosis").value.trim(),
        rx_text: body
      };
      if (isEdit) patch.id = existingRx.id;
      window.SSMPDDb.savePrescription(patient.id, patch, me && me.id).then(function () {
        T.show(isEdit ? "اتحدثت الروشتة" : "اتحفظت الروشتة");
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- طباعة الروشتة — نفس نموذج الروشتة الرسمي اللي بعته المستخدم
  //            بالحرف (صورة واحدة كاملة للصفحة — هيدر+خانات+علامة Rx+الرسمة
  //            الشفافة في النص+فوتر — بدل ما تتقص هيدر/فوتر منفصلين اللي كان
  //            بيسيب المنتصف فاضي من غير الرسمة). القيم/النص بتتحط كـlayer
  //            شفاف فوق الصورة مباشرة (مفيش أي بوكس أبيض بيغطي أي جزء منها) ----------
  function rxFieldValueHtml(topMm, leftMm, widthMm, value) {
    return '<div style="position:absolute;top:' + topMm + 'mm;left:' + leftMm + 'mm;width:' + widthMm + 'mm;font-size:15px;font-weight:700;color:#16212E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(value || "") + '</div>';
  }
  function printPrescription(patient, rx) {
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var rxParagraphs = (rx.rx_text || "").split(/\n{2,}/).map(function (p) {
      return '<p style="margin:0 0 16px;">' + escapeHtml(p).replace(/\n/g, "<br>") + '</p>';
    }).join("");
    var fields =
      rxFieldValueHtml(44.5, 10.7, 37.3, fmtDate(rx.report_date)) +
      rxFieldValueHtml(44.5, 96.8, 72, rx.doctor_name) +
      rxFieldValueHtml(54.7, 10.7, 37.3, rx.specialty) +
      rxFieldValueHtml(54.7, 96.8, 72, patient.full_name) +
      rxFieldValueHtml(64.4, 11.6, 148.3, rx.diagnosis);
    var body =
      '<div style="position:relative;width:210mm;min-height:297mm;margin:0 auto;">' +
      '<img src="' + PRINT_RX_FULL_URL + '" style="position:fixed;top:0;left:0;width:210mm;display:block;">' +
      fields +
      '<div dir="rtl" style="position:relative;padding:103mm 16mm 50mm;box-sizing:border-box;font-size:19px;line-height:2.2;">' + rxParagraphs + '</div>' +
      '</div>';
    win.document.open();
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>روشتة — ' + escapeHtml(patient.full_name) + '</title>' +
      '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;font-size:16px;}</style></head>' +
      '<body dir="rtl">' + body + '</body></html>');
    win.document.close();
    waitForImagesThenPrint(win, 3000);
  }

  // ---------- فورم طلب تحاليل (Lab Request) — تشيك ليست قابلة للطباعة ----------
  var LAB_CATEGORIES = [
    { key: "general_chemistry", label: "General Chemistry", items: ["Glucose FBS/2HPP", "Glucose T.Curve", "HbA1c", "Urea", "Creatinine", "Uric Acid", "eGFR", "Creat.Clearance", "Na, k", "Iron", "TIBC", "Calcium (T&I)", "Phosphor", "Chloride", "Magnesium", "AL.K.Phosphatase", "ALT", "AST", "GGT", "Bilirubin (T&D)", "T.Protein", "Albumin", "Cholestrol", "Triglycerides", "HDL-LDL Cholest", "Amylase", "Lipase"] },
    { key: "microbiology", label: "Microbiology", items: ["Urine ex.", "Stool ex.", "Culture", "ZN for TB", "Stool Occult Blood", "Semen Analaysis"] },
    { key: "cardiac_markers", label: "Cardiac Markers", items: ["CKMB", "CK Total", "Troponin", "LDH"] },
    { key: "blood_coagulation", label: "Blood & Coagulation", items: ["CBC", "ESR", "Retics", "Coombos Direct", "Coombos Indirect", "G6PD", "PT", "PTT"] },
    { key: "serology", label: "Serology", items: ["Herpes II Ab", "CMV M&G", "Toxo M&G", "Helicobacter Ab", "Helicobacter Ag", "Widal & Burcella"] },
    { key: "hormones", label: "Hormones", items: ["B-HCG (Blood)", "Progesterone", "Prolactin", "FSH", "LH", "Anti-Mullerian (AMH)", "E2", "Testosterone (F&T)", "Cortisol", "ACTH"] },
    { key: "tumour_markers", label: "Tumour Markers", items: ["PSA (T&F)", "CA 15.3", "CEA", "AFP", "CA 19.9", "CA 125"] },
    { key: "immunology", label: "Immunology", items: ["Rhumatoid", "Anti-CCP", "ASOT", "CRP", "C3, C4"] },
    { key: "thyroid_study", label: "Thyroid Study", items: ["T3 & T4", "Free T3 & T4", "TSH"] }
  ];

  function openLabRequestFormModal(patient, existingLr, onSaved) {
    var r = existingLr || {};
    var isEdit = !!existingLr;
    var selected = {};
    (r.tests || []).forEach(function (t) { selected[t] = true; });
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var html = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل طلب التحاليل" : "طلب تحاليل جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + (patient.age != null ? (' — ' + patient.age + ' عام') : '') + '</p>' +
      '<div class="field"><label>تاريخ الطلب</label><input id="lr-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field"><label>اسم الطبيب</label><input id="lr-doctor" type="text" placeholder="اسم الطبيب" value="' + escapeHtml(r.doctor_name || '') + '"></div>' +
      '<div class="field"><label>التشخيص (اختياري)</label><input id="lr-diagnosis" type="text" placeholder="التشخيص" value="' + escapeHtml(r.diagnosis || '') + '"></div>';
    LAB_CATEGORIES.forEach(function (cat) {
      html += '<div style="margin-top:12px;"><b style="font-size:12px;color:#0F369D;">' + cat.label + '</b>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;">';
      cat.items.forEach(function (item) {
        var id = "lr-item-" + cat.key + "-" + cat.items.indexOf(item);
        html += '<label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="checkbox" data-lr-item="' + escapeHtml(item) + '"' + (selected[item] ? ' checked' : '') + '> ' + escapeHtml(item) + '</label>';
      });
      html += '</div></div>';
    });
    html += '<div class="field" style="margin-top:12px;"><label>Others (اختياري)</label><textarea id="lr-others" rows="2" placeholder="تحاليل تانية غير موجودة في القائمة">' + escapeHtml(r.others_text || '') + '</textarea></div>' +
      '<button class="btn block" id="lr-save" style="margin-top:10px;">حفظ</button></div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("lr-save").onclick = function () {
      var tests = [];
      backdrop.querySelectorAll("[data-lr-item]").forEach(function (cb) {
        if (cb.checked) tests.push(cb.getAttribute("data-lr-item"));
      });
      var patch = {
        report_date: document.getElementById("lr-date").value || new Date().toISOString().slice(0, 10),
        doctor_name: document.getElementById("lr-doctor").value.trim(),
        diagnosis: document.getElementById("lr-diagnosis").value.trim(),
        tests: tests,
        others_text: document.getElementById("lr-others").value.trim()
      };
      if (isEdit) patch.id = existingLr.id;
      window.SSMPDDb.saveLabRequest(patient.id, patch, me && me.id).then(function () {
        T.show(isEdit ? "اتحدث طلب التحاليل" : "اتحفظ طلب التحاليل");
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // بيطبع البنود المختارة (اللي عليها تشيك) بس — مش القائمة كاملة — عشان
  // المحتوى يفضل قصير وميعديش صفحة واحدة (لو القائمة كاملة اتطبعت، البنود
  // بتفيض لصفحة تانية وبتتراكب مع صورة الهيدر المتكررة تلقائيًا فوق كل صفحة)
  function printLabRequest(patient, lr) {
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var selected = {};
    (lr.tests || []).forEach(function (t) { selected[t] = true; });
    var catsHtml = "";
    LAB_CATEGORIES.forEach(function (cat) {
      var chosen = cat.items.filter(function (item) { return selected[item]; });
      if (!chosen.length) return;
      var itemsHtml = chosen.map(function (item) {
        return '<div style="font-size:12px;margin:0 0 3px;">☑ ' + escapeHtml(item) + '</div>';
      }).join("");
      catsHtml += '<div style="break-inside:avoid;margin-bottom:10px;">' +
        '<div style="font-size:12px;font-weight:700;background:#0F369D;color:#fff;padding:3px 8px;border-radius:4px;margin-bottom:4px;">' + cat.label + '</div>' +
        itemsHtml + '</div>';
    });
    var body =
      '<h1 style="font-size:26px;color:#0F369D;text-align:right;margin:0 0 4px;">Lab Request</h1>' +
      '<div style="border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:16px;"></div>' +
      '<p style="margin:0 0 4px;"><b>المريض:</b> ' + escapeHtml(patient.full_name) + '</p>' +
      (patient.age != null ? '<p style="margin:0 0 4px;"><b>العمر:</b> ' + escapeHtml(String(patient.age)) + ' عام</p>' : '') +
      '<p style="margin:0 0 4px;"><b>التاريخ:</b> ' + fmtDate(lr.report_date) + '</p>' +
      (lr.doctor_name ? '<p style="margin:0 0 4px;"><b>الطبيب:</b> ' + escapeHtml(lr.doctor_name) + '</p>' : '') +
      (lr.diagnosis ? '<p style="margin:0 0 16px;"><b>التشخيص:</b> ' + escapeHtml(lr.diagnosis) + '</p>' : '<div style="margin-bottom:16px;"></div>') +
      (catsHtml ? '<div style="columns:2;column-gap:16px;direction:ltr;text-align:left;">' + catsHtml + '</div>' : '<p style="font-size:12px;color:#888;">مفيش تحاليل متعلّم عليها.</p>') +
      (lr.others_text ? '<div style="margin-top:14px;direction:rtl;text-align:right;"><b>Others:</b> ' + escapeHtml(lr.others_text) + '</div>' : '');
    win.document.open();
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Lab Request — ' + escapeHtml(patient.full_name) + '</title>' +
      '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;font-size:14px;line-height:1.5;}</style></head>' +
      '<body>' + letterheadPageHtml("rtl", body) + '</body></html>');
    win.document.close();
    waitForImagesThenPrint(win, 3000);
  }

  // ---------- فورم طلب أشعة (Radiology/Imaging Request) — تشيك ليست قابلة للطباعة ----------
  var RADIOLOGY_CATEGORIES = [
    { key: "mri", label: "MRI", items: ["Brain", "MRA Brain", "MRA Neck", "Soft Tissue Neck", "Cervical Spine", "Thoracic Spine", "Lumber Spine", "Abdomen", "MRA Abdomen", "Pelvis", "With contrast"], lrItems: ["Shoulder", "Elbow", "Wrist", "Hip", "Knee", "Ankle", "Arthrogram"] },
    { key: "ct", label: "CT", items: ["Brain", "Sinus", "Soft Tissue Neck", "Cervical Spine", "Thoracic Spine", "Lumber Spine", "Urogram", "Renal Stone", "Angio", "Chest", "Abdomen", "Pelvis", "Abdomen/Pelvis", "Chest/Abdomen/Pelvis", "Add 3D Images", "With Contrast"] },
    { key: "breast_imaging", label: "Breast Imaging", items: ["Screening Mammogram", "Diagnostic Mammogram", "Localization - Seed", "Localization - Wire", "Localization - Mammography", "Localization - Ultrasound", "Localization - MRI", "Localization - US Axillary Lymph node", "Biopsy - Mammography", "Biopsy - Ultrasound", "Biopsy - MRI", "Cyst Aspiration"] },
    { key: "ultrasound", label: "Ultrasound", items: ["Abdomen", "Pelvis", "OBST & GYN", "Scrotal", "Appendix", "Thyroid", "Lymph node Mapping"] },
    { key: "nuclear_medicine", label: "Nuclear Medicine", items: ["Cardiac - Myocardial Perfusion Imaging", "Cardiac - Treadmill", "Cardiac - Pharmacological", "Cardiac - MUGA", "Bone Scan - Whole Body", "Bone Scan - SPSCT", "Bone Scan - Multiple Area", "PET/CT - Skull Base To Mid Thigh", "PET/CT - Whole Body", "PET/CT - Brain"] },
    { key: "radiology", label: "Radiology", items: ["Esophagram", "Upper GIT", "Small Bowel Follow Through", "Barium Enema", "Abdomen Supine", "Abdomen Supine and Upright", "Pelvis", "Chest X-Ray", "Ribs", "Cervical Spine"], lrItems: ["Shoulder", "Humerus", "Elbow", "Forearm", "Wrist", "Hand", "Finger", "Femur", "Hip", "Knee", "Tibia/Fibula", "Ankle", "Foot", "Toe"] }
  ];

  function openRadiologyRequestFormModal(patient, existingRr, onSaved) {
    var r = existingRr || {};
    var isEdit = !!existingRr;
    var selected = {};
    (r.items || []).forEach(function (t) { selected[t] = true; });
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var html = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل طلب الأشعة" : "طلب أشعة جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + (patient.age != null ? (' — ' + patient.age + ' عام') : '') + '</p>' +
      '<div class="field"><label>تاريخ الطلب</label><input id="rr-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field"><label>اسم الطبيب</label><input id="rr-doctor" type="text" placeholder="اسم الطبيب" value="' + escapeHtml(r.doctor_name || '') + '"></div>' +
      '<div class="field"><label>التشخيص المبدئي (اختياري)</label><input id="rr-diagnosis" type="text" placeholder="التشخيص" value="' + escapeHtml(r.diagnosis || '') + '"></div>';
    RADIOLOGY_CATEGORIES.forEach(function (cat) {
      html += '<div style="margin-top:12px;"><b style="font-size:12px;color:#0F369D;">' + cat.label + '</b>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;">';
      cat.items.forEach(function (item) {
        html += '<label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="checkbox" data-rr-item="' + escapeHtml(item) + '"' + (selected[item] ? ' checked' : '') + '> ' + escapeHtml(item) + '</label>';
      });
      if (cat.lrItems) {
        cat.lrItems.forEach(function (item) {
          html += '<label style="font-size:12px;display:flex;align-items:center;gap:4px;background:#f2f2f2;border-radius:4px;padding:2px 6px;">' + escapeHtml(item) + ':' +
            '<span style="display:flex;align-items:center;gap:2px;"><input type="checkbox" data-rr-item="' + escapeHtml(item + " - L") + '"' + (selected[item + " - L"] ? ' checked' : '') + '> L</span>' +
            '<span style="display:flex;align-items:center;gap:2px;"><input type="checkbox" data-rr-item="' + escapeHtml(item + " - R") + '"' + (selected[item + " - R"] ? ' checked' : '') + '> R</span></label>';
        });
      }
      html += '</div></div>';
    });
    html += '<div class="field" style="margin-top:12px;"><label>Others (اختياري)</label><textarea id="rr-others" rows="2" placeholder="أشعة تانية غير موجودة في القائمة">' + escapeHtml(r.others_text || '') + '</textarea></div>' +
      '<button class="btn block" id="rr-save" style="margin-top:10px;">حفظ</button></div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("rr-save").onclick = function () {
      var items = [];
      backdrop.querySelectorAll("[data-rr-item]").forEach(function (cb) {
        if (cb.checked) items.push(cb.getAttribute("data-rr-item"));
      });
      var patch = {
        report_date: document.getElementById("rr-date").value || new Date().toISOString().slice(0, 10),
        doctor_name: document.getElementById("rr-doctor").value.trim(),
        diagnosis: document.getElementById("rr-diagnosis").value.trim(),
        items: items,
        others_text: document.getElementById("rr-others").value.trim()
      };
      if (isEdit) patch.id = existingRr.id;
      window.SSMPDDb.saveRadiologyRequest(patient.id, patch, me && me.id).then(function () {
        T.show(isEdit ? "اتحدث طلب الأشعة" : "اتحفظ طلب الأشعة");
        backdrop.remove();
        if (onSaved) onSaved();
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // بيطبع البنود المختارة (اللي عليها تشيك) بس — نفس سبب طلب التحاليل بالظبط
  // (تفادي فيضان المحتوى لصفحة تانية وتراكبه مع الهيدر المتكرر)
  function printRadiologyRequest(patient, rr) {
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var selected = {};
    (rr.items || []).forEach(function (t) { selected[t] = true; });
    var catsHtml = "";
    RADIOLOGY_CATEGORIES.forEach(function (cat) {
      var chosen = cat.items.filter(function (item) { return selected[item]; });
      var itemsHtml = chosen.map(function (item) {
        return '<div style="font-size:11px;margin:0 0 3px;">☑ ' + escapeHtml(item) + '</div>';
      }).join("");
      if (cat.lrItems) {
        itemsHtml += cat.lrItems.filter(function (item) {
          return selected[item + " - L"] || selected[item + " - R"];
        }).map(function (item) {
          var sides = [];
          if (selected[item + " - L"]) sides.push("L");
          if (selected[item + " - R"]) sides.push("R");
          return '<div style="font-size:11px;margin:0 0 3px;">☑ ' + escapeHtml(item) + ' (' + sides.join("، ") + ')</div>';
        }).join("");
      }
      if (!itemsHtml) return;
      catsHtml += '<div style="break-inside:avoid;margin-bottom:10px;">' +
        '<div style="font-size:12px;font-weight:700;background:#0F369D;color:#fff;padding:3px 8px;border-radius:4px;margin-bottom:4px;">' + cat.label + '</div>' +
        itemsHtml + '</div>';
    });
    var body =
      '<h1 style="font-size:24px;color:#0F369D;text-align:right;margin:0 0 4px;">Diagnostic Imaging Request</h1>' +
      '<div style="border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:16px;"></div>' +
      '<p style="margin:0 0 4px;"><b>المريض:</b> ' + escapeHtml(patient.full_name) + '</p>' +
      (patient.age != null ? '<p style="margin:0 0 4px;"><b>العمر:</b> ' + escapeHtml(String(patient.age)) + ' عام</p>' : '') +
      '<p style="margin:0 0 4px;"><b>التاريخ:</b> ' + fmtDate(rr.report_date) + '</p>' +
      (rr.doctor_name ? '<p style="margin:0 0 4px;"><b>الطبيب:</b> ' + escapeHtml(rr.doctor_name) + '</p>' : '') +
      (rr.diagnosis ? '<p style="margin:0 0 16px;"><b>التشخيص:</b> ' + escapeHtml(rr.diagnosis) + '</p>' : '<div style="margin-bottom:16px;"></div>') +
      (catsHtml ? '<div style="columns:2;column-gap:16px;direction:ltr;text-align:left;">' + catsHtml + '</div>' : '<p style="font-size:12px;color:#888;">مفيش بنود أشعة متعلّم عليها.</p>') +
      (rr.others_text ? '<div style="margin-top:14px;direction:rtl;text-align:right;"><b>Others:</b> ' + escapeHtml(rr.others_text) + '</div>' : '');
    win.document.open();
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Diagnostic Imaging Request — ' + escapeHtml(patient.full_name) + '</title>' +
      '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;font-size:14px;line-height:1.5;}</style></head>' +
      '<body>' + letterheadPageHtml("rtl", body) + '</body></html>');
    win.document.close();
    waitForImagesThenPrint(win, 3000);
  }

  // ---------- فورم "تقييم تجربة المريض" — نفس نص/ترتيب استبيان "سعادة الزوار"
  //            الرسمي بالحرف (٦ أسئلة × مقياس ١-٥ + كومنت اختياري). تكراري لكل
  //            زيارة (مش upsert لصف واحد) — كل حفظ بيضيف تقييم جديد. الفورم ده
  //            مشترك بين ملف المريض (render-patients.js) وتاب "تقييمات العملاء"
  //            (render-leads.js) عن طريق window.SSMPDRenderPatients — نفس
  //            الفورم بالحرف زي ما طلب المستخدم، فرق الاستخدام بس إن خدمة
  //            العملاء بتدوّر على المريض الأول (search_patients_basic) قبل ما
  //            تفتحه ----------
  function openExperienceRatingFormModal(patient, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var scoreLabels = { 1: "غير راضٍ", 2: "2", 3: "3", 4: "4", 5: "راضٍ جدًا" };
    var html = '<div class="modal"><div class="modal-head"><h3>تقييم تجربة جديد</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:14px;font-weight:700;margin:-6px 0 2px;">' + escapeHtml(patient.full_name) + '</p>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:0 0 12px;line-height:1.7;">نسعى دائماً إلى تحسين جودة الخدمة إلى المستوى الذي تستحقونه.<br>هذا الاستبيان سوف يساعدنا في تحقيق ذلك.</p>' +
      '<div class="field"><label>تاريخ الزيارة</label><input id="er-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>';
    window.SSMPDExperienceQuestions.forEach(function (q, i) {
      html += '<div style="margin-top:14px;">' +
        '<div style="font-size:13px;font-weight:700;margin-bottom:6px;">' + (i + 1) + '. ' + escapeHtml(q) + '</div>' +
        '<div style="display:flex;gap:22px;">' +
        [1, 2, 3, 4, 5].map(function (n) {
          return '<label style="font-size:12px;display:flex;flex-direction:column;align-items:center;gap:3px;width:34px;"><input type="radio" name="er-q' + i + '" value="' + n + '"><span>' + n + '</span>' +
            (n === 1 ? '<span style="font-size:10px;color:var(--c-muted);white-space:nowrap;">غير راضٍ</span>' : '') +
            (n === 5 ? '<span style="font-size:10px;color:var(--c-muted);white-space:nowrap;">راضٍ جدًا</span>' : '') +
            '</label>';
        }).join("") +
        '</div>' +
        '</div>';
    });
    html += '<div class="field" style="margin-top:14px;"><label>كومنت العميل (اختياري)</label><textarea id="er-comment" rows="2" placeholder="أي ملاحظات من العميل"></textarea></div>' +
      '<button class="btn block" id="er-save" style="margin-top:12px;">حفظ التقييم</button></div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("er-save").onclick = function () {
      var ratings = [];
      for (var i = 0; i < window.SSMPDExperienceQuestions.length; i++) {
        var checked = backdrop.querySelector('input[name="er-q' + i + '"]:checked');
        if (!checked) { T.show("جاوب على كل الأسئلة الأول", "error"); return; }
        ratings.push(Number(checked.value));
      }
      var patch = {
        visit_date: document.getElementById("er-date").value || new Date().toISOString().slice(0, 10),
        ratings: ratings,
        comment: document.getElementById("er-comment").value.trim()
      };
      var curAdmin = (window.SSMPDAuth && window.SSMPDAuth.currentAdmin) || me;
      window.SSMPDDb.saveExperienceRating(patient.id, patch, curAdmin && curAdmin.id).then(function () {
        // البيانات اتحفظت خلاص في قاعدة البيانات — دلوقتي بس بنعرض رسالة شكر
        // ثم نقفل الشاشة تلقائيًا (أو المستخدم يقفلها بنفسه بالضغط على "إغلاق")
        backdrop.querySelector(".modal").innerHTML =
          '<div style="padding:40px 20px;text-align:center;">' +
          '<div style="font-size:40px;margin-bottom:14px;">🎉</div>' +
          '<h3 style="margin-bottom:8px;">نشكركم على تعاونكم معنا</h3>' +
          '<button class="btn" id="er-close-thanks" style="margin-top:16px;">إغلاق</button></div>';
        var closed = false;
        var closeNow = function () {
          if (closed) return;
          closed = true;
          if (document.body.contains(backdrop)) backdrop.remove();
          if (onSaved) onSaved();
        };
        document.getElementById("er-close-thanks").onclick = closeNow;
        backdrop.onclick = function (e) { if (e.target === backdrop) closeNow(); };
        setTimeout(closeNow, 4000);
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  function experienceRatingAvg(r) {
    var arr = r.ratings || [];
    if (!arr.length) return null;
    return (arr.reduce(function (a, b) { return a + b; }, 0) / arr.length);
  }

  // ---------- فورم Echocardiography Report (إنشاء/تعديل) ----------
  var ECHO_DIMENSIONS = [
    { key: "lvedd", label: "LVEDD", ref: "3.5 -5.6 cm" },
    { key: "lvesd", label: "LVESD", ref: "" },
    { key: "lv_swt", label: "LV SWT", ref: "0.7 – 1.1 cm" },
    { key: "lv_pwt", label: "LV PWT", ref: "0.7 – 1.1 cm" },
    { key: "ef", label: "EF", ref: ">50%" },
    { key: "left_atrium", label: "Left Atrium", ref: "1.9 – 4.0 cm" },
    { key: "ao_root", label: "Ao Root", ref: "2.0 - 3.7 cm" },
    { key: "ao_excursion", label: "Ao Excursion", ref: "1.6 -2.6 cm" },
    { key: "rt_ventricle", label: "Rt. Ventricle", ref: "0.7 – 2.7 cm" },
    { key: "fs", label: "FS", ref: "25 – 45 %" }
  ];
  // صور الأشعة المرفقة بتقرير Echo — عدد غير محدود (مش سقف ثابت زي 2 أو 10)،
  // كل صورة بتترفع زي أي ملف مريض عادي (فئة "أشعة") وبتترتبط بالتقرير ده
  // تحديداً عن طريق صف ربط. الصور بتتحمّل من السيرفر مرة واحدة لما المودال
  // يتفتح — مفيش استعلام متكرر كل تفاعل.
  function renderEchoImagesList(container, images) {
    if (!images.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش صور مرفقة لسه.</p>';
      return;
    }
    var html = "";
    images.forEach(function (im) {
      var f = im.patient_files || {};
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
        '<div><b>' + escapeHtml(f.file_name || "—") + '</b><br>' +
        '<span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) + '</span></div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button class="btn ghost sm" data-echo-img-view="' + f.id + '">عرض</button>' +
        '<button class="btn ghost sm" data-echo-img-dl="' + f.id + '" data-echo-img-name="' + escapeHtml(f.file_name || "") + '">تنزيل</button>' +
        '<button class="btn danger sm" data-echo-img-del="' + f.id + '">حذف</button></div></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll("[data-echo-img-view]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-echo-img-view");
        var win = window.open("", "_blank");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          if (win) win.location.href = url;
          else { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
          btn.disabled = false;
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (e) {
          if (win) win.close();
          T.show("خطأ: " + e.message, "error");
          btn.disabled = false;
        });
      };
    });
    container.querySelectorAll("[data-echo-img-dl]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-echo-img-dl");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          var a = document.createElement("a");
          a.href = url; a.download = res.filename || btn.getAttribute("data-echo-img-name") || "image";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          btn.disabled = false;
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; });
      };
    });
    container.querySelectorAll("[data-echo-img-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains("confirm-pending")) {
          var fileId = btn.getAttribute("data-echo-img-del");
          btn.disabled = true;
          window.SSMPDDb.deletePatientFile(fileId).then(function () {
            T.show("اتحذفت الصورة");
            btn.closest("div[style*='justify-content:space-between']").remove();
          }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; });
          return;
        }
        btn.classList.add("confirm-pending");
        btn.textContent = "تأكيد الحذف؟";
        setTimeout(function () { btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; }, 3000);
      };
    });
  }

  function loadEchoImages(reportId, container) {
    container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">بيحمّل…</p>';
    window.SSMPDDb.listEchoReportImages(reportId).then(function (images) {
      renderEchoImagesList(container, images || []);
    }).catch(function (e) { container.innerHTML = '<p style="font-size:12px;color:var(--c-danger,#c0392b);">خطأ: ' + escapeHtml(e.message) + '</p>'; });
  }

  function openEchoReportFormModal(patient, existingReport, onSaved) {
    var r = existingReport || {};
    var dims = r.dimensions || {};
    var isEdit = !!existingReport;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    var html = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل تقرير Echo" : "تقرير Echo جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>الاسم زي ما هيتطبع</label><input id="er-name" value="' + escapeHtml(r.patient_label || patient.full_name || '') + '"></div>' +
      '<div style="display:flex;gap:8px;">' +
      '<div class="field" style="flex:1;"><label>التاريخ</label><input id="er-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field" style="flex:1;"><label>Referred By</label><input id="er-referred" value="' + escapeHtml(r.referred_by || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Dimensions</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;">';
    ECHO_DIMENSIONS.forEach(function (d) {
      html += '<div style="display:flex;align-items:center;gap:6px;font-size:12px;">' +
        '<span style="flex:0 0 90px;">' + d.label + (d.ref ? ' <span style="color:var(--c-muted);font-size:10px;">(' + d.ref + ')</span>' : '') + '</span>' +
        '<input data-echo-dim="' + d.key + '" value="' + escapeHtml(dims[d.key] || '') + '" style="flex:1;padding:4px 6px;"></div>';
    });
    html += '</div></div>' +
      '<div class="field"><label>Summary</label><textarea id="er-summary" rows="8" placeholder="سطر عادي = عنوان بولد (➢)، وسطر يبدأ بـ - = تفصيل تحته (•)">' + escapeHtml(r.summary_text || '') + '</textarea></div>' +
      '<div class="field"><label>Conclusion</label><textarea id="er-conclusion" rows="4">' + escapeHtml(r.conclusion_text || '') + '</textarea></div>' +
      '<div class="field"><label>اسم الطبيب الموقّع</label><input id="er-doctor" value="' + escapeHtml(r.doctor_name || 'Dr. Haytham Shaaban (MSc)') + '"></div>' +
      '<div class="field" style="margin-top:6px;"><label>صور الأشعة المرفقة (عدد مفتوح — اختار كذا صورة مرة واحدة)</label>' +
      (isEdit ?
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<input type="file" id="er-images-input" accept="image/*" multiple style="flex:1;">' +
        '<button class="btn ghost sm" id="er-images-add">إضافة</button></div>' +
        '<div id="er-images-status" style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>' +
        '<div id="er-images-list"></div>'
        : '<p style="font-size:12px;color:var(--c-muted);">احفظ التقرير الأول، وبعدين هيظهر لك اختيار إضافة صور.</p>') +
      '</div>' +
      '<button class="btn block" id="er-save">حفظ</button></div>';
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    if (isEdit) {
      loadEchoImages(existingReport.id, document.getElementById("er-images-list"));
      document.getElementById("er-images-add").onclick = function () {
        var input = document.getElementById("er-images-input");
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) { T.show("اختار صورة أو أكتر الأول", "error"); return; }
        var statusEl = document.getElementById("er-images-status");
        var addBtn = document.getElementById("er-images-add");
        addBtn.disabled = true;
        var done = 0;
        statusEl.textContent = "بيرفع 0/" + files.length + "…";
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            var fd = new FormData();
            fd.append("patient_id", patient.id);
            fd.append("category", "radiology");
            fd.append("other_description", "صورة مرفقة بتقرير Echo — " + (r.report_date || existingReport.report_date || ""));
            fd.append("file", file);
            return window.SSMPDDb.uploadPatientFile(fd).then(function (res) {
              return window.SSMPDDb.linkEchoReportImage(existingReport.id, res.file.id);
            }).then(function () {
              done++;
              statusEl.textContent = "بيرفع " + done + "/" + files.length + "…";
            });
          });
        });
        chain.then(function () {
          statusEl.textContent = "";
          addBtn.disabled = false;
          input.value = "";
          T.show("اتضافت الصور");
          loadEchoImages(existingReport.id, document.getElementById("er-images-list"));
        }).catch(function (e) {
          statusEl.textContent = "";
          addBtn.disabled = false;
          T.show("خطأ في رفع الصور: " + e.message, "error");
          loadEchoImages(existingReport.id, document.getElementById("er-images-list"));
        });
      };
    }

    document.getElementById("er-save").onclick = function () {
      var newDims = {};
      backdrop.querySelectorAll("[data-echo-dim]").forEach(function (inp) {
        var v = inp.value.trim();
        if (v) newDims[inp.getAttribute("data-echo-dim")] = v;
      });
      var patch = {
        patient_label: document.getElementById("er-name").value.trim() || patient.full_name,
        report_date: document.getElementById("er-date").value || new Date().toISOString().slice(0, 10),
        referred_by: document.getElementById("er-referred").value.trim() || null,
        dimensions: newDims,
        summary_text: document.getElementById("er-summary").value.trim(),
        conclusion_text: document.getElementById("er-conclusion").value.trim(),
        doctor_name: document.getElementById("er-doctor").value.trim() || "Dr. Haytham Shaaban (MSc)"
      };
      if (isEdit) patch.id = existingReport.id;
      window.SSMPDDb.saveEchoReport(patient.id, patch, me && me.id).then(function (saved) {
        if (onSaved) onSaved();
        if (!isEdit) {
          // تقرير جديد: بدل ما نقفل المودال، نفتحه تاني في وضع التعديل فورًا
          // عشان يقدر يضيف صور من غير ما يدوّر على زرار "تعديل" تاني
          T.show("اتحفظ التقرير — تقدر تضيف صور دلوقتي");
          backdrop.remove();
          openEchoReportFormModal(patient, saved, onSaved);
        } else {
          T.show("اتحدث التقرير");
          backdrop.remove();
        }
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- جدول جلسات ديناميكي (إضافة/حذف صف) — مشترك بين تقرير الأسنان والعلاج الطبيعي ----------
  function addSessionRowHtml(rowHtml, container) {
    var row = document.createElement("div");
    row.innerHTML = rowHtml;
    row = row.firstElementChild;
    container.appendChild(row);
    row.querySelector("[data-remove-session]").onclick = function () { row.remove(); };
    return row;
  }

  // ---------- فورم "تقرير أسنان" (إنشاء/تعديل) ----------
  function dentalSessionRowHtml(s) {
    s = s || {};
    return '<div class="session-row" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">' +
      '<input type="date" data-sess-date value="' + escapeHtml(s.date || '') + '" style="flex:1;">' +
      '<input data-sess-tooth placeholder="رقم السن" value="' + escapeHtml(s.tooth || '') + '" style="flex:1;">' +
      '<input data-sess-service placeholder="الخدمة اللي اتعملت" value="' + escapeHtml(s.service || '') + '" style="flex:2;">' +
      '<input data-sess-notes placeholder="ملاحظات" value="' + escapeHtml(s.notes || '') + '" style="flex:2;">' +
      '<button type="button" class="btn danger sm" data-remove-session>حذف</button></div>';
  }

  // صور أشعة الأسنان المرفقة بتقرير الأسنان — نفس نمط صور Echo تمامًا
  function renderDentalImagesList(container, images) {
    if (!images.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش صور مرفقة لسه.</p>';
      return;
    }
    var html = "";
    images.forEach(function (im) {
      var f = im.patient_files || {};
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
        '<div><b>' + escapeHtml(f.file_name || "—") + '</b><br>' +
        '<span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) + '</span></div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button class="btn ghost sm" data-dental-img-view="' + f.id + '">عرض</button>' +
        '<button class="btn ghost sm" data-dental-img-dl="' + f.id + '" data-dental-img-name="' + escapeHtml(f.file_name || "") + '">تنزيل</button>' +
        '<button class="btn danger sm" data-dental-img-del="' + f.id + '">حذف</button></div></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll("[data-dental-img-view]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-dental-img-view");
        var win = window.open("", "_blank");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          if (win) win.location.href = url;
          else { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
          btn.disabled = false;
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (e) {
          if (win) win.close();
          T.show("خطأ: " + e.message, "error");
          btn.disabled = false;
        });
      };
    });
    container.querySelectorAll("[data-dental-img-dl]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-dental-img-dl");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          var a = document.createElement("a");
          a.href = url; a.download = res.filename || btn.getAttribute("data-dental-img-name") || "image";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          btn.disabled = false;
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; });
      };
    });
    container.querySelectorAll("[data-dental-img-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains("confirm-pending")) {
          var fileId = btn.getAttribute("data-dental-img-del");
          btn.disabled = true;
          window.SSMPDDb.deletePatientFile(fileId).then(function () {
            T.show("اتحذفت الصورة");
            btn.closest("div[style*='justify-content:space-between']").remove();
          }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; });
          return;
        }
        btn.classList.add("confirm-pending");
        btn.textContent = "تأكيد الحذف؟";
        setTimeout(function () { btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; }, 3000);
      };
    });
  }

  function loadDentalImages(reportId, container) {
    container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">بيحمّل…</p>';
    window.SSMPDDb.listDentalReportImages(reportId).then(function (images) {
      renderDentalImagesList(container, images || []);
    }).catch(function (e) { container.innerHTML = '<p style="font-size:12px;color:var(--c-danger,#c0392b);">خطأ: ' + escapeHtml(e.message) + '</p>'; });
  }

  // صور مرفقة بتقرير العلاج الطبيعي — نفس نمط صور الأسنان/Echo تمامًا
  function renderPhysioImagesList(container, images) {
    if (!images.length) {
      container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">مفيش صور مرفقة لسه.</p>';
      return;
    }
    var html = "";
    images.forEach(function (im) {
      var f = im.patient_files || {};
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
        '<div><b>' + escapeHtml(f.file_name || "—") + '</b><br>' +
        '<span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) + '</span></div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0;">' +
        '<button class="btn ghost sm" data-physio-img-view="' + f.id + '">عرض</button>' +
        '<button class="btn ghost sm" data-physio-img-dl="' + f.id + '" data-physio-img-name="' + escapeHtml(f.file_name || "") + '">تنزيل</button>' +
        '<button class="btn danger sm" data-physio-img-del="' + f.id + '">حذف</button></div></div>';
    });
    container.innerHTML = html;
    container.querySelectorAll("[data-physio-img-view]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-physio-img-view");
        var win = window.open("", "_blank");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          if (win) win.location.href = url;
          else { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
          btn.disabled = false;
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (e) {
          if (win) win.close();
          T.show("خطأ: " + e.message, "error");
          btn.disabled = false;
        });
      };
    });
    container.querySelectorAll("[data-physio-img-dl]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-physio-img-dl");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          var a = document.createElement("a");
          a.href = url; a.download = res.filename || btn.getAttribute("data-physio-img-name") || "image";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          btn.disabled = false;
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; });
      };
    });
    container.querySelectorAll("[data-physio-img-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains("confirm-pending")) {
          var fileId = btn.getAttribute("data-physio-img-del");
          btn.disabled = true;
          window.SSMPDDb.deletePatientFile(fileId).then(function () {
            T.show("اتحذفت الصورة");
            btn.closest("div[style*='justify-content:space-between']").remove();
          }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; });
          return;
        }
        btn.classList.add("confirm-pending");
        btn.textContent = "تأكيد الحذف؟";
        setTimeout(function () { btn.classList.remove("confirm-pending"); btn.textContent = "حذف"; }, 3000);
      };
    });
  }

  function loadPhysioImages(reportId, container) {
    container.innerHTML = '<p style="font-size:12px;color:var(--c-muted);">بيحمّل…</p>';
    window.SSMPDDb.listPhysioReportImages(reportId).then(function (images) {
      renderPhysioImagesList(container, images || []);
    }).catch(function (e) { container.innerHTML = '<p style="font-size:12px;color:var(--c-danger,#c0392b);">خطأ: ' + escapeHtml(e.message) + '</p>'; });
  }

  function openDentalReportFormModal(patient, existingReport, onSaved) {
    var r = existingReport || {};
    var isEdit = !!existingReport;
    var toothMarks = (r.tooth_marks || []).slice();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل تقرير الأسنان" : "تقرير أسنان جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + '</p>' +
      '<div style="display:flex;gap:8px;">' +
      '<div class="field" style="flex:1;"><label>التاريخ</label><input id="dr-date" type="date" value="' + (r.report_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field" style="flex:1;"><label>اسم الطبيب</label><input id="dr-doctor" value="' + escapeHtml(r.doctor_name || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>الشكوى (Chief Complaint)</label><textarea id="dr-complaint" rows="2">' + escapeHtml(r.chief_complaint || '') + '</textarea></div>' +
      '<div class="field"><label>الحالة المزمنة</label><input id="dr-chronic-cond" value="' + escapeHtml(r.chronic_condition || '') + '"></div>' +
      '<div class="field"><label>علاج الأسنان السابق</label><input id="dr-prev-treatment" value="' + escapeHtml(r.previous_treatment || '') + '"></div>' +
      '<div class="field"><label>خطة العلاج المقترحة</label><textarea id="dr-plan" rows="2">' + escapeHtml(r.treatment_plan || '') + '</textarea></div>' +
      '<div class="field"><label>التركيبة (ثابتة / متحركة)</label><input id="dr-prosthesis" value="' + escapeHtml(r.prosthesis_type || '') + '"></div>' +
      '<div class="field"><label>الأمراض المزمنة</label><input id="dr-illnesses" value="' + escapeHtml(r.chronic_illnesses || '') + '"></div>' +
      '<div class="field"><label>مخطط الأسنان (اضغط على السن لتحديد مكانه)</label>' +
      '<div id="td-canvas" style="position:relative;display:inline-block;border:1px solid var(--c-border);border-radius:8px;overflow:hidden;cursor:crosshair;">' +
      '<img id="td-img" src="assets/img/dental-teeth-chart.png" style="display:block;width:680px;max-width:100%;" draggable="false"></div>' +
      '<div id="td-list" style="margin-top:8px;"></div></div>' +
      '<div class="field" style="margin-top:6px;"><label>أشعة الأسنان المرفقة (عدد مفتوح — اختار كذا صورة مرة واحدة)</label>' +
      (isEdit ?
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<input type="file" id="dr-images-input" accept="image/*" multiple style="flex:1;">' +
        '<button class="btn ghost sm" id="dr-images-add">إضافة</button></div>' +
        '<div id="dr-images-status" style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>' +
        '<div id="dr-images-list"></div>'
        : '<p style="font-size:12px;color:var(--c-muted);">احفظ التقرير الأول، وبعدين هيظهر لك اختيار إضافة صور الأشعة.</p>') +
      '</div>' +
      '<div class="field"><label>جدول الجلسات</label><div id="dr-sessions"></div>' +
      '<button type="button" class="btn ghost sm" id="dr-add-session">+ إضافة جلسة</button></div>' +
      '<button class="btn block" id="dr-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    if (isEdit) {
      loadDentalImages(existingReport.id, document.getElementById("dr-images-list"));
      document.getElementById("dr-images-add").onclick = function () {
        var input = document.getElementById("dr-images-input");
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) { T.show("اختار صورة أو أكتر الأول", "error"); return; }
        var statusEl = document.getElementById("dr-images-status");
        var addBtn = document.getElementById("dr-images-add");
        addBtn.disabled = true;
        var done = 0;
        statusEl.textContent = "بيرفع 0/" + files.length + "…";
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            var fd = new FormData();
            fd.append("patient_id", patient.id);
            fd.append("category", "radiology");
            fd.append("other_description", "أشعة أسنان مرفقة بتقرير الأسنان — " + (r.report_date || existingReport.report_date || ""));
            fd.append("file", file);
            return window.SSMPDDb.uploadPatientFile(fd).then(function (res) {
              return window.SSMPDDb.linkDentalReportImage(existingReport.id, res.file.id);
            }).then(function () {
              done++;
              statusEl.textContent = "بيرفع " + done + "/" + files.length + "…";
            });
          });
        });
        chain.then(function () {
          statusEl.textContent = "";
          addBtn.disabled = false;
          input.value = "";
          T.show("اتضافت الصور");
          loadDentalImages(existingReport.id, document.getElementById("dr-images-list"));
        }).catch(function (e) {
          statusEl.textContent = "";
          addBtn.disabled = false;
          T.show("خطأ في رفع الصور: " + e.message, "error");
          loadDentalImages(existingReport.id, document.getElementById("dr-images-list"));
        });
      };
    }

    var sessionsContainer = document.getElementById("dr-sessions");
    (r.sessions && r.sessions.length ? r.sessions : []).forEach(function (s) { addSessionRowHtml(dentalSessionRowHtml(s), sessionsContainer); });
    document.getElementById("dr-add-session").onclick = function () { addSessionRowHtml(dentalSessionRowHtml(), sessionsContainer); };

    // ---------- تحديد مكان السن: نفس نمط نقاط الألم في تقرير العلاج الطبيعي ----------
    var tdCanvas = document.getElementById("td-canvas");
    var tdList = document.getElementById("td-list");
    function renderToothMarks() {
      tdCanvas.querySelectorAll(".td-dot").forEach(function (d) { d.remove(); });
      toothMarks.forEach(function (p, i) {
        var dot = document.createElement("div");
        dot.className = "td-dot";
        dot.title = p.note || "";
        dot.style.cssText = "position:absolute;width:16px;height:16px;border-radius:50%;background:#0F369D;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translate(-50%,-50%);cursor:pointer;left:" + p.x + "%;top:" + p.y + "%;";
        dot.setAttribute("data-td-idx", i);
        tdCanvas.appendChild(dot);
      });
      tdList.innerHTML = toothMarks.length ? toothMarks.map(function (p, i) {
        return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">' +
          '<span style="font-size:11px;color:#0F369D;">● سن ' + (i + 1) + '</span>' +
          '<input data-td-note="' + i + '" placeholder="ملاحظة (اختياري)" value="' + escapeHtml(p.note || '') + '" style="flex:1;font-size:12px;padding:3px 6px;">' +
          '<button type="button" class="btn danger sm" data-td-remove="' + i + '">حذف</button></div>';
      }).join("") : '<p style="font-size:11px;color:var(--c-muted);">مفيش أسنان متحددة لسه.</p>';
      tdList.querySelectorAll("[data-td-remove]").forEach(function (btn) {
        btn.onclick = function () { toothMarks.splice(Number(btn.getAttribute("data-td-remove")), 1); renderToothMarks(); };
      });
      tdList.querySelectorAll("[data-td-note]").forEach(function (inp) {
        inp.oninput = function () { toothMarks[Number(inp.getAttribute("data-td-note"))].note = inp.value; };
      });
    }
    tdCanvas.onclick = function (e) {
      if (e.target !== tdCanvas && e.target.id !== "td-img") return;
      var rect = tdCanvas.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      toothMarks.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, note: "" });
      renderToothMarks();
    };
    renderToothMarks();

    document.getElementById("dr-save").onclick = function () {
      var sessions = Array.prototype.slice.call(sessionsContainer.querySelectorAll(".session-row")).map(function (row) {
        return {
          date: row.querySelector("[data-sess-date]").value,
          tooth: row.querySelector("[data-sess-tooth]").value.trim(),
          service: row.querySelector("[data-sess-service]").value.trim(),
          notes: row.querySelector("[data-sess-notes]").value.trim()
        };
      }).filter(function (s) { return s.date || s.tooth || s.service || s.notes; });
      var patch = {
        report_date: document.getElementById("dr-date").value || new Date().toISOString().slice(0, 10),
        doctor_name: document.getElementById("dr-doctor").value.trim(),
        chief_complaint: document.getElementById("dr-complaint").value.trim(),
        chronic_condition: document.getElementById("dr-chronic-cond").value.trim(),
        previous_treatment: document.getElementById("dr-prev-treatment").value.trim(),
        treatment_plan: document.getElementById("dr-plan").value.trim(),
        prosthesis_type: document.getElementById("dr-prosthesis").value.trim(),
        chronic_illnesses: document.getElementById("dr-illnesses").value.trim(),
        tooth_marks: toothMarks,
        sessions: sessions
      };
      if (isEdit) patch.id = existingReport.id;
      window.SSMPDDb.saveDentalReport(patient.id, patch, me && me.id).then(function (saved) {
        if (onSaved) onSaved();
        if (!isEdit) {
          // تقرير جديد: بدل ما نقفل المودال، نفتحه تاني في وضع التعديل فورًا
          // عشان يقدر يضيف صور أشعة من غير ما يدوّر على زرار "تعديل" تاني
          T.show("اتحفظ التقرير — تقدر تضيف صور أشعة دلوقتي");
          backdrop.remove();
          openDentalReportFormModal(patient, saved, onSaved);
        } else {
          T.show("اتحدث التقرير");
          backdrop.remove();
        }
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // ---------- فورم "تقرير علاج طبيعي" (إنشاء/تعديل) ----------
  var PHYSIO_TREATMENTS = ["Cryo", "Tense", "RF", "Manual", "حجامة (Cupping)", "Recovery", "Laser", "Compression"];

  function physioSessionRowHtml(s) {
    s = s || {};
    var treatments = s.treatments || [];
    var v = s.vitals || {};
    return '<div class="session-row" style="border:1px solid var(--c-border);border-radius:8px;padding:8px;margin-bottom:8px;">' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
      '<input type="date" data-sess-date value="' + escapeHtml(s.date || '') + '" style="flex:1;">' +
      '<input data-sess-duration placeholder="المدة (Time)" value="' + escapeHtml(s.duration || '') + '" style="flex:1;">' +
      '<button type="button" class="btn danger sm" data-remove-session>حذف الجلسة</button></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;margin-bottom:6px;">' +
      PHYSIO_TREATMENTS.map(function (t) {
        return '<label style="display:flex;align-items:center;gap:3px;"><input type="checkbox" data-sess-treatment value="' + t + '"' + (treatments.indexOf(t) !== -1 ? " checked" : "") + '> ' + t + '</label>';
      }).join("") +
      '</div>' +
      '<div style="font-size:11px;color:var(--c-muted);margin-bottom:3px;">القياسات الحيوية وقت الجلسة دي:</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:6px;">' +
      '<input data-sess-weight placeholder="الوزن" value="' + escapeHtml(v.weight || '') + '">' +
      '<input data-sess-pulse placeholder="النبض" value="' + escapeHtml(v.pulse || '') + '">' +
      '<input data-sess-bp placeholder="ضغط الدم" value="' + escapeHtml(v.blood_pressure || '') + '">' +
      '<input data-sess-sugar placeholder="سكر الدم" value="' + escapeHtml(v.blood_sugar || '') + '"></div>' +
      '<input data-sess-notes placeholder="ملاحظات" value="' + escapeHtml(s.notes || '') + '" style="width:100%;"></div>';
  }

  function openPhysioReportFormModal(patient, existingReport, onSaved) {
    var r = existingReport || {};
    var isEdit = !!existingReport;
    var painPoints = (r.pain_points || []).slice();
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + (isEdit ? "تعديل تقرير العلاج الطبيعي" : "تقرير علاج طبيعي جديد") + '</h3><button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin:-6px 0 10px;">المريض: ' + escapeHtml(patient.full_name) + '</p>' +
      '<div style="display:flex;gap:8px;">' +
      '<div class="field" style="flex:1;"><label>تاريخ الزيارة</label><input id="pr-date" type="date" value="' + (r.visit_date || new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="field" style="flex:1;"><label>التخصص</label><input id="pr-specialty" value="' + escapeHtml(r.specialty || 'علاج طبيعي') + '"></div>' +
      '<div class="field" style="flex:1;"><label>الطبيب المعالج</label><input id="pr-doctor" value="' + escapeHtml(r.doctor_name || '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>سبب الزيارة</label><textarea id="pr-reason" rows="2">' + escapeHtml(r.visit_reason || '') + '</textarea></div>' +
      '<p style="font-size:11px;color:var(--c-muted);margin:-4px 0 8px;">القياسات الحيوية (وزن/نبض/ضغط/سكر) بقت خانة في كل جلسة جوه "جدول الجلسات" تحت، لأنها بتتغيّر من زيارة للتانية.</p>' +
      '<div class="field"><label>هل تعاني من أمراض مزمنة؟</label><textarea id="pr-chronic" rows="2" placeholder="ضغط/سكر/غدة درقية/كلى/أورام/تنفسية/أخرى...">' + escapeHtml(r.chronic_diseases || '') + '</textarea></div>' +
      '<div class="field"><label>العمليات الجراحية</label><input id="pr-surgeries" value="' + escapeHtml(r.surgeries || '') + '"></div>' +
      '<div class="field"><label>تاريخ مرضي بالعائلة</label><input id="pr-family" value="' + escapeHtml(r.family_history || '') + '"></div>' +
      '<div class="field"><label>نقاط الألم (اضغط على الرسم لتحديد مكان الألم)</label>' +
      '<div id="pp-canvas" style="position:relative;display:inline-block;border:1px solid var(--c-border);border-radius:8px;overflow:hidden;cursor:crosshair;">' +
      '<img id="pp-img" src="assets/img/physio-body-diagram.png" style="display:block;width:680px;max-width:100%;" draggable="false"></div>' +
      '<div id="pp-list" style="margin-top:8px;"></div></div>' +
      '<div class="field" style="margin-top:6px;"><label>صور أشعة/فحوصات مرفقة (عدد مفتوح — اختار كذا صورة مرة واحدة)</label>' +
      (isEdit ?
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<input type="file" id="pr-images-input" accept="image/*" multiple style="flex:1;">' +
        '<button class="btn ghost sm" id="pr-images-add">إضافة</button></div>' +
        '<div id="pr-images-status" style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>' +
        '<div id="pr-images-list"></div>'
        : '<p style="font-size:12px;color:var(--c-muted);">احفظ التقرير الأول، وبعدين هيظهر لك اختيار إضافة الصور.</p>') +
      '</div>' +
      '<div class="field"><label>جدول الجلسات</label><div id="pr-sessions"></div>' +
      '<button type="button" class="btn ghost sm" id="pr-add-session">+ إضافة جلسة</button></div>' +
      '<button class="btn block" id="pr-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    if (isEdit) {
      loadPhysioImages(existingReport.id, document.getElementById("pr-images-list"));
      document.getElementById("pr-images-add").onclick = function () {
        var input = document.getElementById("pr-images-input");
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) { T.show("اختار صورة أو أكتر الأول", "error"); return; }
        var statusEl = document.getElementById("pr-images-status");
        var addBtn = document.getElementById("pr-images-add");
        addBtn.disabled = true;
        var done = 0;
        statusEl.textContent = "بيرفع 0/" + files.length + "…";
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            var fd = new FormData();
            fd.append("patient_id", patient.id);
            fd.append("category", "radiology");
            fd.append("other_description", "صور مرفقة بتقرير العلاج الطبيعي — " + (r.visit_date || existingReport.visit_date || ""));
            fd.append("file", file);
            return window.SSMPDDb.uploadPatientFile(fd).then(function (res) {
              return window.SSMPDDb.linkPhysioReportImage(existingReport.id, res.file.id);
            }).then(function () {
              done++;
              statusEl.textContent = "بيرفع " + done + "/" + files.length + "…";
            });
          });
        });
        chain.then(function () {
          statusEl.textContent = "";
          addBtn.disabled = false;
          input.value = "";
          T.show("اتضافت الصور");
          loadPhysioImages(existingReport.id, document.getElementById("pr-images-list"));
        }).catch(function (e) {
          statusEl.textContent = "";
          addBtn.disabled = false;
          T.show("خطأ في رفع الصور: " + e.message, "error");
          loadPhysioImages(existingReport.id, document.getElementById("pr-images-list"));
        });
      };
    }

    var sessionsContainer = document.getElementById("pr-sessions");
    (r.sessions && r.sessions.length ? r.sessions : []).forEach(function (s) { addSessionRowHtml(physioSessionRowHtml(s), sessionsContainer); });
    document.getElementById("pr-add-session").onclick = function () { addSessionRowHtml(physioSessionRowHtml(), sessionsContainer); };

    // ---------- نقاط الألم: تحديد بالضغط على الرسم بدل صورة ثابتة غير تفاعلية ----------
    var ppCanvas = document.getElementById("pp-canvas");
    var ppList = document.getElementById("pp-list");
    function renderPainPoints() {
      ppCanvas.querySelectorAll(".pp-dot").forEach(function (d) { d.remove(); });
      painPoints.forEach(function (p, i) {
        var dot = document.createElement("div");
        dot.className = "pp-dot";
        dot.title = p.note || "";
        dot.style.cssText = "position:absolute;width:16px;height:16px;border-radius:50%;background:#D0402A;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);transform:translate(-50%,-50%);cursor:pointer;left:" + p.x + "%;top:" + p.y + "%;";
        dot.setAttribute("data-pp-idx", i);
        ppCanvas.appendChild(dot);
      });
      ppList.innerHTML = painPoints.length ? painPoints.map(function (p, i) {
        return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">' +
          '<span style="font-size:11px;color:var(--c-danger,#c0392b);">● نقطة ' + (i + 1) + '</span>' +
          '<input data-pp-note="' + i + '" placeholder="ملاحظة (اختياري)" value="' + escapeHtml(p.note || '') + '" style="flex:1;font-size:12px;padding:3px 6px;">' +
          '<button type="button" class="btn danger sm" data-pp-remove="' + i + '">حذف</button></div>';
      }).join("") : '<p style="font-size:11px;color:var(--c-muted);">مفيش نقاط ألم متحددة لسه.</p>';
      ppList.querySelectorAll("[data-pp-remove]").forEach(function (btn) {
        btn.onclick = function () { painPoints.splice(Number(btn.getAttribute("data-pp-remove")), 1); renderPainPoints(); };
      });
      ppList.querySelectorAll("[data-pp-note]").forEach(function (inp) {
        inp.oninput = function () { painPoints[Number(inp.getAttribute("data-pp-note"))].note = inp.value; };
      });
    }
    ppCanvas.onclick = function (e) {
      if (e.target !== ppCanvas && e.target.id !== "pp-img") return; // كليك على نقطة موجودة مش هيضيف نقطة جديدة
      var rect = ppCanvas.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      painPoints.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, note: "" });
      renderPainPoints();
    };
    renderPainPoints();

    document.getElementById("pr-save").onclick = function () {
      var sessions = Array.prototype.slice.call(sessionsContainer.querySelectorAll(".session-row")).map(function (row) {
        var treatments = Array.prototype.slice.call(row.querySelectorAll("[data-sess-treatment]:checked")).map(function (c) { return c.value; });
        var vitals = {
          weight: row.querySelector("[data-sess-weight]").value.trim(),
          pulse: row.querySelector("[data-sess-pulse]").value.trim(),
          blood_pressure: row.querySelector("[data-sess-bp]").value.trim(),
          blood_sugar: row.querySelector("[data-sess-sugar]").value.trim()
        };
        return {
          date: row.querySelector("[data-sess-date]").value,
          duration: row.querySelector("[data-sess-duration]").value.trim(),
          treatments: treatments,
          vitals: vitals,
          notes: row.querySelector("[data-sess-notes]").value.trim()
        };
      }).filter(function (s) {
        return s.date || s.duration || s.treatments.length || s.notes ||
          s.vitals.weight || s.vitals.pulse || s.vitals.blood_pressure || s.vitals.blood_sugar;
      });
      var patch = {
        visit_date: document.getElementById("pr-date").value || new Date().toISOString().slice(0, 10),
        specialty: document.getElementById("pr-specialty").value.trim() || "علاج طبيعي",
        doctor_name: document.getElementById("pr-doctor").value.trim(),
        visit_reason: document.getElementById("pr-reason").value.trim(),
        chronic_diseases: document.getElementById("pr-chronic").value.trim(),
        surgeries: document.getElementById("pr-surgeries").value.trim(),
        family_history: document.getElementById("pr-family").value.trim(),
        pain_points: painPoints,
        sessions: sessions
      };
      if (isEdit) patch.id = existingReport.id;
      window.SSMPDDb.savePhysioReport(patient.id, patch, me && me.id).then(function (saved) {
        if (onSaved) onSaved();
        if (!isEdit) {
          // تقرير جديد: بدل ما نقفل المودال، نفتحه تاني في وضع التعديل فورًا
          // عشان يقدر يضيف صور من غير ما يدوّر على زرار "تعديل" تاني
          T.show("اتحفظ التقرير — تقدر تضيف صور دلوقتي");
          backdrop.remove();
          openPhysioReportFormModal(patient, saved, onSaved);
        } else {
          T.show("اتحدث التقرير");
          backdrop.remove();
        }
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  // بيستنى الصور تخلص تحميل فعلياً قبل ما يفتح مربع الطباعة (بدل تأخير ثابت
  // بس) — سبب معروف لظهور الصور فاضية/ناقصة في الطباعة لو المتصفح فتح مربع
  // الطباعة قبل ما الصورة تخلص تحميل من الـ blob URL. فيه سقف أقصى للانتظار
  // عشان النافذة متفضلش عالقة لو صورة فشلت تحميل.
  function waitForImagesThenPrint(win, maxWaitMs) {
    var done = false;
    function go() { if (done) return; done = true; win.focus(); win.print(); }
    var imgs = (win.document.images ? Array.prototype.slice.call(win.document.images) : []).filter(function (img) { return !img.complete; });
    if (!imgs.length) { setTimeout(go, 200); return; }
    var remaining = imgs.length;
    imgs.forEach(function (img) {
      img.addEventListener("load", function () { if (--remaining <= 0) go(); });
      img.addEventListener("error", function () { if (--remaining <= 0) go(); });
    });
    setTimeout(go, maxWaitMs || 3000);
  }

  // ---------- طباعة ملف/ملفات المريض دفعة واحدة (نافذة معاينة بتفتح مربع طباعة المتصفح تلقائي) ----------
  function printPatientFiles(fileList) {
    fileList = fileList || [];
    if (!fileList.length) { T.show("مفيش ملفات للطباعة", "error"); return; }
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    win.document.write('<p style="font-family:sans-serif;padding:20px;">بيجهّز الملفات للطباعة…</p>');
    Promise.all(fileList.map(function (f) {
      return window.SSMPDDb.downloadPatientFile(f.id).then(function (res) {
        return { name: f.file_name, url: URL.createObjectURL(res.blob), type: res.blob.type || "", category: f.category, issuedAt: f.issued_at, uploadedAt: f.uploaded_at };
      });
    })).then(function (items) {
      var body = items.map(function (it) {
        var header = filePrintHeaderHtml(it);
        if (it.type === "application/pdf") {
          return '<div style="page-break-after:always;">' + header + '<embed src="' + it.url + '" type="application/pdf" style="width:100%;height:90vh;"></div>';
        }
        if (it.type.indexOf("image/") === 0) {
          return '<div style="page-break-after:always;text-align:center;padding:10px;">' + header + '<img src="' + it.url + '" style="max-width:100%;"></div>';
        }
        return '<div style="page-break-after:always;padding:20px;">' + header + '<p>تعذّرت معاينة الملف "' + escapeHtml(it.name) + '" — نوعه غير مدعوم للطباعة المباشرة.</p></div>';
      }).join("");
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>طباعة الملفات</title><style>' + PRINT_FONT_FACE_CSS + '</style></head><body style="margin:0;">' + body + PRINT_FOOTER_HTML + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 3000);
    }).catch(function (e) {
      T.show("خطأ: " + e.message, "error");
      win.close();
    });
  }

  // ---------- خط وشعار المركز في صفحات الطباعة — نفس ملفات الهوية البصرية المستخدمة
  //            في الداشبورد نفسه (مفيش داعي المستخدم يبعتهم، موجودين بالفعل في الريبو)
  var PRINT_SITE_BASE = "https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/";
  var PRINT_LOGO_URL = PRINT_SITE_BASE + "assets/img/logo.svg";
  // هيدر/فوتر فورم "التقرير الطبي"/Echo الرسمي — مقصوصين من نفس الفورم المطبوع
  // اللي المركز بيستخدمه فعلياً (بادج ورقي أزرق/برتقالي + QR)، عشان الطباعة
  // من الداشبورد تطلع بنفس الشكل بالظبط بدل ما حد يطبعها يدوي على الوورد
  var PRINT_LETTERHEAD_HEADER_URL = PRINT_SITE_BASE + "assets/img/report-letterhead-header.jpg";
  var PRINT_LETTERHEAD_FOOTER_URL = PRINT_SITE_BASE + "assets/img/report-letterhead-footer.jpg";
  // نموذج الروشتة الرسمي (خانات بالتنقيط + شعار RX) — نفس صورة النموذج اللي
  // بعتها المستخدم بالحرف (بدون أي تعديل)، القيم بتتحط فوقها في نفس أماكن
  // الخانات بالظبط (إحداثيات محسوبة من الصورة الأصلية)
  var PRINT_RX_FULL_URL = PRINT_SITE_BASE + "assets/img/prescription-full.jpg";
  var PRINT_FONT_FACE_CSS =
    "@font-face{font-family:'BigVesta Arabic';src:url('" + PRINT_SITE_BASE + "assets/fonts/BigVesta-Regular.woff2') format('woff2');font-weight:400;}" +
    "@font-face{font-family:'BigVesta Arabic';src:url('" + PRINT_SITE_BASE + "assets/fonts/BigVesta-Bold.woff2') format('woff2');font-weight:700;}" +
    "body{font-family:'BigVesta Arabic','Hiragino Kaku',system-ui,Tahoma,sans-serif;}";
  // فوتر ثابت (fixed) بيتكرر في أسفل كل صفحة مطبوعة — بديل عملي جوه محتوى الصفحة
  // نفسها لأن هيدر/فوتر المتصفح الافتراضي (اللي فيه "about:blank"/الرابط) إعداد
  // متصفح مش متاح التحكم فيه من الصفحة، فده تكملة داخل الصفحة مش استبدال له
  var PRINT_FOOTER_HTML = '<div style="position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:10px;color:#888;padding:6px 0;border-top:1px solid #ddd;background:#fff;">التقرير صادر من مركز عيادات سونو التخصصية</div>';

  function filePrintHeaderHtml(it) {
    var dateLabel = it.issuedAt ? ('تاريخ الإصدار: ' + fmtDate(it.issuedAt)) : ('تاريخ الرفع: ' + fmtDate(it.uploadedAt));
    return '<div style="padding:8px 14px;background:#f5f5f5;border-bottom:2px solid #0F369D;font-weight:700;font-size:13px;display:flex;justify-content:space-between;">' +
      '<span>' + escapeHtml(categoryLabel(it.category)) + '</span><span style="font-weight:400;">' + dateLabel + '</span></div>';
  }

  // إطار صفحة A4 بالهيدر/الفوتر الرسمي (نفس صورة الفورم المطبوع بتاع المركز)،
  // مشترك بين تقرير طبي وEcho — المحتوى بيتحط في المنطقة البيضا النص بينهم
  // الفوتر صورة رسمية جاهزة (بيانات التواصل + الأيقونات مرسومة جوه الصورة نفسها)
  function letterheadPageHtml(dir, bodyHtml) {
    // الهيدر والفوتر الاتنين position:fixed (مش absolute) عشان يتكرروا
    // تلقائيًا أعلى/أسفل كل صفحة مطبوعة لو المحتوى طويل وامتد لأكتر من
    // صفحة، مهما كان عدد الصفحات (سلوك موثّق لعناصر fixed عند الطباعة في
    // Chrome). padding-top مضبوط قد ارتفاع صورة الهيدر (~56mm عند عرض
    // 210mm) عشان النص يبدأ فورًا تحته من غير فراغ.
    return '<div style="position:relative;width:210mm;min-height:297mm;margin:0 auto;">' +
      '<img src="' + PRINT_LETTERHEAD_HEADER_URL + '" style="position:fixed;top:0;left:0;width:210mm;display:block;">' +
      '<img src="' + PRINT_LETTERHEAD_FOOTER_URL + '" style="position:fixed;bottom:0;left:0;width:210mm;display:block;">' +
      '<div dir="' + dir + '" style="position:relative;padding:56mm 15mm 58mm;box-sizing:border-box;line-height:1.7;' + (dir === "ltr" ? "text-align:left;" : "") + '">' + bodyHtml + '</div>' +
      '</div>';
  }

  // صور الأشعة المرفقة بتقرير (Echo/أسنان) في صفحات طباعة منفصلة — شبكة
  // ٤ أو ٦ صور في الصفحة (يختارها المستخدم)، كل صورة كـdata URL (مفيش
  // اعتماد على blob: قد ميتفتحش صح في نافذة الطباعة المنفصلة)
  var XRAY_PER_PAGE_KEY = "ssmpd_xray_per_page";
  function promptXrayPerPage() {
    var def = localStorage.getItem(XRAY_PER_PAGE_KEY) || "4";
    var v = window.prompt("كام صورة أشعة في الصفحة الواحدة؟ اكتب 4 أو 6 (سيب الخانة فاضية عشان متطبعش الصور)", def);
    if (v === null || v.trim() === "") return 0;
    v = parseInt(v, 10);
    v = v >= 5 ? 6 : 4;
    localStorage.setItem(XRAY_PER_PAGE_KEY, String(v));
    return v;
  }
  function fetchImagesAsDataUrls(images) {
    return Promise.all(images.map(function (im) {
      var f = im.patient_files || {};
      return window.SSMPDDb.downloadPatientFile(f.id).then(function (res) {
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { resolve(null); };
          reader.readAsDataURL(res.blob);
        });
      }).catch(function () { return null; });
    })).then(function (urls) { return urls.filter(Boolean); });
  }
  function buildXrayImagesPagesHtml(dataUrls, perPage) {
    if (!dataUrls.length || !perPage) return "";
    var rows = Math.ceil(perPage / 2);
    var gapMM = 5;
    // المساحة المتاحة جوه هيدر/فوتر letterheadPageHtml هي 297 - 56 (بادينج
    // علوي) - 58 (بادينج سفلي) = 183mm، ناقص مساحة عنوان "صور الأشعة
    // المرفقة" وهامشه (~10mm) = ~171mm فعليًا. اتحط 168mm (هامش أمان 3mm)
    // بدل الرقم القديم (160mm) عشان الصور تاخد مساحة أكبر رأسيًا زي ما طلب
    // المستخدم، مع `overflow:hidden` كطبقة حماية تمنع أي فيضان بسيط يدفع
    // لصفحة تانية. هوامش الصفحة الجانبية هنا مخصوصة (8mm بدل 15mm الافتراضية
    // في letterheadPageHtml) عشان الصور تاخد عرض أكبر برضه.
    var gridAreaMM = 168;
    var sideMM = 8;
    var cellH = ((gridAreaMM - (rows - 1) * gapMM) / rows).toFixed(1);
    var pages = "";
    var chunkIndex = 0;
    for (var i = 0; i < dataUrls.length; i += perPage) {
      var chunk = dataUrls.slice(i, i + perPage);
      var cellsHtml = chunk.map(function (src) {
        return '<div style="height:' + cellH + 'mm;display:flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:4px;overflow:hidden;">' +
          '<img src="' + src + '" style="max-width:100%;max-height:100%;object-fit:contain;"></div>';
      }).join("");
      var grid = '<div style="text-align:center;font-size:13px;font-weight:700;margin-bottom:5mm;">صور الأشعة المرفقة</div>' +
        '<div style="height:' + gridAreaMM + 'mm;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:' + gapMM + 'mm;">' + cellsHtml + '</div>';
      var page = '<div style="position:relative;width:210mm;min-height:297mm;margin:0 auto;">' +
        '<img src="' + PRINT_LETTERHEAD_HEADER_URL + '" style="position:fixed;top:0;left:0;width:210mm;display:block;">' +
        '<img src="' + PRINT_LETTERHEAD_FOOTER_URL + '" style="position:fixed;bottom:0;left:0;width:210mm;display:block;">' +
        '<div dir="rtl" style="position:relative;padding:56mm ' + sideMM + 'mm 58mm;box-sizing:border-box;">' + grid + '</div>' +
        '</div>';
      // أول شنك صور مالوش page-break-before إجباري — بيتسيب يكمل تلقائي بعد
      // آخر التقرير (لو التقرير امتد لصفحة تانية زيادة عن المتوقع، إجبار فاصل
      // صفحة هنا كان بيسيب صفحة شبه فاضية (باقي التقرير القليل) قبل ما الصور
      // تبدأ في صفحة تالتة منفصلة). الشناكات اللي بعد كده (لو الصور كتير
      // ومحتاجة أكتر من صفحة) بتفضل كل واحدة في صفحة جديدة زي المتوقع.
      pages += '<div style="' + (chunkIndex > 0 ? "page-break-before:always;" : "") + 'page-break-inside:avoid;">' + page + '</div>';
      chunkIndex++;
    }
    return pages;
  }

  // ---------- طباعة "تقرير طبي" (نص حر) بشكل الفورم الرسمي ----------
  function printMedicalReport(patient, report) {
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var bodyParagraphs = (report.body_text || "").split(/\n{2,}/).map(function (p) {
      return '<p style="margin:0 0 14px;">' + escapeHtml(p).replace(/\n/g, "<br>") + '</p>';
    }).join("");
    var reportTitle = "تقرير طبي" + (report.specialty ? (" - " + report.specialty) : "");
    var body =
      '<h1 style="font-size:28px;color:#0F369D;text-align:right;margin:0 0 4px;">' + escapeHtml(reportTitle) + '</h1>' +
      '<div style="color:#F15A22;font-size:13px;text-align:right;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:22px;font-style:italic;">Medical Report</div>' +
      '<p style="margin:0 0 4px;"><b>المريض:</b> ' + escapeHtml(patient.full_name) + '</p>' +
      (patient.age != null ? '<p style="margin:0 0 4px;"><b>العمر:</b> ' + escapeHtml(String(patient.age)) + ' عام</p>' : '') +
      '<p style="margin:0 0 22px;"><b>التاريخ:</b> ' + fmtDate(report.report_date) + '</p>' +
      bodyParagraphs +
      '<p style="margin:22px 0;">وتفضلوا بقبول فائق الاحترام والتقدير</p>' +
      '<div style="margin-top:50px;"><div>المدير الطبي:</div><div style="font-weight:700;margin-top:4px;">' + escapeHtml(report.doctor_name || "د.دينا حسني") + '</div></div>';
    win.document.open();
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(reportTitle) + ' — ' + escapeHtml(patient.full_name) + '</title>' +
      '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;font-size:14px;line-height:1.9;}</style></head>' +
      '<body>' + letterheadPageHtml("rtl", body) + '</body></html>');
    win.document.close();
    waitForImagesThenPrint(win, 3000);
  }

  // ---------- طباعة Echocardiography Report بشكل الفورم الرسمي ----------
  function printEchoReport(patient, report) {
    var perPage = promptXrayPerPage();
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var dims = report.dimensions || {};
    var left = ["lvedd", "lvesd", "lv_swt", "lv_pwt", "ef"];
    var right = ["left_atrium", "ao_root", "ao_excursion", "rt_ventricle", "fs"];
    var byKey = {};
    ECHO_DIMENSIONS.forEach(function (d) { byKey[d.key] = d; });
    var rows = "";
    for (var i = 0; i < 5; i++) {
      var l = byKey[left[i]], rt = byKey[right[i]];
      rows += '<tr>' +
        '<td style="border:1px solid #999;padding:4px 8px;font-weight:700;">' + l.label + '</td>' +
        '<td style="border:1px solid #999;padding:4px 8px;text-align:center;">' + escapeHtml(dims[l.key] || "") + '</td>' +
        '<td style="border:1px solid #999;padding:4px 8px;font-style:italic;color:#333;background:#f2f2f2;">' + (l.ref || "") + '</td>' +
        '<td style="border:1px solid #999;padding:4px 8px;font-weight:700;">' + rt.label + '</td>' +
        '<td style="border:1px solid #999;padding:4px 8px;text-align:center;">' + escapeHtml(dims[rt.key] || "") + '</td>' +
        '<td style="border:1px solid #999;padding:4px 8px;font-style:italic;color:#333;background:#f2f2f2;">' + (rt.ref || "") + '</td>' +
        '</tr>';
    }
    function summaryLinesHtml(text) {
      return (text || "").split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) {
        var trimmed = l.trim();
        var sub = /^-\s*/.test(trimmed);
        var t = escapeHtml(sub ? trimmed.replace(/^-\s*/, "") : trimmed);
        if (sub) {
          return '<div style="margin:0 0 4px 22px;">• ' + t + '</div>';
        }
        return '<div style="margin:0 0 4px;font-weight:700;">➢ ' + t + '</div>';
      }).join("");
    }
    function conclusionLinesHtml(text) {
      return (text || "").split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) {
        return '<div style="margin:0 0 4px;font-weight:700;text-align:center;">' + escapeHtml(l.trim()) + '</div>';
      }).join("");
    }
    var body =
      '<h1 style="font-size:20px;text-align:center;text-decoration:underline;font-style:italic;margin:0 0 18px;">Echocardiography Report</h1>' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><b>Name: ' + escapeHtml(report.patient_label || patient.full_name) + '</b><b>Date: ' + fmtDate(report.report_date) + '</b></div>' +
      (report.referred_by ? '<div style="font-size:13px;margin-bottom:10px;"><b>Referred By: ' + escapeHtml(report.referred_by) + '</b></div>' : '<div style="margin-bottom:10px;"></div>') +
      '<div style="text-align:center;text-decoration:underline;font-size:12px;margin-bottom:6px;">Dimensions:</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;">' +
      '<tr><td style="border:1px solid #999;padding:4px 8px;font-style:italic;">Items</td><td style="border:1px solid #999;"></td><td style="border:1px solid #999;padding:4px 8px;font-style:italic;">Normal reference</td>' +
      '<td style="border:1px solid #999;padding:4px 8px;font-style:italic;">Items</td><td style="border:1px solid #999;"></td><td style="border:1px solid #999;padding:4px 8px;font-style:italic;">Normal reference</td></tr>' +
      rows + '</table>' +
      '<div style="text-align:center;text-decoration:underline;font-size:12px;margin-bottom:6px;">Summary</div>' +
      '<div style="font-size:12px;margin-bottom:16px;">' + summaryLinesHtml(report.summary_text) + '</div>' +
      '<div style="text-decoration:underline;font-size:12px;margin-bottom:6px;">Conclusion:</div>' +
      '<div style="font-size:12px;margin-bottom:30px;">' + conclusionLinesHtml(report.conclusion_text) + '</div>' +
      '<div style="text-align:center;font-weight:700;font-size:13px;">' + escapeHtml(report.doctor_name || "Dr. Haytham Shaaban (MSc)") + '</div>';
    var finishEcho = function (imagesHtml) {
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Echocardiography Report — ' + escapeHtml(patient.full_name) + '</title>' +
        '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}html,body{direction:ltr;text-align:left;}body{margin:0;font-family:Georgia,\'Times New Roman\',serif;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style></head>' +
        '<body>' + letterheadPageHtml("ltr", body) + imagesHtml + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 4000);
    };
    if (perPage) {
      window.SSMPDDb.listEchoReportImages(report.id).then(function (images) {
        return fetchImagesAsDataUrls(images || []);
      }).then(function (urls) {
        finishEcho(buildXrayImagesPagesHtml(urls, perPage));
      }).catch(function () { finishEcho(""); });
    } else {
      finishEcho("");
    }
  }

  // ---------- طباعة "تقرير أسنان" بشكل الفورم الرسمي ----------
  function printDentalReport(patient, report) {
    var perPage = promptXrayPerPage();
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var sessions = report.sessions || [];
    var rows = sessions.length ? sessions.map(function (s) {
      return '<tr>' +
        '<td style="border:1px solid #999;padding:5px 8px;">' + fmtDate(s.date) + '</td>' +
        '<td style="border:1px solid #999;padding:5px 8px;text-align:center;">' + escapeHtml(s.tooth || "") + '</td>' +
        '<td style="border:1px solid #999;padding:5px 8px;">' + escapeHtml(s.service || "") + '</td>' +
        '<td style="border:1px solid #999;padding:5px 8px;">' + escapeHtml(s.notes || "") + '</td></tr>';
    }).join("") : '<tr><td colspan="4" style="border:1px solid #999;padding:8px;text-align:center;color:#888;">لا توجد جلسات مسجّلة</td></tr>';
    var field = function (label, value) {
      return '<p style="margin:0 0 8px;font-size:13px;"><b>' + label + ': </b>' + escapeHtml(value || "—") + '</p>';
    };
    var toothMarks = report.tooth_marks || [];
    var toothMarksHtml = toothMarks.length ?
      '<div style="text-align:center;margin:16px 0;">' +
      '<div style="position:relative;display:inline-block;">' +
      '<img src="' + PRINT_SITE_BASE + 'assets/img/dental-teeth-chart.png" style="width:420px;display:block;">' +
      toothMarks.map(function (p) {
        return '<div style="position:absolute;width:14px;height:14px;border-radius:50%;background:#0F369D;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:2px solid #fff;transform:translate(-50%,-50%);left:' + p.x + '%;top:' + p.y + '%;"></div>';
      }).join("") +
      '</div>' +
      (toothMarks.some(function (p) { return p.note; }) ?
        '<div style="text-align:right;font-size:11px;margin-top:6px;">' +
        toothMarks.filter(function (p) { return p.note; }).map(function (p, i) { return '<div>● ' + escapeHtml(p.note) + '</div>'; }).join("") +
        '</div>' : '') +
      '</div>' : '';
    var body =
      '<h1 style="font-size:24px;color:#0F369D;text-align:right;margin:0 0 4px;">تقرير أسنان</h1>' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:14px;color:#555;"><span>' + escapeHtml(patient.full_name) + '</span><span>' + fmtDate(report.report_date) + '</span></div>' +
      field("الشكوى", report.chief_complaint) +
      field("الحالة المزمنة", report.chronic_condition) +
      field("علاج الأسنان السابق", report.previous_treatment) +
      field("خطة العلاج المقترحة", report.treatment_plan) +
      field("التركيبة (ثابتة/متحركة)", report.prosthesis_type) +
      field("الأمراض المزمنة", report.chronic_illnesses) +
      toothMarksHtml +
      '<div style="text-align:center;text-decoration:underline;font-size:13px;margin:16px 0 8px;">جدول الجلسات</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px;" dir="rtl">' +
      '<tr><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">التاريخ</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">رقم السن</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">الخدمة</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">ملاحظات</th></tr>' +
      rows + '</table>' +
      '<p style="margin:24px 0 0;font-size:13px;">وتفضلوا بقبول فائق الاحترام والتقدير</p>' +
      (report.doctor_name ? '<p style="text-align:left;margin-top:24px;font-weight:700;font-size:13px;">' + escapeHtml(report.doctor_name) + '</p>' : '');
    var finishDental = function (imagesHtml) {
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>تقرير أسنان — ' + escapeHtml(patient.full_name) + '</title>' +
        '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}tr,table{page-break-inside:avoid;}</style></head>' +
        '<body>' + letterheadPageHtml("rtl", body) + imagesHtml + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 4000);
    };
    if (perPage) {
      window.SSMPDDb.listDentalReportImages(report.id).then(function (images) {
        return fetchImagesAsDataUrls(images || []);
      }).then(function (urls) {
        finishDental(buildXrayImagesPagesHtml(urls, perPage));
      }).catch(function () { finishDental(""); });
    } else {
      finishDental("");
    }
  }

  // ---------- طباعة "تقرير علاج طبيعي" بشكل الفورم الرسمي ----------
  function printPhysioReport(patient, report) {
    var perPage = promptXrayPerPage();
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var sessions = report.sessions || [];
    var painPoints = report.pain_points || [];
    var field = function (label, value) {
      return '<p style="margin:0 0 8px;font-size:13px;"><b>' + label + ': </b>' + escapeHtml(value || "—") + '</p>';
    };
    var vitalsStr = function (v) {
      v = v || {};
      var parts = [];
      if (v.weight) parts.push("و " + v.weight);
      if (v.pulse) parts.push("ن " + v.pulse);
      if (v.blood_pressure) parts.push("ض " + v.blood_pressure);
      if (v.blood_sugar) parts.push("س " + v.blood_sugar);
      return parts.length ? escapeHtml(parts.join(" · ")) : "—";
    };
    var rows = sessions.length ? sessions.map(function (s, i) {
      return '<tr>' +
        '<td style="border:1px solid #999;padding:4px 6px;text-align:center;">' + (i + 1) + '</td>' +
        '<td style="border:1px solid #999;padding:4px 6px;">' + fmtDate(s.date) + '</td>' +
        '<td style="border:1px solid #999;padding:4px 6px;">' + escapeHtml((s.treatments || []).join(", ")) + '</td>' +
        '<td style="border:1px solid #999;padding:4px 6px;text-align:center;">' + escapeHtml(s.duration || "") + '</td>' +
        '<td style="border:1px solid #999;padding:4px 6px;font-size:10px;">' + vitalsStr(s.vitals) + '</td>' +
        '<td style="border:1px solid #999;padding:4px 6px;">' + escapeHtml(s.notes || "") + '</td></tr>';
    }).join("") : '<tr><td colspan="6" style="border:1px solid #999;padding:8px;text-align:center;color:#888;">لا توجد جلسات مسجّلة</td></tr>';
    var painPointsHtml = painPoints.length ?
      '<div style="text-align:center;">' +
      '<div style="position:relative;display:inline-block;">' +
      '<img src="' + PRINT_SITE_BASE + 'assets/img/physio-body-diagram.png" style="width:210px;display:block;">' +
      painPoints.map(function (p) {
        return '<div style="position:absolute;width:11px;height:11px;border-radius:50%;background:#D0402A;-webkit-print-color-adjust:exact;print-color-adjust:exact;border:2px solid #fff;transform:translate(-50%,-50%);left:' + p.x + '%;top:' + p.y + '%;"></div>';
      }).join("") +
      '</div>' +
      (painPoints.some(function (p) { return p.note; }) ?
        '<div style="text-align:right;font-size:10px;margin-top:6px;">' +
        painPoints.filter(function (p) { return p.note; }).map(function (p, i) { return '<div>● ' + escapeHtml(p.note) + '</div>'; }).join("") +
        '</div>' : '') +
      '</div>' : '';
    var sessionsTableHtml =
      '<div style="text-align:center;text-decoration:underline;font-size:13px;margin:0 0 8px;">جدول الجلسات</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;" dir="rtl">' +
      '<tr><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">#</th><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">التاريخ</th><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">نوع العلاج</th><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">المدة</th><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">القياسات الحيوية</th><th style="border:1px solid #999;padding:4px 6px;background:#f2f2f2;">ملاحظات</th></tr>' +
      rows + '</table>';
    var body =
      '<h1 style="font-size:24px;color:#0F369D;text-align:right;margin:0 0 4px;">تقرير علاج طبيعي</h1>' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:14px;color:#555;"><span>' + escapeHtml(patient.full_name) + '</span><span>' + fmtDate(report.visit_date) + '</span></div>' +
      field("التخصص", report.specialty) +
      field("الطبيب المعالج", report.doctor_name) +
      field("سبب الزيارة", report.visit_reason) +
      field("أمراض مزمنة", report.chronic_diseases) +
      field("العمليات الجراحية", report.surgeries) +
      field("تاريخ مرضي بالعائلة", report.family_history) +
      '<div style="display:flex;gap:14px;align-items:flex-start;margin-top:12px;">' +
      '<div style="flex:1;min-width:0;">' + sessionsTableHtml + '</div>' +
      (painPointsHtml ? '<div style="flex:0 0 220px;">' + painPointsHtml + '</div>' : '') +
      '</div>';
    var finishPhysio = function (imagesHtml) {
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>تقرير علاج طبيعي — ' + escapeHtml(patient.full_name) + '</title>' +
        '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:0;}body{margin:0;}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}tr,table{page-break-inside:avoid;}</style></head>' +
        '<body>' + letterheadPageHtml("rtl", body) + imagesHtml + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 4000);
    };
    if (perPage) {
      window.SSMPDDb.listPhysioReportImages(report.id).then(function (images) {
        return fetchImagesAsDataUrls(images || []);
      }).then(function (urls) {
        finishPhysio(buildXrayImagesPagesHtml(urls, perPage));
      }).catch(function () { finishPhysio(""); });
    } else {
      finishPhysio("");
    }
  }

  // ---------- طباعة بروفايل المريض كامل: صفحة بيانات شخصية/طبية + كل المرفقات كصفحات داخلية ----------
  function buildProfileCoverHtml(patient, profile, visits) {
    visits = visits || [];
    var activeChronic = (profile && Array.isArray(profile.chronic_conditions)) ?
      profile.chronic_conditions.filter(function (c) { return c.has; }) : [];
    var activeSurgeries = (profile && Array.isArray(profile.surgeries)) ?
      profile.surgeries.filter(function (s) { return s.has; }) : [];
    var activeFamily = (profile && Array.isArray(profile.family_history)) ?
      profile.family_history.filter(function (f) { return f.has; }) : [];

    var html = '<div style="page-break-after:always;padding:28px;direction:rtl;font-size:13px;line-height:1.9;">';
    html += '<div style="text-align:center;margin-bottom:10px;"><img src="' + PRINT_LOGO_URL + '" alt="مركز عيادات Swnw" style="height:64px;"></div>';
    html += '<h1 style="font-size:19px;margin-bottom:2px;text-align:center;">مركز عيادات Swnw التخصصية</h1>';
    html += '<h2 style="font-size:15px;color:#444;margin-top:0;text-align:center;">ملف المريض — ' + escapeHtml(patient.full_name) +
      ' (' + escapeHtml(patient.patient_code || "") + ')</h2>';

    html += '<h3 style="font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;">البيانات الشخصية</h3>';
    html += '<p>الهاتف: ' + escapeHtml(patient.phone || "—") + '<br>' +
      'السن: ' + escapeHtml(patient.age != null ? String(patient.age) : "—") + '<br>' +
      'النوع: ' + (patient.gender === "male" ? "ذكر" : patient.gender === "female" ? "أنثى" : "—") + '<br>' +
      'الرقم الطبي: ' + escapeHtml(patient.medical_record_no || "—") + '<br>' +
      'تاريخ آخر زيارة: ' + fmtDate(patient.last_visit_date) + '</p>';

    html += '<h3 style="font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;">البيانات الطبية</h3>';
    if (!profile) {
      html += '<p>مفيش بيانات طبية مسجّلة.</p>';
    } else {
      html += '<p>الطبيب المعالج: ' + escapeHtml(profile.treating_doctor || "—") + '<br>' +
        'التخصص: ' + escapeHtml(profile.specialty || "—") + '<br>' +
        'ضغط الدم: ' + escapeHtml(profile.blood_pressure || "—") + ' · سكر الدم: ' + escapeHtml(profile.blood_sugar || "—") + '<br>' +
        'الوزن: ' + escapeHtml(profile.weight || "—") + ' · النبض: ' + escapeHtml(profile.pulse || "—") + ' · الأكسجين: ' + escapeHtml(profile.oxygen_percent || "—") + '</p>';
      html += '<p><b>الأمراض المزمنة: </b>' + (activeChronic.length ? activeChronic.map(function (c) {
        var lbl = (CHRONIC_CONDITIONS.filter(function (x) { return x.key === c.name; })[0] || {}).label || c.name;
        return escapeHtml(lbl) + (c.medication ? ' (' + escapeHtml(c.medication) + ')' : '');
      }).join('، ') : 'لا يوجد') + '</p>';
      html += '<p><b>العمليات الجراحية: </b>' + (activeSurgeries.length ? activeSurgeries.map(function (s) {
        return escapeHtml(s.name || "") + (s.notes ? ' (' + escapeHtml(s.notes) + ')' : '');
      }).join('، ') : 'لا يوجد') + '</p>';
      html += '<p><b>تاريخ مرضي بالعائلة: </b>' + (activeFamily.length ? activeFamily.map(function (f) { return escapeHtml(f.disease || ""); }).join('، ') : 'لا يوجد') + '</p>';
    }

    html += '<h3 style="font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;">سجل الزيارات (' + visits.length + ')</h3>';
    if (!visits.length) {
      html += '<p>مفيش زيارات مسجّلة.</p>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>' +
        '<th style="border:1px solid #ccc;padding:5px;">التاريخ</th><th style="border:1px solid #ccc;padding:5px;">الشكوى</th>' +
        '<th style="border:1px solid #ccc;padding:5px;">خطة العلاج</th><th style="border:1px solid #ccc;padding:5px;">متابعة</th></tr></thead><tbody>';
      visits.forEach(function (v) {
        var plan = [v.medications ? 'أدوية: ' + v.medications : '', v.xrays ? 'أشعة: ' + v.xrays : '', v.labs ? 'تحاليل: ' + v.labs : '', v.other_recommendations || '']
          .filter(Boolean).join(' · ');
        html += '<tr><td style="border:1px solid #ccc;padding:5px;">' + fmtDate(v.visit_date) + '</td>' +
          '<td style="border:1px solid #ccc;padding:5px;">' + escapeHtml(v.complaint || '—') + '</td>' +
          '<td style="border:1px solid #ccc;padding:5px;">' + escapeHtml(plan || '—') + '</td>' +
          '<td style="border:1px solid #ccc;padding:5px;">' + (v.follow_up_date ? fmtDate(v.follow_up_date) : '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  function printPatientProfile(patient, profile, visits, files) {
    files = files || [];
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    win.document.write('<p style="font-family:sans-serif;padding:20px;">بيجهّز الملف للطباعة…</p>');
    var coverHtml = buildProfileCoverHtml(patient, profile, visits);

    Promise.all(files.map(function (f) {
      return window.SSMPDDb.downloadPatientFile(f.id).then(function (res) {
        return { name: f.file_name, url: URL.createObjectURL(res.blob), type: res.blob.type || "", category: f.category, issuedAt: f.issued_at, uploadedAt: f.uploaded_at };
      });
    })).then(function (items) {
      var filesBody = items.map(function (it) {
        var header = filePrintHeaderHtml(it);
        if (it.type === "application/pdf") {
          return '<div style="page-break-after:always;">' + header + '<embed src="' + it.url + '" type="application/pdf" style="width:100%;height:90vh;"></div>';
        }
        if (it.type.indexOf("image/") === 0) {
          return '<div style="page-break-after:always;text-align:center;padding:10px;">' + header + '<img src="' + it.url + '" style="max-width:100%;"></div>';
        }
        return '<div style="page-break-after:always;padding:20px;">' + header + '<p>تعذّرت معاينة الملف "' + escapeHtml(it.name) + '" — نوعه غير مدعوم للطباعة المباشرة.</p></div>';
      }).join("");
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>ملف المريض — ' + escapeHtml(patient.full_name) + '</title><style>' + PRINT_FONT_FACE_CSS + '</style></head><body style="margin:0;">' + coverHtml + filesBody + PRINT_FOOTER_HTML + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 3000);
    }).catch(function (e) {
      T.show("خطأ: " + e.message, "error");
      win.close();
    });
  }

  // ---------- طباعة البيانات الشخصية/الطبية فقط كتقرير نصي (بدون أي مرفقات/صور) ----------
  function printPatientProfileTextOnly(patient, profile, visits) {
    var win = window.open("", "_blank");
    if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
    var coverHtml = buildProfileCoverHtml(patient, profile, visits);
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>بيانات المريض — ' + escapeHtml(patient.full_name) + '</title><style>' + PRINT_FONT_FACE_CSS + '</style></head><body style="margin:0;">' + coverHtml + PRINT_FOOTER_HTML + '</body></html>');
    win.document.close();
    setTimeout(function () { win.focus(); win.print(); }, 400);
  }

  // ---------- عرض تفاصيل زيارة (قراءة فقط) ----------
  function openViewVisitModal(v) {
    var plan = [v.medications ? 'الأدوية: ' + v.medications : '', v.xrays ? 'الأشعة: ' + v.xrays : '', v.labs ? 'التحاليل: ' + v.labs : '', v.other_recommendations ? 'توصيات أخرى: ' + v.other_recommendations : '']
      .filter(Boolean).join('<br>');
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>تفاصيل الزيارة</h3><button class="modal-close">×</button></div>' +
      '<div style="font-size:13px;line-height:1.9;">' +
      '<p><b>التاريخ: </b>' + fmtDate(v.visit_date) + '</p>' +
      '<p><b>رقم الزيارة: </b>' + escapeHtml(v.visit_number || '—') + '</p>' +
      '<p><b>الشكوى: </b>' + escapeHtml(v.complaint || '—') + '</p>' +
      '<p><b>ضغط الدم: </b>' + escapeHtml(v.blood_pressure || '—') + ' &nbsp; <b>سكر الدم: </b>' + escapeHtml(v.blood_sugar || '—') + ' &nbsp; <b>النبض: </b>' + escapeHtml(v.pulse || '—') + '</p>' +
      '<p><b>خطة العلاج: </b><br>' + (plan || '—') + '</p>' +
      '<p><b>تاريخ المتابعة: </b>' + (v.follow_up_date ? fmtDate(v.follow_up_date) : '—') + '</p>' +
      (v.referred_to_other_doctor ? '<p style="color:var(--c-accent2, #F15A22);"><b>تم التحويل لطبيب آخر: </b>' + escapeHtml(v.referred_doctor_name || '—') + '</p>' : '') +
      '</div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };
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
              '<td>' + escapeHtml(f.file_name) + (f.other_description ? ' — ' + escapeHtml(f.other_description) : '') + '</td>' +
              '<td>' + categoryLabel(f.category) + '</td>' +
              '<td style="font-size:11px;">' + escapeHtml(f.uploaded_by_name || "—") + '</td>' +
              '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(f.uploaded_at) + '</td>' +
              '<td>' + (state.reviewFilter === "pending" ?
                '<button class="btn ghost sm" data-view="' + f.id + '">عرض</button> <button class="btn sm" data-approve="' + f.id + '">اعتماد</button> <button class="btn danger sm" data-reject="' + f.id + '">رفض</button>' :
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

        view.querySelectorAll("[data-view]").forEach(function (btn) {
          btn.onclick = function () {
            var fileId = btn.getAttribute("data-view");
            // فتح تاب جديد فوراً (قبل الـ fetch) عشان متتحجبش من مانع النوافذ المنبثقة
            // في المتصفح — بعدين نحط رابط الملف فيها لما يوصل
            var win = window.open("", "_blank");
            btn.disabled = true;
            window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
              var url = URL.createObjectURL(res.blob);
              if (win) win.location.href = url;
              else { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
              btn.disabled = false;
              setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            }).catch(function (e) {
              if (win) win.close();
              T.show("خطأ: " + e.message, "error");
              btn.disabled = false;
            });
          };
        });

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
              T.show(decision === "approve" ? "تم اعتماد الملف" : "تم رفض الملف");
              renderReviewScreen(view, container);
            }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
        }
      }).catch(function (e) {
        view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  // ============ شاشة "طبيب سونو" — طابور الحالات المحالة له بس ============
  function renderDoctorQueue(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.listMyDoctorAssignments(me.id).then(function (rows) {
      var html = '<h2 style="margin-bottom:16px;">الحالات المحالة لك</h2>';
      html += '<div class="section">';
      if (!rows.length) {
        html += '<div class="empty-state">مفيش حالات محالة لك دلوقتي</div>';
      } else {
        html += '<table class="simple"><thead><tr><th>كود المريض</th><th>الاسم</th><th>الهاتف</th><th>وقت الإحالة</th><th></th></tr></thead><tbody>';
        rows.forEach(function (r) {
          var p = r.patients;
          if (!p) return;
          html += '<tr><td>' + escapeHtml(p.patient_code || "—") + '</td><td>' + escapeHtml(p.full_name) + '</td>' +
            '<td>' + escapeHtml(p.phone || "—") + '</td><td>' + fmtDate(r.assigned_at) + '</td>' +
            '<td style="display:flex;gap:6px;">' +
            '<button class="btn ghost sm" data-open="' + p.id + '">فتح الملفات</button>' +
            '<button class="btn sm" data-done="' + r.id + '">تم الكشف</button></td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openPatientModal(container, container, btn.getAttribute("data-open")); };
      });
      container.querySelectorAll("[data-done]").forEach(function (btn) {
        btn.onclick = function () {
          btn.disabled = true;
          window.SSMPDDb.completeDoctorAssignment(btn.getAttribute("data-done")).then(function () {
            T.show("تم تسجيل الكشف");
            renderDoctorQueue(container);
          }).catch(function (e) { T.show("خطأ: " + e.message, "error"); btn.disabled = false; });
        };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  // ============ ٤) شاشة تصفح وفلترة ============
  // ---------- فلتر قائمة المرضى بفترة تاريخ (نفس الفلاتر بتاعة listPatientsArchive) ----------
  function browseDateFilterParams() {
    var p = {};
    if (state.browseDateFrom || state.browseDateTo) p.date_field = state.browseDateField;
    if (state.browseDateFrom) p.date_from = state.browseDateFrom;
    if (state.browseDateTo) p.date_to = state.browseDateTo;
    return p;
  }

  // ---------- تصدير قائمة المرضى المفلترة (Excel / PDF) — بيجيب كل النتائج المطابقة مش صفحة واحدة بس ----------
  function fetchAllFilteredPatients() {
    var params = Object.assign({ search: state.browseSearch || undefined, page: 1, page_size: 2000 }, browseDateFilterParams());
    return window.SSMPDDb.listPatientsArchive(params).then(function (res) { return res.patients || []; });
  }

  function exportBrowseExcel() {
    T.show("بيجهّز ملف Excel…");
    fetchAllFilteredPatients().then(function (patients) {
      if (!patients.length) { T.show("مفيش نتائج للتصدير", "error"); return; }
      var rows = patients.map(function (p) {
        return {
          "كود المريض": p.patient_code || "", "الاسم": p.full_name || "", "الهاتف": p.phone || "",
          "السن": p.age != null ? p.age : "", "النوع": p.gender === "male" ? "ذكر" : p.gender === "female" ? "أنثى" : "",
          "الرقم الطبي": p.medical_record_no || "", "تاريخ الإضافة": p.created_at ? p.created_at.slice(0, 10) : "",
          "آخر زيارة": p.last_visit_date || "", "الحالة": p.status === "archived" ? "مؤرشف" : "نشط"
        };
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "المرضى");
      XLSX.writeFile(wb, "قائمة_المرضى.xlsx");
    }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
  }

  function exportBrowsePdf() {
    T.show("بيجهّز ملف PDF…");
    fetchAllFilteredPatients().then(function (patients) {
      if (!patients.length) { T.show("مفيش نتائج للتصدير", "error"); return; }
      var win = window.open("", "_blank");
      if (!win) { T.show("المتصفح منع فتح نافذة الطباعة — سمح بالنوافذ المنبثقة وحاول تاني", "error"); return; }
      var rows = patients.map(function (p) {
        return '<tr><td style="border:1px solid #999;padding:5px 8px;">' + escapeHtml(p.patient_code || "—") + '</td>' +
          '<td style="border:1px solid #999;padding:5px 8px;">' + escapeHtml(p.full_name || "") + '</td>' +
          '<td style="border:1px solid #999;padding:5px 8px;">' + escapeHtml(p.phone || "—") + '</td>' +
          '<td style="border:1px solid #999;padding:5px 8px;text-align:center;">' + escapeHtml(p.age != null ? String(p.age) : "—") + '</td>' +
          '<td style="border:1px solid #999;padding:5px 8px;">' + fmtDate(p.created_at) + '</td>' +
          '<td style="border:1px solid #999;padding:5px 8px;">' + fmtDate(p.last_visit_date) + '</td></tr>';
      }).join("");
      var body = '<h2 style="font-size:18px;color:#0F369D;margin:0 0 4px;">قائمة المرضى</h2>' +
        '<p style="font-size:12px;color:#666;margin:0 0 14px;">إجمالي: ' + patients.length + ' مريض' + (state.browseDateFrom || state.browseDateTo ? (' — فلتر تاريخ: ' + (state.browseDateFrom || "…") + ' إلى ' + (state.browseDateTo || "…")) : '') + '</p>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;" dir="rtl">' +
        '<tr><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">كود المريض</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">الاسم</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">الهاتف</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">السن</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">تاريخ الإضافة</th><th style="border:1px solid #999;padding:5px 8px;background:#f2f2f2;">آخر زيارة</th></tr>' +
        rows + '</table>';
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>قائمة المرضى</title>' +
        '<style>' + PRINT_FONT_FACE_CSS + '@page{size:A4;margin:14mm;}body{margin:0;}</style></head><body>' + body + '</body></html>');
      win.document.close();
      waitForImagesThenPrint(win, 500);
    }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
  }

  function renderBrowseScreen(view, container) {
    view.innerHTML = '<div class="loading">بيحمّل…</div>';
    window.SSMPDDb.listPatientsArchive(Object.assign({ search: state.browseSearch || undefined, page: state.browsePage, page_size: state.browsePageSize }, browseDateFilterParams()))
      .then(function (res) {
        var patients = res.patients || [];
        var total = res.total || 0;
        var totalPages = Math.max(1, Math.ceil(total / state.browsePageSize));

        var html = '<div class="section">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">' +
          '<input id="pt-search" placeholder="بحث بالاسم / الهاتف / كود المريض" value="' + escapeHtml(state.browseSearch) + '" style="flex:1;min-width:220px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
          '<button class="btn ghost sm" id="pt-search-btn">بحث</button></div>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px;background:var(--c-bg-alt,#f7f8fa);border-radius:10px;">' +
          '<span style="font-size:12px;color:var(--c-muted);">فلترة بالتاريخ:</span>' +
          '<select id="pt-date-field" style="padding:6px 8px;border-radius:8px;border:1px solid var(--c-border);">' +
          '<option value="created_at"' + (state.browseDateField === "created_at" ? " selected" : "") + '>تاريخ إضافة المريض</option>' +
          '<option value="last_visit_date"' + (state.browseDateField === "last_visit_date" ? " selected" : "") + '>تاريخ آخر زيارة</option>' +
          '</select>' +
          '<span style="font-size:11px;color:var(--c-muted);">من</span><input id="pt-date-from" type="date" value="' + escapeHtml(state.browseDateFrom) + '" style="padding:6px 8px;border-radius:8px;border:1px solid var(--c-border);">' +
          '<span style="font-size:11px;color:var(--c-muted);">إلى</span><input id="pt-date-to" type="date" value="' + escapeHtml(state.browseDateTo) + '" style="padding:6px 8px;border-radius:8px;border:1px solid var(--c-border);">' +
          '<button class="btn ghost sm" id="pt-date-apply">تطبيق</button>' +
          (state.browseDateFrom || state.browseDateTo ? '<button class="btn ghost sm" id="pt-date-clear">مسح الفلتر</button>' : '') +
          '<span style="flex:1;"></span>' +
          '<select id="pt-export-select" style="padding:6px 8px;border-radius:8px;border:1px solid var(--c-border);"><option value="">⬇ تصدير النتائج...</option><option value="excel">ملف Excel</option><option value="pdf">ملف PDF</option></select>' +
          '</div>';

        if (!patients.length) {
          html += '<p style="color:var(--c-muted);font-size:13px;">مفيش مرضى مطابقين.</p>';
        } else {
          var canAssign = canAssignDoctor();
          var canEditBrowse = canUpload();
          var canDeleteBrowse = window.SSMPDRoles.hasRole(me, "super_admin");
          html += '<table class="simple"><thead><tr><th>كود المريض</th><th>الاسم</th><th>الهاتف</th><th>السن</th><th>النوع</th><th>الرقم الطبي</th><th>آخر زيارة</th><th>الحالة</th><th></th></tr></thead><tbody>';
          patients.forEach(function (p) {
            html += '<tr><td>' + escapeHtml(p.patient_code || "—") + '</td><td>' + escapeHtml(p.full_name) + '</td>' +
              '<td>' + escapeHtml(p.phone || "—") + '</td>' +
              '<td>' + escapeHtml(p.age != null ? String(p.age) : "—") + '</td>' +
              '<td>' + (p.gender === "male" ? "ذكر" : p.gender === "female" ? "أنثى" : "—") + '</td>' +
              '<td>' + escapeHtml(p.medical_record_no || "—") + '</td>' +
              '<td>' + fmtDate(p.last_visit_date) + '</td>' +
              '<td>' + (p.status === "archived" ? '<span class="status-pill draft">مؤرشف</span>' : '<span class="status-pill approved">نشط</span>') + '</td>' +
              '<td style="display:flex;gap:6px;"><button class="btn ghost sm" data-open="' + p.id + '">فتح</button>' +
              (canEditBrowse ? '<button class="btn ghost sm" data-edit="' + p.id + '">تعديل البيانات</button>' : '') +
              (canAssign ? '<button class="btn ghost sm" data-assign="' + p.id + '" data-assign-name="' + escapeHtml(p.full_name) + '">تحويل لطبيب سونو</button>' : '') +
              (canDeleteBrowse ? '<button class="btn ghost sm" data-delete-patient="' + p.id + '" data-delete-name="' + escapeHtml(p.full_name) + '" style="color:var(--c-danger,#c33);">حذف</button>' : '') +
              '</td></tr>';
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
        document.getElementById("pt-date-apply").onclick = function () {
          state.browseDateField = document.getElementById("pt-date-field").value;
          state.browseDateFrom = document.getElementById("pt-date-from").value;
          state.browseDateTo = document.getElementById("pt-date-to").value;
          state.browsePage = 1;
          renderBrowseScreen(view, container);
        };
        var dateClearBtn = document.getElementById("pt-date-clear");
        if (dateClearBtn) dateClearBtn.onclick = function () {
          state.browseDateFrom = ""; state.browseDateTo = ""; state.browsePage = 1;
          renderBrowseScreen(view, container);
        };
        document.getElementById("pt-export-select").onchange = function (e) {
          var v = e.target.value;
          e.target.value = "";
          if (v === "excel") exportBrowseExcel();
          else if (v === "pdf") exportBrowsePdf();
        };
        var prevBtn = document.getElementById("pt-prev");
        var nextBtn = document.getElementById("pt-next");
        if (prevBtn) prevBtn.onclick = function () { if (state.browsePage > 1) { state.browsePage--; renderBrowseScreen(view, container); } };
        if (nextBtn) nextBtn.onclick = function () { state.browsePage++; renderBrowseScreen(view, container); };

        view.querySelectorAll("[data-open]").forEach(function (btn) {
          btn.onclick = function () { openPatientModal(view, container, btn.getAttribute("data-open")); };
        });
        view.querySelectorAll("[data-edit]").forEach(function (btn) {
          btn.onclick = function () {
            var p = patients.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit"); })[0];
            if (p) openEditPatientModal(p, function () { renderBrowseScreen(view, container); });
          };
        });
        view.querySelectorAll("[data-assign]").forEach(function (btn) {
          btn.onclick = function () { openAssignDoctorModal(btn.getAttribute("data-assign"), btn.getAttribute("data-assign-name")); };
        });
        view.querySelectorAll("[data-delete-patient]").forEach(function (btn) {
          btn.onclick = function () {
            var pid = btn.getAttribute("data-delete-patient");
            var pname = btn.getAttribute("data-delete-name");
            if (!window.confirm("متأكد إنك عايز تمسح ملف \"" + pname + "\" نهائياً؟ الإجراء ده مش هيترجع.")) return;
            btn.disabled = true;
            window.SSMPDDb.deletePatientRecord(pid).then(function () {
              T.show("اتمسح الملف بنجاح");
              renderBrowseScreen(view, container);
            }).catch(function (e) {
              var msg = e && e.message ? e.message : "";
              if (msg.indexOf("foreign key") !== -1 || msg.indexOf("violates") !== -1 || (e && e.code === "23503")) {
                T.show("متقدرش تمسح المريض ده — ليه بيانات مرتبطة (زي عملاء محتملين/leads) لازم تتشال الأول.", "error");
              } else {
                T.show("خطأ: " + msg, "error");
              }
              btn.disabled = false;
            });
          };
        });
      }).catch(function (e) {
        view.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  // ---------- إحالة مريض لـ"طبيب سونو" ----------
  function openAssignDoctorModal(patientId, patientName) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    window.SSMPDDb.listActiveSonoDoctors().then(function (doctors) {
      var html = '<div class="modal"><div class="modal-head"><h3>تحويل "' + escapeHtml(patientName) + '" لطبيب سونو</h3>' +
        '<button class="modal-close">×</button></div>';
      if (!doctors.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش حالياً أي حساب مفعّل عليه دور "طبيب سونو". فعّله من شاشة المستخدمين والصلاحيات الأول.</p>';
      } else {
        html += '<div class="field"><label>اختر الطبيب</label><select id="ad-doctor">' +
          doctors.map(function (d) { return '<option value="' + d.id + '">' + escapeHtml(d.name || d.email) + '</option>'; }).join("") +
          '</select></div><button class="btn" id="ad-confirm">تحويل</button>';
      }
      html += '</div>';
      backdrop.innerHTML = html;
      backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
      var confirmBtn = document.getElementById("ad-confirm");
      if (confirmBtn) confirmBtn.onclick = function () {
        var doctorId = document.getElementById("ad-doctor").value;
        confirmBtn.disabled = true;
        window.SSMPDDb.assignPatientToDoctor(patientId, doctorId, me.id).then(function () {
          T.show("اتحوّلت الحالة للطبيب");
          backdrop.remove();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); confirmBtn.disabled = false; });
      };
    }).catch(function (e) {
      backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function openPatientModal(view, container, patientId) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function reload() {
      Promise.all([
        window.SSMPDDb.getPatientFiles(patientId),
        window.SSMPDDb.getPatientMedicalProfile(patientId).catch(function () { return null; }),
        window.SSMPDDb.listPatientVisits(patientId).catch(function () { return []; }),
        window.SSMPDDb.listMedicalReports(patientId).catch(function () { return []; }),
        window.SSMPDDb.listEchoReports(patientId).catch(function () { return []; }),
        window.SSMPDDb.listDentalReports(patientId).catch(function () { return []; }),
        window.SSMPDDb.listPhysioReports(patientId).catch(function () { return []; }),
        window.SSMPDDb.listPrescriptions(patientId).catch(function () { return []; }),
        window.SSMPDDb.listLabRequests(patientId).catch(function () { return []; }),
        window.SSMPDDb.listRadiologyRequests(patientId).catch(function () { return []; }),
        window.SSMPDDb.listPatientExperienceRatings(patientId).catch(function () { return []; }),
      ]).then(function (results) {
        var res = results[0], profile = results[1], visits = results[2] || [];
        renderPatientModal(backdrop, view, container, res.patient, res.files || [], profile, visits, results[3] || [], results[4] || [], results[5] || [], results[6] || [], results[7] || [], results[8] || [], results[9] || [], results[10] || []);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();
  }

  // سكشن مدموج: مستندات مرفوعة لفئة معيّنة (روشتة/تحاليل/أشعة) + قائمة
  // الفورمات المُنشأة من الداشبورد لنفس الفئة — نفس نمط سكشن "تقرير طبي" بالظبط،
  // عشان الفئة توصف في مكان واحد بدل ما تتكرر في السكشن العام وسكشن منفصل
  function mergedDocSectionHtml(catKey, catLabel, uploadedList, createdCount, canUp, newBtnAttr, createdList, createdEmptyNoun, createdItemHtml) {
    var html = '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>' + catLabel + ' (' + (uploadedList.length + createdCount) + ')</span>' +
      (canUp ? '<span><button class="btn ghost sm" data-upload-cat="' + catKey + '">+ رفع مستند</button> ' +
        '<button class="btn ghost sm" ' + newBtnAttr + '>+ إنشاء جديد</button>' +
        '<input type="file" accept="image/*,application/pdf" data-file-input-cat="' + catKey + '" style="display:none;"></span>' : '') +
      '</h3>';
    if (canUp) {
      html += '<div class="field" data-other-wrap-cat style="display:none;margin-bottom:8px;">' +
        '<label>ملاحظات / تفاصيل الملف (اختياري)</label>' +
        '<input data-other-desc-cat placeholder="اكتب أي تفاصيل تخص الملف">' +
        '<label style="margin-top:6px;">تاريخ إصدار المستند (اختياري)</label>' +
        '<input type="date" data-issued-at-cat></div>';
    }
    html += '<div data-cat-status style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>';
    if (!uploadedList.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش مستندات مرفوعة.</p>';
    } else {
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span style="font-size:12px;color:var(--c-muted);">' + uploadedList.length + ' مستند مرفوع</span>' +
        '<button class="btn ghost sm" data-toggle-files-cat="' + catKey + '">عرض المستندات ▾</button></div>' +
        '<div data-files-list-cat="' + catKey + '" style="display:none;margin-top:8px;">';
      uploadedList.forEach(function (f) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>' + escapeHtml(f.file_name) + '</b>' + (f.other_description ? ' — ' + escapeHtml(f.other_description) : '') +
          ' <span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '" style="font-size:10px;">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span>' +
          '<br><span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) +
          (f.uploaded_by_name ? ' · رفعه: ' + escapeHtml(f.uploaded_by_name) : '') +
          (f.reviewed_by_name ? ' · راجعه: ' + escapeHtml(f.reviewed_by_name) : '') + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-view-file="' + f.id + '">عرض</button>' +
          '<button class="btn ghost sm" data-dl="' + f.id + '">تنزيل</button>' +
          '<button class="btn ghost sm" data-print-file="' + f.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-file="' + f.id + '">حذف</button>' : '') + '</div></div>';
      });
      html += '</div>';
    }
    html += '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--c-border);">' +
      '<b style="font-size:12px;">' + catLabel + ' المُنشأة من الداشبورد (' + createdList.length + ')</b>';
    if (!createdList.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);margin-top:6px;">مفيش ' + createdEmptyNoun + ' مُنشأة لسه.</p>';
    } else {
      createdList.forEach(function (r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' + createdItemHtml(r) + '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function renderPatientModal(backdrop, view, container, patient, files, profile, visits, reports, echoReports, dentalReports, physioReports, prescriptions, labRequests, radiologyRequests, experienceRatings) {
    var byCategory = {};
    CATEGORIES.forEach(function (c) { byCategory[c.key] = []; });
    files.forEach(function (f) { (byCategory[f.category] || (byCategory[f.category] = [])).push(f); });
    profile = profile || null;
    visits = visits || [];
    reports = reports || [];
    echoReports = echoReports || [];
    dentalReports = dentalReports || [];
    physioReports = physioReports || [];
    prescriptions = prescriptions || [];
    labRequests = labRequests || [];
    radiologyRequests = radiologyRequests || [];
    experienceRatings = experienceRatings || [];

    var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(patient.full_name) +
      ' <span style="font-size:12px;color:var(--c-muted);">(' + escapeHtml(patient.patient_code || "") + ')</span></h3>' +
      '<button class="btn ghost sm" data-print-profile="1" style="margin-inline-end:8px;">🖨 طباعة البروفايل</button>' +
      '<button class="btn ghost sm" data-print-profile-text="1" style="margin-inline-end:8px;">🖨 طباعة البيانات</button>' +
      '<button class="modal-close">×</button></div>';

    var canUp = canUpload();
    var canEditMedical = canUp; // نفس صلاحية الأرشيف — "طبيب سونو" معاينة فقط، مفيش زرار تعديل/إضافة يظهر له
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>البيانات الشخصية</span>' +
      (canUp ? '<button class="btn ghost sm" data-edit-personal="1">تعديل</button>' : '') +
      '</h3>' +
      '<p style="font-size:12px;color:var(--c-muted);line-height:1.9;">' +
      'الهاتف: ' + escapeHtml(patient.phone || "—") + '<br>' +
      'السن: ' + escapeHtml(patient.age != null ? String(patient.age) : "—") + '<br>' +
      'النوع: ' + (patient.gender === "male" ? "ذكر" : patient.gender === "female" ? "أنثى" : "—") + '<br>' +
      'الرقم الطبي: ' + escapeHtml(patient.medical_record_no || "—") + '<br>' +
      'تاريخ آخر زيارة: ' + fmtDate(patient.last_visit_date) +
      '</p></div>';

    // ---------- البيانات الطبية ----------
    var activeChronic = (profile && Array.isArray(profile.chronic_conditions)) ?
      profile.chronic_conditions.filter(function (c) { return c.has; }) : [];
    var activeSurgeries = (profile && Array.isArray(profile.surgeries)) ?
      profile.surgeries.filter(function (s) { return s.has; }) : [];
    var activeFamily = (profile && Array.isArray(profile.family_history)) ?
      profile.family_history.filter(function (f) { return f.has; }) : [];

    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>البيانات الطبية</span>' +
      (canEditMedical ? '<button class="btn ghost sm" data-edit-medical="1">تعديل</button>' : '') +
      '</h3>';
    if (!profile) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش بيانات طبية مسجّلة لسه.</p>';
    } else {
      html += '<p style="font-size:12px;color:var(--c-muted);line-height:1.9;">' +
        'الطبيب المعالج: ' + escapeHtml(profile.treating_doctor || "—") + '<br>' +
        'التخصص: ' + escapeHtml(profile.specialty || "—") + '<br>' +
        'ضغط الدم: ' + escapeHtml(profile.blood_pressure || "—") + ' · سكر الدم: ' + escapeHtml(profile.blood_sugar || "—") + '<br>' +
        'الوزن: ' + escapeHtml(profile.weight || "—") + ' · النبض: ' + escapeHtml(profile.pulse || "—") + ' · الأكسجين: ' + escapeHtml(profile.oxygen_percent || "—") +
        '</p>';
      html += '<p style="font-size:12px;margin-top:8px;"><b>الأمراض المزمنة: </b>' +
        (activeChronic.length ? activeChronic.map(function (c) {
          var lbl = (CHRONIC_CONDITIONS.filter(function (x) { return x.key === c.name; })[0] || {}).label || c.name;
          return escapeHtml(lbl) + (c.medication ? ' (' + escapeHtml(c.medication) + ')' : '');
        }).join('، ') : 'لا يوجد') + '</p>';
      html += '<p style="font-size:12px;margin-top:4px;"><b>العمليات الجراحية: </b>' +
        (activeSurgeries.length ? activeSurgeries.map(function (s) {
          return escapeHtml(s.name || "") + (s.notes ? ' (' + escapeHtml(s.notes) + ')' : '');
        }).join('، ') : 'لا يوجد') + '</p>';
      html += '<p style="font-size:12px;margin-top:4px;"><b>تاريخ مرضي بالعائلة: </b>' +
        (activeFamily.length ? activeFamily.map(function (f) { return escapeHtml(f.disease || ""); }).join('، ') : 'لا يوجد') + '</p>';
    }

    html += '<div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">' +
      '<b style="font-size:12px;">سجل الزيارات (' + visits.length + ')</b>' +
      (canEditMedical ? '<button class="btn ghost sm" data-add-visit="1">+ زيارة جديدة</button>' : '') + '</div>';
    if (!visits.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);margin-top:6px;">مفيش زيارات مسجّلة.</p>';
    } else {
      html += '<table class="simple" style="margin-top:8px;font-size:12px;"><thead><tr><th>التاريخ</th><th>رقم الزيارة</th><th>الشكوى</th><th>خطة العلاج</th><th>متابعة</th>' + (canEditMedical ? '<th></th>' : '') + '</tr></thead><tbody>';
      visits.forEach(function (v) {
        var plan = [v.medications ? 'أدوية: ' + v.medications : '', v.xrays ? 'أشعة: ' + v.xrays : '', v.labs ? 'تحاليل: ' + v.labs : '', v.other_recommendations ? v.other_recommendations : '']
          .filter(Boolean).join(' · ');
        html += '<tr><td>' + fmtDate(v.visit_date) + '</td><td>' + escapeHtml(v.visit_number || '—') + '</td>' +
          '<td>' + escapeHtml(v.complaint || '—') + (v.referred_to_other_doctor ? '<br><span style="color:var(--c-accent2, #F15A22);">محوّل لـ' + escapeHtml(v.referred_doctor_name || 'طبيب آخر') + '</span>' : '') + '</td><td>' + escapeHtml(plan || '—') + '</td>' +
          '<td>' + (v.follow_up_date ? fmtDate(v.follow_up_date) : '—') + '</td>' +
          (canEditMedical ? '<td style="white-space:nowrap;">' +
            '<button class="btn ghost sm" data-view-visit="' + v.id + '">عرض</button> ' +
            '<button class="btn ghost sm" data-edit-visit="' + v.id + '">تعديل</button> ' +
            '<button class="btn danger sm" data-del-visit="' + v.id + '">حذف</button></td>' : '') + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    html += '<div class="section" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<b style="font-size:13px;">كل الملفات المرفوعة (' + files.length + ')</b>' +
      (files.length ? '<button class="btn ghost sm" data-print-all="1">🖨 طباعة كل الملفات</button>' : '') +
      '</div>';

    CATEGORIES.forEach(function (c) {
      // البنود دي بتتعرض جوه سكشن "التقارير الطبية" الموحّد تحت (مدموجة مع
      // التقارير/الفورمات المُنشأة من الداشبورد لنفس الفئة) بدل ما تتكرر هنا كمان
      if (c.key === "medical_report" || c.key === "prescription" || c.key === "lab_result" || c.key === "radiology") return;
      var list = byCategory[c.key] || [];
      html += '<div class="section" style="padding:12px 14px;">' +
        '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<span>' + c.label + ' (' + list.length + ')</span>' +
        (canUp ? '<span><button class="btn ghost sm" data-upload-cat="' + c.key + '">+ رفع</button>' +
          (c.key === "medical_report" ? ' <button class="btn ghost sm" data-new-medical-report="1">+ إنشاء جديد</button>' : '') +
          '<input type="file" accept="image/*,application/pdf" data-file-input-cat="' + c.key + '" style="display:none;"></span>' : '') +
        '</h3>';
      if (canUp) {
        html += '<div class="field" data-other-wrap-cat style="display:none;margin-bottom:8px;">' +
          '<label>' + (c.key === "other" ? "وصف نوع الملف" : "ملاحظات / تفاصيل الملف (اختياري)") + '</label>' +
          '<input data-other-desc-cat placeholder="' + (c.key === "other" ? "اكتب نوع الملف" : "اكتب أي تفاصيل تخص الملف") + '">' +
          '<label style="margin-top:6px;">تاريخ إصدار المستند (اختياري)</label>' +
          '<input type="date" data-issued-at-cat></div>';
      }
      html += '<div data-cat-status style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>';
      if (!list.length) {
        html += '<p style="font-size:12px;color:var(--c-muted);">مفيش ملفات.</p>';
      } else {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<span style="font-size:12px;color:var(--c-muted);">' + list.length + ' مستند مرفوع</span>' +
          '<button class="btn ghost sm" data-toggle-files-cat="' + c.key + '">عرض المستندات ▾</button></div>' +
          '<div data-files-list-cat="' + c.key + '" style="display:none;margin-top:8px;">';
        list.forEach(function (f) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
            '<div><b>' + escapeHtml(f.file_name) + '</b>' + (f.other_description ? ' — ' + escapeHtml(f.other_description) : '') +
            ' <span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '" style="font-size:10px;">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span>' +
            '<br><span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) +
            (f.uploaded_by_name ? ' · رفعه: ' + escapeHtml(f.uploaded_by_name) : '') +
            (f.reviewed_by_name ? ' · راجعه: ' + escapeHtml(f.reviewed_by_name) : '') + '</span></div>' +
            '<div style="display:flex;gap:6px;flex-shrink:0;">' +
            '<button class="btn ghost sm" data-view-file="' + f.id + '">عرض</button>' +
            '<button class="btn ghost sm" data-dl="' + f.id + '">تنزيل</button>' +
            '<button class="btn ghost sm" data-print-file="' + f.id + '">🖨 طباعة</button>' +
            (canUp ? '<button class="btn danger sm" data-del-file="' + f.id + '">حذف</button>' : '') + '</div></div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });

    // ---------- سكشن موحّد "التقارير الطبية" (تقرير طبي + Echo + أسنان + علاج طبيعي) ----------
    html += '<div class="section" style="padding:12px 14px 4px;">' +
      '<h2 style="font-size:15px;margin:0;">📋 التقارير الطبية</h2>' +
      '<p style="font-size:11px;color:var(--c-muted);margin:4px 0 0;">كل التقارير الطبية القابلة للطباعة لهذا المريض في مكان واحد.</p></div>';

    // -- تقرير طبي (نص حر) --
    var mrCat = CATEGORIES.filter(function (x) { return x.key === "medical_report"; })[0];
    var mrList = byCategory.medical_report || [];
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>تقرير طبي (' + (mrList.length + reports.length) + ')</span>' +
      (canUp ? '<span><button class="btn ghost sm" data-upload-cat="medical_report">+ رفع مستند</button> ' +
        '<button class="btn ghost sm" data-new-medical-report="1">+ إنشاء جديد</button>' +
        '<input type="file" accept="image/*,application/pdf" data-file-input-cat="medical_report" style="display:none;"></span>' : '') +
      '</h3>';
    if (canUp) {
      html += '<div class="field" data-other-wrap-cat style="display:none;margin-bottom:8px;">' +
        '<label>ملاحظات / تفاصيل الملف (اختياري)</label>' +
        '<input data-other-desc-cat placeholder="اكتب أي تفاصيل تخص الملف">' +
        '<label style="margin-top:6px;">تاريخ إصدار المستند (اختياري)</label>' +
        '<input type="date" data-issued-at-cat></div>';
    }
    html += '<div data-cat-status style="font-size:11px;color:var(--c-muted);margin-bottom:6px;"></div>';
    if (!mrList.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش مستندات مرفوعة.</p>';
    } else {
      mrList.forEach(function (f) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>' + escapeHtml(f.file_name) + '</b>' + (f.other_description ? ' — ' + escapeHtml(f.other_description) : '') +
          ' <span class="status-pill ' + (REVIEW_PILL[f.review_status] || "draft") + '" style="font-size:10px;">' + (REVIEW_LABELS[f.review_status] || f.review_status) + '</span>' +
          '<br><span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) +
          (f.uploaded_by_name ? ' · رفعه: ' + escapeHtml(f.uploaded_by_name) : '') +
          (f.reviewed_by_name ? ' · راجعه: ' + escapeHtml(f.reviewed_by_name) : '') + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-view-file="' + f.id + '">عرض</button>' +
          '<button class="btn ghost sm" data-dl="' + f.id + '">تنزيل</button>' +
          '<button class="btn ghost sm" data-print-file="' + f.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-file="' + f.id + '">حذف</button>' : '') + '</div></div>';
      });
    }
    html += '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--c-border);">' +
      '<b style="font-size:12px;">التقارير المُنشأة من الداشبورد (' + reports.length + ')</b>';
    if (!reports.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);margin-top:6px;">مفيش تقارير مُنشأة لسه.</p>';
    } else {
      reports.forEach(function (r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>' + escapeHtml("تقرير طبي" + (r.specialty ? (" - " + r.specialty) : "")) + '</b> — ' + fmtDate(r.report_date) + '<br>' +
          '<span style="color:var(--c-muted);">' + escapeHtml((r.body_text || "").slice(0, 60)) + ((r.body_text || "").length > 60 ? "…" : "") + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-medical-report="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-medical-report="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-medical-report="' + r.id + '">حذف</button>' : '') + '</div></div>';
      });
    }
    html += '</div></div>';

    // -- روشتة (مدموجة مع فئة رفع "وصفة طبية (روشتة)") --
    html += mergedDocSectionHtml("prescription", "روشتة", byCategory.prescription || [], prescriptions.length, canUp, 'data-new-prescription="1"',
      prescriptions, "روشتات", function (r) {
        return '<div><b>' + escapeHtml("روشتة" + (r.specialty ? (" - " + r.specialty) : "")) + '</b> — ' + fmtDate(r.report_date) +
          (r.doctor_name ? '<br><span style="color:var(--c-muted);">د. ' + escapeHtml(r.doctor_name) + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-prescription="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-prescription="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-prescription="' + r.id + '">حذف</button>' : '') + '</div>';
      });

    // -- طلب تحاليل (مدموجة مع فئة رفع "تحاليل") --
    html += mergedDocSectionHtml("lab_result", "تحاليل", byCategory.lab_result || [], labRequests.length, canUp, 'data-new-lab-request="1"',
      labRequests, "طلبات تحاليل", function (r) {
        return '<div><b>طلب تحاليل</b> — ' + fmtDate(r.report_date) + ' — ' + (r.tests || []).length + ' تحليل' +
          (r.doctor_name ? '<br><span style="color:var(--c-muted);">د. ' + escapeHtml(r.doctor_name) + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-lab-request="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-lab-request="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-lab-request="' + r.id + '">حذف</button>' : '') + '</div>';
      });

    // -- طلب أشعة (مدموجة مع فئة رفع "أشعة") --
    html += mergedDocSectionHtml("radiology", "أشعة", byCategory.radiology || [], radiologyRequests.length, canUp, 'data-new-radiology-request="1"',
      radiologyRequests, "طلبات أشعة", function (r) {
        return '<div><b>طلب أشعة</b> — ' + fmtDate(r.report_date) + ' — ' + (r.items || []).length + ' بند' +
          (r.doctor_name ? '<br><span style="color:var(--c-muted);">د. ' + escapeHtml(r.doctor_name) + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-radiology-request="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-radiology-request="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-radiology-request="' + r.id + '">حذف</button>' : '') + '</div>';
      });

    // ---------- Echocardiography Report ----------
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>Echocardiography Report (' + echoReports.length + ')</span>' +
      (canUp ? '<button class="btn ghost sm" data-new-echo-report="1">+ إنشاء جديد</button>' : '') +
      '</h3>';
    if (!echoReports.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش تقارير Echo مُنشأة لسه.</p>';
    } else {
      echoReports.forEach(function (r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>' + escapeHtml(r.patient_label || patient.full_name) + '</b> — ' + fmtDate(r.report_date) +
          (r.conclusion_text ? '<br><span style="color:var(--c-muted);">' + escapeHtml(r.conclusion_text.slice(0, 60)) + (r.conclusion_text.length > 60 ? "…" : "") + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-echo-report="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-echo-report="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-echo-report="' + r.id + '">حذف</button>' : '') + '</div></div>';
      });
    }
    html += '</div>';

    // ---------- تقرير أسنان ----------
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>تقرير أسنان (' + dentalReports.length + ')</span>' +
      (canUp ? '<button class="btn ghost sm" data-new-dental-report="1">+ إنشاء جديد</button>' : '') +
      '</h3>';
    if (!dentalReports.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش تقارير أسنان مُنشأة لسه.</p>';
    } else {
      dentalReports.forEach(function (r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>تقرير أسنان</b> — ' + fmtDate(r.report_date) +
          (r.chief_complaint ? '<br><span style="color:var(--c-muted);">' + escapeHtml(r.chief_complaint.slice(0, 60)) + (r.chief_complaint.length > 60 ? "…" : "") + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-dental-report="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-dental-report="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-dental-report="' + r.id + '">حذف</button>' : '') + '</div></div>';
      });
    }
    html += '</div>';

    // ---------- تقرير علاج طبيعي ----------
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>تقرير علاج طبيعي (' + physioReports.length + ')</span>' +
      (canUp ? '<button class="btn ghost sm" data-new-physio-report="1">+ إنشاء جديد</button>' : '') +
      '</h3>';
    if (!physioReports.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش تقارير علاج طبيعي مُنشأة لسه.</p>';
    } else {
      physioReports.forEach(function (r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<div><b>تقرير علاج طبيعي</b> — ' + fmtDate(r.visit_date) +
          (r.visit_reason ? '<br><span style="color:var(--c-muted);">' + escapeHtml(r.visit_reason.slice(0, 60)) + (r.visit_reason.length > 60 ? "…" : "") + '</span>' : '') + '</div>' +
          '<div style="display:flex;gap:6px;flex-shrink:0;">' +
          '<button class="btn ghost sm" data-edit-physio-report="' + r.id + '">تعديل</button>' +
          '<button class="btn ghost sm" data-print-physio-report="' + r.id + '">🖨 طباعة</button>' +
          (canUp ? '<button class="btn danger sm" data-del-physio-report="' + r.id + '">حذف</button>' : '') + '</div></div>';
      });
    }
    html += '</div>';

    // ---------- تقييم تجربة المريض ----------
    html += '<div class="section" style="padding:12px 14px;">' +
      '<h3 style="font-size:13px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<span>تقييم تجربة المريض (' + experienceRatings.length + ')</span>' +
      (canUp ? '<button class="btn ghost sm" data-new-experience-rating="1">+ تقييم جديد</button>' : '') +
      '</h3>';
    if (!experienceRatings.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش تقييمات مُسجّلة لسه.</p>';
    } else {
      experienceRatings.forEach(function (r) {
        var avg = experienceRatingAvg(r);
        html += '<div style="padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
          '<b>' + fmtDate(r.visit_date) + '</b> — متوسط التقييم: <b>' + (avg != null ? avg.toFixed(1) : "—") + '/5</b>' +
          (r.comment ? '<br><span style="color:var(--c-muted);">💬 ' + escapeHtml(r.comment) + '</span>' : '') + '</div>';
      });
    }
    html += '</div>';

    backdrop.innerHTML = html;
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };

    function reloadModal() {
      Promise.all([
        window.SSMPDDb.getPatientFiles(patient.id),
        window.SSMPDDb.getPatientMedicalProfile(patient.id).catch(function () { return null; }),
        window.SSMPDDb.listPatientVisits(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listMedicalReports(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listEchoReports(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listDentalReports(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listPhysioReports(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listPrescriptions(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listLabRequests(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listRadiologyRequests(patient.id).catch(function () { return []; }),
        window.SSMPDDb.listPatientExperienceRatings(patient.id).catch(function () { return []; }),
      ]).then(function (results) {
        renderPatientModal(backdrop, view, container, results[0].patient, results[0].files || [], results[1], results[2] || [], results[3] || [], results[4] || [], results[5] || [], results[6] || [], results[7] || [], results[8] || [], results[9] || [], results[10] || []);
      });
    }

    var editPersonalBtn = backdrop.querySelector("[data-edit-personal]");
    if (editPersonalBtn) {
      editPersonalBtn.onclick = function () { openEditPatientModal(patient, reloadModal); };
    }
    var editMedicalBtn = backdrop.querySelector("[data-edit-medical]");
    if (editMedicalBtn) {
      editMedicalBtn.onclick = function () { openEditMedicalProfileModal(patient, profile, reloadModal); };
    }
    var addVisitBtn = backdrop.querySelector("[data-add-visit]");
    if (addVisitBtn) {
      addVisitBtn.onclick = function () { openVisitFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-del-visit]").forEach(function (btn) {
      btn.onclick = function () {
        var visitId = btn.getAttribute("data-del-visit");
        window.SSMPDDb.deletePatientVisit(visitId).then(function () {
          T.show("اتحذفت الزيارة");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });
    backdrop.querySelectorAll("[data-view-visit]").forEach(function (btn) {
      btn.onclick = function () {
        var v = visits.filter(function (x) { return String(x.id) === btn.getAttribute("data-view-visit"); })[0];
        if (v) openViewVisitModal(v);
      };
    });
    backdrop.querySelectorAll("[data-edit-visit]").forEach(function (btn) {
      btn.onclick = function () {
        var v = visits.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-visit"); })[0];
        if (v) openVisitFormModal(patient, v, reloadModal);
      };
    });

    // ---------- طي/عرض قائمة مستندات كل تصنيف ----------
    backdrop.querySelectorAll("[data-toggle-files-cat]").forEach(function (btn) {
      btn.onclick = function () {
        var catKey = btn.getAttribute("data-toggle-files-cat");
        var list = btn.closest(".section").querySelector('[data-files-list-cat="' + catKey + '"]');
        if (!list) return;
        var open = list.style.display !== "none";
        list.style.display = open ? "none" : "block";
        btn.textContent = open ? "عرض المستندات ▾" : "إخفاء المستندات ▴";
      };
    });

    // ---------- زرار الرفع المستقل لكل تصنيف مستند ----------
    backdrop.querySelectorAll("[data-upload-cat]").forEach(function (btn) {
      var catKey = btn.getAttribute("data-upload-cat");
      var section = btn.closest(".section");
      var fileInput = section.querySelector('[data-file-input-cat="' + catKey + '"]');
      var otherWrap = section.querySelector("[data-other-wrap-cat]");
      var statusEl = section.querySelector("[data-cat-status]");

      btn.onclick = function () {
        if (otherWrap && otherWrap.style.display === "none") {
          otherWrap.style.display = "";
          return;
        }
        fileInput.click();
      };

      fileInput.onchange = function () {
        var file = fileInput.files[0];
        if (!file) return;
        var otherDesc = ((section.querySelector("[data-other-desc-cat]") || {}).value || "").trim();
        var issuedAt = ((section.querySelector("[data-issued-at-cat]") || {}).value || "").trim();
        if (catKey === "other" && !otherDesc) { statusEl.textContent = "اكتب وصف نوع الملف الأول"; fileInput.value = ""; return; }
        var fd = new FormData();
        fd.append("patient_id", patient.id);
        fd.append("category", catKey);
        if (otherDesc) fd.append("other_description", otherDesc);
        if (issuedAt) fd.append("issued_at", issuedAt);
        fd.append("file", file);
        statusEl.textContent = "بيرفع…";
        btn.disabled = true;
        window.SSMPDDb.uploadPatientFile(fd).then(function () {
          if (me) window.SSMPDDb.logUsageActivity(me.id, "رفع مستند مريض", file.name + " (" + categoryLabel(catKey) + ")").catch(function () {});
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

    var printAllBtn = backdrop.querySelector("[data-print-all]");
    if (printAllBtn) {
      printAllBtn.onclick = function () { printPatientFiles(files); };
    }
    var printProfileBtn = backdrop.querySelector("[data-print-profile]");
    if (printProfileBtn) {
      printProfileBtn.onclick = function () { printPatientProfile(patient, profile, visits, files); };
    }
    var printProfileTextBtn = backdrop.querySelector("[data-print-profile-text]");
    if (printProfileTextBtn) {
      printProfileTextBtn.onclick = function () { printPatientProfileTextOnly(patient, profile, visits); };
    }

    // ---------- تقرير طبي (إنشاء/تعديل/طباعة/حذف) ----------
    var newMedicalReportBtn = backdrop.querySelector("[data-new-medical-report]");
    if (newMedicalReportBtn) {
      newMedicalReportBtn.onclick = function () { openMedicalReportFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-medical-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = reports.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-medical-report"); })[0];
        if (r) openMedicalReportFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-medical-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = reports.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-medical-report"); })[0];
        if (r) printMedicalReport(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-medical-report]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف التقرير الطبي ده؟")) return;
        window.SSMPDDb.deleteMedicalReport(btn.getAttribute("data-del-medical-report")).then(function () {
          T.show("اتحذف التقرير");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- تقييم تجربة المريض (إنشاء بس — استبيان تكراري لكل زيارة) ----------
    var newExperienceRatingBtn = backdrop.querySelector("[data-new-experience-rating]");
    if (newExperienceRatingBtn) {
      newExperienceRatingBtn.onclick = function () { openExperienceRatingFormModal(patient, reloadModal); };
    }

    // ---------- روشتة (إنشاء/تعديل/طباعة/حذف) ----------
    var newPrescriptionBtn = backdrop.querySelector("[data-new-prescription]");
    if (newPrescriptionBtn) {
      newPrescriptionBtn.onclick = function () { openPrescriptionFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-prescription]").forEach(function (btn) {
      btn.onclick = function () {
        var r = prescriptions.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-prescription"); })[0];
        if (r) openPrescriptionFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-prescription]").forEach(function (btn) {
      btn.onclick = function () {
        var r = prescriptions.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-prescription"); })[0];
        if (r) printPrescription(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-prescription]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف الروشتة دي؟")) return;
        window.SSMPDDb.deletePrescription(btn.getAttribute("data-del-prescription")).then(function () {
          T.show("اتحذفت الروشتة");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- طلب تحاليل (إنشاء/تعديل/طباعة/حذف) ----------
    var newLabRequestBtn = backdrop.querySelector("[data-new-lab-request]");
    if (newLabRequestBtn) {
      newLabRequestBtn.onclick = function () { openLabRequestFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-lab-request]").forEach(function (btn) {
      btn.onclick = function () {
        var r = labRequests.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-lab-request"); })[0];
        if (r) openLabRequestFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-lab-request]").forEach(function (btn) {
      btn.onclick = function () {
        var r = labRequests.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-lab-request"); })[0];
        if (r) printLabRequest(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-lab-request]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف طلب التحاليل ده؟")) return;
        window.SSMPDDb.deleteLabRequest(btn.getAttribute("data-del-lab-request")).then(function () {
          T.show("اتحذف طلب التحاليل");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- طلب أشعة (إنشاء/تعديل/طباعة/حذف) ----------
    var newRadiologyRequestBtn = backdrop.querySelector("[data-new-radiology-request]");
    if (newRadiologyRequestBtn) {
      newRadiologyRequestBtn.onclick = function () { openRadiologyRequestFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-radiology-request]").forEach(function (btn) {
      btn.onclick = function () {
        var r = radiologyRequests.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-radiology-request"); })[0];
        if (r) openRadiologyRequestFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-radiology-request]").forEach(function (btn) {
      btn.onclick = function () {
        var r = radiologyRequests.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-radiology-request"); })[0];
        if (r) printRadiologyRequest(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-radiology-request]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف طلب الأشعة ده؟")) return;
        window.SSMPDDb.deleteRadiologyRequest(btn.getAttribute("data-del-radiology-request")).then(function () {
          T.show("اتحذف طلب الأشعة");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- Echocardiography Report (إنشاء/تعديل/طباعة/حذف) ----------
    var newEchoReportBtn = backdrop.querySelector("[data-new-echo-report]");
    if (newEchoReportBtn) {
      newEchoReportBtn.onclick = function () { openEchoReportFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-echo-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = echoReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-echo-report"); })[0];
        if (r) openEchoReportFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-echo-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = echoReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-echo-report"); })[0];
        if (r) printEchoReport(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-echo-report]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف تقرير الـEcho ده؟")) return;
        window.SSMPDDb.deleteEchoReport(btn.getAttribute("data-del-echo-report")).then(function () {
          T.show("اتحذف التقرير");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- تقرير أسنان (إنشاء/تعديل/طباعة/حذف) ----------
    var newDentalReportBtn = backdrop.querySelector("[data-new-dental-report]");
    if (newDentalReportBtn) {
      newDentalReportBtn.onclick = function () { openDentalReportFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-dental-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = dentalReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-dental-report"); })[0];
        if (r) openDentalReportFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-dental-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = dentalReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-dental-report"); })[0];
        if (r) printDentalReport(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-dental-report]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف تقرير الأسنان ده؟")) return;
        window.SSMPDDb.deleteDentalReport(btn.getAttribute("data-del-dental-report")).then(function () {
          T.show("اتحذف التقرير");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    // ---------- تقرير علاج طبيعي (إنشاء/تعديل/طباعة/حذف) ----------
    var newPhysioReportBtn = backdrop.querySelector("[data-new-physio-report]");
    if (newPhysioReportBtn) {
      newPhysioReportBtn.onclick = function () { openPhysioReportFormModal(patient, null, reloadModal); };
    }
    backdrop.querySelectorAll("[data-edit-physio-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = physioReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-edit-physio-report"); })[0];
        if (r) openPhysioReportFormModal(patient, r, reloadModal);
      };
    });
    backdrop.querySelectorAll("[data-print-physio-report]").forEach(function (btn) {
      btn.onclick = function () {
        var r = physioReports.filter(function (x) { return String(x.id) === btn.getAttribute("data-print-physio-report"); })[0];
        if (r) printPhysioReport(patient, r);
      };
    });
    backdrop.querySelectorAll("[data-del-physio-report]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("حذف تقرير العلاج الطبيعي ده؟")) return;
        window.SSMPDDb.deletePhysioReport(btn.getAttribute("data-del-physio-report")).then(function () {
          T.show("اتحذف التقرير");
          reloadModal();
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
      };
    });

    backdrop.querySelectorAll("[data-print-file]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-print-file");
        var f = files.filter(function (x) { return String(x.id) === fileId; })[0];
        if (f) printPatientFiles([f]);
      };
    });

    backdrop.querySelectorAll("[data-view-file]").forEach(function (btn) {
      btn.onclick = function () {
        var fileId = btn.getAttribute("data-view-file");
        // فتح تاب جديد فوراً (قبل الـ fetch) عشان متتحجبش من مانع النوافذ المنبثقة
        var win = window.open("", "_blank");
        btn.disabled = true;
        window.SSMPDDb.downloadPatientFile(fileId).then(function (res) {
          var url = URL.createObjectURL(res.blob);
          if (win) win.location.href = url;
          else { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click(); }
          btn.disabled = false;
          setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        }).catch(function (e) {
          if (win) win.close();
          T.show("خطأ: " + e.message, "error");
          btn.disabled = false;
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

  // بيستخدمها البحث الموحّد في الشريط العلوي (مرحلة ٦): بتحضّر شاشة "تصفح
  // وفلترة" بمصطلح البحث قبل أول رسم.
  function openSearch(term) {
    state.subTab = "browse";
    state.browseSearch = term;
  }

  window.SSMPDRenderPatients = {
    render: render, openSearch: openSearch,
    openExperienceRatingFormModal: openExperienceRatingFormModal,
    experienceRatingAvg: experienceRatingAvg
  };
})();
