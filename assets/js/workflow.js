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

  // حالة عرض المصمم (أيقونة) — مشتقة من stage + assigned_designer
  var DESIGN_STATUS = {
    received:  { label: "تم الاستلام",        pillClass: "received" },
    approval:  { label: "في الاعتماد",         pillClass: "approval" },
    revision:  { label: "مطلوب التعديل",       pillClass: "revision" },
    approved:  { label: "تم الاعتماد للنشر",    pillClass: "approved" }
  };

  function stageLabel(key) {
    var s = STAGES.filter(function (x) { return x.key === key; })[0];
    return s ? s.label : key;
  }

  function stageIndex(key) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return i;
    return -1;
  }

  // يحدد حالة الأيقونة في شاشة المصمم بناءً على stage الحالية
  function designStatusFor(item) {
    switch (item.stage) {
      case "in_design": return "received";
      case "final_approval": return "approval";
      case "needs_revision": return "revision";
      case "ready_to_publish":
      case "published": return "approved";
      default: return "received";
    }
  }

  window.SSMPDWorkflow = {
    STAGES: STAGES,
    DESIGN_STATUS: DESIGN_STATUS,
    stageLabel: stageLabel,
    stageIndex: stageIndex,
    designStatusFor: designStatusFor
  };
})();
