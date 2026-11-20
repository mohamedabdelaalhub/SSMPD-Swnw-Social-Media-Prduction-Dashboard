/* SWNW Reception — «تشغيل اليوم — التمريض»: today's patients per nursing section, prep checklist, pre-visit triage,
   notices, and the HR section settings. Talks only to the clinic_reception_nursing RPC. Skips trial mode. */
(function(){
'use strict';
if(window.__SWNWNursingDayOpsV1)return;
window.__SWNWNursingDayOpsV1=true;
var unlinked=null,ctx=null,data=null,notes=null,settings=null,settingsTried=false,sel=null,view=null,form=null,loading=false,busy=false,timer=null,modalId=null;
var SEC=[['physio','علاج طبيعي'],['dental','أسنان'],['general','تمريض عام']];
var PREP={dental:['كرسي الأسنان جاهز','أدوات التعقيم جاهزة','الأشعة السابقة على الشاشة'],physio:['سرير الجلسة جاهز','الأجهزة جاهزة','شرح الجلسة للمريض'],general:['جهاز الضغط والميزان جاهزين','ملف المريض مفتوح']};
var CHRONIC=['سكر','ضغط','قلب','ربو','غدة'];
var RANGES=[['bp_sys','ضغط الدم الانقباضي',40,300],['bp_dia','ضغط الدم الانبساطي',20,200],['pulse','النبض',20,250],['temp_c','الحرارة',30,45],['spo2','نسبة الأكسجين',50,100],['weight_kg','الوزن',1,400],['sugar_mgdl','سكر الدم',10,1000]];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function tm(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'—';}
function toast(msg,kind){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,kind||'success');}
function ws(){return ctx&&ctx.workspace;}
function trial(){return !!(ctx&&ctx.data&&ctx.data.workspace&&ctx.data.workspace.mode==='trial');}
function q(action,payload){return window.SSMPDDb.client.rpc('clinic_reception_nursing',{p_workspace:ws(),p_action:action,p_payload:payload||{}}).then(function(r){if(r.error)throw r.error;return r.data;});}
function secLabel(k){var r=SEC.filter(function(x){return x[0]===k;})[0];return r?r[1]:k;}
function root(){return document.querySelector('[data-nd-root]');}
function appt(id){return ((data&&data.appointments)||[]).filter(function(a){return a.id===id;})[0];}
function ago(v){if(!v)return '';var m=Math.max(0,Math.round((Date.now()-new Date(v).getTime())/60000));if(m<1)return 'من دلوقتي';if(m<60)return 'من '+m+' دقيقة';var h=Math.round(m/60);return 'من '+h+' ساعة';}
function statusOf(a){var qs=a.queue_status,s=a.status;if(s==='completed'||qs==='done')return ['خلص','g'];if(qs==='in_service')return ['جوه الكشف','g'];if(qs==='called')return ['جاهز للدخول','b'];if(qs==='waiting'||s==='arrived')return ['وصل — مستني','a'];return ['لسه ماوصلش',''];}
function triageChip(a){if(a.triage==='recorded')return '<span class="nd-chip g">الفحص اتسجل</span>';if(a.triage==='draft')return '<span class="nd-chip a">فحص مسودة</span>';return '';}
function css(){if(document.getElementById('nd-style'))return;var s=document.createElement('style');s.id='nd-style';s.textContent=
'.nd{display:grid;gap:12px;color:#16212E;font-family:"Hiragino Kaku","BigVesta Arabic",system-ui,Tahoma,sans-serif;min-width:0}.nd *{box-sizing:border-box}'+
'.nd-card{background:#fff;border:1px solid #D5DEEE;border-radius:16px;padding:14px;min-width:0}.nd h3,.nd h4{margin:0;color:#0F369D}.nd-sub{font-size:12px;color:#5b6577}'+
'.nd-hd{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}.nd-hd h3{font-size:20px;color:#16212E}'+
'.nd-chip{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:#F2F4F7;color:#3B4658;white-space:nowrap}.nd-chip.b{background:#EEF3FF;color:#0F369D}.nd-chip.a{background:#FFF6E5;color:#8A5A00}.nd-chip.g{background:#E6F2EC;color:#2F7D5C}.nd-chip.r{background:#FBE9E6;color:#D0402A}'+
'.nd-banner{background:#EEF3FF;border-color:#C9D6F3;color:#0F369D;font-weight:600;display:flex;gap:10px;align-items:center}.nd-banner i{width:10px;height:10px;border-radius:50%;background:#0F369D;flex:none}'+
'.nd-tabs{display:flex;gap:6px;padding:6px}.nd-tab{flex:1;border:0;border-radius:12px;padding:10px 4px;background:transparent;color:#3B4658;font:inherit;font-weight:600;cursor:pointer;display:flex;gap:6px;justify-content:center;align-items:center;min-height:44px}.nd-tab em{font-style:normal;background:#E9EDF5;border-radius:99px;padding:0 8px;font-size:12px}.nd-tab.on{background:#16212E;color:#fff}.nd-tab.on em{background:#F15A22;color:#fff}'+
'.nd-cols{display:grid;grid-template-columns:1fr 340px;gap:12px}.nd-list{display:grid;gap:10px;align-content:start;min-width:0}'+
'.nd-pc{display:grid;grid-template-columns:84px 1fr auto;gap:14px;align-items:center}.nd-tm{display:grid;gap:6px;justify-items:center}.nd-tm b{font-size:20px;color:#0F369D}.nd-tk{background:#FDEEE7;color:#C2410C;border-radius:99px;padding:1px 10px;font-size:12px;font-weight:700;white-space:nowrap}'+
'.nd-nm{font-weight:700;font-size:15px;overflow-wrap:anywhere}.nd-nm small{color:#5b6577;font-weight:400;margin-inline-start:6px;font-size:12px}.nd-sv{font-size:13px;color:#3B4658;overflow-wrap:anywhere}.nd-act{display:grid;gap:8px;justify-items:end}.nd-btns{display:flex;gap:8px;flex-wrap:wrap}'+
'.nd-btn{border:1px solid #0F369D;background:#fff;color:#0F369D;border-radius:12px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer;min-height:44px}.nd-btn.p{background:#0F369D;color:#fff}.nd-btn.gh{border-color:#D5DEEE;color:#3B4658}.nd-btn:disabled{opacity:.5;cursor:default}'+
'.nd-nt{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:start;padding:10px;border:1px solid #E6E8EE;border-radius:12px;margin-top:10px;width:100%;text-align:right;background:#fff;font:inherit;color:inherit;cursor:pointer}.nd-nt.hot{border-color:#F7B79A;background:#FFF8F4}.nd-nt .ic{width:30px;height:30px;border-radius:50%;background:#EEF3FF;border:2px solid #C9D6F3}.nd-nt.hot .ic{background:#FDEEE7;border-color:#F7B79A}.nd-nt b{display:block;font-size:13px;line-height:1.7}.nd-tap{font-size:12px;color:#C2410C;font-weight:700}'+
'.nd-ck{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #E6E8EE;border-radius:12px;margin-top:10px;font-weight:600;cursor:pointer}.nd-ck input{width:22px;height:22px;accent-color:#2F7D5C;margin:0;flex:none}'+
'.nd-prog{height:8px;background:#E9EDF5;border-radius:99px;margin-top:12px;overflow:hidden}.nd-prog i{display:block;height:100%;background:#2F7D5C}'+
'.nd-f{display:grid;gap:6px}.nd-f>label,.nd-lb{font-size:12px;color:#5b6577;font-weight:600}.nd-in,.nd-ta{width:100%;border:1px solid #BFCBE3;border-radius:12px;padding:8px 12px;font:inherit;background:#fff;color:#16212E;min-height:44px}.nd-ta{min-height:84px;resize:vertical;line-height:1.7}'+
'.nd-fg{display:grid;gap:12px;margin-top:12px}.nd-c2{grid-template-columns:1fr 1fr}.nd-c3{grid-template-columns:repeat(3,1fr)}.nd-bp{display:flex;gap:6px;align-items:center}'+
'.nd-chips{display:flex;gap:8px;flex-wrap:wrap}.nd-cc{border:1px solid #BFCBE3;border-radius:99px;padding:8px 16px;font:inherit;font-weight:600;background:#fff;color:#3B4658;cursor:pointer;min-height:40px}.nd-cc.on{background:#0F369D;border-color:#0F369D;color:#fff}'+
'.nd-fcols{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.nd-stack{display:grid;gap:12px}.nd-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.nd-bar .nd-sub{flex:1;min-width:180px}'+
'.nd-tr{display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px;align-items:center;padding:10px;border:1px solid #E6E8EE;border-radius:12px;margin-top:8px}.nd-tr select{min-height:40px;border:1px solid #BFCBE3;border-radius:10px;padding:4px 8px;font:inherit;background:#fff}.nd-tr label{display:flex;gap:8px;align-items:center}.nd-tr input[type=checkbox]{width:22px;height:22px}'+
'.nd-modal{position:fixed;inset:0;z-index:9998;background:rgba(22,33,46,.55);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:12px}.nd-modal>div{background:#fff;border-radius:16px;padding:16px;width:min(560px,100%);margin:auto;display:grid;gap:10px}'+
'.nd-empty{text-align:center;color:#5b6577;padding:18px}'+
'@media(max-width:820px){.nd-cols,.nd-fcols,.nd-c2{grid-template-columns:1fr}.nd-c3{grid-template-columns:1fr 1fr}.nd-pc{grid-template-columns:1fr}.nd-tm{display:flex;justify-items:start;align-items:center;gap:10px}.nd-act{justify-items:stretch}.nd-btns{display:grid;grid-template-columns:1fr 1fr}.nd-tr{grid-template-columns:1fr 1fr}.nd-tab{font-size:12px}}';
document.head.appendChild(s);}
function header(){var mine=data.my_section;return '<div class="nd-card nd-hd"><div><div class="nd-sub">النهارده — '+esc(data.date||'')+'</div><h3>تشغيل اليوم — التمريض</h3><div class="nd-sub">'+esc(count(sel))+' مريض في قسم '+esc(secLabel(sel))+'</div></div>'+(mine?'<span class="nd-chip b">'+esc(secLabel(mine))+'</span>':'')+'</div>';}
function count(k){return ((data&&data.appointments)||[]).filter(function(a){return a.section===k;}).length;}
function card(a){var st=statusOf(a);return '<article class="nd-card nd-pc" data-nd-card="'+esc(a.id)+'"><div class="nd-tm"><b>'+tm(a.starts_at)+'</b>'+(a.ticket_no!=null?'<span class="nd-tk">رقم '+esc(a.ticket_no)+'</span>':'')+'</div>'+
 '<div><div class="nd-nm">'+esc(a.patient_name)+'<small dir="ltr">'+esc(a.file_no||'')+'</small></div><div class="nd-sv">'+esc(a.service||'')+(a.doctor?' · '+esc(a.doctor):'')+'</div></div>'+
 '<div class="nd-act"><div class="nd-btns"><span class="nd-chip '+st[1]+'">'+st[0]+'</span>'+triageChip(a)+'</div><div class="nd-btns"><button type="button" class="nd-btn" data-nd="open_file" data-id="'+esc(a.id)+'">افتح الملف</button><button type="button" class="nd-btn p" data-nd="triage" data-id="'+esc(a.id)+'">الفحص قبل الكشف</button><button type="button" class="nd-btn gh" data-nd="details" data-id="'+esc(a.id)+'">تفاصيل</button>'+draftBtn(a)+'</div></div></article>';}
function draftBtn(a){if(a.section!=='dental'&&a.section!=='physio')return '';return '<button type="button" class="nd-btn" data-nd="draft" data-id="'+esc(a.id)+'">'+(a.section==='dental'?'مسودة جلسة الأسنان':'مسودة جلسة العلاج الطبيعي')+'</button>';}
function openDraftFor(a){var D=window.SWNWClinicalDrafts;if(!D){toast('تعذر فتح المسودة','error');return;}if(!a||(a.section!=='dental'&&a.section!=='physio'))return;D.open({kind:a.section,appointmentId:a.id,patientId:a.archive_patient_id,patientLabel:a.patient_name+(a.service?' — '+a.service:'')});}
function notesHtml(){var items=(notes&&notes.items)||[];var h='<aside class="nd-card" data-nd-notes><h4>محتاج تجهزه <span class="nd-sub">'+esc((notes&&notes.unread)||0)+' تنبيهات جديدة</span></h4>';
 if(!items.length)return h+'<p class="nd-empty">مفيش تنبيهات</p></aside>';
 return h+items.slice(0,30).map(function(n){return '<button type="button" class="nd-nt'+(n.read?'':' hot')+'" data-nd="note" data-id="'+esc(n.id)+'" data-appt="'+esc(n.appointment_id||'')+'" data-kind="'+esc(n.kind||'')+'"><span class="ic"></span><span><b>'+esc(n.title)+'</b><span class="nd-sub">من الاستقبال · '+esc(ago(n.created_at))+'</span>'+(n.read?'':'<span class="nd-tap"> اضغط يفتح ملف المريض</span>')+'</span></button>';}).join('')+'</aside>';}
function listHtml(){var secs=data.sections||[];if(!sel||secs.indexOf(sel)<0)sel=secs[0]||null;
 var tabs='<div class="nd-card nd-tabs" role="tablist">'+secs.map(function(k){return '<button type="button" role="tab" class="nd-tab'+(k===sel?' on':'')+'" data-nd="tab" data-sec="'+k+'">'+esc(secLabel(k))+' <em>'+count(k)+'</em></button>';}).join('')+'</div>';
 var rows=((data.appointments)||[]).filter(function(a){return a.section===sel;});
 return header()+'<div class="nd-card nd-banner"><i></i>بتشوف مرضى قسمك لليوم بس. كل ملف بتفتحه بيتسجل</div>'+tabs+
 '<div class="nd-cols"><div class="nd-list" data-nd-list>'+(rows.length?rows.map(card).join(''):'<p class="nd-card nd-empty">مفيش مرضى في القسم ده النهارده</p>')+'</div>'+notesHtml()+'</div>'+settingsHtml();}
function settingsHtml(){if(!settings||!settings.nurses)return '';
 var warn=(unlinked&&unlinked.length)?'<div class="nd-card" data-nd-unlinked style="background:#FFF6E5;border-color:#F0D9A5;color:#8A5A00;font-weight:600;margin-top:10px">دكاترة أسنان وعلاج طبيعي من غير حساب مربوط: الاعتماد بيروح لدكتور القسم أو الإدارة<div class="nd-sub" style="color:#8A5A00">'+unlinked.map(function(d){return esc(d.name);}).join('، ')+'</div></div>':'';
 return '<section class="nd-card" data-nd-settings><h4>توزيع التمريض على الأقسام</h4>'+warn+'<p class="nd-sub">لو ممرضة القسم مش موجودة النهارده، التمريض العام بيشوف حجوزات القسم ده</p>'+
 settings.nurses.map(function(n){var ov=n.override||'';return '<div class="nd-tr" data-nd-nurse="'+esc(n.admin_id)+'"><b>'+esc(n.name)+'</b><span class="nd-chip b">من الموارد البشرية: '+esc(secLabel(n.default_section))+'</span>'+
 '<select data-nd-ov aria-label="القسم"><option value="">من الموارد البشرية</option>'+SEC.map(function(s){return '<option value="'+s[0]+'"'+(ov===s[0]?' selected':'')+'>'+s[1]+'</option>';}).join('')+'</select>'+
 '<label><input type="checkbox" data-nd-abs'+(n.absent_today?' checked':'')+'> غايبة النهارده</label><button type="button" class="nd-btn" data-nd="save_nurse" data-id="'+esc(n.admin_id)+'">حفظ</button></div>';}).join('')+'</section>';}
function paint(){var r=root();if(!r)return;if(view==='triage'&&form){r.innerHTML='<div class="nd">'+triageHtml()+'</div>';return;}
 r.innerHTML='<div class="nd">'+(data?listHtml():'<p class="nd-card nd-empty">جاري التحميل…</p>')+'</div>';}
/* ---------------- triage form */
function val(v){return v==null?'':esc(v);}
function numIn(name,label,unit,step){return '<div class="nd-f"><label>'+label+'</label><input class="nd-in" type="number" inputmode="decimal" step="'+(step||'1')+'" name="'+name+'" value="'+val(form.t[name])+'" aria-label="'+label+(unit?' ('+unit+')':'')+'" placeholder="'+(unit||'')+'"></div>';}
function yesno(name,label,noteName,notePh){var v=form.t[name];return '<div class="nd-f"><span class="nd-lb">'+label+'</span><div class="nd-chips" data-nd-yn="'+name+'"><button type="button" class="nd-cc'+(v===true?' on':'')+'" data-nd="yn" data-name="'+name+'" data-v="1">نعم</button><button type="button" class="nd-cc'+(v===false?' on':'')+'" data-nd="yn" data-name="'+name+'" data-v="0">لا</button></div>'+(v===true?'<input class="nd-in" name="'+noteName+'" value="'+val(form.t[noteName])+'" placeholder="'+notePh+'" maxlength="500">':'')+'</div>';}
function triageHtml(){var a=form.a,t=form.t,dis=t.chronic_diseases||[],other=form.otherOn||!!t.chronic_other;
 return '<div class="nd-card nd-hd"><div><div class="nd-sub">الفحص قبل الكشف</div><h3>'+esc(a.patient_name)+'</h3><div class="nd-sub"><bdi dir="ltr">'+esc(a.file_no||'')+'</bdi> · '+esc(a.service||'')+(a.doctor?' · '+esc(a.doctor):'')+'</div></div>'+(a.ticket_no!=null?'<span class="nd-tk">رقم '+esc(a.ticket_no)+'</span>':'')+'<button type="button" class="nd-btn gh" data-nd="back">رجوع</button></div>'+
 '<form data-nd-form novalidate><div class="nd-fcols"><div class="nd-stack"><section class="nd-card"><h4>العلامات الحيوية</h4><div class="nd-fg nd-c3">'+
 '<div class="nd-f"><label>ضغط الدم</label><div class="nd-bp"><input class="nd-in" type="number" inputmode="numeric" name="bp_sys" value="'+val(t.bp_sys)+'" aria-label="ضغط الدم الانقباضي" placeholder="انقباضي"><b>/</b><input class="nd-in" type="number" inputmode="numeric" name="bp_dia" value="'+val(t.bp_dia)+'" aria-label="ضغط الدم الانبساطي" placeholder="انبساطي"></div></div>'+
 numIn('pulse','النبض','نبضة/د')+numIn('temp_c','الحرارة','°م','0.1')+numIn('spo2','نسبة الأكسجين','٪')+numIn('weight_kg','الوزن','كجم','0.1')+numIn('sugar_mgdl','سكر الدم','mg/dL')+'</div></section>'+
 '<section class="nd-card"><h4>ملاحظات التمريض</h4><div class="nd-fg"><textarea class="nd-ta" name="nursing_note" maxlength="800" aria-label="ملاحظات التمريض">'+val(t.nursing_note)+'</textarea></div></section></div>'+
 '<div class="nd-stack"><section class="nd-card"><h4>أمراض مزمنة</h4><div class="nd-fg"><div class="nd-chips">'+CHRONIC.map(function(c){return '<button type="button" class="nd-cc'+(dis.indexOf(c)>=0?' on':'')+'" data-nd="chronic" data-name="'+c+'">'+c+'</button>';}).join('')+'<button type="button" class="nd-cc'+(other?' on':'')+'" data-nd="other">أخرى</button></div>'+
 (other?'<div class="nd-f"><label>لو أخرى، اكتب هنا</label><input class="nd-in" name="chronic_other" maxlength="300" value="'+val(t.chronic_other)+'" placeholder="اكتب المرض"></div>':'')+
 yesno('on_chronic_meds','بياخد أدوية بصفة مستمرة؟','chronic_meds','اكتب الأدوية')+yesno('recent_surgery','عمل عمليات مؤخرًا؟','surgery_note','اكتب العملية')+
 '<div class="nd-f"><label>حساسية</label><input class="nd-in" name="allergies" maxlength="300" value="'+val(t.allergies)+'"></div></div></section>'+
 '<section class="nd-card"><h4>الشكوى الرئيسية</h4><div class="nd-fg"><textarea class="nd-ta" name="chief_complaint" maxlength="800" aria-label="الشكوى الرئيسية">'+val(t.chief_complaint)+'</textarea></div></section></div></div>'+
 '<div class="nd-card nd-bar" style="margin-top:12px"><span class="nd-sub">بيظهر للدكتور قبل ما المريض يدخل</span><button type="button" class="nd-btn" data-nd="save_draft">حفظ مسودة</button><button type="button" class="nd-btn p" data-nd="save_rec">حفظ وإبلاغ الدكتور</button></div></form>';}
function readForm(){var f=root().querySelector('[data-nd-form]'),e=f.elements,t=form.t,out={appointment_id:form.a.id};
 function n(k){var v=e[k]?String(e[k].value).trim():'';return v===''?null:Number(v);}
 function s(k){var v=e[k]?String(e[k].value).trim():'';return v===''?null:v;}
 RANGES.forEach(function(r){out[r[0]]=n(r[0]);});
 out.chronic_diseases=(t.chronic_diseases||[]).filter(function(c){return CHRONIC.indexOf(c)>=0;});
 out.chronic_other=form.otherOn||t.chronic_other?s('chronic_other'):null;if(!form.otherOn)out.chronic_other=null;
 out.on_chronic_meds=t.on_chronic_meds==null?null:t.on_chronic_meds;out.chronic_meds=out.on_chronic_meds?s('chronic_meds'):null;
 out.recent_surgery=t.recent_surgery==null?null:t.recent_surgery;out.surgery_note=out.recent_surgery?s('surgery_note'):null;
 out.allergies=s('allergies');out.chief_complaint=s('chief_complaint');out.nursing_note=s('nursing_note');return out;}
function syncText(){var f=root()&&root().querySelector('[data-nd-form]');if(!f||!form)return;var e=f.elements,t=form.t;['chronic_other','chronic_meds','surgery_note','allergies','chief_complaint','nursing_note','bp_sys','bp_dia','pulse','temp_c','spo2','weight_kg','sugar_mgdl'].forEach(function(k){if(e[k])t[k]=e[k].value;});}
function validate(p){for(var i=0;i<RANGES.length;i++){var r=RANGES[i],v=p[r[0]];if(v!=null&&(isNaN(v)||v<r[2]||v>r[3])){toast(r[1]+' لازم يكون بين '+r[2]+' و'+r[3],'error');return false;}}return true;}
function saveTriage(status){if(busy||!form)return;syncText();var p=readForm();if(!validate(p))return;p.status=status;busy=true;lock(true);
 q('triage_save',p).then(function(){toast(status==='draft'?'اتحفظت المسودة':'اتحفظ الفحص واتبلّغ الدكتور');var a=appt(form.a.id);if(a)a.triage=status;view=null;form=null;busy=false;return refresh(true);}).catch(function(e){busy=false;lock(false);toast((e&&e.message)||'تعذر حفظ الفحص','error');});}
function lock(on){var r=root();if(r)r.querySelectorAll('button').forEach(function(b){b.disabled=on;});}
function openTriage(id){var a=appt(id);if(!a||busy)return;closeModal();busy=true;q('triage_get',{appointment_id:id}).then(function(r){var t=(r&&r.triage)||{};t=JSON.parse(JSON.stringify(t));if(t.chronic_diseases&&t.chronic_diseases.length===undefined)t.chronic_diseases=[];form={a:a,t:t,otherOn:!!t.chronic_other};view='triage';busy=false;paint();window.scrollTo&&window.scrollTo(0,0);}).catch(function(e){busy=false;toast((e&&e.message)||'تعذر فتح الفحص','error');});}
/* ---------------- details modal (screen 2) */
function closeModal(){modalId=null;var m=document.querySelector('[data-nd-modal]');if(m)m.remove();}
function openDetails(id,title){var a=appt(id);closeModal();modalId=id;var m=document.createElement('div');m.className='nd-modal';m.dataset.ndModal=id;m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');document.body.appendChild(m);
 m.onclick=function(e){if(e.target===m){closeModal();return;}var b=e.target.closest('[data-nd]');if(!b)return;var k=b.dataset.nd;if(k==='close')closeModal();else if(k==='prep')togglePrep(b);else if(k==='open_file')openFile(b.dataset.id);else if(k==='triage')openTriage(b.dataset.id);};
 drawModal(m,a,title);}
function drawModal(m,a,title){if(!a){m.innerHTML='<div><h4>تفاصيل الحجز</h4><p>'+esc(title||'الحجز مش ظاهر في أقسامك النهارده')+'</p><div class="nd-btns"><button type="button" class="nd-btn gh" data-nd="close">إغلاق</button></div></div>';return;}
 var items=PREP[a.section]||PREP.general,done=a.prep||[],n=items.filter(function(i){return done.indexOf(i)>=0;}).length;
 m.innerHTML='<div><div class="nd-hd"><div><div class="nd-sub">تفاصيل الحجز</div><h3 style="font-size:18px;color:#16212E">'+esc(a.patient_name)+'</h3></div><button type="button" class="nd-btn gh" data-nd="close">إغلاق</button></div>'+
 '<div class="nd-sv"><b>'+tm(a.starts_at)+'</b> · '+esc(a.service||'')+(a.doctor?' · '+esc(a.doctor):'')+' · <span class="nd-chip b">'+esc(secLabel(a.section))+'</span></div>'+
 '<h4>قايمة التجهيز</h4><div>'+items.map(function(i,k){return '<label class="nd-ck"><input type="checkbox" data-nd="prep" data-id="'+esc(a.id)+'" data-item="'+esc(i)+'"'+(done.indexOf(i)>=0?' checked':'')+'> '+esc(i)+'</label>';}).join('')+'</div>'+
 '<div class="nd-prog"><i style="width:'+Math.round(n/items.length*100)+'%"></i></div>'+
 '<div class="nd-btns"><button type="button" class="nd-btn" data-nd="open_file" data-id="'+esc(a.id)+'">افتح الملف</button><button type="button" class="nd-btn p" data-nd="triage" data-id="'+esc(a.id)+'">الفحص قبل الكشف</button></div></div>';}
function togglePrep(box){var a=appt(box.dataset.id);if(!a)return;var item=box.dataset.item,on=box.checked;box.disabled=true;
 q('prep_set',{appointment_id:a.id,item:item,done:on}).then(function(){a.prep=(a.prep||[]).filter(function(x){return x!==item;});if(on)a.prep.push(item);}).catch(function(e){toast((e&&e.message)||'تعذر حفظ التجهيز','error');}).then(function(){var m=document.querySelector('[data-nd-modal]');if(m&&modalId===a.id)drawModal(m,a);});}
/* ---------------- open patient file */
function goPatient(pid){var nav=document.querySelector('[data-goto="patients"]');if(nav)nav.click();var R=window.SSMPDRenderPatients;if(R&&R.openPatientById)setTimeout(function(){R.openPatientById(pid);},nav?60:0);}
function openFile(id){var a=appt(id);if(!a||!a.archive_patient_id){toast('الملف مش مربوط بالأرشيف','error');return;}if(busy)return;busy=true;
 q('open_file',{patient_id:a.archive_patient_id,appointment_id:a.id}).then(function(){window.__SWNWNursingOpenLogged=String(a.archive_patient_id);closeModal();goPatient(a.archive_patient_id);}).catch(function(e){toast((e&&e.message)||'تعذر فتح الملف','error');}).then(function(){busy=false;});}
/* ---------------- notifications */
function openNote(b){var id=b.dataset.id,aid=b.dataset.appt,dr=b.dataset.kind==='draft_returned'&&appt(aid);q('notifications_read',{ids:[id]}).catch(function(){}).then(function(){if(notes){(notes.items||[]).forEach(function(n){if(n.id===id&&!n.read){n.read=true;notes.unread=Math.max(0,(notes.unread||1)-1);}});}paint();});
 if(dr&&(dr.section==='dental'||dr.section==='physio')){openDraftFor(dr);return;}
 var title=((notes&&notes.items)||[]).filter(function(n){return n.id===id;})[0];openDetails(aid,title&&title.title);}
/* ---------------- settings */
function saveNurse(btn){var row=btn.closest('[data-nd-nurse]');if(!row||busy)return;busy=true;btn.disabled=true;var ov=row.querySelector('[data-nd-ov]').value||null,ab=row.querySelector('[data-nd-abs]').checked;
 q('settings_save',{admin_id:row.dataset.ndNurse,section_override:ov,absent_today:ab}).then(function(){toast('اتحفظ');busy=false;return Promise.all([loadSettings(),load()]);}).catch(function(e){busy=false;btn.disabled=false;toast((e&&e.message)||'تعذر الحفظ','error');});}
function loadSettings(){return q('settings_get').then(function(r){settings=r&&r.nurses?r:null;if(!settings)return;return q('unlinked_doctors').then(function(u){unlinked=(u&&u.doctors)||[];}).catch(function(){unlinked=null;}).then(function(){paintIfIdle();});}).catch(function(){settings=null;});}
/* ---------------- loading */
function paintIfIdle(){var r=root();if(!r)return;if(view==='triage')return;var a=document.activeElement;if(a&&r.contains(a)&&a.matches&&a.matches('select,input'))return;paint();}
function load(){return q('day',{}).then(function(d){data=d;paintIfIdle();});}
function loadNotes(){return q('notifications',{}).then(function(n){notes=n;paintIfIdle();});}
function refresh(force){if(!ctx||!ws()||trial()||!root()||(document.hidden&&!force))return Promise.resolve();if(loading)return Promise.resolve();loading=true;
 return Promise.all([load(),loadNotes().catch(function(){})]).then(function(){if(force)paint();}).catch(function(e){if(force||!data)toast((e&&e.message)||'تعذر تحميل تشغيل اليوم','error');}).then(function(){loading=false;});}
function onClick(e){var b=e.target.closest('[data-nd]');if(!b||busy&&!/^(tab|chronic|other|yn)$/.test(b.dataset.nd))return;var k=b.dataset.nd;
 if(k==='tab'){sel=b.dataset.sec;paint();}
 else if(k==='open_file')openFile(b.dataset.id);
 else if(k==='triage')openTriage(b.dataset.id);
 else if(k==='details')openDetails(b.dataset.id);
 else if(k==='draft')openDraftFor(appt(b.dataset.id));
 else if(k==='note')openNote(b);
 else if(k==='back'){view=null;form=null;paint();}
 else if(k==='save_draft')saveTriage('draft');
 else if(k==='save_rec')saveTriage('recorded');
 else if(k==='save_nurse')saveNurse(b);
 else if(k==='chronic'){syncText();var d=form.t.chronic_diseases=form.t.chronic_diseases||[],i=d.indexOf(b.dataset.name);if(i>=0)d.splice(i,1);else d.push(b.dataset.name);paint();}
 else if(k==='other'){syncText();form.otherOn=!form.otherOn;paint();}
 else if(k==='yn'){syncText();form.t[b.dataset.name]=b.dataset.v==='1';paint();}}
function mount(){var r=root();if(!r||trial())return;css();if(!r.__ndWired){r.__ndWired=true;r.addEventListener('click',onClick);}
 if(!r.firstChild||!r.querySelector('.nd'))paint();
 if(!settingsTried){settingsTried=true;loadSettings();}
 refresh(true);if(!timer)timer=setInterval(function(){if(!root()){clearInterval(timer);timer=null;return;}refresh(false);},15000);}
function isNurseUser(){var R=window.SSMPDRoles,A=window.SSMPDAuth;if(!R||!A||!A.currentAdmin||!R.hasAnyRole)return false;return R.hasAnyRole(A.currentAdmin,['nursing','head_nursing','super_admin','general_manager']);}
function install(){var base=window.SSMPDReceptionModules;if(!base){setTimeout(install,120);return;}if(base.__swnwNursingWrapped)return;
 var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
 wrapped.sections=function(c){var rows=base.sections?base.sections(c):[];var t=c&&c.data&&c.data.workspace&&c.data.workspace.mode==='trial';if(!t&&isNurseUser()&&!rows.some(function(x){return x[0]==='nursing';}))rows=rows.concat([['nursing','تشغيل اليوم — التمريض','مرضى قسمك لليوم، الفحص قبل الكشف، وتجهيز الحجز']]);return rows;};
 wrapped.panel=function(section,c){if(section==='nursing'){if(!ctx||ctx.workspace!==c.workspace){data=null;notes=null;}ctx=c;if(trial())return '';setTimeout(mount,0);return '<div data-nd-root></div>';}return base.panel?base.panel(section,c):'';};
 wrapped.__swnwNursingWrapped=true;window.SSMPDReceptionModules=wrapped;}
install();
window.__SWNWNursingTest={refresh:refresh,setContext:function(c){ctx=c;}};
})();
