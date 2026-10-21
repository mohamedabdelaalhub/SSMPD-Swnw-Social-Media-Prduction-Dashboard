/* SSMPD — تعديل البيانات الأساسية لليد من مودال إدارة الليدز. */
(function () {
  "use strict";

  var SOURCE_LABELS = { whatsapp: "واتساب", messenger: "ماسنجر", phone: "تليفون", clinic: "عيادة", doctor_referral: "تحويل من طبيب العيادة" };
  var SERVICE_LABELS = {
    checkup: "كشف", consultation: "استشارة", radiology: "أشعة", lab: "تحاليل", nursing: "تمريض",
    physiotherapy: "علاج طبيعي", treatment: "علاج", dental: "أسنان", speech_therapy: "تخاطب",
    psychiatry: "نفسية", cosmetic_laser: "ليزر تجميل", emergency: "طوارئ", other: "أخرى"
  };
  var ACQUISITION_LABELS = { organic: "حالة المركز", ad: "إعلان" };
  var activeLeadId = null;
  var lastRenderContainer = null;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function optionList(labels, selected, includeBlank) {
    var html = includeBlank ? '<option value="">— بدون —</option>' : "";
    Object.keys(labels).forEach(function (key) {
      html += '<option value="' + key + '"' + (key === selected ? " selected" : "") + '>' + labels[key] + '</option>';
    });
    return html;
  }

  function currentApi() {
    return window.SSMPDRenderLeads || null;
  }

  function patchApi() {
    var api = currentApi();
    if (!api || api.__leadEditPatched) return;
    api.__leadEditPatched = true;

    var originalRender = api.render;
    if (typeof originalRender === "function") {
      api.render = function (container) {
        lastRenderContainer = container || lastRenderContainer;
        return originalRender.apply(this, arguments);
      };
    }

    var originalOpen = api.openLeadById;
    if (typeof originalOpen === "function") {
      api.openLeadById = function (leadId) {
        activeLeadId = leadId ? String(leadId) : null;
        return originalOpen.apply(this, arguments);
      };
    }
  }

  function parseInvokeError(error) {
    if (!error) return Promise.resolve("تعذر حفظ بيانات الليد");
    var fallback = error.message || "تعذر حفظ بيانات الليد";
    try {
      var ctx = error.context;
      if (ctx && typeof ctx.clone === "function") {
        return ctx.clone().json().then(function (body) { return (body && (body.error || body.message)) || fallback; }).catch(function () { return fallback; });
      }
    } catch (e) {}
    return Promise.resolve(fallback);
  }

  function updateLead(payload) {
    var client = window.SSMPDDb && window.SSMPDDb.client;
    if (!client || !client.functions || typeof client.functions.invoke !== "function") {
      return Promise.reject(new Error("اتصال قاعدة البيانات غير متاح"));
    }
    return client.functions.invoke("leads-update-details", { body: payload }).then(function (res) {
      if (res.error) return parseInvokeError(res.error).then(function (message) { throw new Error(message); });
      if (res.data && res.data.error) throw new Error(res.data.error);
      return res.data || {};
    });
  }

  function fetchLead(leadId) {
    var client = window.SSMPDDb && window.SSMPDDb.client;
    if (!client) return Promise.reject(new Error("اتصال قاعدة البيانات غير متاح"));
    return client.from("leads").select("*").eq("id", leadId).single().then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function reopenLead(leadId, backdrop) {
    if (backdrop && backdrop.parentNode) backdrop.remove();
    var api = currentApi();
    if (lastRenderContainer && api && typeof api.render === "function") {
      try { api.render(lastRenderContainer); } catch (e) {}
    }
    if (api && typeof api.openLeadById === "function") {
      setTimeout(function () { api.openLeadById(leadId); }, 80);
    }
  }

  function renderEditor(modal, leadId, lead) {
    var old = modal.querySelector("#lm-edit-panel");
    if (old) old.remove();

    var panel = document.createElement("div");
    panel.id = "lm-edit-panel";
    panel.className = "field";
    panel.style.cssText = "border:1px solid var(--c-border);border-radius:12px;padding:12px;margin:0 0 14px;background:var(--c-surface,#fff);";
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:10px;">تعديل بيانات الليد</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">' +
        '<label>اسم العميل<input id="lm-edit-name" value="' + esc(lead.customer_name) + '"></label>' +
        '<label>رقم الهاتف<input id="lm-edit-phone" value="' + esc(lead.phone_raw || lead.phone_normalized || "") + '"></label>' +
        '<label>المصدر<select id="lm-edit-source">' + optionList(SOURCE_LABELS, lead.source, false) + '</select></label>' +
        '<label>الخدمة المهتم بها<select id="lm-edit-service">' + optionList(SERVICE_LABELS, lead.interested_service || "", true) + '</select></label>' +
        '<label>مصدر الاهتمام<select id="lm-edit-acquisition">' + optionList(ACQUISITION_LABELS, lead.acquisition_type || "", true) + '</select></label>' +
        '<label>القسم المطلوب<input id="lm-edit-department" value="' + esc(lead.requested_department || "") + '"></label>' +
      '</div>' +
      '<label style="display:block;margin-top:10px;">نص الرسالة / الملاحظات<textarea id="lm-edit-message" rows="3">' + esc(lead.message_text || "") + '</textarea></label>' +
      '<div id="lm-edit-error" class="err-msg" style="display:none;margin-top:8px;"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">' +
        '<button class="btn ghost sm" type="button" id="lm-edit-cancel">إلغاء</button>' +
        '<button class="btn sm" type="button" id="lm-edit-save">حفظ التعديلات</button>' +
      '</div>';

    var statusBlock = modal.querySelector("#lm-status") && modal.querySelector("#lm-status").closest(".field");
    if (statusBlock) modal.insertBefore(panel, statusBlock);
    else modal.appendChild(panel);

    panel.querySelector("#lm-edit-cancel").onclick = function () { panel.remove(); };
    panel.querySelector("#lm-edit-save").onclick = function () {
      var save = panel.querySelector("#lm-edit-save");
      var err = panel.querySelector("#lm-edit-error");
      var name = panel.querySelector("#lm-edit-name").value.trim();
      var phone = panel.querySelector("#lm-edit-phone").value.trim();
      if (!name || !phone) {
        err.textContent = !name ? "اسم العميل مطلوب" : "رقم الهاتف مطلوب";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      save.disabled = true;
      save.textContent = "بيحفظ…";
      updateLead({
        lead_id: leadId,
        customer_name: name,
        phone: phone,
        source: panel.querySelector("#lm-edit-source").value,
        interested_service: panel.querySelector("#lm-edit-service").value || null,
        acquisition_type: panel.querySelector("#lm-edit-acquisition").value || null,
        requested_department: panel.querySelector("#lm-edit-department").value.trim() || null,
        message_text: panel.querySelector("#lm-edit-message").value.trim() || null
      }).then(function () {
        if (window.SSMPDToast) window.SSMPDToast.show("اتحفظت تعديلات بيانات الليد");
        reopenLead(leadId, modal.closest(".modal-backdrop"));
      }).catch(function (e) {
        err.textContent = "خطأ: " + e.message;
        err.style.display = "block";
        save.disabled = false;
        save.textContent = "حفظ التعديلات";
      });
    };
  }

  function enhanceModal(modal) {
    if (!modal || modal.dataset.leadEditReady === "1" || !modal.querySelector("#lm-save-status")) return;
    if (!activeLeadId) return;
    modal.dataset.leadEditReady = "1";
    modal.dataset.leadId = activeLeadId;

    var head = modal.querySelector(".modal-head");
    if (!head) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost sm";
    btn.id = "lm-edit-details";
    btn.style.marginInlineEnd = "8px";
    btn.textContent = "تعديل البيانات";
    var close = head.querySelector(".modal-close");
    if (close) head.insertBefore(btn, close);
    else head.appendChild(btn);

    btn.onclick = function () {
      var existing = modal.querySelector("#lm-edit-panel");
      if (existing) { existing.remove(); return; }
      btn.disabled = true;
      var leadId = modal.dataset.leadId;
      fetchLead(leadId).then(function (lead) {
        renderEditor(modal, leadId, lead);
      }).catch(function (e) {
        if (window.SSMPDToast) window.SSMPDToast.show("خطأ: " + e.message, "error");
      }).finally(function () { btn.disabled = false; });
    };
  }

  function scan(root) {
    patchApi();
    if (!root) return;
    if (root.matches && root.matches(".modal") && root.querySelector("#lm-save-status")) enhanceModal(root);
    if (root.querySelectorAll) root.querySelectorAll(".modal").forEach(enhanceModal);
  }

  document.addEventListener("click", function (e) {
    var target = e.target && e.target.closest ? e.target.closest("#ld-sub-view [data-open]") : null;
    if (target) activeLeadId = target.getAttribute("data-open") || activeLeadId;
  }, true);

  patchApi();
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(function (rows) {
      rows.forEach(function (row) {
        Array.from(row.addedNodes || []).forEach(function (node) { if (node.nodeType === 1) scan(node); });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(document); });
  else scan(document);

  window.SSMPDLeadDetailsEdit = { enhanceModal: enhanceModal, updateLead: updateLead };
})();
