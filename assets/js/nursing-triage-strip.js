/* SWNW Today Operations — «الفحص قبل الكشف» strip for doctors, nurses and managers.
   Adds a strip to the opened appointment details; loads the triage lazily via clinic_reception_nursing. Skips trial mode. */
(function(){
'use strict';
if(window.__SWNWNursingTriageStripV1)return;
window.__SWNWNursingTriageStripV1=true;
var ctx=null,cache={},pending={},observer=null,scheduled=false;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function tm(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'';}
function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
function ws(){return ctx&&ctx.workspace;}
function trial(){return !!(ctx&&ctx.data&&ctx.data.workspace&&ctx.data.workspace.mode==='trial');}
function allowed(){var R=window.SSMPDRoles,A=window.SSMPDAuth;if(!R||!A||!A.currentAdmin||!R.hasAnyRole)return false;return R.hasAnyRole(A.currentAdmin,['sono_doctor','nursing','head_nursing','super_admin','general_manager']);}
function canConfirm(){var R=window.SSMPDRoles,A=window.SSMPDAuth;return !!(R&&A&&A.currentAdmin&&R.hasAnyRole(A.currentAdmin,['sono_doctor','super_admin','general_manager']));}
function q(action,payload){return window.SSMPDDb.client.rpc('clinic_reception_nursing',{p_workspace:ws(),p_action:action,p_payload:payload||{}}).then(function(r){if(r.error)throw r.error;return r.data;});}
function css(){if(document.getElementById('nts-style'))return;var s=document.createElement('style');s.id='nts-style';s.textContent=
'.nts{background:#EEF3FF;border:1px solid #C9D6F3;border-radius:14px;padding:12px;margin:8px 0;color:#16212E;min-width:0}.nts h5{margin:0;color:#0F369D;font-size:14px}'+
'.nts-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.nts-tile{background:#fff;border:1px solid #D5DEEE;border-radius:12px;padding:8px;text-align:center}.nts-tile small{display:block;color:#5b6577;font-size:11px}.nts-tile b{display:block;font-size:17px;color:#0F369D}.nts-tile em{font-style:normal;font-size:11px;color:#5b6577}'+
'.nts-tile.w{background:#FFF6E5;border-color:#F0C36A}.nts-tile.w b,.nts-tile.w em{color:#8A5A00}.nts-chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#EEF3FF;color:#0F369D;border:1px solid #C9D6F3;margin:2px}'+
'.nts-row{margin-top:10px;font-size:13px;line-height:1.8;overflow-wrap:anywhere}.nts-row small{display:block;color:#5b6577;font-size:11px}.nts-alg{margin-top:10px;background:#FBE9E6;color:#D0402A;border-radius:12px;padding:8px 12px;font-weight:700;font-size:13px}'+
'.nts-btn{margin-top:10px;min-height:44px;border:1px solid #0F369D;background:#0F369D;color:#fff;border-radius:12px;padding:6px 14px;font:inherit;font-weight:600;cursor:pointer}.nts-btn:disabled{opacity:.5}';
document.head.appendChild(s);}
function tile(label,val,unit,warn,flag){return '<div class="nts-tile'+(warn?' w':'')+'"><small>'+label+'</small><b>'+esc(val)+'</b><em>'+(warn?flag:unit)+'</em></div>';}
function flags(t){var f={};if(t.bp_sys!=null&&t.bp_dia!=null){if(t.bp_sys>=140||t.bp_dia>=90)f.bp='مرتفع';else if(t.bp_sys<90||t.bp_dia<60)f.bp='منخفض';}
 if(t.pulse!=null){if(t.pulse>100)f.pulse='سريع';else if(t.pulse<50)f.pulse='بطيء';}
 if(t.spo2!=null&&t.spo2<94)f.spo2='منخفض';if(t.temp_c!=null&&Number(t.temp_c)>=38)f.temp='مرتفعة';
 if(t.sugar_mgdl!=null){if(t.sugar_mgdl>180)f.sugar='مرتفع';else if(t.sugar_mgdl<70)f.sugar='منخفض';}return f;}
function stripHtml(t,id){var f=flags(t),has=function(v){return v!=null&&v!=='';},tiles='';
 if(has(t.bp_sys)&&has(t.bp_dia))tiles+=tile('ضغط الدم',t.bp_sys+'/'+t.bp_dia,'',!!f.bp,f.bp);
 if(has(t.pulse))tiles+=tile('النبض',t.pulse,'نبضة/د',!!f.pulse,f.pulse);
 if(has(t.temp_c))tiles+=tile('الحرارة',t.temp_c,'°م',!!f.temp,f.temp);
 if(has(t.spo2))tiles+=tile('الأكسجين',t.spo2,'٪',!!f.spo2,f.spo2);
 if(has(t.weight_kg))tiles+=tile('الوزن',t.weight_kg,'كجم',false);
 if(has(t.sugar_mgdl))tiles+=tile('سكر الدم',t.sugar_mgdl,'mg/dL',!!f.sugar,f.sugar);
 var dis=(t.chronic_diseases||[]).slice();if(t.chronic_other)dis.push(t.chronic_other);
 return '<div class="nts" data-nts="'+esc(id)+'"><h5>الفحص قبل الكشف — سجّلته '+esc(t.nurse_name||'التمريض')+(t.recorded_at?' الساعة '+tm(t.recorded_at):'')+'</h5>'+(t.status==='draft'?'<div class="nts-row"><small>مسودة — لسه ماتبلّغش للدكتور</small></div>':'')+
 (tiles?'<div class="nts-tiles">'+tiles+'</div>':'')+
 (dis.length?'<div class="nts-row"><small>أمراض مزمنة</small>'+dis.map(function(d){return '<span class="nts-chip">'+esc(d)+'</span>';}).join('')+'</div>':'')+
 (t.on_chronic_meds&&t.chronic_meds?'<div class="nts-row"><small>أدوية مستمرة</small>'+esc(t.chronic_meds)+'</div>':'')+
 (t.recent_surgery&&t.surgery_note?'<div class="nts-row"><small>عمليات مؤخرًا</small>'+esc(t.surgery_note)+'</div>':'')+
 (t.allergies?'<div class="nts-alg">حساسية: '+esc(t.allergies)+'</div>':'')+
 (t.chief_complaint?'<div class="nts-row"><small>الشكوى الرئيسية</small>«'+esc(t.chief_complaint)+'»</div>':'')+
 (t.nursing_note?'<div class="nts-row"><small>ملاحظات التمريض</small>'+esc(t.nursing_note)+'</div>':'')+
 (canConfirm()&&t.status==='recorded'&&(t.chronic_diseases||[]).length&&!t.profile_confirmed_at?'<button type="button" class="nts-btn" data-nts-confirm="'+esc(id)+'">تأكيد نقل الأمراض المزمنة للملف الطبي</button>':'')+'</div>';}
function place(card,id,t){var old=card.querySelector('[data-nts]');if(old)old.remove();if(!t)return;var det=card.querySelector('.journey-card-detail');if(!det)return;var div=document.createElement('div');div.innerHTML=stripHtml(t,id);var el=div.firstChild;var actions=det.querySelector('.journey-card-actions');if(actions)det.insertBefore(el,actions);else det.appendChild(el);
 var b=el.querySelector('[data-nts-confirm]');if(b)b.onclick=function(){if(b.disabled)return;b.disabled=true;q('triage_confirm_profile',{appointment_id:id}).then(function(r){toast('اتنقل '+((r&&r.added)||0)+' مرض للملف الطبي');delete cache[id];return load(card,id);}).catch(function(e){b.disabled=false;toast((e&&e.message)||'تعذر التأكيد','error');});};}
function load(card,id){if(pending[id])return pending[id];pending[id]=q('triage_get',{appointment_id:id}).then(function(r){cache[id]=(r&&r.triage)||null;}).catch(function(){cache[id]=null;}).then(function(){delete pending[id];if(card.isConnected&&card.classList.contains('is-open'))place(card,id,cache[id]);});return pending[id];}
function scan(){scheduled=false;if(!ctx||!ws()||trial()||!allowed())return;document.querySelectorAll('.journey-board .journey-card.is-open[data-appointment]').forEach(function(card){var id=card.dataset.appointment;if(card.querySelector('[data-nts]'))return;css();if(id in cache&&cache[id]!==undefined&&cache[id]!==null){place(card,id,cache[id]);return;}if(id in cache)return;load(card,id);});}
function schedule(){if(scheduled)return;scheduled=true;setTimeout(scan,0);}
function install(){var base=window.SSMPDReceptionModules;if(!base){setTimeout(install,120);return;}if(base.__swnwStripWrapped)return;
 var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
 wrapped.panel=function(section,c){if(section==='journey'){ctx=c;cache={};}var h=base.panel?base.panel(section,c):'';schedule();return h;};wrapped.__swnwStripWrapped=true;window.SSMPDReceptionModules=wrapped;
 observer=new MutationObserver(function(){schedule();});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});}
install();
window.__SWNWNursingStripTest={scan:scan,setContext:function(c){ctx=c;}};
})();
