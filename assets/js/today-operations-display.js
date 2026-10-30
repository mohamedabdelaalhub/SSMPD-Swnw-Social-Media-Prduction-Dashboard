/* SWNW Today Operations — rotating reception display launcher. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsDisplayV1)return;
window.__SWNWTodayOperationsDisplayV1=true;
var context=null,observer=null;
function toast(msg,kind){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,kind||'success');}
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function displayUrl(token){var u=new URL('checkin-display.html',location.href);u.search='';u.hash='';u.searchParams.set('display',token);return u.toString();}
function openDisplay(){
 if(!context||!context.workspace){toast('افتح تشغيل اليوم ثم حاول مرة أخرى','error');return;}
 var popup=window.open('about:blank','swnw-checkin-display');
 if(popup){try{popup.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Swnw</title><body style="font-family:Arial;text-align:center;padding:60px">جاري تجهيز شاشة تسجيل الوصول…</body></html>');popup.document.close();}catch(e){}}
 rpc('clinic_reception_display_session',{p_workspace:context.workspace}).then(function(data){
   var url=displayUrl(data.display_token);
   if(popup&&!popup.closed){popup.location.replace(url);return;}
   return navigator.clipboard.writeText(url).then(function(){toast('تم نسخ رابط شاشة تسجيل الوصول. افتحه على التلفزيون.');});
 }).catch(function(err){if(popup&&!popup.closed)popup.close();toast(err.message||'تعذر فتح شاشة تسجيل الوصول','error');});
}
function inject(){
 document.querySelectorAll('.journey-toolbar-actions').forEach(function(bar){
   if(bar.querySelector('[data-tv-checkin-display]'))return;
   var b=document.createElement('button');b.type='button';b.className='btn btn-primary';b.dataset.tvCheckinDisplay='1';b.textContent='شاشة تسجيل الوصول';b.onclick=function(e){e.preventDefault();openDisplay();};
   bar.insertBefore(b,bar.firstChild);
 });
}
function refreshReceptionIfOpen(){
 var shell=document.querySelector('.rx-shell');
 if(!shell||!window.SSMPDReception||typeof window.SSMPDReception.render!=='function')return;
 var receptionHost=shell.parentElement;
 if(receptionHost)window.SSMPDReception.render(receptionHost);
}
function install(){
 var base=window.SSMPDReceptionModules;
 if(!base){setTimeout(install,120);return;}
 if(base.__swnwDisplayWrapped)return;
 var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
 wrapped.panel=function(section,c){if(section==='journey')context=c;var html=base.panel?base.panel(section,c):'';setTimeout(inject,0);return html;};
 wrapped.__swnwDisplayWrapped=true;
 window.SSMPDReceptionModules=wrapped;
 observer=new MutationObserver(inject);observer.observe(document.documentElement,{childList:true,subtree:true});inject();
 setTimeout(refreshReceptionIfOpen,0);
}
install();
})();
