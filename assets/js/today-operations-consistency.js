/* Keep legacy reception snapshot consistent after Today Operations writes. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsConsistency)return;
window.__SWNWTodayOperationsConsistency=true;
var installed=false,dirty=false;
function loadCallsLayer(){
 if(window.__SWNWTodayOperationsCalls||document.querySelector('script[data-today-operations-calls]'))return;
 var s=document.createElement('script');
 s.src='assets/js/today-operations-calls.js?v=patient-journey-20261030-1';
 s.async=false;
 s.dataset.todayOperationsCalls='1';
 document.head.appendChild(s);
}
function install(){
 if(installed)return;
 if(!window.SSMPDDb||!window.SSMPDDb.client||!window.SSMPDReceptionModules){setTimeout(install,250);return;}
 installed=true;
 var client=window.SSMPDDb.client,originalRpc=client.rpc.bind(client);
 client.rpc=function(name,args,options){
  return originalRpc(name,args,options).then(function(result){
   if(name==='clinic_reception_journey_command'&&result&&!result.error)dirty=true;
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
}
install();
})();
