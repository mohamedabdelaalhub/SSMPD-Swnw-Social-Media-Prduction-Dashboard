/* SWNW — lightweight launcher for the standalone System Diagnostics page */
(function () {
  "use strict";
  if (window.__SWNWSystemDiagnosticsLauncher) return;
  window.__SWNWSystemDiagnosticsLauncher = true;

  var DIAG_URL = "connection-test.html";
  var scheduled = false;

  function openDiagnostics() {
    window.open(DIAG_URL, "_blank", "noopener,noreferrer");
  }

  function addLoginLink() {
    var box = document.querySelector(".auth-box");
    if (!box || box.querySelector("[data-system-diagnostics-login]")) return;

    var wrap = document.createElement("div");
    wrap.dataset.systemDiagnosticsLogin = "1";
    wrap.style.cssText = "margin-top:14px;text-align:center;font-size:12px;";
    var a = document.createElement("a");
    a.href = DIAG_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "🩺 تشخيص النظام";
    a.style.cssText = "color:#0f3a8d;font-weight:700;text-decoration:underline;";
    wrap.appendChild(a);
    box.appendChild(wrap);

    var err = box.querySelector(".err-msg");
    if (err && /failed to fetch|networkerror|network request|load failed/i.test(err.textContent || "")) {
      var quick = document.createElement("button");
      quick.type = "button";
      quick.textContent = "فتح تشخيص النظام";
      quick.style.cssText = "width:100%;margin-top:8px;padding:9px 12px;border:1px solid #f0b4ae;border-radius:10px;background:#fff;color:#9f2d20;font-weight:700;cursor:pointer;";
      quick.onclick = openDiagnostics;
      err.insertAdjacentElement("afterend", quick);
    }
  }

  function addHeaderButton() {
    var help = document.getElementById("dashboard-help-toggle");
    if (!help || document.getElementById("system-diagnostics-toggle")) return;

    var btn = document.createElement("button");
    btn.id = "system-diagnostics-toggle";
    btn.type = "button";
    btn.className = help.className || "";
    btn.title = "تشخيص النظام";
    btn.setAttribute("aria-label", "تشخيص النظام");
    btn.textContent = "🩺";
    btn.onclick = openDiagnostics;

    help.parentNode.insertBefore(btn, help);
  }

  function inject() {
    addLoginLink();
    addHeaderButton();
  }

  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      inject();
    });
  }

  function start() {
    inject();
    var root = document.getElementById("app-root") || document.body;
    new MutationObserver(scheduleInject).observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();