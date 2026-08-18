/* SSMPD — الأدوار والصلاحيات */
(function () {
  "use strict";

  var ROLES = {
    page_manager: "مسؤول المحتوى",
    designer: "مصمم جرافيك",
    approver: "مسؤول اعتماد",
    general_manager: "مدير عام",
    super_admin: "سوبر أدمن",
    reception: "استقبال",
    customer_service: "خدمة عملاء",
    nursing: "تمريض"
  };

  // كل تاب: مين يشوفه — المدير العام يشوف كل حاجة زي السوبر أدمن ما عدا تاب المستخدمين
  // تاب "النشر" يشوفه الكل ما عدا المصمم (مش شغلته)
  // تاب "أرشيف المرضى" مش مبني على الرول — أي رول عنده admins.has_archive_access=true
  // (أو سوبر أدمن) بيشوفه، فمتحط لوش هنا وبيتفحص بشكل خاص في canSeeTab
  var TAB_ACCESS = {
    summary: ["page_manager", "designer", "approver", "general_manager", "super_admin"],
    production: ["page_manager", "general_manager", "super_admin"],
    review: ["approver", "general_manager", "super_admin"],
    design: ["designer", "general_manager", "super_admin"],
    publish: ["page_manager", "approver", "general_manager", "super_admin"],
    archive: ["page_manager", "designer", "approver", "general_manager", "super_admin"],
    leads: ["reception", "customer_service", "general_manager", "super_admin"],
    admin: ["super_admin"]
  };

  var Roles = {
    ALL: ROLES,

    label: function (role) {
      return ROLES[role] || role;
    },

    // بياخد صف admin كامل (مش بس الرول) عشان تاب "أرشيف المرضى" بيتفحص بصلاحية
    // has_archive_access المنفصلة عن الرول — لسه بيقبل الرول كـ string لوحده كمان
    // (توافق مع كود/اختبارات قديمة كانت بتنادي canSeeTab(role, tab))
    canSeeTab: function (adminOrRole, tab) {
      var admin = (typeof adminOrRole === "string") ? { role: adminOrRole } : (adminOrRole || {});
      if (tab === "patients") {
        return !!admin.has_archive_access || admin.role === "super_admin";
      }
      var list = TAB_ACCESS[tab];
      return !!list && list.indexOf(admin.role) !== -1;
    },

    defaultTab: function (role) {
      if (role === "reception" || role === "customer_service") return "leads";
      if (role === "nursing") return "patients";
      if (role === "approver") return "review";
      if (role === "designer") return "design";
      if (role === "page_manager") return "production";
      return "summary";
    },

    isSuperAdmin: function (role) {
      return role === "super_admin";
    },

    // المدير العام له كل صلاحيات المحتوى زي السوبر أدمن، بس من غير إدارة المستخدمين
    canApprove: function (role) {
      return role === "approver" || role === "general_manager" || role === "super_admin";
    },

    canDesign: function (role) {
      return role === "designer" || role === "general_manager" || role === "super_admin";
    },

    canCreateContent: function (role) {
      return role === "page_manager" || role === "general_manager" || role === "super_admin";
    }
  };

  window.SSMPDRoles = Roles;
})();
