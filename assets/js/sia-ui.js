(function(){
  'use strict';
  if(window.__SSMPD_SIA_UI_LOADED__)return;
  window.__SSMPD_SIA_UI_LOADED__=true;
  var assistantIcon='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 20c.8-4 3.2-6 6.5-6s5.7 2 6.5 6"></path><path d="M18.5 4.5v4M16.5 6.5h4"></path></svg>';
  function patch(){
    var b=document.querySelector('.ssmpd-aa-launch');
    if(b&&!b.dataset.siaBranded){b.dataset.siaBranded='1';b.innerHTML=assistantIcon;b.setAttribute('aria-label','سيا — المساعد الإداري');b.title='سيا — المساعد الإداري';}
    document.querySelectorAll('.ssmpd-aa-panel').forEach(function(p){p.setAttribute('aria-label','سيا — المساعد الإداري');var h=p.querySelector('.ssmpd-aa-head h2');if(h&&h.textContent.trim()==='المساعد الإداري')h.textContent='سيا · المساعد الإداري';});
    document.querySelectorAll('.aa-center h1').forEach(function(h){if(h.textContent.trim()==='مركز المساعد الإداري')h.textContent='سيا · مركز المساعد الإداري';});
    if(window.SSMPDRoles&&window.SSMPDRoles.ALL&&!window.SSMPDRoles.ALL.digital_agent)window.SSMPDRoles.ALL.digital_agent='موظف رقمي';
  }
  patch();
  new MutationObserver(patch).observe(document.documentElement,{childList:true,subtree:true});
})();
