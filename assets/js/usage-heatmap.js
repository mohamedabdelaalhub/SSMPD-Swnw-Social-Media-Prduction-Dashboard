/* Usage heatmap (owner 2026-11-13): counts tab views and button taps per ROLE per day, so unused buttons can be hidden.
   No user id, no patient data: the server derives the role; we only send stable keys (data-action / data-goto / id) or a
   short button label without digits. Batched in memory and sent once every 10 minutes (and when the tab is hidden). */
(function(root){'use strict';
if(root.__SWNWUsageHeatmap)return;root.__SWNWUsageHeatmap=true;
var buf={},count=0,timer=null,failures=0,FLUSH_MS=600000;
function area(){try{return (root.sessionStorage.getItem('ssmpd_active_tab')||'home').slice(0,40);}catch(e){return 'home';}}
function add(a,e){if(!a||!e)return;e=String(e).slice(0,80);var k=a+'\u0001'+e;buf[k]=(buf[k]||0)+1;if(++count>=250)flush();}
function clean(t){t=String(t||'').replace(/\s+/g,' ').trim();if(!t||t.length>30||/\d{2,}/.test(t)||/@/.test(t))return '';return t.replace(/[0-9٠-٩]/g,'');}
function keyOf(el){
 if(el.dataset){if(el.dataset.goto)return ['menu','goto:'+el.dataset.goto];if(el.dataset.tab)return ['tabs','tab:'+el.dataset.tab];
  for(var n in el.dataset){if(/action$/i.test(n)||n==='action'){var v=String(el.dataset[n]||'');if(v&&v.length<=40&&!/^[0-9a-f-]{20,}$/i.test(v))return [area(),n+':'+v];}}}
 if(el.id&&!/\d{3,}/.test(el.id))return [area(),'#'+el.id];
 if(el.closest&&el.closest('table,tbody,[data-appointment],[data-task-id],[data-lead-id],.patient-card'))return null;
 for(var x=el,i=0;x&&i<8;x=x.parentElement,i++){if(x.attributes)for(var j=0;j<x.attributes.length;j++){if(/^data-.*id$/i.test(x.attributes[j].name))return null;}}
 var t=clean(el.getAttribute&&el.getAttribute('aria-label')||el.textContent);return t?[area(),'text:'+t]:null;}
function onClick(ev){try{var el=ev.target&&ev.target.closest&&ev.target.closest('button,a,summary,[role=button],[data-goto],[data-tab]');if(!el)return;var k=keyOf(el);if(k)add(k[0],k[1]);}catch(e){}}
function flush(){var items=[];for(var k in buf){var p=k.split('\u0001');items.push({a:p[0],e:p[1],n:buf[k]});}buf={};count=0;if(!items.length)return;
 var db=root.SSMPDDb&&root.SSMPDDb.client;if(!db||!root.SSMPDAuth||!root.SSMPDAuth.currentAdmin||failures>3)return;
 db.rpc('ui_usage_track',{p_items:items.slice(0,300)}).then(function(r){if(r&&r.error)failures++;else failures=0;},function(){failures++;});}
document.addEventListener('click',onClick,true);
var nav=root.SSMPDNavigationUI;function wrapNav(){var n=root.SSMPDNavigationUI;if(!n||n.__usageWrapped)return;var orig=n.setCurrent;n.setCurrent=function(tab){try{if(tab)add(String(tab).slice(0,40),'view');}catch(e){}return orig.apply(this,arguments);};n.__usageWrapped=true;}
wrapNav();setTimeout(wrapNav,3000);
timer=setInterval(flush,FLUSH_MS);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush();});
root.SSMPDUsageHeatmap={flush:flush,_buf:function(){return buf;}};
})(window);
