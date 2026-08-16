/* SSMPD — تعريف مراحل سير العمل (مصدر واحد للحقيقة) */
(function () {
  "use strict";

  // ٧ مراحل Kanban بالترتيب — لا تُغيَّر المفاتيح (stage) لأنها مخزّنة في القاعدة
  var STAGES = [
    { key: "idea_selection",   label: "اختيار الفكرة" },
    { key: "initial_approval", label: "اعتماد أولي" },
    { key: "in_design",        label: "قيد التصميم" },
    { key: "final_approval",   label: "في الاعتماد النهائي" },
    { key: "needs_revision",   label: "مطلوب تعديل" },
    { key: "ready_to_publish", label: "جاهز للنشر" },
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
    platformSelectHtml: platformSelectHtml
  };
})();
