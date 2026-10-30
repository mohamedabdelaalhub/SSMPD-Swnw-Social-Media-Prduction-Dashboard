/* SWNW Today Operations — patient journey layer for clinic_reception. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsV1)return;
window.__SWNWTodayOperationsV1=true;

var css=document.createElement('link');
css.rel='stylesheet';css.href='assets/css/today-operations.css?v=journey-sandbox-20261031-1';css.dataset.todayOperations='1';
if(!document.querySelector('link[data-today-operations]'))document.head.appendChild(css);

var state={day:null,workspace:null,data:null,loading:false,error:null,refreshTimer:null,context:null,sandbox:null,owner:null,generation:0};
var base=window.SSMPDReceptionModules||{sections:function(){return[];},panel:function(){return'';},act:function(){return false;},bookingFields:function(){return'';},bookingWire:function(){}};

function cairoDay(value){
 var d=value?new Date(value):new Date(),parts={};
 new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).forEach(function(p){parts[p.type]=p.value;});
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function shiftDay(day,amount){var d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
function time(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'—';}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
function num(v){return Number(v||0).toLocaleString('en-US');}
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function toast(msg,kind){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,kind||'success');}
function token(){return crypto.randomUUID();}
function currentRoot(){return state.context&&state.context.host&&state.context.host.querySelector('[data-journey-root]');}
function effectiveContext(c){
 if(!state.sandbox)return c;
 var model=state.sandbox,out=Object.assign({},c,{workspace:model.workspace,data:model.catalog,sandbox:true});
 out.modal=function(title,body,save){return c.modal(title,body,save,function(){});};
 return out;
}
function sandboxChoice(){var allowed=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&['super_admin','general_manager'].includes(window.SSMPDAuth.currentAdmin.role);return state.sandbox?'<section class="journey-sandbox-banner" role="status"><strong>وضع التجربة</strong><p>بيانات تدريب منفصلة ومحفوظة في حسابك. الحجوزات والخدمات والرسائل هنا لا تغيّر سيستم المركز أو الحسابات أو المخزون الفعلي.</p>'+action('sandbox_exit','','العودة للتشغيل الحالي')+'</section>':allowed?'<div class="journey-mode-choice">'+action('sandbox_enter','','وضع التجربة')+'<span>جرّب الرحلة كاملة ببيانات منفصلة.</span></div>':'';}
function switchMode(c,trial){
 if(document.querySelector('.rx-modal')){toast('أغلق النافذة الحالية قبل تغيير الوضع','error');return;}
 state.generation++;state.loading=false;state.error=null;state.data=null;
 if(!trial){state.sandbox=null;return load(c,true);}
 if(!window.SWNJourneySandbox){state.error=Error('تعذر تحميل وضع التجربة؛ حدّث الصفحة');paint(c);return;}
 var generation=state.generation,root=currentRoot();if(root){root.dataset.journeyMode='trial';root.innerHTML='<p class="journey-loading">جاري فتح مساحة التجربة…</p>';}
 state.loading=true;
 return window.SWNJourneySandbox.open(state.day).then(function(model){if(generation!==state.generation)return;state.sandbox=model;state.data=model.journey;state.loading=false;paint(c);}).catch(function(error){if(generation!==state.generation)return;state.loading=false;state.error=error;paint(c);});
}

function load(c,force){
 if(c.sandbox)c=state.context;
 state.context=c;state.workspace=c.workspace;
 if(!state.day)state.day=cairoDay();
 if(state.loading&&!force)return;
 state.loading=true;state.error=null;
 var root=currentRoot();if(root)root.innerHTML='<div class="journey-loading">جاري تحميل تشغيل اليوم…</div>';
 var generation=++state.generation,trial=!!state.sandbox;
 return (trial?window.SWNJourneySandbox.open(state.day):rpc('clinic_reception_journey_snapshot',{p_workspace:c.workspace,p_day:state.day})).then(function(data){
  if(generation!==state.generation||state.workspace!==c.workspace)return;
  if(trial){Object.assign(state.sandbox,data);data=data.journey;}
  state.data=data||{};state.loading=false;paint(c);
 }).catch(function(err){if(generation!==state.generation)return;state.loading=false;state.error=err;paint(c);});
}

function metric(label,value,sub){return '<article class="journey-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</article>';}
function action(name,id,label,cls){return '<button type="button" class="btn '+(cls||'')+'" data-journey-action="'+name+'" data-id="'+esc(id||'')+'">'+esc(label)+'</button>';}
function badge(status){var map={expected:'متوقع',on_the_way:'في الطريق',waiting:'ينتظر',called:'تم الاستدعاء',in_service:'داخل الخدمة',on_hold:'انتظار نتيجة',completed:'انتهى',no_show:'لم يحضر',cancelled:'ملغي'};return '<span class="journey-badge journey-badge-'+esc(status)+'">'+esc(map[status]||status)+'</span>';}
function journeyBar(a){
 var steps=['موعد','وصول','انتظار','كشف','انتهاء'],idx=0,s=a.queue_status;
 if(['on_the_way'].includes(s))idx=0;if(['waiting','called'].includes(s))idx=2;if(['in_service','on_hold'].includes(s))idx=3;if(s==='completed')idx=4;
 return '<div class="journey-bar" aria-label="رحلة المريض">'+steps.map(function(x,i){return '<span class="'+(i<idx?'done':i===idx?'current':'')+'">'+x+'</span>';}).join('')+'</div>';
}
function card(a,c){
 var s=a.queue_status||'expected',buttons='';
 if(s==='expected')buttons+=action('on_the_way',a.id,'في الطريق')+action('arrive',a.id,'وصل','btn-primary')+action('no_show',a.id,'لم يحضر')+action('qr',a.id,'QR خاص');
 if(s==='on_the_way')buttons+=action('arrive',a.id,'تسجيل الوصول','btn-primary')+action('qr',a.id,'QR خاص');
 if(s==='waiting')buttons+=action('call',a.id,'استدعاء','btn-primary')+action('priority',a.id,'الأولوية')+action('help',a.id,'مساعدة');
 if(s==='called')buttons+=action('consultation_start',a.id,'بدأ الكشف','btn-primary')+action('call',a.id,'إعادة النداء')+action('priority',a.id,'الأولوية');
 if(s==='in_service')buttons+=action('hold',a.id,'انتظار تحليل/إجراء')+action('request_service',a.id,'طلب خدمة')+action('visit_detail',a.visit_id,'تفاصيل الزيارة')+action('visit_complete',a.id,'إنهاء الزيارة','btn-primary');
 if(s==='on_hold')buttons+=action('resume',a.id,'عودة للطبيب','btn-primary')+action('request_service',a.id,'طلب خدمة')+action('visit_detail',a.visit_id,'تفاصيل الزيارة');
 if(['completed','no_show','cancelled'].includes(s))buttons+=action('timeline',a.id,'الخط الزمني');
 if(c.sandbox&&['expected','on_the_way'].includes(s))buttons+=action('sandbox_reschedule',a.id,'تغيير الموعد')+action('cancel',a.id,'إلغاء الحجز');
 if(c.sandbox&&s==='completed')buttons+=action('sandbox_feedback',a.id,'تقييم التجربة');
 var wait=a.wait_minutes?'<span class="journey-wait '+(a.wait_minutes>Number((state.data.settings||{}).max_wait_minutes||20)?'late':'')+'">انتظار '+num(a.wait_minutes)+' د</span>':'';
 return '<article class="journey-card" data-appointment="'+esc(a.id)+'"><header><div><h4>'+esc(a.patient_name)+'</h4><p>'+esc(a.file_no||'')+' · '+esc(a.provider_name)+' · '+time(a.starts_at)+'</p></div>'+badge(s)+'</header>'+journeyBar(a)+'<div class="journey-card-meta"><span>'+esc(a.service_name)+'</span>'+wait+(a.priority>0?'<span>أولوية '+num(a.priority)+(a.priority_reason?' · '+esc(a.priority_reason):'')+'</span>':'')+'</div><div class="journey-card-actions">'+buttons+'</div></article>';
}
function column(title,key,items,c){return '<section class="journey-column"><header><h3>'+esc(title)+'</h3><span>'+num(items.length)+'</span></header><div class="journey-column-body">'+(items.map(function(a){return card(a,c);}).join('')||'<p class="journey-empty">لا يوجد مرضى هنا.</p>')+'</div></section>';}
function doctorCards(data){
 var by={},sessions={};(data.doctor_sessions||[]).forEach(function(s){sessions[s.provider_id]=s;});
 (data.appointments||[]).forEach(function(a){if(!by[a.provider_id])by[a.provider_id]={id:a.provider_id,name:a.provider_name,department:a.department,total:0,waiting:0,inService:0};by[a.provider_id].total++;if(['waiting','called','on_hold'].includes(a.queue_status))by[a.provider_id].waiting++;if(a.queue_status==='in_service')by[a.provider_id].inService++;});
 return Object.keys(by).map(function(id){var d=by[id],s=sessions[id]||{},status=s.status||'scheduled';return '<article class="journey-doctor"><div><h4>'+esc(d.name)+'</h4><p>'+esc(d.department||'')+' · '+num(d.waiting)+' ينتظر · '+num(d.inService)+' داخل الكشف</p></div><div class="journey-doctor-status">'+esc({scheduled:'مجدول',on_the_way:'في الطريق',arrived:'وصل',started:'بدأ العيادة',delayed:'متأخر',ended:'انتهى',cancelled:'ملغي'}[status]||status)+'</div><div class="journey-doctor-actions">'+action('doctor_on_the_way',id,'في الطريق')+action('doctor_arrived',id,'وصل')+action('doctor_started',id,'بدأ')+action('doctor_delayed',id,'تأخير')+action('doctor_ended',id,'انتهى')+'</div></article>';}).join('')||'<p class="journey-empty">لا توجد عيادات في هذا اليوم.</p>';
}
function actionCenter(data){
 var alerts=[],limit=Number((data.settings||{}).max_wait_minutes||20);
 (data.appointments||[]).forEach(function(a){if(['waiting','called','on_hold'].includes(a.queue_status)&&Number(a.wait_minutes)>limit)alerts.push({type:'wait',title:a.patient_name,text:'ينتظر منذ '+a.wait_minutes+' دقيقة · '+a.provider_name,id:a.id});});
 (data.help_requests||[]).forEach(function(h){alerts.push({type:'help',title:h.patient_name,text:(h.message||'طلب مساعدة')+' · '+h.provider_name,id:h.id});});
 (data.doctor_sessions||[]).filter(function(s){return s.status==='delayed';}).forEach(function(s){alerts.push({type:'doctor',title:s.provider_name,text:'تأخير '+(s.eta_minutes||'—')+' دقيقة'+(s.delay_reason?' · '+s.delay_reason:''),id:s.provider_id});});
 return alerts.map(function(a){return '<article class="journey-alert"><div><strong>'+esc(a.title)+'</strong><p>'+esc(a.text)+'</p></div>'+(a.type==='help'?action('resolve_help',a.id,'تم التعامل','btn-primary'):a.type==='wait'?action('priority',a.id,'فتح المريض'):'')+'</article>';}).join('')||'<p class="journey-empty">لا توجد حالات تحتاج تدخل الآن.</p>';
}
function paint(c){
 var root=currentRoot();if(!root)return;
 c=effectiveContext(c);root.dataset.journeyMode=c.sandbox?'trial':'live';
 if(state.error){root.innerHTML=sandboxChoice()+'<section class="journey-error"><p>'+esc(state.error.message||'تعذر تحميل تشغيل اليوم')+'</p>'+action('refresh','','إعادة المحاولة','btn-primary')+'</section>';bind(root,c);return;}
 var d=state.data||{},apps=d.appointments||[];
 var expected=apps.filter(function(a){return ['expected','on_the_way'].includes(a.queue_status);});
 var waiting=apps.filter(function(a){return ['waiting','called','on_hold'].includes(a.queue_status);});
 var service=apps.filter(function(a){return a.queue_status==='in_service';});
 var done=apps.filter(function(a){return ['completed','no_show','cancelled'].includes(a.queue_status);});
 var waits=apps.filter(function(a){return Number(a.wait_minutes)>0;}).map(function(a){return Number(a.wait_minutes);});
 var avg=waits.length?Math.round(waits.reduce(function(x,y){return x+y;},0)/waits.length):0,max=waits.length?Math.max.apply(Math,waits):0;
 root.innerHTML=sandboxChoice()+'<div class="journey-toolbar"><div class="journey-date-nav">'+action('prev','','اليوم السابق')+'<input aria-label="يوم الرحلة" type="date" data-journey-day value="'+esc(state.day)+'">'+action('next','','اليوم التالي')+action('today','','اليوم','btn-primary')+'</div><div class="'+(c.sandbox?'journey-sandbox-actions':'journey-toolbar-actions')+'">'+(c.sandbox?action('sandbox_book','','حجز تجريبي جديد','btn-primary'):action('static_qr','','QR الاستقبال')+action('settings','','إعدادات التشغيل'))+action('refresh','','تحديث')+'</div></div>'+
 '<div class="journey-metrics">'+metric('حجوزات اليوم',apps.length)+metric('متوقع وصولهم',expected.length)+metric('في الانتظار',waiting.length)+metric('داخل الخدمة',service.length)+metric('انتهوا',done.filter(function(a){return a.queue_status==='completed';}).length)+metric('لم يحضر',done.filter(function(a){return a.queue_status==='no_show';}).length)+metric('متوسط الانتظار',avg+' د')+metric('أطول انتظار',max+' د')+'</div>'+
 '<div class="journey-layout"><main><div class="journey-board">'+column('متوقع وصولهم','expected',expected,c)+column('في الانتظار','waiting',waiting,c)+column('داخل الخدمة','service',service,c)+column('انتهوا','done',done,c)+'</div><section class="journey-section"><div class="journey-section-head"><h3>حالة العيادات والأطباء</h3></div><div class="journey-doctors">'+doctorCards(d)+'</div></section></main><aside><section class="journey-section journey-action-center"><div class="journey-section-head"><h3>يحتاج تدخل</h3></div>'+actionCenter(d)+'</section><section class="journey-section"><div class="journey-section-head"><h3>اتصال الوكيل</h3></div><p>'+num((d.outbox||[]).filter(function(o){return !o.delivered_at;}).length)+' رسالة رحلة لم تُسلّم بعد.</p><p>'+num((d.outbox||[]).filter(function(o){return !!o.delivered_at;}).length)+' رسالة تم تسليمها.</p></section></aside></div>';
 if(c.sandbox){var aside=root.querySelector('aside');aside.lastElementChild.remove();aside.insertAdjacentHTML('beforeend',window.SWNJourneySandbox.messages(state.sandbox));}
 bind(root,c);
}
function bind(root,c){
 root.onclick=function(e){var b=e.target.closest('[data-journey-action]');if(!b)return;e.preventDefault();handle(b.dataset.journeyAction,b.dataset.id,c);};
 var input=root.querySelector('[data-journey-day]');if(input)input.onchange=function(){state.day=input.value;load(c,true);};
}
function findAppointment(id){return ((state.data||{}).appointments||[]).find(function(a){return a.id===id;});}
function refresh(c){return load(c,true);}
function run(c,name,payload,key){var request=c.sandbox?window.SWNJourneySandbox.command(state.sandbox,name,payload,key):rpc('clinic_reception_journey_command',{p_workspace:c.workspace,p_action:name,p_payload:payload||{},p_token:key||token()});return request.then(function(r){return Promise.resolve(refresh(c)).then(function(){return r;});});}
function simpleConfirm(c,title,text,actionName,appointmentId,payload){c.modal(title,'<p>'+esc(text)+'</p>',function(){return run(c,actionName,Object.assign({appointment_id:appointmentId},payload||{}));});}
function infoModal(c,title,html){var m=c.modal(title,html,function(){return Promise.resolve();});m.querySelector('[type="submit"]').hidden=true;m.querySelector('[data-rx-cancel]').textContent='إغلاق';return m;}
function loadQrLib(){return new Promise(function(resolve,reject){if(window.QRCode){resolve();return;}var s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';s.onload=resolve;s.onerror=function(){reject(Error('تعذر تحميل مولد QR'));};document.head.appendChild(s);});}
function checkinUrl(tokenValue){var base=new URL('patient-checkin.html',location.href);base.search='';base.hash='';if(tokenValue)base.searchParams.set('token',tokenValue);return base.toString();}
function showQr(c,title,url,subtitle){var m=infoModal(c,title,'<div class="journey-qr-print"><p>'+esc(subtitle||'امسح الكود لتسجيل الوصول')+'</p><div data-journey-qr></div><input class="journey-url" readonly value="'+esc(url)+'"><div class="journey-card-actions"><button type="button" class="btn" data-copy-qr>نسخ الرابط</button><button type="button" class="btn btn-primary" data-print-qr>طباعة</button></div></div>');
 loadQrLib().then(function(){var box=m.querySelector('[data-journey-qr]');box.innerHTML='';new QRCode(box,{text:url,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});}).catch(function(err){m.querySelector('[data-journey-qr]').textContent=err.message;});
 m.querySelector('[data-copy-qr]').onclick=function(){navigator.clipboard.writeText(url).then(function(){toast('تم نسخ الرابط');});};m.querySelector('[data-print-qr]').onclick=function(){window.print();};
}
function settingsModal(c){var s=(state.data||{}).settings||{};var body='<p>الإحداثيات تُستخدم فقط للتحقق من وجود المريض داخل نطاق المركز وقت تسجيل الوصول.</p>'+c.field('clinic_lat','خط العرض','number',s.clinic_lat==null?'':s.clinic_lat,'step="0.000001"')+c.field('clinic_lng','خط الطول','number',s.clinic_lng==null?'':s.clinic_lng,'step="0.000001"')+c.field('radius_meters','نطاق السماح بالمتر','number',s.radius_meters||180,'required min="20" max="5000"')+c.select('location_required','التحقق من الموقع',[['true','مطلوب'],['false','غير مطلوب']],String(s.location_required!==false))+c.select('qr_enabled','QR تسجيل الوصول',[['true','مفعل'],['false','موقوف']],String(s.qr_enabled!==false))+c.select('feedback_enabled','طلب التقييم بعد الزيارة',[['true','مفعل'],['false','موقوف']],String(s.feedback_enabled!==false))+c.field('max_wait_minutes','حد تنبيه الانتظار بالدقائق','number',s.max_wait_minutes||20,'required min="1" max="240"')+c.field('doctor_delay_minutes','حد تأخير الطبيب بالدقائق','number',s.doctor_delay_minutes||10,'required min="1" max="180"')+'<div data-wide><button type="button" class="btn" data-use-current-location>استخدم موقعي الحالي كموقع المركز</button></div>';
 var m=c.modal('إعدادات تشغيل اليوم',body,function(v){v.location_required=v.location_required==='true';v.qr_enabled=v.qr_enabled==='true';v.feedback_enabled=v.feedback_enabled==='true';return run(c,'settings',v);});
 m.querySelector('[data-use-current-location]').onclick=function(){var btn=this;btn.disabled=true;btn.textContent='جاري قراءة الموقع…';navigator.geolocation.getCurrentPosition(function(pos){m.querySelector('[name="clinic_lat"]').value=pos.coords.latitude.toFixed(6);m.querySelector('[name="clinic_lng"]').value=pos.coords.longitude.toFixed(6);btn.disabled=false;btn.textContent='تم التقاط الموقع';},function(){btn.disabled=false;btn.textContent='تعذر قراءة الموقع';},{enableHighAccuracy:true,timeout:12000,maximumAge:0});};
}
function timelineModal(c,id){var a=findAppointment(id),events=((state.data||{}).events||[]).filter(function(e){return e.appointment_id===id;}).sort(function(x,y){return new Date(x.event_at)-new Date(y.event_at);});var labels={'patient.on_the_way':'المريض في الطريق','patient.arrived':'وصل المريض','queue.called':'تم استدعاء المريض','consultation.started':'بدأ الكشف','consultation.on_hold':'انتظار تحليل أو إجراء','consultation.review':'عودة للطبيب','visit.completed':'انتهت الزيارة','appointment.no_show':'لم يحضر','appointment.cancelled':'ألغي الحجز','queue.priority_changed':'تغيرت الأولوية','patient.help_requested':'طلب مساعدة','lab.requested':'طلب تحليل','imaging.requested':'طلب أشعة','procedure.requested':'طلب إجراء','service.requested':'طلب خدمة'};infoModal(c,'رحلة '+(a?a.patient_name:'المريض'),'<div class="journey-timeline">'+(events.map(function(e){return '<article><time>'+time(e.event_at)+'</time><div><strong>'+esc(labels[e.event_type]||e.event_type)+'</strong><small>'+esc(e.source||'')+'</small></div></article>';}).join('')||'<p>لا توجد أحداث مسجلة بعد.</p>')+'</div>');}
function serviceModal(c,id){var a=findAppointment(id);if(!a||!a.visit_id){toast('سجل حضور المريض أولًا','error');return;}var services=(c.data.services||[]).map(function(s){return [s.id,s.name+' — '+s.department];});var providers=(c.data.providers||[]).map(function(p){return [p.id,p.name];});c.modal('طلب خدمة أثناء الزيارة',c.select('request_kind','نوع الطلب',[['lab','تحليل'],['imaging','أشعة'],['procedure','إجراء'],['service','خدمة أخرى']])+c.select('service_id','الخدمة',services)+c.select('provider_id','الطبيب المنفذ',providers)+c.field('quantity','العدد','number','1','required min="0.001" step="0.001"'),function(v){return run(c,'request_service',Object.assign({appointment_id:id},v));});}
function doctorStatus(c,id,status){if(status==='delayed'){c.modal('تسجيل تأخير الطبيب',c.field('eta_minutes','التأخير المتوقع بالدقائق','number','15','required min="1" max="480"')+c.field('delay_reason','السبب','text','',' '),function(v){return run(c,'doctor_status',{provider_id:id,session_date:state.day,status:'delayed',eta_minutes:v.eta_minutes,delay_reason:v.delay_reason});});return;}run(c,'doctor_status',{provider_id:id,session_date:state.day,status:status});}
function priorityModal(c,id){var a=findAppointment(id);if(!a){toast('تعذر العثور على الحجز','error');return;}c.modal('أولوية المريض',c.select('priority','درجة الأولوية',[['0','عادية'],['1','أولوية 1'],['2','أولوية 2'],['3','أولوية 3'],['4','أولوية 4'],['5','أولوية 5']])+c.field('reason','السبب','text',a.priority_reason||'',' '),function(v){return run(c,'priority',{appointment_id:id,priority:v.priority,reason:v.reason});});}
function helpModal(c,id){c.modal('طلب مساعدة',c.select('kind','النوع',[['assistance','مساعدة'],['priority','أولوية إنسانية'],['complaint','شكوى'],['other','أخرى']])+c.field('message','التفاصيل','text','','required'),function(v){return run(c,'patient_help',{appointment_id:id,kind:v.kind,message:v.message});});}
function handle(name,id,c){
 try{
  if(name==='sandbox_enter'){switchMode(c,true);return;}if(name==='sandbox_exit'){switchMode(state.context,false);return;}
  if(c.sandbox){
   var save=function(a,p,k){return run(c,a,p,k);};
   if(['static_qr','qr','settings'].includes(name)){toast('هذا الإجراء غير متاح في مساحة التجربة','error');return;}
   if(name==='sandbox_book'||name==='sandbox_reschedule'){window.SWNJourneySandbox.book(c,state.sandbox,state.day,save,name==='sandbox_reschedule'?(state.sandbox.catalog.appointments||[]).find(function(a){return a.id===id;}):null);return;}
   if(name==='visit_detail'){window.SWNJourneySandbox.orders(c,state.sandbox,id,save);return;}
   if(name==='sandbox_feedback'){window.SWNJourneySandbox.feedback(c,id,save);return;}
   if(name==='sandbox_messages'){run(c,'simulate_messages',{}).catch(function(e){toast(e.message,'error');});return;}
  }
  if(name==='refresh'){refresh(c);return;}if(name==='prev'){state.day=shiftDay(state.day,-1);refresh(c);return;}if(name==='next'){state.day=shiftDay(state.day,1);refresh(c);return;}if(name==='today'){state.day=cairoDay();refresh(c);return;}if(name==='settings'){settingsModal(c);return;}if(name==='static_qr'){showQr(c,'QR تسجيل الوصول العام',checkinUrl(),'ضع هذا الكود على كاونتر الاستقبال أو منطقة الانتظار. المريض يدخل رقم هاتف الحجز ويؤكد موقعه.');return;}if(name==='timeline'){timelineModal(c,id);return;}if(name==='visit_detail'){if(id&&base.act)base.act('visit-detail',id,c);return;}if(name==='priority'){priorityModal(c,id);return;}if(name==='help'){helpModal(c,id);return;}if(name==='request_service'){serviceModal(c,id);return;}if(name==='resolve_help'){run(c,'resolve_help',{id:id,status:'resolved'});return;}
  if(name==='qr'){run(c,'checkin_token',{appointment_id:id}).then(function(r){showQr(c,'QR خاص بالحجز',checkinUrl(r.token),'هذا الكود خاص بهذا الحجز ويعمل خلال الفترة المحددة.');});return;}
  if(name.indexOf('doctor_')===0){doctorStatus(c,id,name.replace('doctor_',''));return;}
  if(name==='arrive'){simpleConfirm(c,'تسجيل وصول المريض','سيتم فتح الزيارة ووضع المريض في قائمة الانتظار.','arrive',id,{method:'reception'});return;}
  if(name==='on_the_way'){run(c,'on_the_way',{appointment_id:id});return;}
  if(name==='call'){run(c,'call',{appointment_id:id});return;}
  if(name==='consultation_start'){run(c,'consultation_start',{appointment_id:id});return;}
  if(name==='hold'){run(c,'hold',{appointment_id:id});return;}
  if(name==='resume'){run(c,'resume',{appointment_id:id});return;}
  if(name==='visit_complete'){c.modal('إنهاء الزيارة','<p>يلزم تنفيذ أو إلغاء كل الخدمات المفتوحة قبل إغلاق الزيارة.</p>'+c.field('reason','ملاحظة إن وجدت','text','',' '),function(v){return run(c,'visit_complete',{appointment_id:id,reason:v.reason});});return;}
  if(name==='no_show'){c.modal('تسجيل عدم الحضور',c.field('reason','السبب','text','لم يحضر المريض','required'),function(v){return run(c,'no_show',{appointment_id:id,reason:v.reason});});return;}
  if(name==='cancel'){c.modal('إلغاء الحجز',c.field('reason','السبب','text','','required'),function(v){return run(c,'cancel',{appointment_id:id,reason:v.reason});});return;}
 }catch(err){toast(err.message||'تعذر تنفيذ الإجراء','error');}
}

function panel(c){
 var owner=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id;
 if(state.owner!==owner){state.owner=owner;state.sandbox=null;state.data=null;state.loading=false;state.error=null;state.generation++;}
 state.context=c;if(state.workspace!==c.workspace){state.workspace=c.workspace;state.data=null;state.day=cairoDay();state.loading=false;state.error=null;state.generation++;}
 setTimeout(function(){if(!state.data&&!state.loading)load(c);else paint(c);},0);
 return '<section class="journey-shell"><header class="journey-title"><div><h2>تشغيل اليوم</h2><p>رحلة المريض والطابور وحالة الأطباء والتدخلات في شاشة واحدة.</p></div></header><div data-journey-root><div class="journey-loading">جاري تحميل تشغيل اليوم…</div></div></section>';
}

var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
wrapped.sections=function(c){var rows=base.sections?base.sections(c):[];if(!rows.some(function(x){return x[0]==='journey';}))rows=rows.concat([['journey','تشغيل اليوم','رحلة المريض والطابور وحالة الأطباء والتنبيهات اللحظية.']]);return rows;};
wrapped.panel=function(section,c){if(section==='journey')return panel(c);return base.panel?base.panel(section,c):'';};
wrapped.act=function(a,id,c){if(a.indexOf('journey-')===0){handle(a.slice(8),id,c);return true;}return base.act?base.act(a,id,c):false;};
window.SSMPDReceptionModules=wrapped;

window.SWNTodayOperations={refresh:function(){if(state.context)refresh(state.context);},openStaticQr:function(){if(state.context)handle('static_qr','',state.context);}};
})();
