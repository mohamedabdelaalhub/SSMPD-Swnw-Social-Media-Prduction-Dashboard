/* SWNW Today Operations V2 — UX and workflow refinements without replacing the existing journey module. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsUXV2)return;
window.__SWNWTodayOperationsUXV2=true;

var lastContext=null,wrappedModules=null,trialCache={};
var priorityLabels={
 '0':'ترتيب عادي',
 '1':'أولوية إنسانية — طفل أو كبير سن',
 '2':'مساعدة حركة أو وصول',
 '3':'أولوية تشغيلية — ظرف خاص',
 '4':'حالة عاجلة — بقرار التمريض',
 '5':'حالة حرجة — أولوية طبية فورية'
};
var supportLabels={
 assistance:'مساعدة من الاستقبال',
 wheelchair:'كرسي متحرك',
 stretcher:'سرير متحرك',
 nurse:'ممرض أو ممرضة للمساعدة',
 priority:'أولوية إنسانية',
 complaint:'شكوى',
 other:'طلب آخر'
};

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
function toast(msg,kind){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,kind||'success');}
function token(){return crypto.randomUUID();}
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function journeyRoot(){return document.querySelector('[data-journey-root]');}
function journeyMode(){var r=journeyRoot();return r&&r.dataset.journeyMode==='trial'?'trial':'live';}
function selectedDay(){var x=document.querySelector('[data-journey-day]');return x&&x.value?x.value:new Date().toISOString().slice(0,10);}
function refresh(){if(window.SWNTodayOperations&&window.SWNTodayOperations.refresh)return window.SWNTodayOperations.refresh();}
function currentContext(){if(!lastContext)throw Error('افتح تبويب تشغيل اليوم مرة أخرى ثم أعد المحاولة');return lastContext;}

function ensureWrap(){
 var modules=window.SSMPDReceptionModules;
 if(!modules){setTimeout(ensureWrap,250);return;}
 if(modules===wrappedModules&&modules.__journeyUXV2Wrapped)return;
 var originalPanel=modules.panel;
 modules.panel=function(section,c){if(section==='journey')lastContext=c;return originalPanel?originalPanel.call(modules,section,c):'';};
 modules.__journeyUXV2Wrapped=true;
 wrappedModules=modules;
}
ensureWrap();
setInterval(ensureWrap,1200);

function trialModel(day,force){
 day=day||selectedDay();
 if(!force&&trialCache[day])return Promise.resolve(trialCache[day]);
 return rpc('clinic_reception_sandbox_open',{p_day:day}).then(function(m){trialCache[day]=m;return m;});
}
function modeModel(day){
 var c=currentContext();
 if(journeyMode()==='trial')return trialModel(day);
 return Promise.resolve({workspace:c.workspace,catalog:c.data||{},journey:null});
}
function modeWorkspace(model){return journeyMode()==='trial'?model.workspace:currentContext().workspace;}
function modeCommand(model,action,payload){
 if(journeyMode()==='trial')return rpc('clinic_reception_sandbox_command',{p_workspace:model.workspace,p_action:action,p_payload:payload||{},p_token:token()});
 return rpc('clinic_reception_journey_command',{p_workspace:currentContext().workspace,p_action:action,p_payload:payload||{},p_token:token()});
}
function afterCommand(p){return Promise.resolve(p).then(function(r){trialCache={};return Promise.resolve(refresh()).then(function(){return r;});});}

function serviceGroup(s){
 var t=((s.department||'')+' '+(s.name||'')+' '+(s.code||'')).toLowerCase();
 if(/تحاليل|معمل|مختبر|lab|patholog/.test(t))return {key:'lab',label:'التحاليل',kind:'lab'};
 if(/أشعة|اشعة|radiolog|imaging|سونار|موجات|x-ray|xray|mri|ct scan|ct-sc/.test(t))return {key:'imaging',label:'الأشعة',kind:'imaging'};
 if(/علاج طبيعي|طبيعي|physio|physical therapy|rehab/.test(t))return {key:'physio',label:'العلاج الطبيعي',kind:'service'};
 return {key:'other',label:'خدمات أخرى',kind:'service'};
}
function serviceSelect(services){
 var order=['lab','imaging','physio','other'],groups={};
 services.forEach(function(s){var g=serviceGroup(s);(groups[g.key]||(groups[g.key]={label:g.label,rows:[]})).rows.push(s);});
 return '<label>الخدمة المطلوبة<select name="service_id" required><option value="">اختر الخدمة</option>'+order.map(function(k){var g=groups[k];if(!g||!g.rows.length)return'';return '<optgroup label="'+esc(g.label)+'">'+g.rows.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+(s.department?' — '+esc(s.department):'')+'</option>';}).join('')+'</optgroup>';}).join('')+'</select></label>';
}

function openService(id){
 var c=currentContext();
 modeModel(selectedDay()).then(function(model){
  var catalog=model.catalog||{},services=catalog.services||[],providers=catalog.providers||[];
  if(!services.length)throw Error('لا توجد خدمات متاحة الآن');
  var body='<p data-wide>اختر الخدمة فقط. نوع الطلب يُحدد تلقائيًا من الخدمة، ولا تحتاج لاختيار منفذ أو عدد عند إنشاء الطلب.</p>'+serviceSelect(services);
  c.modal('طلب خدمة أثناء الزيارة',body,function(v){
   var s=services.find(function(x){return x.id===v.service_id;});if(!s)throw Error('اختر الخدمة');
   var g=serviceGroup(s),provider=providers.find(function(p){return p.department===s.department;});
   if(!provider)throw Error('لا يوجد منفذ مسجل لقسم هذه الخدمة. أضف مقدم خدمة للقسم أولًا.');
   return afterCommand(modeCommand(model,'request_service',{appointment_id:id,service_id:s.id,provider_id:provider.id,quantity:'1',request_kind:g.kind,metadata:{service_group:g.key,provider_selected_automatically:true}}));
  });
 }).catch(function(e){toast(e.message||'تعذر فتح طلب الخدمة','error');});
}

function openPriority(id){
 var c=currentContext();
 var rows=Object.keys(priorityLabels).map(function(k){return [k,priorityLabels[k]];});
 var body='<p data-wide>الأولوية لا تعتمد على رقم مبهم. اختر السبب التشغيلي المناسب. الحالات العاجلة والحرجة تُقدّم بقرار التمريض دون انتظار موافقة المرضى.</p>'+c.select('priority','مستوى الأولوية',rows,'0')+c.field('reason','سبب الأولوية','text','',' ');
 c.modal('تحديد أولوية المريض',body,function(v){
  if(v.priority!=='0'&&String(v.reason||'').trim().length<3)throw Error('اكتب سبب الأولوية');
  return modeModel(selectedDay()).then(function(model){return afterCommand(modeCommand(model,'priority',{appointment_id:id,priority:v.priority,reason:v.reason,metadata:{priority_label:priorityLabels[v.priority]}}));});
 });
}

function openHelp(id){
 var c=currentContext();
 var rows=[['assistance',supportLabels.assistance],['wheelchair',supportLabels.wheelchair],['stretcher',supportLabels.stretcher],['nurse',supportLabels.nurse],['priority',supportLabels.priority],['complaint',supportLabels.complaint],['other',supportLabels.other]];
 var body='<p data-wide>الطلب يظهر فورًا في مركز «يحتاج تدخل» داخل تشغيل اليوم لموظفي الاستقبال والتمريض والإدارة المصرح لهم بالشاشة. طلبات الحركة والتمريض تُوجّه للتمريض، والشكوى تُسجل في رحلة المريض حتى يتم التعامل معها.</p>'+c.select('support_type','نوع الطلب',rows,'assistance')+c.field('message','التفاصيل','text','',' ');
 c.modal('طلب دعم للمريض',body,function(v){
  var subtype=v.support_type,label=supportLabels[subtype]||supportLabels.other,kind='assistance',team='reception';
  if(subtype==='priority'){kind='priority';team='reception';}
  else if(subtype==='complaint'){kind='complaint';team='reception_customer_care';if(String(v.message||'').trim().length<3)throw Error('اكتب تفاصيل الشكوى');}
  else if(['wheelchair','stretcher','nurse'].includes(subtype)){kind='assistance';team='nursing';}
  else if(subtype==='other'){kind='other';team='reception';}
  var message=label+(String(v.message||'').trim()?' — '+String(v.message).trim():'');
  return modeModel(selectedDay()).then(function(model){return afterCommand(modeCommand(model,'patient_help',{appointment_id:id,kind:kind,message:message,metadata:{subtype:subtype,target_team:team,label:label}}));});
 });
}

function timeLabel(v){return new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'});}
function dateOf(v){var d=new Date(v),p={};new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).forEach(function(x){p[x.type]=x.value;});return p.year+'-'+p.month+'-'+p.day;}
function liveSlots(id,day){return rpc('clinic_reception_journey_reschedule_slots',{p_workspace:currentContext().workspace,p_appointment:id,p_day:day});}
function trialSlots(model,appointment,day){
 return trialModel(day,true).then(function(target){
  var catalog=target.catalog||{},service=(catalog.services||[]).find(function(s){return s.id===appointment.service_id;});
  var duration=Math.max(5,Math.round((new Date(appointment.ends_at)-new Date(appointment.starts_at))/60000)||Number(service&&service.minutes)||20),rows=[];
  (catalog.availability||[]).filter(function(a){return a.provider_id===appointment.provider_id;}).forEach(function(a){
   for(var t=Date.parse(a.starts_at);t+duration*60000<=Date.parse(a.ends_at);t+=duration*60000){
    var end=t+duration*60000;if(dateOf(t)!==day)continue;
    if((catalog.appointments||[]).some(function(x){return x.id!==appointment.id&&x.provider_id===appointment.provider_id&&!['cancelled','no_show'].includes(x.status)&&Date.parse(x.starts_at)<end&&Date.parse(x.ends_at)>t;}))continue;
    rows.push({starts_at:new Date(t).toISOString()});
   }
  });
  return {slots:rows,target:target};
 });
}
function openReschedule(id){
 var c=currentContext(),currentDay=selectedDay();
 modeModel(currentDay).then(function(model){
  var catalog=model.catalog||{},apps=(model.journey&&model.journey.appointments)||catalog.appointments||[],a=apps.find(function(x){return x.id===id;});
  if(!a&&journeyMode()==='live')a=(c.data.appointments||[]).find(function(x){return x.id===id;});
  if(!a)throw Error('تعذر العثور على الحجز');
  var initial=dateOf(a.starts_at),body=c.field('day','اليوم الجديد','date',initial,'required')+c.select('starts_at','الساعة المتاحة',[]);
  var m=c.modal('تغيير يوم وموعد الحجز',body,function(v){
   if(!v.starts_at)throw Error('اختر الساعة الجديدة');
   if(journeyMode()==='trial')return rpc('clinic_reception_sandbox_command',{p_workspace:model.workspace,p_action:'reschedule',p_payload:{id:a.id,patient_id:a.patient_id,provider_id:a.provider_id,service_id:a.service_id,starts_at:v.starts_at,source:a.source||'sandbox',source_evidence:a.source_evidence||'unknown'},p_token:token()}).then(function(r){trialCache={};refresh();return r;});
   return rpc('clinic_reception_journey_reschedule',{p_workspace:c.workspace,p_appointment:id,p_starts_at:v.starts_at,p_token:token()}).then(function(r){refresh();return r;});
  });
  if(!m)return;
  var form=m.querySelector('form'),dayInput=form.elements.day,timeSelect=form.elements.starts_at,status=m.querySelector('[data-rx-status]');
  function fill(){
   timeSelect.disabled=true;timeSelect.innerHTML='<option value="">جاري تحميل المواعيد…</option>';status.textContent='';
   var promise=journeyMode()==='trial'?trialSlots(model,a,dayInput.value):liveSlots(id,dayInput.value);
   promise.then(function(r){if(!m.isConnected)return;var slots=r.slots||[];timeSelect.innerHTML='<option value="">اختر الساعة</option>'+slots.map(function(s){return '<option value="'+esc(s.starts_at)+'">'+esc(timeLabel(s.starts_at))+'</option>';}).join('');timeSelect.disabled=false;if(!slots.length)status.textContent='لا توجد مواعيد متاحة للطبيب في هذا اليوم.';}).catch(function(e){if(!m.isConnected)return;timeSelect.innerHTML='<option value="">لا توجد مواعيد</option>';status.textContent=e.message||'تعذر تحميل المواعيد';});
  }
  dayInput.onchange=fill;fill();
 }).catch(function(e){toast(e.message||'تعذر تغيير الموعد','error');});
}

function openFinish(id){
 var c=currentContext();
 modeModel(selectedDay()).then(function(model){
  var workspace=modeWorkspace(model);
  return rpc('clinic_reception_journey_prepare_finish',{p_workspace:workspace,p_appointment:id,p_token:token()}).then(function(prep){
   if(!prep||prep.ready!==true){
    var rows=(prep&&prep.open_orders)||[],names=rows.map(function(x){return x.name||'خدمة مفتوحة';}).join('، ');
    c.modal('لا يمكن إنهاء الزيارة الآن','<p data-wide>يوجد طلب خدمة لم يُنفذ أو يُلغ بعد'+(names?' — '+esc(names):'')+'. افتح تفاصيل الزيارة وأنهِ الطلب أولًا.</p>',function(){return Promise.resolve();});
    return;
   }
   c.modal('إنهاء الزيارة','<p data-wide>يمكن إنهاء الزيارة الآن بدون طلب خدمة إضافية. إذا كان الكشف الأساسي هو الخدمة الوحيدة البسيطة فسيتم تثبيت تنفيذه تلقائيًا قبل الإغلاق.</p>'+c.field('reason','ملاحظة اختيارية','text','',' '),function(v){
    var payload={appointment_id:id,reason:String(v.reason||'').trim()||'انتهت الزيارة بعد الكشف دون خدمات إضافية'};
    return afterCommand(modeCommand(model,'visit_complete',payload));
   });
  });
 }).catch(function(e){toast(e.message||'تعذر إنهاء الزيارة','error');});
}

function metricCancelled(root){
 var metrics=root.querySelector('.journey-metrics');if(!metrics||metrics.querySelector('[data-v2-cancelled-metric]'))return;
 var count=root.querySelectorAll('.journey-badge-cancelled').length,card=document.createElement('article');card.className='journey-metric';card.dataset.v2CancelledMetric='1';card.innerHTML='<span>ملغاة</span><strong>'+count.toLocaleString('en-US')+'</strong>';metrics.appendChild(card);
}
function labelPriority(root){
 root.querySelectorAll('.journey-card-meta span').forEach(function(s){var m=s.textContent.match(/^أولوية\s+([0-5])(?:\s+·\s*(.*))?$/);if(!m)return;s.textContent=priorityLabels[m[1]]+(m[2]?' · '+m[2]:'');});
 root.querySelectorAll('[data-journey-action="priority"]').forEach(function(b){b.textContent='تحديد الأولوية';});
}
function addButtons(root){
 root.querySelectorAll('.journey-card').forEach(function(card){
  var id=card.dataset.appointment,actions=card.querySelector('.journey-card-actions');if(!id||!actions)return;
  var expected=card.querySelector('.journey-badge-expected,.journey-badge-on_the_way');
  if(expected&&!actions.querySelector('[data-journey-v2-action="reschedule"]')){var b=document.createElement('button');b.type='button';b.className='btn';b.dataset.journeyV2Action='reschedule';b.dataset.id=id;b.textContent='تغيير اليوم والساعة';actions.appendChild(b);}
  var active=card.querySelector('.journey-badge-waiting,.journey-badge-called,.journey-badge-on_hold');
  if(active&&!actions.querySelector('[data-journey-action="help"], [data-journey-v2-action="help"]')){var h=document.createElement('button');h.type='button';h.className='btn';h.dataset.journeyV2Action='help';h.dataset.id=id;h.textContent='طلب دعم';actions.appendChild(h);}
  if(card.querySelector('.journey-badge-on_hold')&&!actions.querySelector('[data-journey-action="visit_complete"], [data-journey-v2-action="finish"]')){var f=document.createElement('button');f.type='button';f.className='btn btn-primary';f.dataset.journeyV2Action='finish';f.dataset.id=id;f.textContent='إنهاء الزيارة وانتظار النتيجة';actions.appendChild(f);}
 });
 root.querySelectorAll('[data-journey-action="help"]').forEach(function(b){b.textContent='طلب دعم';});
}
function translateTimeline(){
 var map={'appointment.rescheduled':'تم تغيير الموعد','result.ready':'ظهرت النتيجة','service.requested':'تم طلب خدمة','lab.requested':'تم طلب تحليل','imaging.requested':'تم طلب أشعة'};
 document.querySelectorAll('.journey-timeline strong').forEach(function(x){if(map[x.textContent])x.textContent=map[x.textContent];});
}
function enhance(){var r=journeyRoot();if(!r)return;metricCancelled(r);labelPriority(r);addButtons(r);translateTimeline();}
var observer=new MutationObserver(function(){enhance();});observer.observe(document.documentElement,{childList:true,subtree:true});setInterval(enhance,1000);enhance();

document.addEventListener('click',function(e){
 var b=e.target.closest('[data-journey-v2-action], [data-journey-action="priority"], [data-journey-action="help"], [data-journey-action="request_service"], [data-journey-action="visit_complete"], [data-journey-action="sandbox_reschedule"]');
 if(!b||!b.closest('[data-journey-root]'))return;
 var action=b.dataset.journeyV2Action||b.dataset.journeyAction,id=b.dataset.id||'';
 if(action==='priority'||action==='help'||action==='request_service'||action==='visit_complete'||action==='sandbox_reschedule'||action==='reschedule'||action==='finish'){
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(action==='priority')openPriority(id);
  else if(action==='help')openHelp(id);
  else if(action==='request_service')openService(id);
  else if(action==='visit_complete'||action==='finish')openFinish(id);
  else openReschedule(id);
 }
},true);
})();