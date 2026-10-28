/* SWNW — lightweight launcher + live health indicator for System Diagnostics */
(function () {
  "use strict";
  if (window.__SWNWSystemDiagnosticsLauncher) return;
  window.__SWNWSystemDiagnosticsLauncher = true;

  var DIAG_URL = "connection-test.html";
  var STORAGE_KEY = "swnw_system_errors_v1";
  var SUPER_MARKER = "swnw_diag_super_v1";
  var STATUS_WINDOW = 24 * 60 * 60 * 1000;
  var scheduled = false;

  function isSuperAdmin() {
    var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!a) return false;
    if (a.role === "super_admin") return true;
    return Array.isArray(a.roles) && a.roles.indexOf("super_admin") !== -1;
  }
  function markAccess() {
    try { sessionStorage.setItem(SUPER_MARKER, isSuperAdmin() ? "1" : "0"); } catch (_) {}
  }
  function openDiagnostics() {
    markAccess();
    window.location.href = DIAG_URL;
  }
  function safeItems(){try{var x=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}}
  function getStatus(){
    if(window.SWNWErrorMonitor&&typeof window.SWNWErrorMonitor.getStatus==="function")return window.SWNWErrorMonitor.getStatus();
    var now=Date.now(),items=safeItems().filter(function(x){return !x.resolved&&(!x.ts||now-new Date(x.ts).getTime()<STATUS_WINDOW);});
    if(items.some(function(x){return x.severity==="red";}))return{level:"red",count:items.length};
    if(items.length)return{level:"orange",count:items.length};
    return{level:"green",count:0};
  }
  function statusMeta(level){
    if(level==="red")return{color:"#d92d20",symbol:"×",label:"يوجد عطل يحتاج الانتباه"};
    if(level==="orange")return{color:"#f79009",symbol:"!",label:"يوجد تنبيه أو صلاحية تحتاج مراجعة"};
    return{color:"#12b76a",symbol:"✓",label:"النظام سليم على هذا الجهاز"};
  }
  function paintIndicator(node,status){
    if(!node)return;var m=statusMeta(status.level);
    node.dataset.healthLevel=status.level;node.title=m.label+(status.count?" — "+status.count+" تنبيه":"");node.setAttribute("aria-label",node.title);
    node.style.background=m.color;node.style.color="#fff";node.style.border="0";node.style.borderRadius="999px";node.style.minWidth="34px";node.style.width="34px";node.style.height="34px";node.style.padding="0";node.style.display="inline-flex";node.style.alignItems="center";node.style.justifyContent="center";node.style.fontWeight="900";node.style.boxShadow="0 0 0 3px rgba(255,255,255,.8),0 2px 8px rgba(0,0,0,.12)";node.textContent=m.symbol;
  }
  function refreshStatus(){var s=getStatus();paintIndicator(document.getElementById("system-diagnostics-toggle"),s);var badge=document.querySelector("[data-system-diagnostics-admin-status]");if(badge){var m=statusMeta(s.level);badge.textContent=m.label+(s.count?" — "+s.count+" تنبيه":"");badge.style.color=m.color;}}

  function addLoginLink(){
    var box=document.querySelector(".auth-box");if(!box||box.querySelector("[data-system-diagnostics-login]"))return;
    var wrap=document.createElement("div");wrap.dataset.systemDiagnosticsLogin="1";wrap.style.cssText="margin-top:14px;text-align:center;font-size:12px;";
    var a=document.createElement("a");a.href=DIAG_URL;a.textContent="🩺 تشخيص النظام";a.style.cssText="color:#0f3a8d;font-weight:700;text-decoration:underline;";a.onclick=function(){try{sessionStorage.setItem(SUPER_MARKER,"0");}catch(_){}};wrap.appendChild(a);box.appendChild(wrap);
    var err=box.querySelector(".err-msg");if(err&&/failed to fetch|networkerror|network request|load failed/i.test(err.textContent||"")){
      var quick=document.createElement("a");quick.href=DIAG_URL;quick.textContent="فتح تشخيص النظام";quick.style.cssText="display:block;text-align:center;width:100%;margin-top:8px;padding:9px 12px;border:1px solid #f0b4ae;border-radius:10px;background:#fff;color:#9f2d20;font-weight:700;text-decoration:none;";quick.onclick=function(){try{sessionStorage.setItem(SUPER_MARKER,"0");}catch(_){}};err.insertAdjacentElement("afterend",quick);
    }
  }
  function addHeaderButton(){
    var help=document.getElementById("dashboard-help-toggle");if(!help||document.getElementById("system-diagnostics-toggle"))return;
    var btn=document.createElement("button");btn.id="system-diagnostics-toggle";btn.type="button";btn.title="تشخيص النظام";btn.setAttribute("aria-label","تشخيص النظام");btn.onclick=openDiagnostics;help.parentNode.insertBefore(btn,help);refreshStatus();
  }
  function addAdminCard(){
    var users=document.getElementById("admin-users");if(!users||document.querySelector("[data-system-diagnostics-admin-card]"))return;
    var card=document.createElement("div");card.className="section";card.dataset.systemDiagnosticsAdminCard="1";
    card.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;"><div><h3 style="margin:0 0 5px;">تشخيص النظام</h3><p style="margin:0;color:var(--c-muted);font-size:12px;line-height:1.6;">فحص الشبكة والخدمات، وشرح مبسط لآخر أخطاء الجهاز مع الحل المقترح.</p><div data-system-diagnostics-admin-status style="font-weight:800;font-size:12px;margin-top:6px;"></div></div><button class="btn" type="button" data-system-diagnostics-admin-open>فتح تشخيص النظام</button></div>';
    users.parentNode.insertBefore(card,users);
    var open=card.querySelector('[data-system-diagnostics-admin-open]');if(open)open.onclick=openDiagnostics;
    refreshStatus();
  }
  function inject(){addLoginLink();addHeaderButton();addAdminCard();refreshStatus();}
  function scheduleInject(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;inject();});}
  function start(){inject();var root=document.getElementById("app-root")||document.body;new MutationObserver(scheduleInject).observe(root,{childList:true,subtree:true});}

  window.addEventListener("swnw:diagnostic-status",refreshStatus);
  window.addEventListener("storage",function(e){if(e.key===STORAGE_KEY)refreshStatus();});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
