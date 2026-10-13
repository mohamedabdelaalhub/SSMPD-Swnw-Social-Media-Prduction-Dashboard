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
    sono_doctor: "طبيب سونو",
    contract_manager: "مسؤول التعاقدات",
    accountant: "محاسب",
    financial_manager: "مدير مالي"
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
    comments: ["page_manager", "approver", "general_manager", "super_admin"],
    clinic_info: ["page_manager", "customer_service", "general_manager", "super_admin"],
    performance: ["page_manager", "approver", "general_manager", "super_admin"],
    archive: ["page_manager", "designer", "approver", "general_manager", "super_admin"],
    leads: ["reception", "customer_service", "general_manager", "super_admin"],
    admin: ["super_admin"],
    metaads: ["page_manager", "approver", "general_manager", "super_admin"],
    mediabuyer: ["page_manager", "approver", "general_manager", "super_admin"],
    accounting: ["general_manager", "super_admin"],
    tasks: ["page_manager", "designer", "approver", "general_manager", "super_admin", "reception", "customer_service", "nursing", "sono_doctor", "contract_manager"],
    contracting_entities: ["contract_manager", "general_manager", "super_admin"],
    inventory: ["general_manager", "super_admin", "nursing", "reception", "sono_doctor"]
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

    isControlledFinance: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["accountant", "financial_manager"]) && !Roles.hasAnyRole(adminOrRole, ["super_admin", "general_manager"]);
    },
    canModuleAction: function (adminOrRole, module, action) {
      var admin = normalizeAdmin(adminOrRole);
      if (Roles.isControlledFinance(admin)) {
        if (module==="inventory") return action==="view"||action==="create"||action==="update";
        var rows=admin.module_permissions||[], row=rows.find(function(p){return p.module_key===module;});
        return !!row && row.can_view===true && (action==='view'||row['can_'+action]===true) && !(module==='tasks'&&action==='delete');
      }
      if(module==='accounting')return Roles.hasAnyRole(admin,["general_manager","super_admin"]);
      if(module==='inventory')return Roles.hasAnyRole(admin,["general_manager","super_admin"]) || (action==="view"||action==="create")&&Roles.hasAnyRole(admin,["nursing","reception","sono_doctor"]);
      if(module==='contracting_entities')return Roles.hasAnyRole(admin,action==='delete'?["general_manager","super_admin"]:["contract_manager","general_manager","super_admin"]);
      if(module==='tasks')return action!=='delete';
      return false;
    },

    // كل أسماء أدوار المستخدم مجمّعة لعرض بادچ الدور — "خدمة عملاء، استقبال" مثلاً
    labelAll: function (adminOrRole) {
      return Roles.rolesOf(adminOrRole).map(Roles.label).join("، ");
    },

    // بياخد صف admin كامل (مش بس الرول) عشان تاب "أرشيف المرضى" بيتفحص بصلاحية
    // has_archive_access المنفصلة عن الرول — لسه بيقبل الرول كـ string لوحده كمان
    canSeeTab: function (adminOrRole, tab) {
      var admin = normalizeAdmin(adminOrRole);
      if (Roles.isControlledFinance(admin) && ["accounting","contracting_entities","tasks","inventory"].includes(tab))return Roles.canModuleAction(admin,tab,'view');
      if (tab === "patients") {
        return !!admin.has_archive_access || !!admin.has_archive_view_only ||
          Roles.hasRole(admin, "super_admin") || Roles.hasRole(admin, "nursing");
      }
      var list = TAB_ACCESS[tab];
      return !!list && Roles.hasAnyRole(admin, list);
    },

    defaultTab: function (adminOrRole) {
      var admin = normalizeAdmin(adminOrRole);
      if (Roles.isControlledFinance(admin)) {
        var tabs=["accounting","contracting_entities","tasks","inventory"];
        var permitted=tabs.find(function(tab){return Roles.canSeeTab(admin,tab);});
        if(permitted)return permitted;
        var other=Object.keys(TAB_ACCESS).find(function(tab){return Roles.canSeeTab(admin,tab);});return other||null;
      }
      if (Roles.hasRole(admin, "contract_manager")) return "contracting_entities";
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

    canCreateAIDesign: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["page_manager", "designer", "approver", "general_manager", "super_admin"]);
    },

    canCreateContent: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["page_manager", "general_manager", "super_admin"]);
    },

    // اعتماد/رفض خطط ووكيل Media Buyer — مقصور على المدير العام/السوبر أدمن
    // بس (زي سياسة RLS "managers write media_buyer_plans/actions" بالظبط)
    canDeleteContractingEntity: function (adminOrRole) {
      return Roles.canModuleAction(adminOrRole,"contracting_entities","delete");
    },

    canApproveMediaBuyer: function (adminOrRole) {
      return Roles.hasAnyRole(adminOrRole, ["general_manager", "super_admin"]);
    }
  };

  window.SSMPDRoles = Roles;
})();


