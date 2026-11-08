/* Final UX glue for the unified reception day. Keeps existing engines intact. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsFinalizeV1)return;
window.__SWNWTodayOperationsFinalizeV1=true;

var firstEntryAttempted=false;
function roles(){return window.SSMPDRoles&&window.SSMPDAuth?window.SSMPDRoles.rolesOf(window.SSMPDAuth.currentAdmin):[];}
function has(role){return roles().indexOf(role)!==-1;}
function clinical(){return has('super_admin')||has('general_manager')||has('sono_doctor')||has('nursing')||has('head_nursing');}
function hideLegacyCash(){document.querySelectorAll('[data-goto="booking_cash"]').forEach(function(node){node.hidden=true;node.setAttribute('aria-hidden','true');});}
function autoOpenJourney(){
 var admin=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;if(!admin||!window.SSMPDRoles)return;
 var isReception=window.SSMPDRoles.hasRole(admin,'reception'),manager=window.SSMPDRoles.hasAnyRole(admin,['super_admin','general_manager']);if(!isReception||manager)return;
 var grid=document.querySelector('.fc-section-grid');if(!grid)return;
 var journey=grid.querySelector('[data-rx-section="journey"]');
 if(journey){journey.click();return;}
 var reload=document.querySelector('[data-rx-action="reload"]');if(reload&&!reload.dataset.unifiedReloaded){reload.dataset.unifiedReloaded='1';reload.click();setTimeout(autoOpenJourney,180);}
}
function refresh(){hideLegacyCash();}
var observer=new MutationObserver(function(){setTimeout(refresh,0);});observer.observe(document.documentElement,{childList:true,subtree:true});

document.addEventListener('click',function(e){
 var nav=e.target.closest('[data-goto="reception_services"]');if(nav&&has('reception')&&!has('super_admin')&&!has('general_manager'))setTimeout(autoOpenJourney,160);
},true);

setTimeout(function(){hideLegacyCash();if(firstEntryAttempted)return;firstEntryAttempted=true;autoOpenJourney();},600);
setInterval(refresh,1200);
})();