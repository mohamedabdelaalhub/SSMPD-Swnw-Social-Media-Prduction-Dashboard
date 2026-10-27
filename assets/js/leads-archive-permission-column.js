/* SWNW — real per-user Leads Archive permission: admin grant + native leads access */
(function () {
  "use strict";
  if (window.__SWNWLeadsArchiveGrantRuntimeV3) return;
  window.__SWNWLeadsArchiveGrantRuntimeV3 = true;

  function current() { return window.SSMPDAuth && window.SSMPDAuth.currentAdmin; }
  function rolesOf(a) {
    if (!a) return [];
    if (Array.isArray(a.roles) && a.roles.length) return a.roles.slice();
    return [a.role].concat(a.extra_roles || []).filter(Boolean);
  }
  function hasRole(a, role) { return rolesOf(a).indexOf(role) !== -1; }
  function isManager(a) { return hasRole(a, "super_admin") || hasRole(a, "general_manager"); }
  function isReception(a) { return hasRole(a, "reception"); }
  function isCS(a) { return hasRole(a, "customer_service"); }
  function hasGrant(a) { return !!(a && a.active !== false && a.has_leads_archive_access === true); }

  function toast(msg, type) {
    if (window.SSMPDToast && typeof window.SSMPDToast.show === "function") window.SSMPDToast.show(msg, type || "info");
  }

  // 1) Make the main Leads module visible when the dedicated archive permission is granted.
  function patchRoles() {
    var R = window.SSMPDRoles;
    if (!R || typeof R.canSeeTab !== "function") return false;
    if (R.canSeeTab.__leadsArchiveGrantWrapped) return true;
    var original = R.canSeeTab;
    var wrapped = function (adminOrRole, tab) {
      if (tab === "leads" && typeof adminOrRole === "object" && hasGrant(adminOrRole)) return true;
      return original.call(R, adminOrRole, tab);
    };
    wrapped.__leadsArchiveGrantWrapped = true;
    R.canSeeTab = wrapped;
    return true;
  }

  // 2) Add the permission checkbox BEFORE Admin Workspace converts the table to mobile cards.
  function injectPermission(container, admins) {
    if (!container || !window.SSMPDDb) return;
    var table = container.querySelector("#admin-users table.simple");
    if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
    if (table.dataset.leadsArchivePermissionNative === "1") return;

    var headerRow = table.tHead.rows[0];
    var deleteHeader = Array.prototype.slice.call(headerRow.cells).find(function (cell) {
      return /حذف الليدز/.test(cell.textContent || "");
    });
    if (!deleteHeader) return;

    if (!Array.prototype.slice.call(headerRow.cells).some(function (cell) { return /أرشيف الليدز/.test(cell.textContent || ""); })) {
      var th = document.createElement("th");
      th.textContent = "أرشيف الليدز";
      headerRow.insertBefore(th, deleteHeader);
    }

    var byId = Object.create(null);
    (admins || []).forEach(function (a) { byId[a.id] = a; });

    Array.prototype.slice.call(table.tBodies[0].rows).forEach(function (tr) {
      if (tr.querySelector("[data-leads-archive-access]")) return;
      var anchor = tr.querySelector("[data-delete-leads]");
      if (!anchor) return;
      var id = anchor.getAttribute("data-delete-leads");
      var a = byId[id];
      if (!a) return;

      var inherited = isManager(a);
      var td = document.createElement("td");
      td.style.textAlign = "center";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.leadsArchiveAccess = id;
      cb.checked = inherited || a.has_leads_archive_access === true;
      cb.disabled = inherited;
      cb.title = inherited ? "متاحة تلقائيًا من دور المدير" : "السماح بالعمل على أرشيف الليدز";
      td.appendChild(cb);
      var target = anchor.closest("td");
      if (!target || !target.parentNode) return;
      target.parentNode.insertBefore(td, target);

      if (!inherited) cb.addEventListener("change", function () {
        var wanted = cb.checked;
        cb.disabled = true;
        window.SSMPDDb.updateAdmin(id, { has_leads_archive_access: wanted }).then(function () {
          a.has_leads_archive_access = wanted;
          cb.disabled = false;
          toast(wanted ? "تم منح صلاحية أرشيف الليدز" : "تم إلغاء صلاحية أرشيف الليدز");
        }).catch(function (e) {
          cb.checked = !wanted;
          cb.disabled = false;
          toast("تعذر حفظ صلاحية أرشيف الليدز: " + ((e && e.message) || "خطأ"), "error");
        });
      });
    });
    table.dataset.leadsArchivePermissionNative = "1";
  }

  function patchAdminWorkspace() {
    var W = window.SSMPDAdminWorkspace;
    if (!W || typeof W.mount !== "function") return false;
    if (W.mount.__leadsArchiveGrantWrapped) return true;
    var original = W.mount;
    var wrapped = function (container, admins) {
      injectPermission(container, admins || []);
      return original.call(W, container, admins);
    };
    wrapped.__leadsArchiveGrantWrapped = true;
    W.mount = wrapped;
    return true;
  }

  // 3) Reuse the EXISTING Leads Archive inside render-leads. No duplicate archive screen.
  function withTemporaryManager(a, fn) {
    var hadRoles = Array.isArray(a.roles);
    var previous = hadRoles ? a.roles.slice() : null;
    var temp = rolesOf(a);
    if (temp.indexOf("general_manager") === -1) temp.push("general_manager");
    a.roles = temp;
    try { return fn(); }
    finally {
      if (hadRoles) a.roles = previous;
      else delete a.roles;
    }
  }

  function allowedKeys(a) {
    var keys = Object.create(null);
    if (isReception(a)) { keys.reception = true; keys.bulk = true; keys.missing_data = true; }
    if (isCS(a)) { keys.cs = true; keys.experience_ratings = true; keys.dashboard = true; keys.missing_data = true; }
    if (hasGrant(a)) keys.archive = true;
    return keys;
  }

  function tidyLeadTabs(container, api, originalRender) {
    var a = current();
    if (!a || !hasGrant(a) || isManager(a) || !container || !container.isConnected) return;
    var tabs = container.querySelector(".tabs");
    if (!tabs || !tabs.querySelector("[data-sub]")) return;
    var allowed = allowedKeys(a);
    Array.prototype.slice.call(tabs.querySelectorAll("[data-sub]")).forEach(function (btn) {
      var key = btn.getAttribute("data-sub");
      if (!allowed[key]) btn.remove();
    });

    var archive = tabs.querySelector('[data-sub="archive"]');
    if (!archive) {
      archive = document.createElement("button");
      archive.type = "button";
      archive.className = "tab-btn";
      archive.setAttribute("data-sub", "archive");
      archive.textContent = "أرشيف الليدز";
      archive.onclick = function () {
        api.openSearch("");
        withTemporaryManager(a, function () { originalRender(container); });
        setTimeout(function () { tidyLeadTabs(container, api, originalRender); }, 0);
      };
      tabs.appendChild(archive);
    }
  }

  function patchLeadsRenderer() {
    var api = window.SSMPDRenderLeads;
    if (!api || typeof api.render !== "function" || typeof api.openSearch !== "function") return false;
    if (api.render.__leadsArchiveGrantWrapped) return true;
    var originalRender = api.render;
    var wrapped = function (container) {
      var a = current();
      if (hasGrant(a) && !isManager(a) && !isReception(a) && !isCS(a)) {
        api.openSearch("");
        withTemporaryManager(a, function () { originalRender(container); });
      } else {
        originalRender(container);
      }
      setTimeout(function () { tidyLeadTabs(container, api, originalRender); }, 0);
    };
    wrapped.__leadsArchiveGrantWrapped = true;
    api.render = wrapped;

    new MutationObserver(function () {
      var a = current();
      if (!a || !hasGrant(a) || isManager(a)) return;
      document.querySelectorAll(".tabs").forEach(function (tabs) {
        if (!tabs.querySelector("[data-sub]")) return;
        var parent = tabs.parentElement;
        if (parent) tidyLeadTabs(parent, api, originalRender);
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var a = patchRoles(), b = patchAdminWorkspace(), c = patchLeadsRenderer();
    if ((a && b && c) || tries >= 300) clearInterval(timer);
  }, 100);
  patchRoles(); patchAdminWorkspace(); patchLeadsRenderer();
})();
