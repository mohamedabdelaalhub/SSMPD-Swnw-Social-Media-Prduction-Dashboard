/* SSMPD — جهات التعاقد: ملف جهة، عقود، متابعة، مرضى وإيراد موثق من الفواتير. */
(function () {
  "use strict";
  var T = window.SSMPDToast;
  var TYPES = { school: "مدرسة", nursery: "حضانة", center: "مركز", clinic: "عيادة", other: "أخرى" };
  var STATUSES = { negotiating: "قيد التفاوض", active: "تم التعاقد", suspended: "معلّق", expired: "منتهي", rejected: "مرفوض" };
  var ACTIVITY = { call: "اتصال", meeting: "اجتماع", whatsapp: "واتساب", email: "بريد", note: "ملاحظة" };
  var me;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); }
  function date(v) { return v ? new Date(v).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—"; }
  function money(v) { return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ج.م"; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function statusPill(s) { var c = s === "active" ? "approved" : s === "negotiating" ? "approval" : s === "rejected" ? "revision" : "draft"; return '<span class="status-pill ' + c + '">' + (STATUSES[s] || s || "بدون عقد") + "</span>"; }

  function render(container) {
    me = window.SSMPDAuth.currentAdmin;
    container.innerHTML = '<div id="ce-view"><div class="loading">بيحمّل جهات التعاقد…</div></div>';
    load(container);
  }

  function load(container) {
    window.SSMPDDb.listContractingEntities().then(function (rows) {
      rows = rows || [];
      var active = rows.filter(function (r) { return r.contract_status === "active"; });
      var negotiating = rows.filter(function (r) { return r.contract_status === "negotiating"; });
      var revenue = rows.reduce(function (n, r) { return n + Number(r.documented_revenue || 0); }, 0);
      var html = '<div class="section"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;"><div><h2 style="margin:0 0 4px;">جهات التعاقد</h2><p style="margin:0;color:var(--c-muted);font-size:13px;">تتبّع الجهات، العقود، المرضى المرتبطين، والإيراد الموثق من فواتير الخدمات.</p></div><button class="btn" id="ce-new">إضافة جهة تعاقد</button></div>' +
        '<div class="kpis" style="margin-top:16px;"><div class="kpi-card"><div class="label">جهات نشطة</div><div class="value">' + active.length + '</div></div><div class="kpi-card"><div class="label">قيد التفاوض</div><div class="value">' + negotiating.length + '</div></div><div class="kpi-card"><div class="label">مرضى مرتبطون</div><div class="value">' + rows.reduce(function (n, r) { return n + Number(r.patients_count || 0); }, 0) + '</div></div><div class="kpi-card"><div class="label">إيراد موثق</div><div class="value small">' + money(revenue) + '</div></div></div></div>';
      html += '<div class="section"><div style="overflow:auto;"><table><thead><tr><th>الجهة</th><th>النوع</th><th>الحالة</th><th>نهاية العقد</th><th>المتابعة القادمة</th><th>المرضى</th><th>الإيراد الموثق</th><th></th></tr></thead><tbody>';
      if (!rows.length) html += '<tr><td colspan="8" style="text-align:center;color:var(--c-muted);padding:24px;">لا توجد جهات تعاقد مسجلة بعد.</td></tr>';
      rows.forEach(function (r) {
        html += '<tr><td><b>' + esc(r.entity_name) + '</b></td><td>' + (TYPES[r.entity_type] || r.entity_type) + '</td><td>' + statusPill(r.contract_status) + '</td><td>' + date(r.end_date) + '</td><td>' + date(r.next_follow_up_date) + '</td><td>' + Number(r.patients_count || 0) + '</td><td>' + money(r.documented_revenue) + '</td><td><button class="btn ghost sm" data-open="' + r.entity_id + '">فتح الملف</button></td></tr>';
      });
      html += '</tbody></table></div><p style="font-size:11px;color:var(--c-muted);margin:12px 0 0;">الإيراد الموثق = مجموع فواتير الخدمات المسجلة للمريض بعد ربطه بالعقد. نسبة الخصم محفوظة في العقد ولا تتحول لقيمة نقدية إلا عند وجود فاتورة قبل الخصم.</p></div>';
      container.querySelector("#ce-view").innerHTML = html;
      document.getElementById("ce-new").onclick = function () { openCreate(container); };
      container.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openDetails(b.getAttribute("data-open"), container); }; });
    }).catch(function (e) { container.querySelector("#ce-view").innerHTML = '<div class="section"><p>تعذر تحميل جهات التعاقد: ' + esc(e.message) + '</p></div>'; });
  }

  function modal(title, html) {
    var bd = document.createElement("div"); bd.className = "modal-backdrop";
    bd.innerHTML = '<div class="modal" style="max-width:820px;"><div class="modal-head"><h3>' + title + '</h3><button class="modal-close">×</button></div>' + html + '</div>';
    document.body.appendChild(bd); bd.querySelector(".modal-close").onclick = function () { bd.remove(); }; bd.onclick = function (e) { if (e.target === bd) bd.remove(); }; return bd;
  }
  function input(id, label, type, value) { return '<div class="field"><label>' + label + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + esc(value || "") + '"></div>'; }

  function openCreate(container) {
    var typeOpts = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k] + '</option>'; }).join("");
    var bd = modal("إضافة جهة تعاقد", '<div class="section" style="margin:0;"><h4>بيانات الجهة</h4>' + input("ce-name", "اسم المدرسة / المركز", "text") + '<div class="field"><label>نوع الجهة</label><select id="ce-type">' + typeOpts + '</select></div>' + input("ce-address", "العنوان", "text") +
      '<h4>بيانات المسؤول</h4>' + input("ce-contact", "اسم الشخص المسؤول", "text") + input("ce-title", "المسمى الوظيفي", "text") + input("ce-phone", "رقم التليفون", "tel") + input("ce-wa", "رقم واتساب", "tel") +
      '<h4>العقد الأول</h4>' + input("ce-agreement", "تاريخ التعاقد", "date", today()) + input("ce-start", "تاريخ بداية التعاقد", "date", today()) + input("ce-end", "تاريخ انتهاء التعاقد", "date") +
      '<div class="field"><label>حالة التعاقد</label><select id="ce-status">' + Object.keys(STATUSES).map(function (k) { return '<option value="' + k + '"' + (k === "negotiating" ? " selected" : "") + '>' + STATUSES[k] + '</option>'; }).join("") + '</select></div>' + input("ce-discount", "نسبة الخصم المتفق عليها %", "number", "0") + input("ce-cashback", "نسبة الكاش باك %", "number", "0") + input("ce-cashback-recipient", "مستحق الكاش باك", "text") + input("ce-transfer", "رقم كاش باك / وسيلة التحويل", "text") +
      '<div class="field"><label>الخدمات المتفق عليها</label><textarea id="ce-services" rows="2"></textarea></div><div class="field"><label>ملاحظات</label><textarea id="ce-notes" rows="3"></textarea></div>' +
      '<div class="field"><label>اسم مسؤول التعاقد</label><input value="' + esc((me && (me.name || me.email)) || "") + '" readonly></div>' + input("ce-signed-by", "اسم الموقّع على العقد", "text") + input("ce-signed-doc", "رابط خارجي اختياري للعقد", "url") + '<p style="font-size:12px;color:var(--c-muted);margin:-8px 0 14px;">بعد الحفظ يمكنك رفع ملف العقد نفسه وسيُحفظ تلقائيًا في Google Drive.</p>' +
      '<h4>المتابعة</h4><div class="field"><label>موعد المتابعة القادمة</label><input id="ce-follow" type="date"></div><button class="btn block" id="ce-save">حفظ جهة التعاقد</button></div>');
    bd.querySelector("#ce-save").onclick = function () {
      var name = bd.querySelector("#ce-name").value.trim(); if (!name) { T.show("اكتب اسم الجهة", "error"); return; }
      var pct = function (id) { var n = Number(bd.querySelector(id).value || 0); return isFinite(n) ? n : 0; };
      var entity = { name: name, entity_type: bd.querySelector("#ce-type").value, address: bd.querySelector("#ce-address").value.trim() || null, owner_admin_id: me.id, created_by: me.id, notes: bd.querySelector("#ce-notes").value.trim() || null };
      var contact = { full_name: bd.querySelector("#ce-contact").value.trim(), job_title: bd.querySelector("#ce-title").value.trim() || null, phone: bd.querySelector("#ce-phone").value.trim() || null, whatsapp: bd.querySelector("#ce-wa").value.trim() || null };
      var contract = { agreement_date: bd.querySelector("#ce-agreement").value || null, start_date: bd.querySelector("#ce-start").value || today(), end_date: bd.querySelector("#ce-end").value || null, status: bd.querySelector("#ce-status").value, discount_percent: pct("#ce-discount"), cashback_percent: pct("#ce-cashback"), cashback_recipient: bd.querySelector("#ce-cashback-recipient").value.trim() || null, cashback_transfer_method: bd.querySelector("#ce-transfer").value.trim() || null, services: bd.querySelector("#ce-services").value.trim() || null, signed_by_name: bd.querySelector("#ce-signed-by").value.trim() || null, signed_document_url: bd.querySelector("#ce-signed-doc").value.trim() || null, created_by: me.id };
      var follow = bd.querySelector("#ce-follow").value; var activity = follow ? { activity_type: "note", summary: "تم إنشاء ملف جهة التعاقد", next_follow_up_date: follow, created_by: me.id } : null;
      bd.querySelector("#ce-save").disabled = true;
      window.SSMPDDb.createContractingEntity(entity, contact, contract, activity).then(function (created) { T.show("تم حفظ جهة التعاقد"); bd.remove(); load(container); openDetails(created.id, container); }).catch(function (e) { bd.querySelector("#ce-save").disabled = false; T.show("خطأ: " + e.message, "error"); });
    };
  }

  function openDetails(entityId, container) {
    var bd = modal("ملف جهة التعاقد", '<div class="loading">بيحمّل الملف…</div>');
    function reload() {
      window.SSMPDDb.getContractingEntityDetails(entityId).then(function (d) {
        var activeContract = d.contracts.filter(function (c) { return c.status === "active"; })[0] || d.contracts[0];
        var total = d.finance.reduce(function (n, r) { return n + Number(r.documented_revenue || 0); }, 0);
        var cash = d.finance.reduce(function (n, r) { return n + Number(r.cashback_due || 0); }, 0);
        var html = '<div class="section" style="margin:0 0 12px;"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start;"><div><h2 style="margin:0 0 5px;">' + esc(d.entity.name) + '</h2><div>' + (TYPES[d.entity.entity_type] || d.entity.entity_type) + ' · ' + statusPill(activeContract && activeContract.status) + '</div><p style="color:var(--c-muted);font-size:12px;">' + esc(d.entity.address || "لا يوجد عنوان") + '</p></div><button class="btn sm" id="ced-link">ربط مريض</button></div><div class="kpis" style="margin-top:12px;"><div class="kpi-card"><div class="label">مرضى مرتبطون</div><div class="value">' + d.finance.length + '</div></div><div class="kpi-card"><div class="label">إيراد موثق</div><div class="value small">' + money(total) + '</div></div><div class="kpi-card"><div class="label">كاش باك مستحق</div><div class="value small">' + money(cash) + '</div></div></div></div>';
        html += '<div class="section"><h4>بيانات التواصل</h4>' + (d.contacts.length ? d.contacts.map(function (c) { return '<div style="padding:7px 0;border-bottom:1px solid var(--c-border);"><b>' + esc(c.full_name) + '</b> — ' + esc(c.job_title || "") + '<br><span style="font-size:12px;color:var(--c-muted);">' + esc(c.phone || "") + (c.whatsapp ? " · واتساب: " + esc(c.whatsapp) : "") + '</span></div>'; }).join("") : '<p>لا توجد بيانات اتصال.</p>') + '</div>';
        html += '<div class="section"><h4>العقود</h4><div style="overflow:auto"><table><thead><tr><th>الحالة</th><th>من</th><th>إلى</th><th>خصم</th><th>كاش باك</th><th>الخدمات</th><th>العقد الموقع</th></tr></thead><tbody>' + d.contracts.map(function (c) { var file = c.signed_document_url ? '<a class="btn ghost sm" href="' + esc(c.signed_document_url) + '" target="_blank" rel="noopener">فتح العقد</a>' : ''; return '<tr><td>' + statusPill(c.status) + '<button class="btn ghost sm" style="display:block;margin-top:8px;white-space:nowrap;" data-edit-contract="' + c.id + '">تعديل العقد</button></td><td>' + date(c.start_date) + '</td><td>' + date(c.end_date) + '</td><td>' + c.discount_percent + '%</td><td>' + c.cashback_percent + '%</td><td>' + esc(c.services || "—") + '</td><td style="white-space:nowrap;">' + file + '<button class="btn ghost sm" data-upload-contract="' + c.id + '">رفع' + (file ? '/استبدال' : ' العقد') + '</button></td></tr>'; }).join("") + '</tbody></table></div></div>';
        html += '<div class="section"><h4>المرضى والإيراد الموثق</h4><div style="overflow:auto"><table><thead><tr><th>المريض</th><th>الكود</th><th>عدد الفواتير</th><th>الإيراد</th><th>الكاش باك</th><th>بعد الكاش باك</th></tr></thead><tbody>' + (d.finance.length ? d.finance.map(function (r) { return '<tr><td>' + esc(r.patient_name) + '</td><td>' + esc(r.patient_code) + '</td><td>' + r.invoices_count + '</td><td>' + money(r.documented_revenue) + '</td><td>' + money(r.cashback_due) + '</td><td>' + money(r.net_after_cashback) + '</td></tr>'; }).join("") : '<tr><td colspan="6">لا يوجد مرضى مرتبطون بعد.</td></tr>') + '</tbody></table></div></div>';
        html += '<div class="section"><h4>المتابعة</h4><div class="field"><label>تسجيل متابعة</label><textarea id="ced-note" rows="2" placeholder="نتيجة الاتصال أو الاجتماع"></textarea></div><div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;"><div class="field" style="margin:0;min-width:160px;"><label>النوع</label><select id="ced-type">' + Object.keys(ACTIVITY).map(function (k) { return '<option value="' + k + '">' + ACTIVITY[k] + '</option>'; }).join("") + '</select></div><div class="field" style="margin:0;min-width:160px;"><label>المتابعة القادمة</label><input id="ced-follow" type="date"></div><button class="btn sm" id="ced-add">حفظ المتابعة</button></div><div style="margin-top:14px;">' + (d.activities.length ? d.activities.map(function (a) { return '<div style="padding:8px 0;border-bottom:1px solid var(--c-border);"><b>' + (ACTIVITY[a.activity_type] || a.activity_type) + '</b> — ' + esc(a.summary) + '<br><span style="font-size:11px;color:var(--c-muted);">المتابعة: ' + date(a.next_follow_up_date) + ' · ' + date(a.created_at) + '</span></div>'; }).join("") : '<p>لا توجد متابعات.</p>') + '</div></div>';
        bd.querySelector(".modal").innerHTML = '<div class="modal-head"><h3>ملف جهة التعاقد</h3><button class="modal-close">×</button></div>' + html;
        bd.querySelector(".modal-close").onclick = function () { bd.remove(); };
        bd.querySelector("#ced-add").onclick = function () { var summary = bd.querySelector("#ced-note").value.trim(); if (!summary) return T.show("اكتب ملخص المتابعة", "error"); window.SSMPDDb.addContractActivity({ entity_id: entityId, contract_id: activeContract && activeContract.id, activity_type: bd.querySelector("#ced-type").value, summary: summary, next_follow_up_date: bd.querySelector("#ced-follow").value || null, created_by: me.id }).then(function () { reload(); load(container); }).catch(function (e) { T.show(e.message, "error"); }); };
        bd.querySelector("#ced-link").onclick = function () { if (!activeContract) return T.show("سجل عقدًا للجهة أولًا", "error"); openLinkPatient(activeContract, reload, container); };
        bd.querySelectorAll("[data-edit-contract]").forEach(function (b) { b.onclick = function () {
          var contract = d.contracts.find(function (c) { return c.id === b.getAttribute("data-edit-contract"); });
          if (contract) openEditContract(contract, function () { reload(); load(container); });
        }; });
        bd.querySelectorAll("[data-upload-contract]").forEach(function (b) { b.onclick = function () { openContractUpload(b.getAttribute("data-upload-contract"), reload); }; });
      }).catch(function (e) { bd.querySelector(".modal").innerHTML = '<div class="modal-head"><h3>خطأ</h3><button class="modal-close">×</button></div><p>' + esc(e.message) + '</p>'; bd.querySelector(".modal-close").onclick = function () { bd.remove(); }; });
    }
    reload();
  }

  function openEditContract(contract, done) {
    var options = Object.keys(STATUSES).map(function (key) {
      return '<option value="' + key + '"' + (key === contract.status ? ' selected' : '') + '>' + STATUSES[key] + '</option>';
    }).join("");
    var bd = modal("تعديل العقد", '<form id="cee-form" class="section" style="margin:0;">' +
      '<div class="field"><label for="cee-status">حالة التعاقد</label><select id="cee-status">' + options + '</select></div>' +
      input("cee-agreement", "تاريخ التعاقد", "date", contract.agreement_date) +
      input("cee-start", "تاريخ بداية التعاقد", "date", contract.start_date) +
      input("cee-end", "تاريخ انتهاء التعاقد", "date", contract.end_date) +
      input("cee-discount", "نسبة الخصم المتفق عليها %", "number", String(contract.discount_percent || 0)) +
      input("cee-cashback", "نسبة الكاش باك %", "number", String(contract.cashback_percent || 0)) +
      input("cee-recipient", "مستحق الكاش باك", "text", contract.cashback_recipient) +
      input("cee-transfer", "رقم كاش باك / وسيلة التحويل", "text", contract.cashback_transfer_method) +
      '<div class="field"><label for="cee-services">الخدمات المتفق عليها</label><textarea id="cee-services" rows="2">' + esc(contract.services) + '</textarea></div>' +
      '<div class="field"><label for="cee-notes">ملاحظات العقد</label><textarea id="cee-notes" rows="3">' + esc(contract.terms_notes) + '</textarea></div>' +
      input("cee-signer", "اسم الموقّع على العقد", "text", contract.signed_by_name) +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="submit" class="btn" id="cee-save">حفظ التعديلات</button><button type="button" class="btn ghost" id="cee-cancel">إلغاء</button></div></form>');
    bd.querySelectorAll(".field").forEach(function (field) {
      var control = field.querySelector("input");
      if (control) field.querySelector("label").htmlFor = control.id;
    });
    bd.querySelector("#cee-start").required = true;
    ["#cee-discount", "#cee-cashback"].forEach(function (id) {
      var control = bd.querySelector(id); control.min = "0"; control.max = "100"; control.step = "0.01";
    });
    bd.querySelector("#cee-cancel").onclick = function () { bd.remove(); };
    bd.querySelector("#cee-form").onsubmit = function (event) {
      event.preventDefault();
      var button = bd.querySelector("#cee-save");
      if (button.disabled) return;
      var value = function (id) { return bd.querySelector("#cee-" + id).value.trim(); };
      var start = value("start"), end = value("end");
      if (!start) return T.show("حدد تاريخ بداية التعاقد", "error");
      if (end && end < start) return T.show("تاريخ انتهاء التعاقد لازم يكون في نفس يوم البداية أو بعده", "error");
      var discount = Number(value("discount")), cashback = Number(value("cashback"));
      if (!isFinite(discount) || !isFinite(cashback) || discount < 0 || discount > 100 || cashback < 0 || cashback > 100) return T.show("نسبة الخصم والكاش باك لازم تكون بين 0 و100", "error");
      var patch = {
        status: value("status"), agreement_date: value("agreement") || null,
        start_date: start, end_date: end || null,
        discount_percent: discount, cashback_percent: cashback,
        cashback_recipient: value("recipient") || null, cashback_transfer_method: value("transfer") || null,
        services: value("services") || null, terms_notes: value("notes") || null, signed_by_name: value("signer") || null
      };
      button.disabled = true; button.textContent = "جارٍ الحفظ…";
      window.SSMPDDb.updateContractingEntityContract(contract.id, contract.entity_id, patch).then(function () {
        T.show("تم تعديل العقد"); bd.remove(); done();
      }).catch(function (e) {
        button.disabled = false; button.textContent = "حفظ التعديلات";
        T.show("تعذر حفظ التعديلات: " + e.message, "error");
      });
    };
    bd.querySelector("#cee-status").focus();
  }

  function openContractUpload(contractId, done) {
    var bd = modal("رفع العقد الموقع", '<p style="font-size:12px;color:var(--c-muted);">PDF أو Word أو صورة. سيُحفظ في Google Drive داخل ملف جهة التعاقد.</p><div class="field"><label>ملف العقد</label><input id="ceu-file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"></div><button class="btn block" id="ceu-save">رفع العقد</button>');
    bd.querySelector("#ceu-save").onclick = function () {
      var file = bd.querySelector("#ceu-file").files[0];
      if (!file) return T.show("اختر ملف العقد", "error");
      if (file.size > 15 * 1024 * 1024) return T.show("أقصى حجم للعقد 15 ميجابايت", "error");
      var fd = new FormData(); fd.append("contract_id", contractId); fd.append("file", file);
      var button = bd.querySelector("#ceu-save"); button.disabled = true; button.textContent = "جارٍ الرفع…";
      window.SSMPDDb.uploadContractingEntityContract(fd).then(function () { T.show("تم حفظ العقد على Google Drive"); bd.remove(); done(); }).catch(function (e) { button.disabled = false; button.textContent = "رفع العقد"; T.show("خطأ: " + e.message, "error"); });
    };
  }

  function openLinkPatient(contract, done, container) {
    var bd = modal("ربط مريض بعقد", '<p style="font-size:12px;color:var(--c-muted);">ابحث بالاسم أو رقم الهاتف أو كود المريض. الربط لا يعرض الملف الطبي هنا.</p><div class="field"><label>بحث</label><input id="cl-search" placeholder="اكتب 3 حروف على الأقل"></div><div id="cl-results"></div>');
    bd.querySelector("#cl-search").oninput = function () { var q = this.value.trim(); var box = bd.querySelector("#cl-results"); if (q.length < 3) { box.innerHTML = ""; return; } window.SSMPDDb.searchPatientsBasic(q).then(function (rows) { box.innerHTML = (rows || []).map(function (p) { return '<button class="btn ghost sm" style="margin:3px;" data-p="' + p.id + '">' + esc(p.full_name) + ' — ' + esc(p.patient_code || "") + '</button>'; }).join("") || '<p>لا توجد نتائج.</p>'; box.querySelectorAll("[data-p]").forEach(function (b) { b.onclick = function () { window.SSMPDDb.linkPatientToContract({ contract_id: contract.id, patient_id: b.getAttribute("data-p"), linked_from: today(), linked_by: me.id }).then(function () { T.show("تم ربط المريض بالعقد"); bd.remove(); done(); load(container); }).catch(function (e) { T.show(e.message.indexOf("current") !== -1 ? "المريض مرتبط حاليًا بعقد آخر" : e.message, "error"); }); }; }); }); };
  }

  window.SSMPDRenderContractingEntities = { render: render };
})();
