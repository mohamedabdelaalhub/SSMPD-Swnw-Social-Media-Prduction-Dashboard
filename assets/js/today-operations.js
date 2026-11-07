/* SWNW Today Operations — patient journey layer for clinic_reception. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsV1)return;
window.__SWNWTodayOperationsV1=true;

var css=document.createElement('link');
css.rel='stylesheet';css.href='assets/css/today-operations.css?v=today-board-20261107-1';css.dataset.todayOperations='1';
if(!document.querySelector('link[data-today-operations]'))document.head.appendChild(css);

var state={day:null,workspace:null,data:null,loading:false,error:null,refreshTimer:null,context:null,sandbox:null,owner:null,generation:0,query:'',filter:'all'};
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

function metric(label,value,sub){return '<article class="journey-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</article>';}
function action(name,id,label,cls){return '<button type="button" class="btn '+(cls||'')+'" data-journey-action="'+name+'" data-id="'+esc(id||'')+'">'+esc(label)+'</button>';}
function badge(status){var map={expected:'متوقع',on_the_way:'في الطريق',waiting:'ينتظر',called:'تم الاستدعاء',in_service:'داخل الخدمة',on_hold:'انتظار نتيجة',completed:'انتهى',no_show:'لم يحضر',cancelled:'ملغي'};return '<span class="journey-badge journey-badge-'+esc(status)+'">'+esc(map[status]||status)+'</span>';}
function load(c,force,silent){
 if(c.sandbox)c=state.context;
 state.context=c;state.workspace=c.workspace;
 if(!state.day)state.day=cairoDay();
 if(state.loading&&!force)return;
 state.loading=true;state.error=null;
 var root=currentRoot();if(root&&!silent)root.innerHTML='<div class="journey-loading">جاري تحميل تشغيل اليوم…</div>';
 var generation=++state.generation,trial=!!state.sandbox;
 var live=function(){return rpc('clinic_reception_journey_hub_snapshot',{p_workspace:c.workspace,p_day:state.day}).catch(function(err){if(!/does not exist|not find|schema cache/i.test(String(err&&err.message||'')))throw err;return rpc('clinic_reception_journey_snapshot',{p_workspace:c.workspace,p_day:state.day});});};
 return (trial?window.SWNJourneySandbox.open(state.day):live()).then(function(data){
  if(generation!==state.generation||state.workspace!==c.workspace)return;
  if(trial){Object.assign(state.sandbox,data);data=data.journey;}
  state.data=data||{};state.loading=false;paint(c);
 }).catch(function(err){if(generation!==state.generation)return;state.loading=false;if(silent&&state.data)return;state.error=err;paint(c);});
}

/* One board for the reception day: coming -> waiting -> inside -> done. One main button per card, the rest in the "⋯" menu. */
var LANES=[['coming','جاي'],['waiting','مستني'],['inside','جوه'],['done','خلص']];
var PRIORITY={'1':'أولوية إنسانية','2':'مساعدة حركة','3':'ظرف خاص','4':'عاجل','5':'حالة حرجة'};
function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' ج.م';}
function lane(a){var s=a.queue_status||'expected';if(s==='expected'||s==='on_the_way')return 'coming';if(s==='waiting'||s==='called')return 'waiting';if(s==='in_service'||s==='on_hold')return 'inside';return 'done';}
function waitLimit(){return Number(((state.data||{}).settings||{}).max_wait_minutes||20);}
function lateMinutes(a){if(lane(a)!=='coming'||!a.starts_at||state.day!==cairoDay())return 0;var m=Math.floor((Date.now()-Date.parse(a.starts_at))/60000);return m>0?m:0;}
function hasDue(a){return !!a.can_view_finance&&Number(a.patient_due)>0;}
function roles(){return window.SSMPDRoles&&window.SSMPDRoles.rolesOf&&window.SSMPDAuth?window.SSMPDRoles.rolesOf(window.SSMPDAuth.currentAdmin):[];}
function hasRole(list){var mine=roles(),admin=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;if(admin&&list.indexOf(admin.role)!==-1)return true;return list.some(function(r){return mine.indexOf(r)!==-1;});}
function financeAllowed(kind){var a=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin,r=window.SSMPDRoles;return !!(a&&r&&r.isControlledFinance&&r.isControlledFinance(a)&&r.canModuleAction&&r.canModuleAction(a,'accounting',kind));}
function can(kind){
 if(hasRole(['super_admin','general_manager']))return true;
 if(kind==='book')return hasRole(['reception','customer_service']);
 if(kind==='finance')return hasRole(['reception'])||financeAllowed('view');
 if(kind==='collect')return hasRole(['reception'])||financeAllowed('create');
 return false;
}
function v2(name,id,label){return '<button type="button" class="btn" data-journey-v2-action="'+name+'" data-id="'+esc(id||'')+'">'+esc(label)+'</button>';}
function more(items,label){return items?'<details class="journey-more"><summary aria-label="'+esc(label||'إجراءات أخرى')+'" title="'+esc(label||'إجراءات أخرى')+'">⋯</summary><div class="journey-more-menu">'+items+'</div></details>':'';}
function cardActions(a,c){
 var s=a.queue_status||'expected',main='',rest='',detail=a.visit_id?action('visit_detail',a.visit_id,'تفاصيل الزيارة'):'';
 if(s==='expected'){main=action('arrive',a.id,'وصل','btn-primary');rest=action('on_the_way',a.id,'في الطريق')+action('no_show',a.id,'لم يحضر')+action('qr',a.id,'QR خاص')+v2('reschedule',a.id,'تغيير اليوم والساعة');}
 else if(s==='on_the_way'){main=action('arrive',a.id,'وصل','btn-primary');rest=action('qr',a.id,'QR خاص')+v2('reschedule',a.id,'تغيير اليوم والساعة');}
 else if(s==='waiting'){main=action('call',a.id,'نادي','btn-primary');rest=action('priority',a.id,'تحديد الأولوية')+action('help',a.id,'طلب دعم');}
 else if(s==='called'){main=action('consultation_start',a.id,'بدأ الكشف','btn-primary');rest=action('call',a.id,'إعادة النداء')+action('priority',a.id,'تحديد الأولوية')+action('help',a.id,'طلب دعم');}
 else if(s==='in_service'){main=action('visit_complete',a.id,'إنهاء الزيارة','btn-primary');rest=action('hold',a.id,'انتظار تحليل/إجراء')+action('request_service',a.id,'طلب خدمة')+detail;}
 else if(s==='on_hold'){main=action('resume',a.id,'عودة للطبيب','btn-primary');rest=action('request_service',a.id,'طلب خدمة')+detail+v2('finish',a.id,'إنهاء الزيارة وانتظار النتيجة')+action('help',a.id,'طلب دعم');}
 if(hasDue(a)&&can('collect')&&a.due_invoices&&a.due_invoices.length){if(!main)main=action('collect_due',a.id,'حصّل','btn-primary');else rest=action('collect_due',a.id,'تحصيل '+money(a.patient_due))+rest;}
 if(c.sandbox&&s==='completed')rest+=action('sandbox_feedback',a.id,'تقييم التجربة');
 if(c.sandbox&&['expected','on_the_way'].includes(s))rest+=action('cancel',a.id,'إلغاء الحجز');
 rest+=action('account',a.id,'التفاصيل والحساب')+action('timeline',a.id,'الخط الزمني');
 return main+more(rest);
}
function card(a,c){
 var s=a.queue_status||'expected',tags='',late=lateMinutes(a);
 if(late>0)tags+='<span class="journey-tag journey-tag-late">متأخر '+num(late)+' د</span>';
 if(a.wait_minutes)tags+='<span class="journey-wait '+(Number(a.wait_minutes)>waitLimit()?'late':'')+'">مستني '+num(a.wait_minutes)+' د</span>';
 if(a.priority>0)tags+='<span class="journey-tag">'+esc(PRIORITY[String(a.priority)]||('أولوية '+num(a.priority)))+(a.priority_reason?' · '+esc(a.priority_reason):'')+'</span>';
 if(a.can_view_finance&&a.patient_due!=null)tags+=hasDue(a)?'<span class="journey-tag journey-tag-due">عليه '+money(a.patient_due)+'</span>':(a.visit_id&&Number(a.patient_payable_total)>0?'<span class="journey-tag journey-tag-paid">مدفوع</span>':'');
 return '<article class="journey-card" data-appointment="'+esc(a.id)+'" data-lane="'+lane(a)+'"><header><div><h4>'+esc(a.patient_name)+'</h4><p>'+time(a.starts_at)+' · '+esc(a.provider_name)+'</p></div>'+badge(s)+'</header><p class="journey-card-service">'+esc(a.service_name)+(a.file_no?' · ملف '+esc(a.file_no):'')+'</p>'+(tags?'<div class="journey-card-meta">'+tags+'</div>':'')+'<div class="journey-card-actions">'+cardActions(a,c)+'</div></article>';
}
function column(key,title,items,c){return '<section class="journey-column" data-journey-lane="'+key+'"><header><h3>'+esc(title)+'</h3><span>'+num(items.length)+'</span></header><div class="journey-column-body">'+(items.map(function(a){return card(a,c);}).join('')||'<p class="journey-empty">مفيش حد هنا.</p>')+'</div></section>';}
function doctorStrip(data){
 var by={},sessions={},labels={scheduled:'مجدول',on_the_way:'في الطريق',arrived:'وصل',started:'بدأ العيادة',delayed:'متأخر',ended:'انتهى',cancelled:'ملغي'};(data.doctor_sessions||[]).forEach(function(s){sessions[s.provider_id]=s;});
 (data.appointments||[]).forEach(function(a){if(!by[a.provider_id])by[a.provider_id]={name:a.provider_name,waiting:0,inside:0};if(lane(a)==='waiting')by[a.provider_id].waiting++;if(lane(a)==='inside')by[a.provider_id].inside++;});
 var ids=Object.keys(by);if(!ids.length)return '';
 return '<section class="journey-doctors" aria-label="حالة الأطباء">'+ids.map(function(id){var d=by[id],s=sessions[id]||{},status=s.status||'scheduled',late=status==='delayed'?' '+num(s.eta_minutes||0)+' د':'';return '<article class="journey-doctor journey-doctor-'+esc(status)+'"><div><h4>'+esc(d.name)+'</h4><p><span class="journey-doctor-status">'+esc((labels[status]||status)+late)+'</span> · '+num(d.waiting)+' مستني · '+num(d.inside)+' جوه</p></div>'+more(action('doctor_on_the_way',id,'في الطريق')+action('doctor_arrived',id,'وصل')+action('doctor_started',id,'بدأ')+action('doctor_delayed',id,'تأخير')+action('doctor_ended',id,'انتهى'),'حالة الطبيب')+'</article>';}).join('')+'</section>';
}
function actionCenter(data){
 var alerts=[],limit=waitLimit();
 (data.appointments||[]).forEach(function(a){if(['waiting','called','on_hold'].includes(a.queue_status)&&Number(a.wait_minutes)>limit)alerts.push({type:'wait',title:a.patient_name,text:'مستني من '+a.wait_minutes+' دقيقة · '+a.provider_name,id:a.id});});
 (data.help_requests||[]).forEach(function(h){alerts.push({type:'help',title:h.patient_name,text:(h.message||'طلب مساعدة')+' · '+h.provider_name,id:h.id});});
 (data.doctor_sessions||[]).filter(function(s){return s.status==='delayed';}).forEach(function(s){alerts.push({type:'doctor',title:s.provider_name,text:'تأخير '+(s.eta_minutes||'—')+' دقيقة'+(s.delay_reason?' · '+s.delay_reason:''),id:s.provider_id});});
 return alerts.map(function(a){return '<article class="journey-alert"><div><strong>'+esc(a.title)+'</strong><p>'+esc(a.text)+'</p></div>'+(a.type==='help'?action('resolve_help',a.id,'تم التعامل','btn-primary'):a.type==='wait'?action('priority',a.id,'تحديد الأولوية'):'')+'</article>';}).join('')||'<p class="journey-empty">لا توجد حالات تحتاج تدخل الآن.</p>';
}
var FILTERS={all:function(){return true;},coming:function(a){return lane(a)==='coming';},late:function(a){return lateMinutes(a)>0;},waiting:function(a){return lane(a)==='waiting';},inside:function(a){return lane(a)==='inside';},done:function(a){return lane(a)==='done';},due:hasDue};
function visibleApps(){
 var apps=((state.data||{}).appointments||[]).slice().sort(function(x,y){return (Number(y.priority)||0)-(Number(x.priority)||0)||Date.parse(x.starts_at)-Date.parse(y.starts_at);});
 var f=FILTERS[state.filter]||FILTERS.all,q=String(state.query||'').trim().toLowerCase();
 return apps.filter(function(a){if(!f(a))return false;if(!q)return true;return [a.patient_name,a.phone,a.file_no].some(function(v){return String(v||'').toLowerCase().indexOf(q)!==-1;});});
}
function metricsHtml(apps){
 var n=function(f){return apps.filter(f).length;},dueSum=apps.filter(hasDue).reduce(function(t,a){return t+Number(a.patient_due||0);},0),finance=apps.some(function(a){return a.can_view_finance;});
 var done=apps.filter(FILTERS.done),noShow=done.filter(function(a){return a.queue_status==='no_show';}).length,cancelled=done.filter(function(a){return a.queue_status==='cancelled';}).length;
 var tiles=[['coming','جاي',n(FILTERS.coming),''],['late','متأخر',n(FILTERS.late),''],['waiting','مستني',n(FILTERS.waiting),''],['inside','جوه',n(FILTERS.inside),''],['done','خلص',done.length-noShow-cancelled,(noShow||cancelled)?'لم يحضر '+num(noShow)+' · ملغي '+num(cancelled):'']];
 if(finance)tiles.push(['due','عليه فلوس',n(hasDue),money(dueSum)]);
 return '<div class="journey-metrics">'+tiles.map(function(t){return '<button type="button" class="journey-metric'+(state.filter===t[0]?' is-active':'')+(t[0]==='late'&&t[2]?' is-alert':'')+'" data-journey-filter="'+t[0]+'" aria-pressed="'+(state.filter===t[0])+'"><span>'+esc(t[1])+'</span><strong>'+num(t[2])+'</strong>'+(t[3]?'<small>'+esc(t[3])+'</small>':'')+'</button>';}).join('')+'</div>';
}
function paintBoard(c){
 var root=currentRoot();if(!root)return;var host=root.querySelector('[data-journey-board-host]');if(!host)return;
 var apps=visibleApps(),filtered=state.filter!=='all'||String(state.query||'').trim();
 host.innerHTML=metricsHtml((state.data||{}).appointments||[])+(filtered?'<p class="journey-filter-note" role="status">بيظهر '+num(apps.length)+' من '+num(((state.data||{}).appointments||[]).length)+' '+action('clear_filter','','عرض الكل')+'</p>':'')+'<div class="journey-board">'+LANES.map(function(l){return column(l[0],l[1],apps.filter(function(a){return lane(a)===l[0];}),c);}).join('')+'</div>';
}
function paint(c){
 var root=currentRoot();if(!root)return;
 c=effectiveContext(c);root.dataset.journeyMode=c.sandbox?'trial':'live';
 if(state.error){root.innerHTML=sandboxChoice()+'<section class="journey-error"><p>'+esc(state.error.message||'تعذر تحميل تشغيل اليوم')+'</p>'+action('refresh','','إعادة المحاولة','btn-primary')+'</section>';bind(root,c);return;}
 var d=state.data||{},open=root.querySelector('details.journey-tools[open]');
 var tools=c.sandbox?'':more(action('static_qr','','QR الاستقبال')+action('settings','','إعدادات التشغيل')+action('patient_search','','بحث في ملفات المرضى')+(can('collect')?action('quick_collect','','تحصيل سريع'):'')+(can('finance')?action('finance_section','','الخزينة والوردية'):''),'أدوات الاستقبال').replace('class="journey-more"','class="journey-more journey-tools"').replace('class="journey-more-menu"','class="journey-more-menu journey-toolbar-actions"');
 var book=c.sandbox?action('sandbox_book','','حجز تجريبي جديد','btn-primary'):(can('book')?action('new_booking','','حجز جديد','btn-primary'):'');
 root.innerHTML=sandboxChoice()+'<div class="journey-toolbar"><div class="journey-toolbar-main">'+book+'<input type="search" class="journey-search" data-journey-search aria-label="ابحث بالاسم أو التليفون أو رقم الملف" placeholder="ابحث بالاسم أو التليفون أو رقم الملف" value="'+esc(state.query||'')+'"></div><div class="journey-date-nav">'+action('prev','','‹ السابق')+'<input aria-label="يوم الرحلة" type="date" data-journey-day value="'+esc(state.day)+'">'+action('next','','التالي ›')+(state.day!==cairoDay()?action('today','','اليوم','btn-primary'):'')+action('refresh','','تحديث')+tools+'</div></div>'+
 doctorStrip(d)+'<div class="journey-layout"><main data-journey-board-host></main><aside><section class="journey-section journey-action-center"><div class="journey-section-head"><h3>يحتاج تدخل</h3></div>'+actionCenter(d)+'</section><section class="journey-section"><div class="journey-section-head"><h3>اتصال الوكيل</h3></div><p>'+num((d.outbox||[]).filter(function(o){return !o.delivered_at;}).length)+' رسالة رحلة لم تُسلّم بعد.</p><p>'+num((d.outbox||[]).filter(function(o){return !!o.delivered_at;}).length)+' رسالة تم تسليمها.</p></section></aside></div>';
 if(open){var t=root.querySelector('details.journey-tools');if(t)t.open=true;}
 paintBoard(c);
 if(c.sandbox){var aside=root.querySelector('aside');aside.lastElementChild.remove();aside.insertAdjacentHTML('beforeend',window.SWNJourneySandbox.messages(state.sandbox));}
 bind(root,c);
}
function bind(root,c){
 root.onclick=function(e){
  var f=e.target.closest('[data-journey-filter]');if(f){e.preventDefault();state.filter=state.filter===f.dataset.journeyFilter?'all':f.dataset.journeyFilter;paintBoard(c);return;}
  var b=e.target.closest('[data-journey-action]');if(!b)return;e.preventDefault();var menu=b.closest('details.journey-more');if(menu)menu.open=false;handle(b.dataset.journeyAction,b.dataset.id,c);
 };
 var input=root.querySelector('[data-journey-day]');if(input)input.onchange=function(){state.day=input.value;load(c,true);};
 var search=root.querySelector('[data-journey-search]');if(search)search.oninput=function(){state.query=search.value;paintBoard(c);};
}
function openSection(c,key,after){
 var host=c&&c.host;if(!host)return;var back=host.querySelector('[data-rx-action="back"]');if(back)back.click();
 setTimeout(function(){var s=host.querySelector('[data-rx-section="'+key+'"]');if(!s){toast('هذا القسم غير متاح حسب صلاحيتك','error');return;}s.click();if(after)setTimeout(function(){var b=host.querySelector('[data-rx-action="'+after+'"]');if(b)b.click();},40);},40);
}
function collectDue(c,a){
 var inv=a&&a.due_invoices&&a.due_invoices[0];if(!inv)return;
 var known=((c.data||{}).invoices||[]).some(function(x){return x.id===inv.id;});
 if(known&&base.act&&base.act('collect-invoice',inv.id,c))return;
 toast('افتح «التحصيل والمستلزمات» لتحصيل فاتورة '+(inv.invoice_no||''),'error');openSection(c,'operations');
}
function accountModal(c,id){
 var a=findAppointment(id);if(!a)return;
 var finance=a.can_view_finance?'<section><h4>الحساب</h4><p>المطلوب من المريض '+money(a.patient_payable_total)+' · المدفوع '+money(a.patient_paid)+' · المتبقي '+money(a.patient_due)+'</p>'+(hasDue(a)&&can('collect')&&a.due_invoices&&a.due_invoices.length?'<button type="button" class="btn btn-primary" data-journey-account-collect>تحصيل المتبقي</button>':'')+'</section>':'';
 var m=infoModal(c,a.patient_name,'<div class="journey-account" data-wide><section><h4>الحجز</h4><p>'+time(a.starts_at)+' · '+esc(a.provider_name)+' · '+esc(a.service_name)+'</p><p>'+(a.file_no?'ملف '+esc(a.file_no)+' · ':'')+(a.phone?esc(a.phone):'')+'</p></section>'+finance+'</div>');
 var b=m&&m.querySelector('[data-journey-account-collect]');if(b)b.onclick=function(){m.remove();collectDue(c,a);};
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
  if(name==='clear_filter'){state.filter='all';state.query='';paint(c);return;}
  if(name==='account'){accountModal(c,id);return;}
  if(name==='collect_due'){collectDue(c,findAppointment(id));return;}
  if(name==='new_booking'){openSection(c,'appointments','book');return;}
  if(name==='patient_search'){openSection(c,'patients');return;}
  if(name==='finance_section'){openSection(c,'operations');return;}
  if(name==='quick_collect'){if(base.act&&base.act('collect','',c))return;openSection(c,'operations');return;}
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

function autoRefresh(){var root=currentRoot();if(!root||!root.isConnected||!state.context||state.loading||document.hidden||document.querySelector('.rx-modal')||root.querySelector('details.journey-more[open]')||(document.activeElement&&document.activeElement.matches&&document.activeElement.matches('[data-journey-search],[data-journey-day]')))return;load(state.context,false,true);}
if(!state.refreshTimer)state.refreshTimer=setInterval(autoRefresh,60000);
document.addEventListener('click',function(e){var inMenuButton=e.target.closest&&e.target.closest('details.journey-more button');document.querySelectorAll('details.journey-more[open]').forEach(function(d){if(!d.contains(e.target)||inMenuButton&&d.contains(inMenuButton))d.open=false;});},true);
var wrapped={};Object.keys(base).forEach(function(k){wrapped[k]=base[k];});
wrapped.sections=function(c){var rows=base.sections?base.sections(c):[];if(!rows.some(function(x){return x[0]==='journey';}))rows=rows.concat([['journey','تشغيل اليوم','رحلة المريض والطابور وحالة الأطباء والتنبيهات اللحظية.']]);return rows;};
wrapped.panel=function(section,c){if(section==='journey')return panel(c);return base.panel?base.panel(section,c):'';};
wrapped.act=function(a,id,c){if(a.indexOf('journey-')===0){handle(a.slice(8),id,c);return true;}return base.act?base.act(a,id,c):false;};
window.SSMPDReceptionModules=wrapped;

window.SWNTodayOperations={refresh:function(){if(state.context)refresh(state.context);},openStaticQr:function(){if(state.context)handle('static_qr','',state.context);}};
})();
