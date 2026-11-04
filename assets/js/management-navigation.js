/* SWNW operational pages live in the main menu, not the content-production strip. */
(function(w){
 'use strict';
 var observer=null,active=false,working=false;
 var pages=[
  {key:'business_intelligence',label:'ذكاء الإدارة',selector:'[data-goto="business_intelligence"]',open:function(){w.SSMPDOpenBusinessIntelligence?.();}},
  {key:'digital_team',label:'الفريق الرقمي',selector:'[data-digital-team-tab]',open:function(){w.SSMPDDigitalTeam?.open();}},
  {key:'patient360',label:'علاقة المريض 360',selector:'[data-p360-nav]',open:function(){w.SSMPDPatient360?.open();}},
  {key:'assistant_center',label:'مركز المساعد الإداري',selector:'[data-aa-center-tab]',open:function(){w.SSMPDAdministrativeAssistantCenter?.open();}}
 ];
 function allowed(){
   var a=w.SSMPDAuth?.currentAdmin||{},roles=Array.isArray(a.roles)?a.roles:[];
   return a.role==='super_admin'||a.role==='general_manager'||roles.includes('super_admin')||roles.includes('general_manager');
 }
 function sync(){
  if(working||!allowed())return;
  var items=document.querySelector('#user-dropdown .ud-items');if(!items)return;
  working=true;
  try{
    var group=items.querySelector('[data-management-nav]');
    if(!group){group=document.createElement('div');group.className='sw-management-nav';group.setAttribute('data-management-nav','1');var title=document.createElement('div');title.className='sw-management-title';title.textContent='الإدارة والتشغيل';group.appendChild(title);items.appendChild(group);}
    pages.forEach(function(p){
      var btn=group.querySelector('[data-management-page="'+p.key+'"]');
      if(!btn){
        btn=items.querySelector(p.selector)||document.createElement('button');
        btn.type='button';btn.className='ud-item sw-management-link';
        btn.textContent=p.label;btn.setAttribute('data-management-page',p.key);
        btn.onclick=p.open;group.appendChild(btn);
      }
    });
    // Old dynamically-created strip entries must not reappear in the content suite.
    document.querySelectorAll('#tabs-bar [data-tab="business_intelligence"],#tabs-bar [data-digital-team-tab],#tabs-bar [data-p360-nav],#tabs-bar [data-aa-center-tab],#mobile-menu .mm-tabs [data-digital-team-tab],#mobile-menu .mm-tabs [data-p360-nav],#mobile-menu .mm-tabs [data-aa-center-tab]').forEach(function(el){el.remove();});
  }finally{working=false;}
 }
 function start(){
  sync();if(observer)return;
  observer=new MutationObserver(sync);
  observer.observe(document.getElementById('app-root')||document.body,{childList:true,subtree:true});
  w.addEventListener('ssmpd-auth-changed',sync);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
 w.SSMPDManagementNavigation={refresh:sync};
})(window);