/* SWNW Tasks — keep parent/subtask navigation context */
(function () {
  "use strict";
  if (window.__SWNWTaskStageNavigation) return;
  window.__SWNWTaskStageNavigation = true;

  var ctx = null;
  var pending = null;
  var workflow = null;
  var host = null;
  var restoreTimer = null;
  var observer = null;

  function escCss(v) {
    if (window.CSS && CSS.escape) return CSS.escape(String(v));
    return String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function taskModal() {
    var detail = document.querySelector(".tsk-modal .tv-detail");
    if (!detail) return null;
    var modal = detail.closest(".tsk-modal");
    return modal ? { modal: modal, detail: detail } : null;
  }

  function currentTaskId(detail) {
    var marker = detail.querySelector('.tv-tools [data-action="history"][data-id], .tv-tools [data-action="checklist"][data-id]');
    return marker && marker.dataset.id || "";
  }

  function parentInfo(detail) {
    var button = detail.querySelector('.tv-crumb [data-action="open-task"][data-id]');
    return button ? { id: button.dataset.id, title: (button.textContent || "").trim() } : null;
  }

  function stageList(section) {
    if (!section) return [];
    var allButtons = Array.prototype.slice.call(section.querySelectorAll('.tv-row-main[data-action="open-task"][data-id]'));
    var total = allButtons.length;
    var placed = [], used = {};
    Array.prototype.slice.call(section.querySelectorAll('.tw-stage')).forEach(function (stage) {
      var b = stage.querySelector('.tv-row-main[data-action="open-task"][data-id]');
      var num = parseInt((stage.firstElementChild && stage.firstElementChild.textContent || "").trim(), 10);
      if (!b || !num) return;
      var title = b.querySelector(".tv-row-title");
      placed.push({ id: b.dataset.id, title: (title ? title.textContent : b.textContent || "").trim(), position: num });
      used[num] = true;
    });
    var missing = [];
    for (var i = 1; i <= total; i++) if (!used[i]) missing.push(i);
    Array.prototype.slice.call(section.querySelectorAll('details .tv-row-main[data-action="open-task"][data-id]')).forEach(function (b, i) {
      var title = b.querySelector(".tv-row-title");
      placed.push({ id: b.dataset.id, title: (title ? title.textContent : b.textContent || "").trim(), position: missing[i] || total + i + 1 });
    });
    return placed.sort(function (a, b) { return a.position - b.position; });
  }

  function dispatchOpen(id, returnChildId) {
    if (!id || !host || !host.isConnected) return false;
    var b = document.createElement("button");
    b.type = "button";
    b.hidden = true;
    b.dataset.action = "open-task";
    b.dataset.id = id;
    if (returnChildId) b.dataset.smartReturnChild = returnChildId;
    host.appendChild(b);
    b.click();
    b.remove();
    return true;
  }

  function goParent(parentId, childId) {
    pending = null;
    workflow = null;
    if (ctx) ctx.returnChildId = childId || ctx.childId;
    dispatchOpen(parentId, childId || (ctx && ctx.childId));
  }

  function addStyle() {
    if (document.getElementById("swnw-task-stage-nav-style")) return;
    var style = document.createElement("style");
    style.id = "swnw-task-stage-nav-style";
    style.textContent =
      ".swnw-stage-nav{position:sticky;top:0;z-index:12;margin:0 0 14px;padding:10px;background:rgba(247,249,253,.97);border:1px solid #dfe7f2;border-radius:14px;box-shadow:0 4px 14px rgba(28,54,90,.07);backdrop-filter:blur(8px)}" +
      ".swnw-stage-nav__meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:12px;color:#607089}.swnw-stage-nav__meta b{color:#1f3652;font-size:13px}" +
      ".swnw-stage-nav__actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,1.35fr) minmax(0,1fr);gap:8px}.swnw-stage-nav button{font:inherit;min-height:42px;border:1px solid #d9e2ee;border-radius:11px;background:#fff;color:#25415f;font-weight:700;cursor:pointer;padding:7px 9px}.swnw-stage-nav button.parent{background:#0f369d;border-color:#0f369d;color:#fff}.swnw-stage-nav button:disabled{opacity:.38;cursor:default}" +
      ".swnw-stage-return{animation:swnwStageFlash 1.35s ease}.swnw-stage-return .tv-row{box-shadow:0 0 0 3px rgba(15,54,157,.18)}@keyframes swnwStageFlash{0%,100%{background:transparent}40%{background:#eef4ff}}" +
      "@media(max-width:600px){.swnw-stage-nav{margin-inline:-4px;padding:9px}.swnw-stage-nav__actions{grid-template-columns:1fr 1.25fr 1fr;gap:6px}.swnw-stage-nav button{font-size:12px;padding:6px 5px}.swnw-stage-nav__meta span{max-width:60%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}";
    document.head.appendChild(style);
  }

  function navButton(label, id, kind, disabled) {
    return '<button type="button" data-swnw-stage-nav="' + kind + '" data-id="' + (id || "") + '"' +
      (kind === "parent" ? ' class="parent"' : "") + (disabled ? " disabled" : "") + ">" + label + "</button>";
  }

  function enhanceChild(info, parent, childId) {
    var siblings = [];
    if (pending && pending.childId === childId) siblings = pending.siblings || [];
    else if (ctx && ctx.parentId === parent.id) siblings = ctx.siblings || [];

    var index = siblings.findIndex(function (x) { return x.id === childId; });
    ctx = {
      parentId: parent.id,
      parentTitle: parent.title,
      childId: childId,
      siblings: siblings,
      index: index,
      returnChildId: ctx && ctx.returnChildId || ""
    };
    pending = null;

    var old = info.detail.querySelector(".swnw-stage-nav");
    if (old) return;
    var nav = document.createElement("div");
    nav.className = "swnw-stage-nav";
    var total = siblings.length;
    var current = index >= 0 ? siblings[index] : null;
    var position = current && current.position || (index >= 0 ? index + 1 : 0);
    var prev = index > 0 ? siblings[index - 1] : null;
    var next = index >= 0 && index < total - 1 ? siblings[index + 1] : null;
    nav.innerHTML =
      '<div class="swnw-stage-nav__meta"><b>' + (position && total ? "مرحلة " + position + " من " + total : "مهمة فرعية") + '</b><span>' + (parent.title || "المهمة الرئيسية") + '</span></div>' +
      '<div class="swnw-stage-nav__actions">' +
      navButton("‹ السابق", prev && prev.id, "sibling", !prev) +
      navButton("↩ المهمة الرئيسية", parent.id, "parent", false) +
      navButton("التالي ›", next && next.id, "sibling", !next) +
      "</div>";
    info.detail.insertBefore(nav, info.detail.firstChild);
  }

  function focusReturnedChild(info) {
    if (!ctx || !ctx.returnChildId) return;
    var id = ctx.returnChildId;
    var row = info.detail.querySelector('.tw-stages [data-task-id="' + escCss(id) + '"]');
    if (!row) return;
    ctx.returnChildId = "";
    var stage = row.closest(".tw-stage") || row;
    stage.classList.add("swnw-stage-return");
    setTimeout(function () { stage.classList.remove("swnw-stage-return"); }, 1500);
    setTimeout(function () { stage.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
  }

  function enhance() {
    var info = taskModal();
    if (!info) {
      if (workflow && host && host.isConnected) {
        clearTimeout(restoreTimer);
        restoreTimer = setTimeout(function () {
          if (!document.querySelector(".tsk-modal-backdrop") && workflow) {
            var w = workflow;
            workflow = null;
            if (ctx) ctx.returnChildId = w.childId;
            dispatchOpen(w.parentId, w.childId);
          }
        }, 120);
      }
      return;
    }
    host = info.modal.parentElement || host;
    clearTimeout(restoreTimer);
    var childId = currentTaskId(info.detail);
    var parent = parentInfo(info.detail);
    if (parent && childId) {
      enhanceChild(info, parent, childId);
    } else {
      focusReturnedChild(info);
    }
  }

  function captureClick(ev) {
    var target = ev.target && ev.target.closest ? ev.target.closest("[data-action],[data-swnw-stage-nav]") : null;
    if (!target) return;

    if (target.dataset.swnwStageNav) {
      if (target.disabled) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      var navId = target.dataset.id;
      if (target.dataset.swnwStageNav === "parent") {
        goParent(navId, ctx && ctx.childId);
      } else {
        if (ctx) ctx.returnChildId = "";
        dispatchOpen(navId);
      }
      return;
    }

    var action = target.dataset.action;
    if (action === "close-modal" && ev.target !== target && ev.target.closest(".tsk-modal")) return;
    if (action === "open-task") {
      var stages = target.closest(".tw-stages");
      if (stages) {
        var info = taskModal();
        pending = { childId: target.dataset.id, siblings: stageList(stages) };
        if (info) host = info.modal.parentElement || host;
      } else if (target.closest(".tv-crumb")) {
        pending = null;
        workflow = null;
      }
      return;
    }

    var infoNow = taskModal();
    var parentNow = infoNow && parentInfo(infoNow.detail);
    var childNow = infoNow && currentTaskId(infoNow.detail);

    if (action === "close-modal" && parentNow && childNow) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      goParent(parentNow.id, childNow);
      return;
    }

    if (parentNow && childNow && /^(progress|submit|blocked|approve|return)$/.test(action || "")) {
      workflow = { parentId: parentNow.id, childId: childNow };
      if (!ctx) ctx = { parentId: parentNow.id, parentTitle: parentNow.title, childId: childNow, siblings: [], index: -1, returnChildId: "" };
      return;
    }

    if (action === "close-modal" && workflow && !infoNow) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      var w = workflow;
      workflow = null;
      dispatchOpen(w.childId);
    }
  }

  addStyle();
  document.addEventListener("click", captureClick, true);
  observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhance();
})();
