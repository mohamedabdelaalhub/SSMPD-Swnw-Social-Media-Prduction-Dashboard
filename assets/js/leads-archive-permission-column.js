/* SWNW — reliable Leads Archive permission column inside Admin users table */
(function () {
  "use strict";
  if (window.__SWNWLeadsArchivePermissionColumn) return;
  window.__SWNWLeadsArchivePermissionColumn = true;

  var running = false;

  function isInherited(a) {
    var roles = [a && a.role].concat((a && a.extra_roles) || []);
    return roles.indexOf("super_admin") !== -1 || roles.indexOf("general_manager") !== -1;
  }

  function notify(msg, type) {
    if (window.SSMPDToast && typeof window.SSMPDToast.show === "function") {
      window.SSMPDToast.show(msg, type || "info");
    }
  }

  function install() {
    if (running || !window.SSMPDDb || typeof window.SSMPDDb.listAdmins !== "function") return;
    var table = document.querySelector("#admin-users table.simple");
    if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
    if (table.dataset.leadsArchivePermissionNative === "1") return;

    running = true;
    window.SSMPDDb.listAdmins().then(function (admins) {
      if (!table.isConnected) return;
      var map = Object.create(null);
      (admins || []).forEach(function (a) { map[a.id] = a; });

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

      Array.prototype.slice.call(table.tBodies[0].rows).forEach(function (tr) {
        if (tr.querySelector("[data-leads-archive-access]")) return;
        var anchor = tr.querySelector("[data-delete-leads]");
        if (!anchor) return;
        var id = anchor.getAttribute("data-delete-leads");
        var a = map[id];
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
        anchor.closest("td").parentNode.insertBefore(td, anchor.closest("td"));

        if (!inherited) {
          cb.addEventListener("change", function () {
            var wanted = cb.checked;
            cb.disabled = true;
            window.SSMPDDb.updateAdmin(id, { has_leads_archive_access: wanted }).then(function () {
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
      table.dataset.leadsArchiveAccessReady = "1";
    }).catch(function (e) {
      console.error("Leads archive permission column:", e);
    }).finally(function () {
      running = false;
    });
  }

  install();
  var tries = 0;
  var timer = setInterval(function () {
    install();
    tries += 1;
    if (tries >= 40) clearInterval(timer);
  }, 500);

  new MutationObserver(function () { install(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
