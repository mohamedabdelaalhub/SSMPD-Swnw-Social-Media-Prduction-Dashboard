/* مستندات المريض من الاستقبال (owner 2026-11-17): while booking, or later from the timeline «⋯» menu when the patient arrives.
 * Several documents at once; each row = document type (dropdown) + file. Files go to the patient archive through the existing
 * patient-files-upload edge function (same permission: archive access), mapped to its categories with the type as the description,
 * so they appear in أرشيف المرضى under the right section and go through the usual review. */
(function (w, d) {
  "use strict";
  var TYPES = [
    ["national_id", "id_document", "صورة البطاقة أو تحقيق الشخصية أو شهادة الميلاد (أقل من 16 سنة)"],
    ["passport", "id_document", "صورة الباسبور (لو موجود)"],
    ["coverage_card", "insurance", "صورة كارنيه العلاج أو النقابة أو التأمين أو جهة التعاقد"],
    ["approval_letter", "insurance", "صورة الموافقة أو خطاب التحمل"],
    ["child_birth_cert", "id_document", "صورة شهادة ميلاد الطفل (أقل من 16 سنة) للموافقات"]
  ];
  var MAX = 15 * 1024 * 1024;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function row() {
    return '<div class="rxd-row" data-rxd-row><select data-rxd-type aria-label="نوع المستند"><option value="">اختار نوع المستند</option>' +
      TYPES.map(function (t) { return '<option value="' + t[0] + '">' + esc(t[2]) + '</option>'; }).join("") +
      '</select>' + (w.SSMPDUploadBox ? w.SSMPDUploadBox.html({ attr: 'data-rxd-file aria-label="الملف"', accept: "image/*,application/pdf", kind: "document", compact: true, take: "📷 صوّر المستند", pick: "🖼 اختار ملف", wrap: 'data-ub-max="15728640"' }) : '<input type="file" data-rxd-file accept="image/*,application/pdf" aria-label="الملف">') + '<button type="button" class="btn ghost sm" data-rxd-remove aria-label="شيل المستند ده">×</button></div>';
  }
  // No name attributes: the booking form's FormData never picks these up.
  function markup(open) {
    return '<details data-wide class="rx-advanced rxd"' + (open ? " open" : "") + '><summary>مستندات المريض (اختياري) — بطاقة، كارنيه، موافقة…</summary><div class="rxd-body" data-rxd>' +
      '<div data-rxd-rows>' + row() + '</div><button type="button" class="btn sm" data-rxd-add>+ مستند تاني</button>' +
      '<p class="rxd-note">المستندات بتترفع على ملف المريض في أرشيف المرضى بعد الحفظ، وبتتراجع من المسؤول زي أي مستند.</p><p class="rxd-status" data-rxd-status role="status"></p></div></details>';
  }
  function wire(scope) {
    var box = scope.querySelector("[data-rxd]"); if (!box || box.dataset.wired) return; box.dataset.wired = "1";
    /* upload-box.js (owner 2026-11-28): the photo is named مستند_<file no>_<document type>_<dd-mm>_<HH-MM> — the type follows the picker */
    box.addEventListener("change", function (e) { var sel = e.target.closest && e.target.closest("[data-rxd-type]"); if (!sel) return; var ub = sel.closest("[data-rxd-row]").querySelector("[data-ub]"), ty = TYPES.filter(function (x) { return x[0] === sel.value; })[0];
      if (ub) ub.setAttribute("data-ub-label", ty ? ty[2].split(/ أو |\(/)[0].replace(/^صورة /, "").trim() : ""); });
    box.addEventListener("click", function (e) {
      if (e.target.closest("[data-rxd-add]")) { e.preventDefault(); box.querySelector("[data-rxd-rows]").insertAdjacentHTML("beforeend", row()); return; }
      var rm = e.target.closest("[data-rxd-remove]");
      if (rm) { e.preventDefault(); var rows = box.querySelectorAll("[data-rxd-row]"); if (rows.length > 1) rm.closest("[data-rxd-row]").remove(); else { var r = rows[0]; r.querySelector("[data-rxd-type]").value = ""; var fi = r.querySelector("[data-rxd-file]"); fi.value = ""; if (fi.closest("[data-ub]")) fi.dispatchEvent(new Event("change")); } }
    });
  }
  // Rows with a file. Throws a clear message when a file has no type, or is too big.
  function picked(scope) {
    var out = [];
    (scope ? scope.querySelectorAll("[data-rxd-row]") : []).forEach(function (r) {
      var f = r.querySelector("[data-rxd-file]").files[0], t = r.querySelector("[data-rxd-type]").value;
      if (!f) return;
      if (!t) throw new Error("اختار نوع المستند للملف: " + f.name);
      if (f.size > MAX) throw new Error("الملف " + f.name + " أكبر من 15 ميجا");
      var ty = TYPES.filter(function (x) { return x[0] === t; })[0];
      out.push({ file: f, category: ty[1], label: ty[2] });
    });
    return out;
  }
  function upload(archivePatientId, items, status) {
    var db = w.SSMPDDb; if (!items.length) return Promise.resolve(0);
    if (!archivePatientId) return Promise.reject(new Error("ملف المريض مش مربوط بأرشيف المرضى، فالمستندات ماترفعتش"));
    if (!db || !db.uploadPatientFile) return Promise.reject(new Error("رفع المستندات مش متاح"));
    var done = 0;
    return items.reduce(function (p, it) {
      return p.then(function () {
        if (status) status.textContent = "بيرفع " + (done + 1) + " من " + items.length + "…";
        var fd = new FormData(); fd.append("patient_id", archivePatientId); fd.append("category", it.category); fd.append("other_description", it.label); fd.append("file", it.file);
        return db.uploadPatientFile(fd).then(function () { done++; });
      });
    }, Promise.resolve()).then(function () { if (status) status.textContent = "اترفع " + done + " مستند"; return done; });
  }
  function toast(m, k) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(m, k || "success"); }
  // Modal from the timeline menu (after booking / on arrival).
  function openModal(archivePatientId, patientName, modal) {
    if (!archivePatientId) { toast("ملف المريض ده مش مربوط بأرشيف المرضى", "error"); return; }
    var root = modal("مستندات المريض — " + (patientName || ""), markup(true).replace("<details", "<div").replace("</details>", "</div>").replace(/<summary>.*?<\/summary>/, ""), function () {
      var items = picked(root); if (!items.length) throw new Error("اختار ملف واحد على الأقل");
      return upload(archivePatientId, items, root.querySelector("[data-rxd-status]")).then(function (n) { toast("اترفع " + n + " مستند على ملف المريض"); return n; });
    });
    if (root) wire(root);
    return root;
  }
  w.SSMPDReceptionDocs = { TYPES: TYPES, markup: markup, wire: wire, picked: picked, upload: upload, openModal: openModal };
})(window, document);
