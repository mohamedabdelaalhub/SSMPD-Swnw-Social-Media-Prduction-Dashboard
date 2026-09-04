/* SSMPD — الأدوار والصلاحيات (بتدعم أكتر من رول لنفس المستخدم — admin.roles) */
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
    nursing: "تمريض",
    sono_doctor: "طبيب سونو"
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
    admin: ["super_admin"],
    metaads: ["page_manager", "approver", "general_manager", "super_admin"]
  };

  // بياخد صف admin كامل أو رول كـ string لوحده (توافق مع كود/اختبارات قديمة)
  function normalizeAdmin(adminOrRole) {
    return (typeof adminOrRole === "string") ? { role: adminOrRole } : (adminOrRole || {});
  }

  var Roles = {
    ALL: ROLES,

    label: function (role) {
      return ROLES[role] || role;
    },

    // كل أدوار المستخدم الفعلية (الأساسي + الإضافية) — بتدعم admin.roles (مصفوفة،
    // من auth.js بعد الدخول) ولو مش موجودة بترجع [admin.role] بس (توافق قديم)
    rolesOf: function (adminOrRole) {
      var admin = normalizeAdmin(adminOrRole);
      if (Array.isArray(admin.roles) && admin.roles.length) return admin.roles;
      return admin.role ? [admin.role] : [];
    },

    hasRole: function (adminOrRole, role) {
      return Roles.rolesOf(adminOrRole).indexOf(role) !== -1;
    },

    hasAnyRole: function (adminOrRole, rolesList) {
      var mine = Roles.rolesOf(adminOrRole);
      return rolesList.some(function (r) { return mine.indexOf(r) !== -1; });
    },

    // كل أسماء أدوار المستخدم مجمّعة لعرض بادچ الدور — "خدمة عملاء، استقبال" مثلاً
    labelAll: function (adminOrRole) {
      return Roles.rolesOf(adminOrRole).map(Roles.label).join("، ");
    },

    // بياخد صف admin كامل (مش بس الرول) عشان تاب "أرشيف المرضى" بيتفحص بصلاحية
    // has_archive_access المنفصلة عن الرول — لسه بيقبل الرول كـ string لوحده كمان
    canSeeTab: function (adminOrRole, tab) {
      var admin = normalizeAdmin(adminOrRole);
      if (tab === "patients") {
        return !!admin.has_archive_access || !!admin.has_archive_view_only ||
          Roles.hasRole(admin, "super_admin") || Roles.hasRole(admin, "nursing");
      }
      var list = TAB_ACCESS[tab];
      return !!list && Roles.hasAnyRole(admin, list);
    },

    defaultTab: function (adminOrRole) {
      var admin = normalizeAdmin(adminOrRole);
      if (Roles.hasRole(admin, "reception") || Roles.hasRole(admin, "customer_service")) return "leads";
      if (Roles.hasRole(admin, "nursing")) return "patients";
      if (Roles.hasRole(admin, "sono_doctor")) return "patients";
      if (Roles.hasRole(admin, "approver")) return "review";
      if (Roles.hasRole(admin, "designer")) return "design";
      if (Roles.hasRole(admin, "page_manager")) return "production";
      return "summary";
    },

    isSuperAdmin: function (adminOrRole) {
      return Roles.hasRole(adminOrRole, "super_admin");
    },

    // المدير العام له كل صلاحيات المحتوى زي السوبر أدمن، بس من غير إدارة المستخدمين
    canApprove: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["approver", "general_manager", "super_admin"]);
    },

    canDesign: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["designer", "general_manager", "super_admin"]);
    },

    canCreateContent: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["page_manager", "general_manager", "super_admin"]);
    }
  };

  window.SSMPDRoles = Roles;
})();
