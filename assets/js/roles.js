/* SSMPD — الأدوار والصلاحيات */
(function () {
  "use strict";

  var ROLES = {
    page_manager: "موظف صفحات",
    designer: "مصمم",
    approver: "مسؤول اعتماد",
    super_admin: "سوبر أدمن"
  };

  // كل تاب: مين يشوفه
  var TAB_ACCESS = {
    summary: ["page_manager", "designer", "approver", "super_admin"],
    production: ["page_manager", "super_admin"],
    review: ["approver", "super_admin"],
    design: ["designer", "super_admin"],
    archive: ["page_manager", "designer", "approver", "super_admin"],
    admin: ["super_admin"]
  };

  var Roles = {
    ALL: ROLES,

    label: function (role) {
      return ROLES[role] || role;
    },

    canSeeTab: function (role, tab) {
      var list = TAB_ACCESS[tab];
      return !!list && list.indexOf(role) !== -1;
    },

    defaultTab: function (role) {
      if (role === "approver") return "review";
      if (role === "designer") return "design";
      if (role === "page_manager") return "production";
      return "summary";
    },

    isSuperAdmin: function (role) {
      return role === "super_admin";
    },

    canApprove: function (role) {
      return role === "approver" || role === "super_admin";
    },

    canDesign: function (role) {
      return role === "designer" || role === "super_admin";
    },

    canCreateContent: function (role) {
      return role === "page_manager" || role === "super_admin";
    }
  };

  window.SSMPDRoles = Roles;
})();
