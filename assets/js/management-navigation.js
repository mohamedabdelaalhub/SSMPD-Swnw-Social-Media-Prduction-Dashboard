/* SWNW administration pages are first-class workspaces, not content tabs. */
(function(w){
'use strict';
if(w.SSMPDManagementNavigation)return;
var observer=null,busy=false;
var pages=[
 {key:'business_intelligence',label:'ذكاء الإدارة',open:function(){w.SSMPDOpenBusinessIntelligence?.();}},
 {key:'digital_team',label:'الفريق الرقمي',open:function(){w.SSMPDDigitalTeam?.open();}},
 {key:'patient360',label:'علاقة المريض 360',open:function(){w.SSMPDPatient360?.open();}},
 {key:'assistant_center',label:'مركز المساعد الإداري',open:function(){w.SSMPDAdministrativeAssistantCenter?.open();}}
];
function allow(){var a=w.SSMPDAuth?.currentAdmin||{},r=Array.isArray(a.roles)?a.roles:[];return ['super_admin','general_manager'].includes(a.role)||r.includes('super_admin')||r.includes('general_manager');}
function enter(key){
 document.body.classList.add('sw-management-view');
 document.body.setAttribute('data-management-active',key);
 var b=document.getElementById('tabs-bar');if(b)b.style.display='none';
 var m=document.querySelector('#mobile-menu .mm-tabs');if(m)m.style.display='none';
 document.querySelectorAll('[data-management-page]').forEach(function(x){x.setAttribute('aria-current',x.dataset.managementPage===key?'page':'false');});
 document.getElementById('user-dropdown')?.classList.remove('open');
}
function exit(){document.body.classList.remove('sw-management-view');document.body.removeAttribute('data-management-active');}
function sync(){
 if(busy||!allow())return;
 var items=document.querySelector('#user-dropdown .ud-items');if(!items)return;
 busy=true;
 try{
  var group=items.querySelector('[data-management-nav]');
  if(!group){group=document.createElement('div');group.className='sw-management-nav';group.dataset.managementNav='1';var title=document.createElement('div');title.className='sw-management-title';title.textContent='الإدارة والتشغيل';group.appendChild(title);items.appendChild(group);}
  pages.forEach(function(p){
   var links=items.querySelectorAll('[data-management-page="'+p.key+'"]');
   var button=links[0]||document.createElement('button');
   button.className='ud-item sw-management-link';button.type='button';button.textContent=p.label;
   button.setAttribute('data-management-page',p.key);
   button.onclick=function(){p.open();enter(p.key);};
   if(button.parentNode!==group)group.appendChild(button);
   Array.from(links).slice(1).forEach(function(x){x.remove();});
  });
  // Remove orphaned copies created by legacy modules, including Sia's duplicate entry.
  items.querySelectorAll('[data-aa-center-tab]:not([data-management-page]),[data-digital-team-tab]:not([data-management-page]),[data-p360-nav]:not([data-management-page]),[data-goto="business_intelligence"]:not([data-management-page])').forEach(function(x){x.remove();});
  document.querySelectorAll('#tabs-bar [data-tab="business_intelligence"],#tabs-bar [data-digital-team-tab],#tabs-bar [data-p360-nav],#tabs-bar [data-aa-center-tab],#mobile-menu .mm-tabs [data-digital-team-tab],#mobile-menu .mm-tabs [data-p360-nav],#mobile-menu .mm-tabs [data-aa-center-tab]').forEach(function(x){x.remove();});
 }finally{busy=false;}
}
function start(){
 sync();if(observer)return;
 observer=new MutationObserver(sync);observer.observe(document.getElementById('app-root')||document.body,{childList:true,subtree:true});
 document.addEventListener('click',function(e){if(e.target.closest('[data-management-page]'))return;if(e.target.closest('.tab-btn,[data-goto]'))exit();},true);
 w.addEventListener('ssmpd-auth-changed',sync);
}
w.SSMPDManagementNavigation={refresh:sync,enter:enter,exit:exit};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);