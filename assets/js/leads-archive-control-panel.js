/* SWNW — explicit Leads Archive shortcut inside the Admin Control Panel */
(function () {
  "use strict";
  if (window.__SWNWLeadsArchiveControlPanel) return;
  window.__SWNWLeadsArchiveControlPanel = true;

  function current() {
    return window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
  }

  function canOpen() {
    var mod = window.SWNNLeadsArchiveAccess;
    return !!(mod && typeof mod.canOpen === "function" && mod.canOpen(current()));
  }

  function openArchive() {
    var mod = window.SWNNLeadsArchiveAccess;
    if (mod && typeof mod.open === "function") {
      mod.open();
      return;
    }
    if (window.SSMPDToast) window.SSMPDToast.show("أرشيف الليدز لم يكتمل تحميله بعد. حدّث الصفحة مرة واحدة.", "error");
  }

  function inject() {
    var users = document.getElementById("admin-users");
    if (!users || !users.isConnected) return;
    var container = users.parentElement;
    if (!container || container.querySelector("[data-admin-leads-archive-shortcut]")) return;
    if (!canOpen()) return;

    var section = document.createElement("div");
    section.className = "section";
    section.dataset.adminLeadsArchiveShortcut = "1";
    section.style.marginBottom = "16px";
    section.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div><h3 style="margin:0 0 4px;">أرشيف الليدز</h3>' +
        '<p style="margin:0;font-size:12px;color:var(--c-muted);">فتح أرشيف الليدز للبحث والعرض. صلاحية القراءة مستقلة ويمكن منحها لموظفين محددين من جدول المستخدمين أدناه.</p></div>' +
        '<button type="button" class="btn" data-open-admin-leads-archive>🗃️ فتح أرشيف الليدز</button>' +
      '</div>';

    container.insertBefore(section, users);
    section.querySelector("[data-open-admin-leads-archive]").onclick = openArchive;
  }

  var observer = new MutationObserver(inject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  inject();
})();
