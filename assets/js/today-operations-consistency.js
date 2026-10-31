/* Keep legacy reception snapshot consistent after Today Operations writes. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsConsistency)return;
window.__SWNWTodayOperationsConsistency=true;
var installed=false,dirty=false;
function loadCallsLayer(){
 if(window.__SWNWTodayOperationsCalls||document.querySelector('script[data-today-operations-calls]'))return;
 var s=document.createElement('script');
 s.src='assets/js/today-operations-calls.js?v=journey-sandbox-20261031-1';
 s.async=false;
 s.dataset.todayOperationsCalls='1';
 document.head.appendChild(s);
}
function loadServiceRequestV3(){
 if(window.__SWNWJourneyServiceRequestV3||document.querySelector('script[data-journey-service-request-v3]'))return;
 var s=document.createElement('script');
 s.src='assets/js/today-operations-service-request-v3.js?v=patient-journey-v3-20261031-1';
 s.async=false;
 s.dataset.journeyServiceRequestV3='1';
 document.head.appendChild(s);
}
function loadV2(){
 if(window.__SWNWTodayOperationsUXV2||document.querySelector('script[data-today-operations-v2]'))return;
 var s=document.createElement('script');
 s.src='assets/js/today-operations-v2.js?v=patient-journey-v2-20261031-1';
 s.async=false;
 s.dataset.todayOperationsV2='1';
 document.head.appendChild(s);
}
function install(){
 if(installed)return;
 if(!window.SSMPDDb||!window.SSMPDDb.client||!window.SSMPDReceptionModules){setTimeout(install,250);return;}
 installed=true;
 var client=window.SSMPDDb.client,originalRpc=client.rpc.bind(client);
 client.rpc=function(name,args,options){
  return originalRpc(name,args,options).then(function(result){
   if(['clinic_reception_journey_command','clinic_reception_sandbox_command','clinic_reception_journey_reschedule','clinic_reception_journey_prepare_finish','clinic_reception_journey_request_service'].includes(name)&&result&&!result.error)dirty=true;
   return result;
  });
 };
 var modules=window.SSMPDReceptionModules,originalPanel=modules.panel;
 modules.panel=function(section,c){
  var html=originalPanel?originalPanel.call(modules,section,c):'';
  if(section!=='journey'&&dirty&&c&&typeof c.load==='function'){
   dirty=false;
   setTimeout(function(){c.load();},0);
  }
  return html;
 };
 loadCallsLayer();
 loadServiceRequestV3();
 loadV2();
}
install();
})();
