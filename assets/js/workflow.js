/* SSMPD — تعريف مراحل سير العمل (مصدر واحد للحقيقة) */
(function () {
  "use strict";

  // ٨ مراحل Kanban بالترتيب — لا تُغيَّر المفاتيح (stage) لأنها مخزّنة في القاعدة
  var STAGES = [
    { key: "idea_selection",   label: "اختيار الفكرة" },
    { key: "initial_approval", label: "اعتماد أولي" },
    { key: "in_design",        label: "قيد التصميم" },
    { key: "final_approval",   label: "في الاعتماد النهائي" },
    { key: "needs_revision",   label: "مطلوب تعديل" },
    { key: "ready_to_publish", label: "جاهز للنشر" },
    { key: "scheduled",        label: "مجدولة للنشر" },
    { key: "published",        label: "تم النشر" }
  ];

  // حالة عرض المصمم (أيقونة) — مشتقة من stage + design_received_at + assigned_designer
  var DESIGN_STATUS = {
    pending:   { label: "في انتظار الاستلام",   pillClass: "draft" },
    received:  { label: "تم الاستلام",        pillClass: "received" },
    approval:  { label: "في الاعتماد",         pillClass: "approval" },
    revision:  { label: "مطلوب التعديل",       pillClass: "revision" },
    approved:  { label: "تم الاعتماد للنشر",    pillClass: "approved" }
  };

  // تمييز المحتوى بين الصفحتين — يحدده منشئ المحتوى، ويظهر لكل الأدوار في كل المراحل
  var BRANDS = {
    sono:    { label: "سونو" },
    dr_dina: { label: "د.دينا" }
  };

  // منصة النشر — تُختار عند النشر (زي ما يُختار البراند تاني في نفس اللحظة)
  var PLATFORMS = {
    facebook:  { label: "فيسبوك" },
    instagram: { label: "انستجرام" },
    tiktok:    { label: "تيكتوك" },
    youtube:   { label: "قناة يوتيوب" },
    website:   { label: "الموقع الإلكتروني" }
  };

  function stageLabel(key) {
    var s = STAGES.filter(function (x) { return x.key === key; })[0];
    return s ? s.label : key;
  }

  function stageIndex(key) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return i;
    return -1;
  }

  // يحدد حالة الأيقونة في شاشة المصمم بناءً على stage + هل المصمم دوس "استلام" ولا لسه
  function designStatusFor(item) {
    switch (item.stage) {
      case "in_design": return item.design_received_at ? "received" : "pending";
      case "final_approval": return "approval";
      case "needs_revision": return "revision";
      case "ready_to_publish":
      case "published": return "approved";
      default: return "pending";
    }
  }

  // بادچ صغير يظهر جنب العنوان في كل الشاشات — فاضي لو المادة لسه بلا براند محدد
  function brandBadgeHtml(brand) {
    if (!brand || !BRANDS[brand]) return "";
    return '<span class="brand-badge ' + brand + '">' + BRANDS[brand].label + "</span>";
  }

  // دروب داون اختيار البراند — بيُستخدم عند إنشاء المحتوى وعند إعادة الاختيار وقت النشر
  function brandSelectHtml(id, selected) {
    var opts = Object.keys(BRANDS).map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? " selected" : "") + '>' + BRANDS[k].label + "</option>";
    }).join("");
    return '<select id="' + id + '"><option value="">— اختر —</option>' + opts + "</select>";
  }

  // دروب داون اختيار منصة النشر
  function platformSelectHtml(id, selected) {
    var opts = Object.keys(PLATFORMS).map(function (k) {
      return '<option value="' + k + '"' + (selected === k ? " selected" : "") + '>' + PLATFORMS[k].label + "</option>";
    }).join("");
    return '<select id="' + id + '"><option value="">— اختر —</option>' + opts + "</select>";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // مين يقدر يعدّل المادة: السوبر أدمن والمدير العام دايماً، أو منشئ المادة نفسه
  function canEditItem(me, item) {
    if (!me || !item) return false;
    if (me.role === "super_admin" || me.role === "general_manager") return true;
    return item.created_by === me.id;
  }

  // الحذف مقصور على السوبر أدمن والمدير العام (زي ما هو محدد في صلاحيات القاعدة RLS)
  function canDeleteItem(me) {
    return !!(me && (me.role === "super_admin" || me.role === "general_manager"));
  }

  // زراير تعديل/حذف — بتظهر حسب صلاحية الشخص الحالي، تُستخدم في كل شاشات عرض المادة
  function itemActionsHtml(item, me) {
    var html = "";
    if (canEditItem(me, item)) html += '<button class="btn ghost sm" data-edit-item="' + item.id + '">تعديل</button> ';
    if (canDeleteItem(me)) html += '<button class="btn danger sm" data-delete-item="' + item.id + '">حذف</button>';
    return html;
  }

  // مودال تعديل عنوان/نص/صفحة المادة — بيتفتح فوق أي مودال تاني مفتوح
  function openEditContentModal(item, onSaved) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = '<div class="modal"><div class="modal-head"><h3>تعديل المادة</h3>' +
      '<button class="modal-close">×</button></div>' +
      '<div class="field"><label>العنوان</label><input id="ed-title" value="' + escapeAttr(item.title) + '"></div>' +
      '<div class="field"><label>المادة دي لصفحة</label>' + brandSelectHtml("ed-brand", item.brand || "") + '</div>' +
      '<div class="field"><label>نص المحتوى</label><textarea id="ed-body">' + escapeHtml(item.body || "") + '</textarea></div>' +
      '<div style="text-align:left;margin-top:10px;"><button class="btn" id="ed-save">حفظ التعديلات</button></div></div>';
    document.body.appendChild(backdrop);
    backdrop.querySelector(".modal-close").onclick = function () { backdrop.remove(); };
    backdrop.onclick = function (e) { if (e.target === backdrop) backdrop.remove(); };

    document.getElementById("ed-save").onclick = function () {
      var title = document.getElementById("ed-title").value.trim();
      var body = document.getElementById("ed-body").value.trim();
      var brand = document.getElementById("ed-brand").value;
      if (!title) { alert("اكتب عنوان"); return; }
      if (!brand) { alert("اختر المادة دي لصفحة سونو ولا د.دينا"); return; }
      window.SSMPDDb.updateContentItem(item.id, { title: title, body: body, brand: brand })
        .then(function (updated) {
          backdrop.remove();
          if (onSaved) onSaved(updated);
        }).catch(function (e) { alert("خطأ: " + e.message); });
    };
  }

  // حذف نهائي بعد تأكيد — الإجراء ده لا يمكن التراجع عنه
  function deleteContentItemWithConfirm(item, onDeleted) {
    if (!confirm('متأكد إنك عايز تحذف "' + item.title + '"؟ الإجراء ده نهائي ومش هيترجع.')) return;
    window.SSMPDDb.deleteContentItem(item.id).then(function () {
      if (onDeleted) onDeleted();
    }).catch(function (e) { alert("خطأ: " + e.message); });
  }

  // ربط زراير تعديل/حذف داخل أي مودال — استدعيها بعد إضافة المودال للصفحة
  function wireItemActions(backdrop, item, onChanged) {
    var editBtn = backdrop.querySelector("[data-edit-item]");
    if (editBtn) editBtn.onclick = function () {
      openEditContentModal(item, function (updated) {
        backdrop.remove();
        if (onChanged) onChanged(updated);
      });
    };
    var delBtn = backdrop.querySelector("[data-delete-item]");
    if (delBtn) delBtn.onclick = function () {
      deleteContentItemWithConfirm(item, function () {
        backdrop.remove();
        if (onChanged) onChanged(null);
      });
    };
  }

  window.SSMPDWorkflow = {
    STAGES: STAGES,
    DESIGN_STATUS: DESIGN_STATUS,
    BRANDS: BRANDS,
    PLATFORMS: PLATFORMS,
    stageLabel: stageLabel,
    stageIndex: stageIndex,
    designStatusFor: designStatusFor,
    brandBadgeHtml: brandBadgeHtml,
    brandSelectHtml: brandSelectHtml,
    platformSelectHtml: platformSelectHtml,
    canEditItem: canEditItem,
    canDeleteItem: canDeleteItem,
    itemActionsHtml: itemActionsHtml,
    openEditContentModal: openEditContentModal,
    deleteContentItemWithConfirm: deleteContentItemWithConfirm,
    wireItemActions: wireItemActions
  };
})();
