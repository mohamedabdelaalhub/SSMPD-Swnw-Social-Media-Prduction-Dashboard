/* SSMPD — شاشة إدارة الليدز والتواصل مع العملاء: استقبال رسائل واتساب/ماسنجر،
   كشف تكرار تلقائي، مطابقة مع أرشيف المرضى، توزيع تلقائي، تسجيل محاولات تواصل،
   وتغيير الحالة. كل المنطق الحساس بيعدّي من Edge Functions (db.js). */
(function () {
  "use strict";
  var T = window.SSMPDToast;

  var STATUS_LABELS = {
    new: "جديد", in_progress: "قيد المتابعة", booked: "تم الحجز",
    interested_undecided: "مهتم لسه مقررش", rejected: "مرفوض",
    no_response: "لا يوجد رد", invalid_number: "رقم غير صحيح"
  };
  var STATUS_PILL_CLASS = {
    new: "received", in_progress: "approval", booked: "approved",
    interested_undecided: "approval", rejected: "revision",
    no_response: "draft", invalid_number: "revision"
  };
  var SOURCE_LABELS = { whatsapp: "واتساب", messenger: "ماسنجر" };
  var SERVICE_LABELS = {
    consultation: "استشارة", radiology: "أشعة", lab: "تحاليل", nursing: "تمريض",
    physiotherapy: "علاج طبيعي", treatment: "علاج", other: "أخرى"
  };
  var PRIORITY_LABELS = { high: "عالية", medium: "متوسطة", normal: "عادية" };
  var RESULT_LABELS = { answered: "تم الرد", no_answer: "لا يوجد رد", busy: "مشغول", call_back_later: "اتصال لاحقاً", other: "أخرى" };
  var CLOSED_STATUSES = ["booked", "rejected", "no_response", "invalid_number"];

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-US", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return iso; }
  }

  var state = { status: "", search: "", openOnly: false, page: 1, pageSize: 20 };

  function render(container) {
    container.innerHTML = '<div class="loading">بيحمّل…</div>';
    loadList(container);
  }

  function loadList(container) {
    window.SSMPDDb.listLeads({
      status: state.status || undefined,
      search: state.search || undefined,
      open_only: state.openOnly ? "true" : undefined,
      page: state.page, page_size: state.pageSize
    }).then(function (res) {
      var leads = res.leads || [];
      var total = res.total || 0;
      var totalPages = Math.max(1, Math.ceil(total / state.pageSize));

      var html = '<h2 style="margin-bottom:16px;">إدارة الليدز والتواصل مع العملاء</h2>';
      html += '<div class="section">';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">' +
        '<input id="ld-search" placeholder="بحث بالاسم / الهاتف" value="' + escapeHtml(state.search) + '" style="flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<select id="ld-status" style="padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
        '<option value="">كل الحالات</option>' +
        Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '" ' + (state.status === k ? "selected" : "") + '>' + STATUS_LABELS[k] + '</option>'; }).join("") +
        '</select>' +
        '<label style="font-size:12px;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="ld-open-only" ' + (state.openOnly ? "checked" : "") + '> المفتوحة بس</label>' +
        '<button class="btn ghost sm" id="ld-search-btn">بحث</button>' +
        '<button class="btn sm" id="ld-new-btn">+ ليد جديد</button></div>';

      if (!leads.length) {
        html += '<p style="color:var(--c-muted);font-size:13px;">مفيش ليدز مطابقة.</p>';
      } else {
        html += '<table class="simple"><thead><tr><th>العميل</th><th>الهاتف</th><th>المصدر</th><th>مريض</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead><tbody>';
        leads.forEach(function (l) {
          html += '<tr><td>' + escapeHtml(l.customer_name) + '</td><td>' + escapeHtml(l.phone_raw || l.phone_normalized || "—") + '</td>' +
            '<td>' + (SOURCE_LABELS[l.source] || l.source) + '</td>' +
            '<td>' + (l.patient_type === "existing" ? "قديم" : "جديد") + '</td>' +
            '<td><span class="status-pill ' + (STATUS_PILL_CLASS[l.current_status] || "draft") + '">' + (STATUS_LABELS[l.current_status] || l.current_status) + '</span></td>' +
            '<td style="font-size:11px;color:var(--c-muted);">' + fmtDate(l.created_at) + '</td>' +
            '<td><button class="btn ghost sm" data-open="' + l.id + '">فتح</button></td></tr>';
        });
        html += '</tbody></table>';
        html += '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:14px;">' +
          '<button class="btn ghost sm" id="ld-prev" ' + (state.page <= 1 ? "disabled" : "") + '>السابق</button>' +
          '<span style="font-size:12px;color:var(--c-muted);">صفحة ' + state.page + ' من ' + totalPages + ' (' + total + ' ليد)</span>' +
          '<button class="btn ghost sm" id="ld-next" ' + (state.page >= totalPages ? "disabled" : "") + '>التالي</button></div>';
      }
      html += '</div>';

      container.innerHTML = html;

      document.getElementById("ld-search-btn").onclick = function () {
        state.search = document.getElementById("ld-search").value.trim();
        state.status = document.getElementById("ld-status").value;
        state.openOnly = document.getElementById("ld-open-only").checked;
        state.page = 1;
        render(container);
      };
      document.getElementById("ld-search").onkeydown = function (e) { if (e.key === "Enter") document.getElementById("ld-search-btn").click(); };
      document.getElementById("ld-new-btn").onclick = function () { openNewLeadModal(container); };
      var prevBtn = document.getElementById("ld-prev");
      var nextBtn = document.getElementById("ld-next");
      if (prevBtn) prevBtn.onclick = function () { if (state.page > 1) { state.page--; render(container); } };
      if (nextBtn) nextBtn.onclick = function () { state.page++; render(container); };

      container.querySelectorAll("[data-open]").forEach(function (btn) {
        btn.onclick = function () { openLeadModal(container, btn.getAttribute("data-open")); };
      });
    }).catch(function (e) {
      container.innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
    });
  }

  function newLeadFormHtml() {
    return '<div class="field"><label>اسم العميل</label><input id="nl-name"></div>' +
      '<div class="field"><label>رقم الهاتف</label><input id="nl-phone" placeholder="01xxxxxxxxx"></div>' +
      '<div class="field"><label>المصدر</label><select id="nl-source"><option value="whatsapp">واتساب</option><option value="messenger">ماسنجر</option></select></div>' +
      '<div class="field"><label>نص الرسالة (اختياري)</label><textarea id="nl-message" rows="2"></textarea></div>' +
      '<div class="field"><label>الخدمة المهتم بيها (اختياري)</label><select id="nl-service"><option value="">— بدون —</option>' +
      Object.keys(SERVICE_LABELS).map(function (k) { return '<option value="' + k + '">' + SERVICE_LABELS[k] + '</option>'; }).join("") + '</select></div>' +
      '<div id="nl-dup-box"></div>';
  }

  function openNewLeadModal(container) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>ليد جديد</h3><button class="modal-close">×</button></div>' +
      newLeadFormHtml() +
      '<button class="btn block" id="nl-save">حفظ</button></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

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
        backdrop.remove();
        render(container);
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

  function openLeadModal(container, leadId) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="loading">بيحمّل…</div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    function reload() {
      // مفيش endpoint لجلب ليد واحد بالـ id — بنستخدم استعلام مباشر محكوم بنفس RLS
      // بتاع جدول leads (قراءة فقط، مفيش منطق حساس هنا فمش لازم Edge Function)
      window.SSMPDDb.client.from("leads").select("*").eq("id", leadId).single().then(function (res) {
        if (res.error) throw res.error;
        return Promise.all([res.data, window.SSMPDDb.listLeadAttempts(leadId)]);
      }).then(function (r) {
        renderLeadModal(backdrop, container, r[0], r[1] || []);
      }).catch(function (e) {
        backdrop.querySelector(".modal").innerHTML = '<div class="err-msg">خطأ: ' + e.message + '</div>';
      });
    }
    reload();
  }

  function renderLeadModal(backdrop, listContainer, lead, attempts) {
    var html = '<div class="modal"><div class="modal-head"><h3>' + escapeHtml(lead.customer_name) + '</h3><button class="modal-close">×</button></div>';
    html += '<div class="status-pill ' + (STATUS_PILL_CLASS[lead.current_status] || "draft") + '" style="margin-bottom:12px;">' + (STATUS_LABELS[lead.current_status] || lead.current_status) + '</div>';
    html += '<p style="font-size:13px;line-height:1.9;">' +
      'الهاتف: <b>' + escapeHtml(lead.phone_raw || lead.phone_normalized || "—") + '</b><br>' +
      'المصدر: ' + (SOURCE_LABELS[lead.source] || lead.source) + '<br>' +
      'مريض: ' + (lead.patient_type === "existing" ? "قديم" : "جديد") + '<br>' +
      (lead.interested_service ? ('مهتم بـ: ' + (SERVICE_LABELS[lead.interested_service] || lead.interested_service) + '<br>') : '') +
      (lead.message_text ? ('الرسالة: ' + escapeHtml(lead.message_text) + '<br>') : '') +
      'تاريخ الاستلام: ' + fmtDate(lead.created_at) +
      '</p>';

    // تحديث الحالة والأولوية ورقم الحجز
    html += '<div class="field" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
      '<div><label>الحالة</label><select id="lm-status">' +
      Object.keys(STATUS_LABELS).map(function (k) { return '<option value="' + k + '" ' + (k === lead.current_status ? "selected" : "") + '>' + STATUS_LABELS[k] + '</option>'; }).join("") +
      '</select></div>' +
      '<div><label>الأولوية</label><select id="lm-priority">' +
      Object.keys(PRIORITY_LABELS).map(function (k) { return '<option value="' + k + '" ' + (k === lead.priority ? "selected" : "") + '>' + PRIORITY_LABELS[k] + '</option>'; }).join("") +
      '</select></div>' +
      '<div><label>رقم الحجز (اختياري)</label><input id="lm-booking" value="' + escapeHtml(lead.booking_reference || "") + '" style="width:140px;"></div>' +
      '<button class="btn ghost sm" id="lm-save-status">حفظ</button></div>';

    // تسجيل محاولة تواصل جديدة
    html += '<div class="field" style="border-top:1px solid var(--c-border);padding-top:14px;">' +
      '<label>تسجيل محاولة تواصل</label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
      '<select id="at-result">' + Object.keys(RESULT_LABELS).map(function (k) { return '<option value="' + k + '">' + RESULT_LABELS[k] + '</option>'; }).join("") + '</select>' +
      '<input id="at-notes" placeholder="ملاحظات (اختياري)" style="flex:1;min-width:160px;padding:9px 12px;border-radius:10px;border:1px solid var(--c-border);">' +
      '<input id="at-followup" type="date" title="معاد متابعة جاي (اختياري)">' +
      '<button class="btn sm" id="at-save">تسجيل</button></div></div>';

    // سجل المحاولات
    html += '<div style="border-top:1px solid var(--c-border);padding-top:14px;margin-top:6px;"><label style="font-size:12px;color:var(--c-muted);display:block;margin-bottom:8px;">سجل المحاولات (' + attempts.length + ')</label>';
    if (!attempts.length) {
      html += '<p style="font-size:12px;color:var(--c-muted);">مفيش محاولات مسجّلة لسه.</p>';
    } else {
      attempts.forEach(function (a) {
        html += '<div style="font-size:12px;padding:6px 0;border-bottom:1px solid var(--c-border);">' +
          '<b>' + (RESULT_LABELS[a.result] || a.result) + '</b> — ' + fmtDate(a.attempt_date) +
          (a.notes ? ('<br><span style="color:var(--c-muted);">' + escapeHtml(a.notes) + '</span>') : '') + '</div>';
      });
    }
    html += '</div></div>';

    backdrop.innerHTML = html;
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };

    document.getElementById("lm-save-status").onclick = function () {
      var payload = {
        lead_id: lead.id,
        current_status: document.getElementById("lm-status").value,
        priority: document.getElementById("lm-priority").value,
        booking_reference: document.getElementById("lm-booking").value.trim() || ""
      };
      window.SSMPDDb.updateLeadStatus(payload).then(function () {
        T.show("اتحدّثت بيانات الليد");
        backdrop.remove();
        render(listContainer);
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
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
        backdrop.remove();
        openLeadModal(listContainer, lead.id);
      }).catch(function (e) { T.show("خطأ: " + e.message, "error"); });
    };
  }

  window.SSMPDRenderLeads = { render: render };
})();
