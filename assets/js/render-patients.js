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
        '<button class="btn sm" id="uf-btn">رفع</button></div>' +
        '<div class="field" id="uf-other-wrap" style="display:none;"><label>وصف نوع الملف</label><input id="uf-other-desc" placeholder="اكتب نوع الملف"></div>' +
        '<div id="uf-status" style="font-size:12px;color:var(--c-muted);"></div>';

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

  // ---------- إضافة زيارة جديدة لسجل الزيارات ----------
  function openAddVisitModal(patient, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>زيارة جديدة</h3><button class="modal-close">×</button></div>' +
      '<div class="field"><label>تاريخ الزيارة</label><input id="vs-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></div>' +
      '<div class="field"><label>رقم الزيارة</label><input id="vs-number"></div>' +
      '<div class="field"><label>الشكوى</label><input id="vs-complaint"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div class="field" style="flex:1;min-width:110px;"><label>ضغط الدم</label><input id="vs-bp"></div>' +
      '<div class="field" style="flex:1;min-width:110px;"><label>سكر الدم</label><input id="vs-sugar"></div>' +
      '<div class="field" style="flex:1;min-width:110px;"><label>النبض</label><input id="vs-pulse"></div>' +
      '</div>' +
      '<div class="field"><label>الأدوية</label><input id="vs-meds"></div>' +
      '<div class="field"><label>الأشعة</label><input id="vs-xrays"></div>' +
      '<div class="field"><label>التحاليل</label><input id="vs-labs"></div>' +
      '<div class="field"><label>توصيات أخرى</label><input id="vs-other"></div>' +
      '<div class="field"><label>تاريخ المتابعة</label><input id="vs-followup" type="date"></div>' +
      '<button class="btn block" id="vs-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("vs-save").onclick = function () {
      var visit = {
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
        follow_up_date: document.getElementById("vs-followup").value || null
      };
      window.SSMPDDb.addPatientVisit(patient.id, visit, me && me.id).then(function () {
        T.show("اتضافت الزيارة");
        backdrop.remove();
        if (onSaved) onSaved();
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
          var canAssign = canAssignDoctor();
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
              '<button class="btn ghost sm" data-edit="' + p.id + '">تعديل البيانات</button>' +
              (canAssign ? '<button class="btn ghost sm" data-assign="' + p.id + '" data-assign-name="' + escapeHtml(p.full_name) + '">تحويل لطبيب سونو</button>' : '') +
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
      ]).then(function (results) {
        var res = results[0], profile = results[1], visits = results[2] || [];
        renderPatientModal(backdrop, view, container, res.patient, res.files || [], profile, visits);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();
  }

  function renderPatientModal(backdrop, view, container, patient, files, profile, visits) {
    var byCategory = {};
    CATEGORIES.forEach(function (c) { byCategory[c.key] = []; });
    files.forEach(function (f) { (byCategory[f.category] || (byCategory[f.category] = [])).push(f); });
    profile = profile || null;
    visits = visits || [];

    var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(patient.full_name) +
      ' <span style="font-size:12px;color:var(--c-muted);">(' + escapeHtml(patient.patient_code || "") + ')</span></h3>' +
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
          '<td>' + escapeHtml(v.complaint || '—') + '</td><td>' + escapeHtml(plan || '—') + '</td>' +
          '<td>' + (v.follow_up_date ? fmtDate(v.follow_up_date) : '—') + '</td>' +
          (canEditMedical ? '<td><button class="btn danger sm" data-del-visit="' + v.id + '">حذف</button></td>' : '') + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

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
            (canUp ? '<button class="btn danger sm" data-del-file="' + f.id + '">حذف</button>' : '') + '</div></div>';
        });
      }
      html += '</div>';
    });

    html += '</div>';
    backdrop.innerHTML = html;
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };

    function reloadModal() {
      Promise.all([
        window.SSMPDDb.getPatientFiles(patient.id),
        window.SSMPDDb.getPatientMedicalProfile(patient.id).catch(function () { return null; }),
        window.SSMPDDb.listPatientVisits(patient.id).catch(function () { return []; }),
      ]).then(function (results) {
        renderPatientModal(backdrop, view, container, results[0].patient, results[0].files || [], results[1], results[2] || []);
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
      addVisitBtn.onclick = function () { openAddVisitModal(patient, reloadModal); };
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
