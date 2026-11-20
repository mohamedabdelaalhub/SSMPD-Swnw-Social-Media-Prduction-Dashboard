/* SWNW — dental / physio nurse DRAFTS and the case doctor's approval (mockup screen 5).
   Talks only to the public.clinical_drafts RPC. A draft never reaches the official report until the doctor approves. */
(function(){
'use strict';
if(window.__SWNWClinicalDraftsV1)return;
window.__SWNWClinicalDraftsV1=true;
var S=null,modal=null,rev={items:null,timer:null,ctx:null,loading:false,countAt:0};
var KIND={dental:'مساعدة أسنان',physio:'ممرضة علاج طبيعي'};
var STATUS={draft:['مسودة','b'],pending_review:['مسودة — بانتظار اعتماد الدكتور','a'],approved:['اتعتمدت','g'],returned:['رجعت للتعديل','r']};
var PROCS=[['أسنان كبار',[['exam','كشف عادي'],['xray','أشعة مطلوبة'],['filling','حشو'],['root_canal','حشو عصب'],['crown_impression','مقاسات طربوش (تاج)'],['crown_fit','تركيب طربوش'],['ortho_fixed','تقويم ثابت'],['extraction','خلع'],['extraction_surgical','خلع جراحي'],['extraction_roots','خلع جذور'],['implant','زراعة'],['scaling','تنضيف جير وتلميع']]],
 ['أسنان أطفال',[['ped_pulpotomy','حشو عصب أطفال (ضرس لبني)'],['ped_mta','حشو عصب أطفال لسن دائم جذوره لسه ما اكتملتش (MTA)'],['space_maintainer','حافظ مسافات'],['crown_stainless','كراون ستانلس'],['crown_zirconia','كراون زيركون (للأسنان الأمامية)'],['laser_filling','حشو ليزر'],['ortho_removable','تقويم متحرك (أطفال)'],['ped_front_extraction','خلع أسنان أمامية أطفال']]]];
var KIDS=PROCS[1][1].map(function(x){return x[0];});
var MATERIAL=['root_canal','crown_impression','crown_fit','crown_stainless','crown_zirconia','ped_pulpotomy','ped_mta'];
var TREAT=['Cryo','Tense','RF','Manual','حجامة (Cupping)','Recovery','Laser','Compression','Ultra Sound','Infra Red'];
var FIELDS={tooth:'السن',procedure:'الإجراء',procedure_label:'الإجراء',pediatric:'أسنان أطفال',material:'الماتريال / الخامة',extraction_site:'مكان السن المخلوع',radiograph_needed:'أشعة مطلوبة',notes:'ملاحظات الجلسة',plan:'الخطة',area:'مكان العلاج',treatments:'العلاج',duration:'المدة'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
function tm(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'';}
function ago(v){if(!v)return '';var m=Math.max(0,Math.round((Date.now()-new Date(v).getTime())/60000));if(m<1)return 'من دلوقتي';if(m<60)return 'من '+m+' دقيقة';return 'من '+Math.round(m/60)+' ساعة';}
function rpc(action,payload){return window.SSMPDDb.client.rpc('clinical_drafts',{p_action:action,p_payload:payload||{}}).then(function(r){if(r.error)throw r.error;return r.data;});}
function procLabel(code){var out='';PROCS.forEach(function(g){g[1].forEach(function(p){if(p[0]===code)out=p[1];});});return out;}
function css(){if(document.getElementById('cd-style'))return;var s=document.createElement('style');s.id='cd-style';s.textContent=
'.cd-modal{position:fixed;inset:0;z-index:9999;background:rgba(22,33,46,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:12px;font-family:"Hiragino Kaku","BigVesta Arabic",system-ui,Tahoma,sans-serif;color:#16212E}.cd-modal *{box-sizing:border-box}'+
'.cd-box{background:#fff;border-radius:16px;padding:16px;width:min(620px,100%);margin:auto;display:grid;gap:12px;min-width:0}.cd-box.wide{width:min(1040px,100%)}'+
'.cd-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.cd-card{border:1px solid #D5DEEE;border-radius:14px;padding:14px;display:grid;gap:10px;min-width:0;background:#fff}.cd-card.lock{background:#F8F9FB}'+
'.cd-card h3,.cd-card h4{margin:0;color:#0F369D}.cd-hd{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}.cd-sub{font-size:12px;color:#5b6577}'+
'.cd-chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#F2F4F7;color:#3B4658}.cd-chip.b{background:#EEF3FF;color:#0F369D}.cd-chip.a{background:#FFF6E5;color:#8A5A00}.cd-chip.g{background:#E6F2EC;color:#2F7D5C}.cd-chip.r{background:#FBE9E6;color:#D0402A}.cd-tag{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;background:#FDEEE7;color:#C2410C}'+
'.cd-f{display:grid;gap:6px;min-width:0}.cd-f>label,.cd-lb{font-size:12px;color:#5b6577;font-weight:600}.cd-in,.cd-ta,.cd-sel{width:100%;border:1px solid #BFCBE3;border-radius:12px;padding:8px 12px;font:inherit;background:#fff;color:#16212E;min-height:44px}.cd-ta{min-height:84px;resize:vertical;line-height:1.7}.cd-in:disabled,.cd-ta:disabled,.cd-sel:disabled{background:#F2F4F7;opacity:1;color:#16212E}'+
'.cd-g2{display:grid;grid-template-columns:1fr 2fr;gap:10px}.cd-ck{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #E6E8EE;border-radius:12px;font-weight:600}.cd-ck input{width:22px;height:22px;margin:0;accent-color:#0F369D;flex:none}'+
'.cd-chips{display:flex;gap:8px;flex-wrap:wrap}.cd-cc{border:1px solid #BFCBE3;border-radius:99px;padding:8px 14px;font:inherit;font-weight:600;background:#fff;color:#3B4658;cursor:pointer;min-height:40px}.cd-cc.on{background:#0F369D;border-color:#0F369D;color:#fff}.cd-cc:disabled{cursor:default;opacity:.7}'+
'.cd-btns{display:flex;gap:8px;flex-wrap:wrap}.cd-btn{border:1px solid #0F369D;background:#fff;color:#0F369D;border-radius:12px;padding:8px 16px;font:inherit;font-weight:700;cursor:pointer;min-height:44px}.cd-btn.p{background:#0F369D;color:#fff}.cd-btn.g{background:#2F7D5C;border-color:#2F7D5C;color:#fff}.cd-btn.r{border-color:#D0402A;color:#D0402A}.cd-btn.gh{border-color:#D5DEEE;color:#3B4658}.cd-btn:disabled{opacity:.5;cursor:default}'+
'.cd-ban{border-radius:12px;padding:10px 12px;font-weight:600;font-size:13px;line-height:1.7}.cd-ban.r{background:#FBE9E6;color:#D0402A;border:1px solid #F2B8AE}.cd-ban.a{background:#FFF6E5;color:#8A5A00;border:1px solid #F0D9A5}'+
'.cd-log{list-style:none;margin:0;padding:0;display:grid;gap:8px}.cd-log li{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.7}.cd-log i{width:10px;height:10px;border-radius:50%;background:#0F369D;flex:none;margin-top:8px}.cd-log i.o{background:#F15A22}.cd-log i.g{background:#2F7D5C}'+
'.cd-list{display:grid;gap:8px}.cd-row{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;border:1px solid #D5DEEE;border-radius:12px;padding:10px 12px;background:#fff;font:inherit;color:inherit;text-align:right;cursor:pointer;width:100%;min-height:48px}.cd-row b{display:block;overflow-wrap:anywhere}.cd-empty{text-align:center;color:#5b6577;padding:18px}'+
'.cd-badge{display:inline-block;margin-inline-start:8px;min-width:22px;padding:0 7px;border-radius:99px;background:#F15A22;color:#fff;font-size:12px;font-weight:700;text-align:center}'+
'@media(max-width:820px){.cd-cols{grid-template-columns:1fr}.cd-g2{grid-template-columns:1fr}.cd-btns .cd-btn{flex:1 1 140px}}';
document.head.appendChild(s);}
function close(){if(modal){modal.remove();modal=null;}S=null;}
function ro(){if(!S)return true;if(S.mode==='review')return !S.editing;return S.d.status==='pending_review'||S.d.status==='approved';}
function chip(status){var s=STATUS[status]||STATUS.draft;return '<span class="cd-chip '+s[1]+'" data-cd-status>'+s[0]+'</span>';}
function fieldsHtml(){var c=S.c,dis=ro()?' disabled':'';
 if(S.d.kind==='physio'){var tr=c.treatments||[];
  return '<div class="cd-f"><label for="cd-area">مكان العلاج</label><input class="cd-in" id="cd-area" data-cf="area" value="'+esc(c.area||'')+'"'+dis+'></div>'+
  '<div class="cd-f"><span class="cd-lb">العلاج المستخدم</span><div class="cd-chips">'+TREAT.map(function(t){return '<button type="button" class="cd-cc'+(tr.indexOf(t)>=0?' on':'')+'" data-cd="treat" data-t="'+esc(t)+'"'+dis+'>'+esc(t)+'</button>';}).join('')+'</div></div>'+
  '<div class="cd-f"><label for="cd-dur">المدة (بالدقائق)</label><input class="cd-in" id="cd-dur" type="number" inputmode="numeric" min="0" data-cf="duration" value="'+esc(c.duration||'')+'"'+dis+'></div>'+
  '<div class="cd-f"><label for="cd-notes">ملاحظات الجلسة</label><textarea class="cd-ta" id="cd-notes" data-cf="notes"'+dis+'>'+esc(c.notes||'')+'</textarea></div>';}
 var p=c.procedure||'',mat=MATERIAL.indexOf(p)>=0,site=p==='space_maintainer';
 return '<div class="cd-g2"><div class="cd-f"><label for="cd-tooth">السن</label><input class="cd-in" id="cd-tooth" data-cf="tooth" placeholder="36 — سفلي أيمن" value="'+esc(c.tooth||'')+'"'+dis+'></div>'+
  '<div class="cd-f"><label for="cd-proc">الإجراء</label><select class="cd-sel" id="cd-proc" data-cf="procedure"'+dis+'><option value="">اختار الإجراء</option>'+PROCS.map(function(g){return '<optgroup label="'+g[0]+'">'+g[1].map(function(x){return '<option value="'+x[0]+'"'+(p===x[0]?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</optgroup>';}).join('')+'</select></div></div>'+
  (c.radiograph_needed?'<div><span class="cd-tag">أشعة مطلوبة</span></div>':'')+
  '<label class="cd-ck"><input type="checkbox" data-cf="pediatric"'+(c.pediatric?' checked':'')+dis+'> أسنان أطفال (لبنية)</label>'+
  '<label class="cd-ck"><input type="checkbox" data-cf="radiograph_needed"'+(c.radiograph_needed?' checked':'')+dis+'> أشعة مطلوبة</label>'+
  (mat?'<div class="cd-f"><label for="cd-mat">الماتريال / الخامة</label><input class="cd-in" id="cd-mat" data-cf="material" placeholder="مثال: MTA — بتختلف من حالة لحالة" value="'+esc(c.material||'')+'"'+dis+'></div>':'')+
  (site?'<div class="cd-f"><label for="cd-site">مكان السن المخلوع</label><input class="cd-in" id="cd-site" data-cf="extraction_site" placeholder="اكتب مكان السن" value="'+esc(c.extraction_site||'')+'"'+dis+'></div>':'')+
  '<div class="cd-f"><label for="cd-notes">ملاحظات الجلسة</label><textarea class="cd-ta" id="cd-notes" data-cf="notes"'+dis+'>'+esc(c.notes||'')+'</textarea></div>'+
  '<div class="cd-f"><label for="cd-plan">الخطة</label><textarea class="cd-ta" id="cd-plan" data-cf="plan"'+dis+'>'+esc(c.plan||'')+'</textarea></div>';}
function noCase(){return S.d.no_case_doctor?'<div class="cd-ban a" data-cd-nocase>الدكتور ده مالوش حساب مربوط — الاعتماد عند دكتور القسم أو الإدارة</div>':'';}
function logHtml(){var rows=(S.log||[]).map(function(l){var who=esc(l.actor||''),t=tm(l.at),f=fieldsText(l.changed_fields),cls='',txt='';
  if(l.action==='create'){txt='كتبه: '+who;}else if(l.action==='edit'){txt='عدّل: '+who+(f?' · خانة ('+f+')':'');}else if(l.action==='submit'){txt='بعته للدكتور: '+who;}
  else if(l.action==='return'){cls='o';txt='رجّعه للتعديل: '+who+(l.reason?' · السبب: '+esc(l.reason):'');}
  else if(l.action==='edit_by_doctor'){cls='o';txt='راجعه: '+who+(f?' · عدّل خانة ('+f+')':'');}
  else if(l.action==='approve'){cls='g';txt='اعتمد: '+who;}else txt=esc(l.action)+': '+who;
  return '<li><i class="'+cls+'"></i><span>'+txt+(t?' · '+t:'')+'</span></li>';}).join('');
 return '<section class="cd-card" data-cd-log><h4>سجل المراجعة</h4>'+(rows?'<ul class="cd-log">'+rows+'</ul>':'<p class="cd-sub">لسه مفيش سجل</p>')+'</section>';}
function fieldsText(arr){if(!arr||!arr.length)return '';var seen={},out=[];arr.forEach(function(k){var l=FIELDS[k]||k;if(!seen[l]){seen[l]=1;out.push(l);}});return esc(out.join('، '));}
function head(title,sub){return '<div class="cd-hd"><div><div class="cd-sub">'+esc(sub||'')+'</div><h3>'+title+'</h3></div><div class="cd-btns">'+chip(S.d.status)+'<button type="button" class="cd-btn gh" data-cd="close">إغلاق</button></div></div>';}
function formHtml(){var locked=ro(),st=S.d.status;
 return '<section class="cd-card'+(locked?' lock':'')+'" data-cd-form>'+head('مسودة الجلسة — '+KIND[S.d.kind],S.label||S.d.patient_name||'')+
  (st==='returned'&&S.d.return_reason?'<div class="cd-ban r" data-cd-return>الدكتور رجّعها للتعديل: '+esc(S.d.return_reason)+'</div>':'')+noCase()+fieldsHtml()+
  (st==='approved'?'<div><span class="cd-chip g">معتمد ومقفول</span></div>':'<div class="cd-btns"><button type="button" class="cd-btn" data-cd="save"'+(locked?' disabled':'')+'>حفظ مسودة</button><button type="button" class="cd-btn p" data-cd="send"'+(locked?' disabled':'')+'>إرسال للدكتور</button></div>')+
  '<p class="cd-sub">لحد ما الدكتور يعتمد، النص مش بيدخل الملف الرسمي</p></section>';}
function reviewHtml(){var st=S.d.status,done=st==='approved';
 var left='<section class="cd-card'+(S.editing?'':' lock')+'" data-cd-form>'+head('مراجعة الدكتور — '+KIND[S.d.kind],(S.d.patient_name||'')+(S.d.author?' · كتبته '+S.d.author:''))+noCase()+fieldsHtml()+'</section>';
 var right='<section class="cd-card" data-cd-decide>'+(done?'<div><span class="cd-chip g">معتمد ومقفول</span></div><p class="cd-sub">النص المعتمد مقفول ومحدش يقدر يعدّله. أي تصحيح بعد كده بيتسجل كإضافة جديدة باسم الدكتور.</p>':
  '<h4>قرارك</h4><div class="cd-f"><label for="cd-reason">سبب الرجوع للتعديل (إجباري لو هترجّعه)</label><textarea class="cd-ta" id="cd-reason" data-cd-reason placeholder="اكتب اللي محتاج يتعدّل"></textarea></div>'+
  '<div class="cd-btns">'+(S.editing?'<button type="button" class="cd-btn g" data-cd="approve_edit">اعتماد التعديل</button>':'<button type="button" class="cd-btn g" data-cd="approve">اعتماد</button><button type="button" class="cd-btn p" data-cd="edit">تعديل واعتماد</button>')+'<button type="button" class="cd-btn r" data-cd="return">رجّعه للتعديل</button></div>')+'</section>';
 return '<div class="cd-cols"><div>'+left+'</div><div style="display:grid;gap:12px">'+right+logHtml()+'</div></div>';}
function draw(){if(!modal||!S)return;var top=modal.scrollTop;modal.innerHTML='<div class="cd-box'+(S.mode==='review'?' wide':'')+'">'+(S.mode==='review'?reviewHtml():formHtml()+(S.log&&S.log.length?logHtml():''))+'</div>';modal.scrollTop=top;}
function sync(){if(!modal||!S||ro())return;modal.querySelectorAll('[data-cf]').forEach(function(e){var k=e.dataset.cf;S.c[k]=e.type==='checkbox'?e.checked:e.value;});}
function content(){var c=S.c,o;
 if(S.d.kind==='physio')return {area:String(c.area||'').trim(),treatments:(c.treatments||[]).slice(),duration:String(c.duration||'').trim(),notes:String(c.notes||'').trim()};
 var p=c.procedure||'';
 return {tooth:String(c.tooth||'').trim(),procedure:p,procedure_label:procLabel(p),pediatric:!!c.pediatric,material:MATERIAL.indexOf(p)>=0?String(c.material||'').trim():'',extraction_site:p==='space_maintainer'?String(c.extraction_site||'').trim():'',radiograph_needed:!!c.radiograph_needed,notes:String(c.notes||'').trim(),plan:String(c.plan||'').trim()};}
function empty(o){return !Object.keys(o).some(function(k){var v=o[k];return Array.isArray(v)?v.length:(v===true||(typeof v==='string'&&v!==''));});}
function done(){window.dispatchEvent(new CustomEvent('swnw-drafts-changed'));}
function reload(){return rpc('get',{id:S.d.id}).then(function(r){if(!S)return;var d=r.draft||{};S.d=d;S.c=JSON.parse(JSON.stringify(d.content||{}));S.log=r.log||[];S.editing=false;draw();});}
function busy(on){S.busy=on;if(modal)modal.querySelectorAll('button').forEach(function(b){if(on)b.disabled=true;});}
function save(submit){if(!S||S.busy||ro())return;sync();var c=content();if(submit&&empty(c)){toast('اكتب بيانات الجلسة الأول','error');return;}
 var p={kind:S.d.kind,patient_id:S.d.patient_id,content:c,submit:!!submit};if(S.d.id)p.id=S.d.id;if(S.d.appointment_id)p.appointment_id=S.d.appointment_id;busy(true);
 rpc('save',p).then(function(r){toast(submit?'اتبعتت للدكتور':'اتحفظت المسودة');done();if(submit){close();return;}S.busy=false;S.d.id=r.id;S.d.status=r.status||S.d.status;S.c=c;draw();}).catch(function(e){if(S){S.busy=false;draw();}toast((e&&e.message)||'تعذر حفظ المسودة','error');});}
function decide(kind){if(!S||S.busy)return;var p={id:S.d.id};
 if(kind==='return'){var r=modal.querySelector('[data-cd-reason]'),why=r?String(r.value).trim():'';if(!why){toast('اكتب سبب الرجوع للتعديل','error');return;}p.reason=why;}
 if(kind==='approve_edit'){sync();p.content=content();}
 busy(true);rpc(kind==='return'?'return':'approve',p).then(function(){toast(kind==='return'?'اتبعتت للتعديل':'اتعتمدت');done();if(kind==='return'){close();return;}S.busy=false;return reload();}).catch(function(e){if(S){S.busy=false;draw();}toast((e&&e.message)||'تعذر تنفيذ القرار','error');});}
function onClick(e){var b=e.target.closest('[data-cd]');if(e.target===modal){close();return;}if(!b||!S)return;var k=b.dataset.cd;
 if(k==='close')close();else if(k==='save')save(false);else if(k==='send')save(true);
 else if(k==='treat'){if(ro())return;var t=b.dataset.t,a=S.c.treatments=S.c.treatments||[],i=a.indexOf(t);if(i>=0)a.splice(i,1);else a.push(t);b.classList.toggle('on',i<0);}
 else if(k==='edit'){S.editing=true;draw();}
 else if(k==='approve'||k==='approve_edit'||k==='return')decide(k);}
function onChange(e){var t=e.target;if(!S||!t.dataset||t.dataset.cf!=='procedure')return;sync();var p=S.c.procedure||'';if(KIDS.indexOf(p)>=0)S.c.pediatric=true;if(p==='xray')S.c.radiograph_needed=true;draw();}
function show(state){css();if(modal)modal.remove();S=state;modal=document.createElement('div');modal.className='cd-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.dataset.cdModal='1';modal.addEventListener('click',onClick);modal.addEventListener('change',onChange);document.body.appendChild(modal);draw();}
function fresh(o,d){d=d||{};return {mode:'form',editing:false,busy:false,label:o.patientLabel||'',d:{id:d.id||null,kind:d.kind||o.kind,status:d.status||'draft',patient_id:d.patient_id||o.patientId,appointment_id:d.appointment_id||o.appointmentId||null,return_reason:d.return_reason||null,no_case_doctor:!!d.no_case_doctor},c:JSON.parse(JSON.stringify(d.content||{})),log:[]};}
function open(o){o=o||{};if(!o.kind||!KIND[o.kind]){toast('نوع المسودة مش معروف','error');return Promise.resolve();}
 if(!o.patientId){toast('الملف مش مربوط بالأرشيف','error');return Promise.resolve();}
 var p=o.appointmentId?rpc('list_mine',{appointment_id:o.appointmentId}).then(function(r){var l=((r&&r.drafts)||[]).filter(function(d){return d.kind===o.kind;});return l.filter(function(d){return d.status==='draft'||d.status==='returned';})[0]||l[0]||null;}):Promise.resolve(null);
 return p.then(function(d){show(fresh(o,d));}).catch(function(e){toast((e&&e.message)||'تعذر فتح المسودة','error');});}
function openDraft(id){return rpc('get',{id:id}).then(function(r){var d=r.draft||{};var s=fresh({kind:d.kind,patientId:d.patient_id,appointmentId:d.appointment_id,patientLabel:d.patient_name},d);s.log=r.log||[];s.d.patient_name=d.patient_name;s.d.author=d.author;
  if(d.can_review&&(d.status==='pending_review'||d.status==='approved'))s.mode='review';show(s);}).catch(function(e){toast((e&&e.message)||'تعذر فتح المسودة','error');});}
/* ---------------- doctor section «مسودات للمراجعة» */
function isReviewer(){var R=window.SSMPDRoles,A=window.SSMPDAuth;if(!R||!A||!A.currentAdmin||!R.hasAnyRole)return false;return R.hasAnyRole(A.currentAdmin,['sono_doctor','super_admin','general_manager']);}
function isTrial(c){return !!(c&&c.data&&c.data.workspace&&c.data.workspace.mode==='trial');}
function setBadge(){var n=(rev.items||[]).length;document.querySelectorAll('[data-rx-section="clinical-drafts"] .cd-badge').forEach(function(b){b.textContent=n;b.hidden=!n;});}
function revHtml(){var l=rev.items;if(!l)return '<p class="cd-empty">جاري التحميل…</p>';if(!l.length)return '<p class="cd-empty">مفيش مسودات مستنية مراجعتك</p>';
 return '<div class="cd-list">'+l.map(function(d){return '<button type="button" class="cd-row" data-cdr="open" data-id="'+esc(d.id)+'"><span class="cd-chip '+(d.kind==='dental'?'a':'b')+'">'+(d.kind==='dental'?'أسنان':'علاج طبيعي')+'</span><span><b>'+esc(d.patient_name||'')+'</b><span class="cd-sub">كتبتها '+esc(d.author||'')+' · '+esc(ago(d.submitted_at))+'</span></span><span class="cd-sub">'+tm(d.submitted_at)+'</span></button>';}).join('')+'</div>';}
function paintRev(){var r=document.querySelector('[data-cdr-root]');if(r)r.innerHTML='<div class="cd-card"><h3>مسودات للمراجعة <span class="cd-badge"'+((rev.items||[]).length?'':' hidden')+'>'+(rev.items||[]).length+'</span></h3>'+revHtml()+'</div>';setBadge();}
function loadRev(){if(rev.loading)return Promise.resolve();rev.loading=true;return rpc('list_review',{}).then(function(r){rev.items=(r&&r.drafts)||[];paintRev();}).catch(function(e){if(!rev.items){rev.items=[];paintRev();}}).then(function(){rev.loading=false;rev.countAt=Date.now();});}
function mountRev(){var r=document.querySelector('[data-cdr-root]');if(!r)return;css();if(!r.__cdWired){r.__cdWired=true;r.addEventListener('click',function(e){var b=e.target.closest('[data-cdr="open"]');if(b)openDraft(b.dataset.id);});}
 paintRev();loadRev();if(!rev.timer)rev.timer=setInterval(function(){if(!document.querySelector('[data-cdr-root]')){clearInterval(rev.timer);rev.timer=null;return;}if(!document.hidden)loadRev();},20000);}
window.addEventListener('swnw-drafts-changed',function(){if(rev.ctx)loadRev();});
function install(){var base=window.SSMPDReceptionModules;if(!base){setTimeout(install,120);return;}if(base.__swnwDraftsWrapped)return;
 var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
 wrapped.sections=function(c){var rows=base.sections?base.sections(c):[];if(!isTrial(c)&&isReviewer()){css();rev.ctx=c;if(Date.now()-rev.countAt>20000){rev.countAt=Date.now();loadRev();}
   if(!rows.some(function(x){return x[0]==='clinical-drafts';})){var n=(rev.items||[]).length;rows=rows.concat([['clinical-drafts','مسودات للمراجعة <span class="cd-badge"'+(n?'':' hidden')+'>'+n+'</span>','مسودات الأسنان والعلاج الطبيعي اللي مستنية اعتمادك']]);}}return rows;};
 wrapped.panel=function(section,c){if(section==='clinical-drafts'){rev.ctx=c;if(isTrial(c)||!isReviewer())return '';setTimeout(mountRev,0);return '<div data-cdr-root></div>';}return base.panel?base.panel(section,c):'';};
 wrapped.__swnwDraftsWrapped=true;window.SSMPDReceptionModules=wrapped;}
install();
window.SWNWClinicalDrafts={open:open,openDraft:openDraft};
})();
