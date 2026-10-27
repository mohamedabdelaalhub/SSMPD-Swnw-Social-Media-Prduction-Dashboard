/* SWNW — Leads Archive permission integrated before Admin Workspace transforms the table into cards */
(function () {
  "use strict";
  if (window.__SWNWLeadsArchivePermissionColumnV2) return;
  window.__SWNWLeadsArchivePermissionColumnV2 = true;

  function isInherited(a) {
    var roles = [a && a.role].concat((a && a.extra_roles) || []);
    return roles.indexOf("super_admin") !== -1 || roles.indexOf("general_manager") !== -1;
  }

  function notify(msg, type) {
    if (window.SSMPDToast && typeof window.SSMPDToast.show === "function") {
      window.SSMPDToast.show(msg, type || "info");
    }
  }

  function injectBeforeTransform(container, admins) {
    if (!container || !window.SSMPDDb) return;
    var table = container.querySelector("#admin-users table.simple");
    if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
    if (table.dataset.leadsArchivePermissionNative === "1") return;

    var headerRow = table.tHead.rows[0];
    var deleteHeader = Array.prototype.slice.call(headerRow.cells).find(function (cell) {
      return /حذف الليدز/.test(cell.textContent || "");
    });
    if (!deleteHeader) return;

    var existingHeader = Array.prototype.slice.call(headerRow.cells).find(function (cell) {
      return /أرشيف الليدز/.test(cell.textContent || "");
    });
    if (!existingHeader) {
      var th = document.createElement("th");
      th.textContent = "أرشيف الليدز";
      th.dataset.leadsArchivePermissionColumn = "1";
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

      var inherited = isInherited(a);
      var td = document.createElement("td");
      td.style.textAlign = "center";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.leadsArchiveAccess = id;
      cb.checked = inherited || a.has_leads_archive_access === true;
      cb.disabled = inherited;
      cb.title = inherited ? "متاحة تلقائيًا من دور المدير" : "السماح بقراءة أرشيف الليدز";
      td.appendChild(cb);

      var target = anchor.closest("td");
      if (!target || !target.parentNode) return;
      target.parentNode.insertBefore(td, target);

      if (!inherited) {
        cb.addEventListener("change", function () {
          var wanted = cb.checked;
          cb.disabled = true;
          window.SSMPDDb.updateAdmin(id, { has_leads_archive_access: wanted }).then(function () {
            a.has_leads_archive_access = wanted;
            cb.disabled = false;
            notify(wanted ? "تم منح صلاحية أرشيف الليدز" : "تم إلغاء صلاحية أرشيف الليدز");
          }).catch(function (e) {
            cb.checked = !wanted;
            cb.disabled = false;
            notify("تعذر حفظ صلاحية أرشيف الليدز: " + ((e && e.message) || "خطأ"), "error");
          });
        });
      }
    });

    table.dataset.leadsArchivePermissionNative = "1";
  }

  function wrapAdminWorkspace() {
    var workspace = window.SSMPDAdminWorkspace;
    if (!workspace || typeof workspace.mount !== "function") return false;
    if (workspace.mount.__leadsArchivePermissionWrapped) return true;

    var original = workspace.mount;
    var wrapped = function (container, admins) {
      injectBeforeTransform(container, admins || []);
      return original.call(workspace, container, admins);
    };
    wrapped.__leadsArchivePermissionWrapped = true;
    workspace.mount = wrapped;
    return true;
  }

  if (!wrapAdminWorkspace()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (wrapAdminWorkspace() || tries >= 200) clearInterval(timer);
    }, 100);
  }
})();
