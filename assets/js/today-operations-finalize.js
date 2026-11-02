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
function journeyStatus(id){
 var safe=(window.CSS&&CSS.escape)?CSS.escape(id):String(id).replace(/"/g,'\\"');
 var old=document.querySelector('.journey-card[data-appointment="'+safe+'"]');if(!old)return '';
 var badge=old.querySelector('.journey-badge');if(!badge)return '';
 var cls=Array.from(badge.classList).find(function(x){return x.indexOf('journey-badge-')===0&&x!=='journey-badge';});
 return cls?cls.replace('journey-badge-',''):'';
}
function enhanceCards(){
 document.querySelectorAll('.rx-unified-card[data-unified-patient]').forEach(function(card){
  var id=card.dataset.unifiedPatient,status=journeyStatus(id),actions=card.querySelector('.rx-unified-card-actions');if(!actions)return;
  if(status==='called'){
   var call=actions.querySelector('[data-unified-action="journey-call"]');if(call)call.textContent='إعادة النداء';
   if(clinical()&&!actions.querySelector('[data-unified-action="journey-consultation_start"]')){
    var b=document.createElement('button');b.type='button';b.className='btn btn-primary';b.dataset.unifiedAction='journey-consultation_start';b.dataset.id=id;b.textContent='بدأ الكشف';actions.insertBefore(b,actions.firstChild);
   }
  }
 });
 document.querySelectorAll('[data-unified-drawer] [data-unified-action="patient-drawer"]').forEach(function(b){b.remove();});
}
function fixPresentMetric(){
 var hub=document.querySelector('[data-unified-hub]');if(!hub)return;
 var metric=Array.from(hub.querySelectorAll('[data-unified-filter]')).find(function(b){var s=b.querySelector('span');return s&&s.textContent.trim()==='حضر';});if(!metric)return;
 var present=0;
 document.querySelectorAll('.journey-card[data-appointment]').forEach(function(card){var badge=card.querySelector('.journey-badge');if(!badge)return;var cls=Array.from(badge.classList).join(' ');if(!/journey-badge-(expected|on_the_way|no_show|cancelled)/.test(cls))present++;});
 var strong=metric.querySelector('strong');if(strong)strong.textContent=present;metric.dataset.unifiedFilter='present';
}
function showFilter(key,root){
 root.querySelectorAll('[data-unified-column]').forEach(function(col){
  if(key==='all')col.hidden=false;
  else if(key==='present')col.hidden=col.dataset.unifiedColumn==='booked';
  else col.hidden=col.dataset.unifiedColumn!==key;
 });
 root.querySelectorAll('.rx-unified-card[data-unified-patient]').forEach(function(card){
  card.hidden=false;
  if(key==='present'){
   var status=journeyStatus(card.dataset.unifiedPatient);if(status==='no_show'||status==='cancelled'||status==='expected'||status==='on_the_way')card.hidden=true;
  }
 });
}
function autoOpenJourney(){
 var admin=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;if(!admin||!window.SSMPDRoles)return;
 var isReception=window.SSMPDRoles.hasRole(admin,'reception'),manager=window.SSMPDRoles.hasAnyRole(admin,['super_admin','general_manager']);if(!isReception||manager)return;
 var grid=document.querySelector('.fc-section-grid');if(!grid)return;
 var journey=grid.querySelector('[data-rx-section="journey"]');
 if(journey){journey.click();return;}
 var reload=document.querySelector('[data-rx-action="reload"]');if(reload&&!reload.dataset.unifiedReloaded){reload.dataset.unifiedReloaded='1';reload.click();setTimeout(autoOpenJourney,180);}
}
function refresh(){hideLegacyCash();enhanceCards();fixPresentMetric();}
var observer=new MutationObserver(function(){setTimeout(refresh,0);});observer.observe(document.documentElement,{childList:true,subtree:true});

document.addEventListener('click',function(e){
 var filter=e.target.closest('[data-unified-filter]');if(filter){var key=filter.dataset.unifiedFilter;if(key==='present'){e.preventDefault();e.stopImmediatePropagation();showFilter('present',filter.closest('[data-unified-hub]'));}}
 var nav=e.target.closest('[data-goto="reception_services"]');if(nav&&has('reception')&&!has('super_admin')&&!has('general_manager'))setTimeout(autoOpenJourney,160);
},true);

setTimeout(function(){hideLegacyCash();if(firstEntryAttempted)return;firstEntryAttempted=true;autoOpenJourney();},600);
setInterval(refresh,1200);
})();