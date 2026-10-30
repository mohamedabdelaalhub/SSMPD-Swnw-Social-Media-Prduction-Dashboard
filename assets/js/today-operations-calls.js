/* SWNW Today Operations — PBX/missed-call layer. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsCalls)return;
window.__SWNWTodayOperationsCalls=true;
var busy=false,lastKey='',timer=null;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function tm(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'—';}
function day(){var i=document.querySelector('[data-journey-day]');return i&&i.value?i.value:null;}
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function target(){var root=document.querySelector('[data-journey-root]');if(!root||root.dataset.journeyMode==='trial')return null;var aside=root.querySelector('.journey-layout aside');return aside||null;}
function render(rows){var host=target();if(!host)return;var old=host.querySelector('[data-journey-calls]');if(old)old.remove();var unresolved=(rows||[]).filter(function(c){return c.status==='missed'&&!c.resolved_at;});var section=document.createElement('section');section.className='journey-section';section.dataset.journeyCalls='1';section.innerHTML='<div class="journey-section-head"><h3>مكالمات تحتاج متابعة</h3><span>'+unresolved.length.toLocaleString('en-US')+'</span></div>'+(unresolved.length?unresolved.map(function(c){var label=c.patient_name||c.caller||'رقم غير معروف';return '<article class="journey-alert"><div><strong>'+esc(label)+'</strong><p>مكالمة فائتة · '+tm(c.started_at)+(c.caller?' · '+esc(c.caller):'')+'</p></div><button type="button" class="btn btn-primary" data-resolve-call="'+esc(c.id)+'">تمت المتابعة</button></article>';}).join(''):'<p class="journey-empty">لا توجد مكالمات فائتة تحتاج متابعة.</p>');host.appendChild(section);section.querySelectorAll('[data-resolve-call]').forEach(function(btn){btn.onclick=function(){btn.disabled=true;rpc('clinic_reception_call_command_live',{p_action:'resolve',p_call:btn.dataset.resolveCall,p_token:crypto.randomUUID()}).then(function(){load(true);}).catch(function(e){btn.disabled=false;if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(e.message||'تعذر تحديث المكالمة','error');});};});}
function load(force){if(busy||!window.SSMPDDb||!window.SSMPDDb.client||!target())return;var d=day()||'';var key=d+':'+Math.floor(Date.now()/15000);if(!force&&key===lastKey)return;lastKey=key;busy=true;rpc('clinic_reception_calls_snapshot_live',{p_day:d||null}).then(render).catch(function(){}).finally(function(){busy=false;});}
function start(){if(timer)return;timer=setInterval(load,3000);load(true);document.addEventListener('change',function(e){if(e.target&&e.target.matches('[data-journey-day]'))setTimeout(function(){load(true);},100);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
