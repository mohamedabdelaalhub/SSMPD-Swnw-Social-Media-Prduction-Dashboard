/* SWNW Unified Today Operations — one daily reception journey over existing booking, clinical and finance engines. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsUnifiedV1)return;
window.__SWNWTodayOperationsUnifiedV1=true;

var currentContext=null,originalModules=null,wrappedModules=null,lastModel=null,loading=false,refreshTimer=null,rootObserver=null;

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ج.م';}
function time(v){return v?new Date(v).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'—';}
function cairoDay(){var o={};new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).forEach(function(p){o[p.type]=p.value;});return o.year+'-'+o.month+'-'+o.day;}
function roles(){return window.SSMPDRoles&&window.SSMPDAuth?window.SSMPDRoles.rolesOf(window.SSMPDAuth.currentAdmin):[];}
function has(list){var mine=roles();return list.some(function(r){return mine.indexOf(r)!==-1;});}
function controlledFinance(action){var a=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin,r=window.SSMPDRoles;if(!a||!r)return false;if(!r.isControlledFinance(a))return false;return r.canModuleAction(a,'accounting',action||'view');}
function can(kind){
 if(has(['super_admin','general_manager']))return true;
 if(kind==='book')return has(['reception','customer_service']);
 if(kind==='arrive')return has(['reception','nursing','head_nursing']);
 if(kind==='queue')return has(['reception','nursing','head_nursing']);
 if(kind==='clinical')return has(['sono_doctor','nursing','head_nursing']);
 if(kind==='finance')return has(['reception'])||controlledFinance('view');
 if(kind==='collect')return has(['reception'])||controlledFinance('create');
 return false;
}
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function selectedDay(){var el=document.querySelector('[data-journey-day]');return el&&el.value?el.value:cairoDay();}
function toast(msg,kind){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(msg,kind||'success');}

function stage(a){
 var q=a.queue_status||'expected';
 if(q==='cancelled'||q==='no_show')return 'done';
 if(q==='completed')return a.payment_required?'payment':'done';
 if(q==='on_hold')return 'service';
 if(q==='in_service')return 'doctor';
 if(q==='waiting'||q==='called')return 'waiting';
 if(a.appointment_status==='arrived')return 'arrived';
 return 'booked';
}
var STAGES=[['booked','محجوز'],['arrived','وصل'],['waiting','في الانتظار'],['doctor','مع الطبيب'],['service','خدمة أخرى'],['payment','بانتظار الدفع'],['done','انتهى']];
function stageLabel(a){var k=stage(a),x=STAGES.find(function(s){return s[0]===k;});return x?x[1]:k;}

function quickButton(action,label,cls){return '<button type="button" class="btn '+(cls||'')+'" data-unified-action="'+action+'">'+esc(label)+'</button>';}
function actionButton(action,id,label,cls){return '<button type="button" class="btn '+(cls||'')+'" data-unified-action="'+action+'" data-id="'+esc(id||'')+'">'+esc(label)+'</button>';}
function shell(){
 return '<section class="rx-unified-hub" data-unified-hub dir="rtl">'+
  '<header class="rx-unified-header"><div><h2>تشغيل اليوم</h2><p>ابدأ بالمريض. الحجز والزيارة والخدمات والتحصيل تتحرك من نفس الرحلة.</p></div><div class="rx-unified-quick">'+
   (can('arrive')?quickButton('open-arrivals','مريض وصل','btn-primary'):'')+
   (can('book')?quickButton('new-booking','حجز جديد'):'')+
   quickButton('patient-search','بحث عن مريض')+
   (can('collect')?quickButton('quick-collect','تحصيل سريع'):'')+
   (can('finance')?quickButton('finance-section','الخزينة والوردية'):'')+
  '</div></header><div data-unified-body><p class="journey-loading">جاري تجهيز رحلة اليوم…</p></div></section>';
}

function metrics(apps){
 var counts={};STAGES.forEach(function(s){counts[s[0]]=0;});apps.forEach(function(a){counts[stage(a)]++;});
 return '<div class="rx-unified-metrics">'+[
  ['حجوزات اليوم',apps.length,'all'],['لم يصل',counts.booked,'booked'],['حضر',counts.arrived+counts.waiting+counts.doctor+counts.service+counts.payment+counts.done,'arrived'],['ينتظر',counts.waiting,'waiting'],['مع الطبيب',counts.doctor,'doctor'],['خدمة أخرى',counts.service,'service'],['بانتظار الدفع',counts.payment,'payment']
 ].map(function(x){return '<button type="button" data-unified-filter="'+x[2]+'"><span>'+esc(x[0])+'</span><strong>'+x[1]+'</strong></button>';}).join('')+'</div>';
}

function cardButtons(a){var s=stage(a),h='';
 if(s==='booked'&&can('arrive'))h+=actionButton('journey-arrive',a.id,'تسجيل وصول','btn-primary');
 if(s==='waiting'&&can('queue'))h+=actionButton('journey-call',a.id,'استدعاء','btn-primary');
 if(s==='waiting'&&can('queue'))h+=actionButton('journey-priority',a.id,'الأولوية');
 if(s==='doctor'&&can('clinical'))h+=actionButton('journey-hold',a.id,'خدمة أو إجراء');
 if(s==='service'&&can('clinical'))h+=actionButton('journey-resume',a.id,'عودة للطبيب','btn-primary');
 if(s==='payment'&&can('collect')&&a.due_invoices&&a.due_invoices.length)h+=actionButton('collect-invoice',a.due_invoices[0].id,'تحصيل','btn-primary');
 h+=actionButton('patient-drawer',a.id,'تفاصيل');return h;}
function patientCard(a){
 var finance=a.can_view_finance&&a.patient_due!=null?'<span class="rx-unified-due '+(Number(a.patient_due)>0?'is-due':'')+'">'+(Number(a.patient_due)>0?'متبقي '+money(a.patient_due):'مسدد')+'</span>':'';
 var wait=Number(a.wait_minutes||0)>0?'<span>انتظار '+Number(a.wait_minutes)+' د</span>':'';
 return '<article class="rx-unified-card" data-unified-patient="'+esc(a.id)+'"><header><div><h4>'+esc(a.patient_name)+'</h4><p>'+esc(a.file_no||'')+' · '+time(a.starts_at)+'</p></div><span class="rx-unified-stage">'+esc(stageLabel(a))+'</span></header><p>'+esc(a.provider_name)+' · '+esc(a.service_name)+'</p><div class="rx-unified-meta">'+wait+finance+'</div><div class="rx-unified-card-actions">'+cardButtons(a)+'</div></article>';
}
function board(apps){return '<div class="rx-unified-board">'+STAGES.map(function(s){var rows=apps.filter(function(a){return stage(a)===s[0];});return '<section class="rx-unified-column" data-unified-column="'+s[0]+'"><header><h3>'+s[1]+'</h3><span>'+rows.length+'</span></header><div>'+(rows.map(patientCard).join('')||'<p class="rx-unified-empty">لا يوجد مرضى</p>')+'</div></section>';}).join('')+'</div>';}

function render(model){lastModel=model||{};var apps=lastModel.appointments||[],body=document.querySelector('[data-unified-body]');if(!body)return;body.innerHTML=metrics(apps)+board(apps);bindHub(document.querySelector('[data-unified-hub]'));}
function loadHub(force){
 if(!currentContext||loading&&!force)return Promise.resolve();var body=document.querySelector('[data-unified-body]');if(!body)return Promise.resolve();loading=true;
 return rpc('clinic_reception_journey_hub_snapshot',{p_workspace:currentContext.workspace,p_day:selectedDay()}).then(function(m){loading=false;render(m);}).catch(function(e){loading=false;body.innerHTML='<p class="journey-error">'+esc(e.message||'تعذر تحميل رحلة اليوم')+'</p>';});
}
function scheduleLoad(){clearTimeout(refreshTimer);refreshTimer=setTimeout(function(){loadHub(true);},180);}

function openSection(key,afterAction){
 var c=currentContext;if(!c||!c.host)return;
 var back=c.host.querySelector('[data-rx-action="back"]');if(back)back.click();
 setTimeout(function(){var section=c.host.querySelector('[data-rx-section="'+key+'"]');if(!section){toast('هذا القسم غير متاح حسب صلاحيتك','error');return;}section.click();if(afterAction)setTimeout(function(){var b=c.host.querySelector('[data-rx-action="'+afterAction+'"]');if(b)b.click();},40);},40);
}
function invokeJourney(name,id){if(originalModules&&originalModules.act){originalModules.act('journey-'+name,id,currentContext);scheduleLoad();}}
function invokeFinance(invoiceId){if(!can('collect'))return;var ok=originalModules&&originalModules.act&&originalModules.act('collect-invoice',invoiceId,currentContext);if(!ok)openSection('operations');}
function eventLabel(t){return {'patient.on_the_way':'في الطريق','patient.arrived':'وصل المركز','queue.called':'تم استدعاؤه','consultation.started':'بدأ الكشف','consultation.on_hold':'انتظار خدمة أو إجراء','consultation.review':'عاد للطبيب','visit.completed':'انتهت الزيارة','appointment.no_show':'لم يحضر','appointment.cancelled':'ألغي الحجز','service.requested':'طلب خدمة','lab.requested':'طلب تحليل','imaging.requested':'طلب أشعة','patient.help_requested':'طلب مساعدة'}[t]||t;}
function closeDrawer(){var x=document.querySelector('[data-unified-drawer]');if(x)x.remove();}
function openDrawer(id){
 var a=(lastModel&&lastModel.appointments||[]).find(function(x){return x.id===id;});if(!a)return;
 var events=(lastModel.events||[]).filter(function(e){return e.appointment_id===id;}).slice(0,8);
 var messages=(lastModel.outbox||[]).filter(function(o){return o.appointment_id===id;});
 var orders=currentContext&&currentContext.data&&a.visit_id?(currentContext.data.orders||[]).filter(function(o){return o.visit_id===a.visit_id;}):[];
 var finance=a.can_view_finance?'<section><h4>الحساب</h4><p>إجمالي مسؤولية المريض '+money(a.patient_payable_total)+' · المدفوع '+money(a.patient_paid)+' · المتبقي '+money(a.patient_due)+'</p>'+(Number(a.patient_due)>0&&can('collect')&&a.due_invoices&&a.due_invoices.length?actionButton('collect-invoice',a.due_invoices[0].id,'تحصيل المستحق','btn-primary'):'')+'</section>':'';
 var root=document.createElement('div');root.className='modal-backdrop rx-unified-drawer';root.dataset.unifiedDrawer='1';root.innerHTML='<section class="modal" role="dialog" aria-modal="true" dir="rtl"><header class="modal-head"><div><h3>'+esc(a.patient_name)+'</h3><p>'+esc(a.file_no||'')+' · '+esc(stageLabel(a))+'</p></div><button type="button" class="modal-close" data-unified-close aria-label="إغلاق">×</button></header><div class="rx-unified-drawer-body"><section><h4>الحجز والزيارة</h4><p>'+esc(a.provider_name)+' · '+esc(a.service_name)+' · '+time(a.starts_at)+'</p><p>مصدر الحجز '+esc(a.booking_source||'—')+'</p></section><section><h4>الخدمات</h4>'+(orders.length?orders.map(function(o){return '<p>'+esc((o.snapshot&&o.snapshot.name)||'خدمة')+' · '+esc(o.status||'')+'</p>';}).join(''):'<p>لا توجد خدمات إضافية مسجلة.</p>')+'</section>'+finance+'<section><h4>الرسائل والتنبيهات</h4><p>'+messages.filter(function(x){return x.delivered_at;}).length+' تم تسليمها · '+messages.filter(function(x){return !x.delivered_at;}).length+' بانتظار التسليم</p></section><section><h4>الخط الزمني</h4>'+(events.length?events.map(function(e){return '<p>'+time(e.event_at)+' · '+esc(eventLabel(e.event_type))+'</p>';}).join(''):'<p>لا توجد أحداث مسجلة بعد.</p>')+'</section></div><footer class="rx-unified-drawer-actions">'+cardButtons(a)+'</footer></section>';document.body.appendChild(root);bindHub(root);root.querySelector('[data-unified-close]').onclick=closeDrawer;root.onclick=function(e){if(e.target===root)closeDrawer();};
}
function handle(action,id){
 if(action==='new-booking'){openSection('appointments','book');return;}
 if(action==='patient-search'){openSection('patients');return;}
 if(action==='open-arrivals'){openSection('appointments');return;}
 if(action==='finance-section'){openSection('operations');return;}
 if(action==='quick-collect'){if(originalModules&&originalModules.act&&originalModules.act('collect','',currentContext))return;openSection('operations');return;}
 if(action==='patient-drawer'){openDrawer(id);return;}
 if(action==='collect-invoice'){closeDrawer();invokeFinance(id);return;}
 if(action.indexOf('journey-')===0){closeDrawer();invokeJourney(action.slice(8),id);return;}
}
function bindHub(root){if(!root||root.dataset.unifiedBound==='1')return;root.dataset.unifiedBound='1';root.addEventListener('click',function(e){var b=e.target.closest('[data-unified-action]');if(b){e.preventDefault();handle(b.dataset.unifiedAction,b.dataset.id||'');return;}var f=e.target.closest('[data-unified-filter]');if(f){e.preventDefault();var key=f.dataset.unifiedFilter;root.querySelectorAll('[data-unified-column]').forEach(function(col){col.hidden=key!=='all'&&col.dataset.unifiedColumn!==key;});}});}

function observeJourney(){
 if(rootObserver){rootObserver.disconnect();rootObserver=null;}var root=document.querySelector('[data-journey-root]');if(!root)return;
 rootObserver=new MutationObserver(function(){scheduleLoad();});rootObserver.observe(root,{childList:true,subtree:true});
}
function improveHubOrder(){
 document.querySelectorAll('.fc-section-grid').forEach(function(grid){var journey=grid.querySelector('[data-rx-section="journey"]');if(journey&&grid.firstElementChild!==journey)grid.insertBefore(journey,grid.firstElementChild);});
 var admin=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;
 if(admin&&window.SSMPDRoles&&window.SSMPDRoles.hasRole(admin,'reception')&&!window.SSMPDRoles.hasAnyRole(admin,['super_admin','general_manager']))document.querySelectorAll('[data-goto="booking_cash"]').forEach(function(n){n.hidden=true;});
}
function installStyle(){if(document.getElementById('rx-unified-style'))return;var s=document.createElement('style');s.id='rx-unified-style';s.textContent='\
.rx-unified-hub{margin-bottom:14px}.rx-unified-header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.rx-unified-header h2{margin:0 0 4px}.rx-unified-header p{margin:0;color:var(--c-text-muted,#667085)}.rx-unified-quick{display:flex;gap:8px;flex-wrap:wrap}.rx-unified-metrics{display:grid;grid-template-columns:repeat(7,minmax(105px,1fr));gap:8px;margin:12px 0}.rx-unified-metrics button{border:1px solid var(--c-border,#d7dee7);background:var(--c-surface,#fff);border-radius:12px;padding:10px;text-align:right;cursor:pointer}.rx-unified-metrics span{display:block;font-size:12px;color:var(--c-text-muted,#667085)}.rx-unified-metrics strong{font-size:21px}.rx-unified-board{display:grid;grid-template-columns:repeat(7,minmax(210px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px}.rx-unified-column{border:1px solid var(--c-border,#d7dee7);background:var(--c-surface-subtle,#f8fafc);border-radius:14px;min-height:190px}.rx-unified-column>header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--c-border,#d7dee7)}.rx-unified-column>header h3{font-size:14px;margin:0}.rx-unified-column>header span{font-weight:700}.rx-unified-column>div{padding:8px}.rx-unified-card{background:var(--c-surface,#fff);border:1px solid var(--c-border,#d7dee7);border-radius:12px;padding:10px;margin-bottom:8px}.rx-unified-card header{display:flex;justify-content:space-between;gap:8px}.rx-unified-card h4{margin:0;font-size:14px}.rx-unified-card p{margin:4px 0;font-size:12px}.rx-unified-stage,.rx-unified-due{font-size:11px;padding:3px 7px;border-radius:999px;background:var(--c-surface-subtle,#eef2f6);white-space:nowrap}.rx-unified-due.is-due{font-weight:700}.rx-unified-meta,.rx-unified-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.rx-unified-card-actions .btn{font-size:11px;padding:5px 7px}.rx-unified-empty{font-size:12px;color:var(--c-text-muted,#667085);text-align:center;padding:18px 4px}.rx-unified-drawer .modal{width:min(720px,96vw)}.rx-unified-drawer-body{display:grid;gap:10px}.rx-unified-drawer-body section{border:1px solid var(--c-border,#d7dee7);border-radius:12px;padding:10px}.rx-unified-drawer-body h4{margin:0 0 6px}.rx-unified-drawer-body p{margin:4px 0}.rx-unified-drawer-actions{display:flex;gap:8px;flex-wrap:wrap}.rx-unified-hub+.journey-shell .journey-title,.rx-unified-hub+.journey-shell .journey-metrics,.rx-unified-hub+.journey-shell .journey-board{display:none!important}@media(max-width:900px){.rx-unified-header{display:block}.rx-unified-quick{margin-top:10px}.rx-unified-metrics{grid-template-columns:repeat(2,1fr)}.rx-unified-board{display:block;overflow:visible}.rx-unified-column{margin-bottom:10px;min-height:0}.rx-unified-column[hidden]{display:none}}';document.head.appendChild(s);}

function wrap(){
 var m=window.SSMPDReceptionModules;if(!m){setTimeout(wrap,120);return;}if(m.__unifiedTodayWrapped){wrappedModules=m;return;}
 originalModules=m;var next={};Object.keys(m).forEach(function(k){next[k]=m[k];});
 var originalPanel=m.panel;
 next.panel=function(section,c){if(section==='journey'){currentContext=c;setTimeout(function(){bindHub(document.querySelector('[data-unified-hub]'));observeJourney();loadHub(true);},0);return shell()+(originalPanel?originalPanel.call(m,section,c):'');}return originalPanel?originalPanel.call(m,section,c):'';};
 next.__unifiedTodayWrapped=true;wrappedModules=next;window.SSMPDReceptionModules=next;improveHubOrder();
}
installStyle();wrap();setInterval(function(){if(window.SSMPDReceptionModules!==wrappedModules)wrap();improveHubOrder();},900);
})();