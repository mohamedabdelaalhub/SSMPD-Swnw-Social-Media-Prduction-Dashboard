/* SSMPD — شاشة أرشيف المرضى: بحث/إنشاء مريض، رفع/عرض/تنزيل/حذف ملفاته على Google Drive
   كل عملية بتعدّي من Supabase Edge Functions (db.js → *PatientArchive/*PatientFile) — مفيش
   أي وصول مباشر لـ Drive من المتصفح، ومفيش أي رابط مشاركة مباشر يوصل للموظف. */
(function () {
  "use strict";
  var T = window.SSMPDToast;

  var CATEGORIES = [
    { key: "id_document", label: "تحقيق شخصية" },
    { key: "insurance", label: "تأمين" },
    { key: "radiology", label: "أشعة" },
    { key: "lab_result", label: "تحاليل" },
    { key: "other", label: "أخرى" }
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

  var state = { search: "", page: 1, pageSize: 20 };

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    loadList(container);
  }

  function loadList(container) {
    window.SSMPDDb.listPatientsArchive({ search: state.search || undefined, page: state.page, page_size: state.pageSize })
      .then(function (res) {
        var patients = res.patients || [];
        var total = res.total || 0;
        var totalPages = Math.max(1, Math.ceil(total / state.pageSize));

        var html = '<h2 style="margin-bottom:16px;">أرشيف المرضى</h2>';
        html += '<div class="section">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
          '<input id="pt-search" placeholder="بحث بالاسم / الهاتف / كود المريض" value="' + escapeHtml(state.search) + '" style="flex:1;min-width:220px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
          '<button class="btn ghost sm" id="pt-search-btn">بحث</button>' +
          '<button class="btn sm" id="pt-new-btn">+ مريض جديد</button></div>';

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
            '<button class="btn ghost sm" id="pt-prev" ' + (state.page <= 1 ? "disabled" : "") + '>السابق</button>' +
            '<span style="font-size:12px;color:var(--c-muted);">صفحة ' + state.page + ' من ' + totalPages + ' (' + total + ' مريض)</span>' +
            '<button class="btn ghost sm" id="pt-next" ' + (state.page >= totalPages ? "disabled" : "") + '>التالي</button></div>';
        }
        html += '</div>';

        container.innerHTML = html;

        document.getElementById("pt-search-btn").onclick = function () {
          state.search = document.getElementById("pt-search").value.trim();
          state.page = 1;
          render(container);
        };
        document.getElementById("pt-search").onkeydown = function (e) {
          if (e.key === "Enter") document.getElementById("pt-search-btn").click();
        };
        document.getElementById("pt-new-btn").onclick = function () { openNewPatientModal(container); };
        var prevBtn = document.getElementById("pt-prev");
        var nextBtn = document.getElementById("pt-next");
        if (prevBtn) prevBtn.onclick = function () { if (state.page > 1) { state.page--; render(container); } };
        if (nextBtn) nextBtn.onclick = function () { state.page++; render(container); };

        container.querySelectorAll("[data-open]").forEach(function (btn) {
          btn.onclick = function () { openPatientModal(container, btn.getAttribute("data-open")); };
        });
      }).catch(function (e) {
        container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
  }

  function openNewPatientModal(container) {
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
          if (res.id) openPatientModal(container, res.id); else render(container);
        }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  function openPatientModal(container, patientId) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function reload() {
      window.SSMPDDb.getPatientFiles(patientId).then(function (res) {
        renderPatientModal(backdrop, container, res.patient, res.files || []);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();
  }

  function renderPatientModal(backdrop, listContainer, patient, files) {
    var byCategory = {};
    CATEGORIES.forEach(function (c) { byCategory[c.key] = []; });
    files.forEach(function (f) { (byCategory[f.category] || (byCategory[f.category] = [])).push(f); });

    var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(patient.full_name) +
      ' <span style="font-size:12px;color:var(--c-muted);">(' + escapeHtml(patient.patient_code || "") + ')</span></h3>' +
      '<button class="modal-close">×</button></div>' +
      '<p style="font-size:12px;color:var(--c-muted);margin-bottom:14px;">الهاتف: ' + escapeHtml(patient.phone || "—") + '</p>';

    html += '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
      '<div style="flex:1;min-width:140px;"><label>رفع ملف جديد</label><select id="up-category">' +
      CATEGORIES.map(function (c) { return '<option value="' + c.key + '">' + c.label + '</option>'; }).join("") +
      '</select></div>' +
      '<div style="flex:2;min-width:180px;"><input type="file" id="up-file"></div>' +
      '<button class="btn sm" id="up-btn">رفع</button></div>' +
      '<div id="up-status" style="font-size:12px;color:var(--c-muted);margin-bottom:10px;"></div>';

    CATEGORIES.forEach(function (c) {
      var list = byCategory[c.key] || [];
      html += '<div class="section" style="padding:12px 14px;"><h3 style="font-size:13px;margin-bottom:10px;">' + c.label + ' (' + list.length + ')</h3>';
      if (!list.length) {
        html += '<p style="font-size:12px;color:var(--c-muted);">مفيش ملفات.</p>';
      } else {
        list.forEach(function (f) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-border);font-size:12px;">' +
            '<div><b>' + escapeHtml(f.file_name) + '</b><br><span style="color:var(--c-muted);">' + fmtBytes(f.file_size) + ' · ' + fmtDate(f.uploaded_at) + '</span></div>' +
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

    document.getElementById("up-btn").onclick = function () {
      var category = document.getElementById("up-category").value;
      var fileInput = document.getElementById("up-file");
      var file = fileInput.files[0];
      var statusEl = document.getElementById("up-status");
      if (!file) { statusEl.textContent = "اختار ملف الأول"; return; }
      var fd = new FormData();
      fd.append("patient_id", patient.id);
      fd.append("category", category);
      fd.append("file", file);
      statusEl.textContent = "بيرفع…";
      window.SSMPDDb.uploadPatientFile(fd).then(function () {
        window.SSMPDToast.show("اترفع الملف بنجاح");
        window.SSMPDDb.getPatientFiles(patient.id).then(function (res) {
          renderPatientModal(backdrop, listContainer, res.patient, res.files || []);
        });
      }).catch(function (e) {
        statusEl.textContent = "خطأ: " + e.message;
      });
    };

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
        }).catch(function (e) { window.SSMPDToast.show("خطأ: " + e.message, "error"); btn.disabled = false; });
      };
    });

    backdrop.querySelectorAll("[data-del-file]").forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains("confirm-pending")) {
          var fileId = btn.getAttribute("data-del-file");
          window.SSMPDDb.deletePatientFile(fileId).then(function () {
            window.SSMPDToast.show("اتحذف الملف");
            window.SSMPDDb.getPatientFiles(patient.id).then(function (res) {
              renderPatientModal(backdrop, listContainer, res.patient, res.files || []);
            });
          }).catch(function (e) { window.SSMPDToast.show("خطأ: " + e.message, "error"); });
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
