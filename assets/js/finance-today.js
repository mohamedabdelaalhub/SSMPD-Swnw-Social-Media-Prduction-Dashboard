/* «شغلي النهارده» (owner «طبقه» 2026-11-21, mockup docs/ui-references/mockups/finance-simple-roles.html).
   The finance area opens on a few big, clear tasks for the person's role instead of a crowded screen; everything else stays one click
   away under «تفاصيل أكتر» (the overview numbers) and in the side rail. No new permissions and no new data: the counts come from the
   existing clinic_finance_overview() (needs), and every button opens a section or modal that already exists.
     * reviewer (financial manager / GM / owner): استلم كاش من الخزن — اعتمادات مستنياك — فروق الخزينة — مراجعة الورديات — ملخص اليوم
     * finance staff without review (accountant): طلبات الصرف — سند قبض / صرف — كشف الخزينة — حساب دكتور أو مورد
     * cashier (reception «خزينة الاستقبال»): سلّم كاش لزميل أو للرئيسية — اقفل ورديتي وسلّم الكاش — مقدمات الحجز */
(function(w,d){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function n(v){var x=Number(v);return isNaN(x)?0:x;}
function card(i,t,hot){return '<div class="ft-task'+(hot?' is-hot':'')+'"><span class="ft-n">'+i+'</span><b>'+esc(t.title)+(t.count?' <span class="ft-badge">'+esc(t.count)+'</span>':'')+'</b><span class="ft-sub">'+esc(t.sub)+'</span>'+
 '<button type="button" class="btn'+(i===1?' btn-primary':'')+'" '+t.attr+'>'+esc(t.btn)+'</button></div>';}
function band(title,sub,tasks){return '<section class="ft" dir="rtl" data-ft><div class="ft-head"><b>'+esc(title)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div><div class="ft-tasks">'+
 tasks.map(function(t,i){return card(i+1,t,!!t.count);}).join('')+'</div></section>';}
function need(dd,kind){var x=(dd.needs||[]).filter(function(v){return v.kind===kind;})[0];return x?n(x.count):0;}

/* reviewer / accountant tasks from the overview payload; `allowed(id)` hides a task whose section this person cannot open */
function financeTasks(dd,allowed){
 var ok=function(id){return !allowed||allowed(id);},t=[];
 if(dd.can_review){
  t.push({title:'استلم كاش من الخزن',count:need(dd,'handover'),sub:'خزن التحصيل اللي طلبت التسليم — عدّ الفلوس واعتمد.',btn:'استلم',attr:'data-ft-go="shifts"'});
  t.push({title:'اعتمادات مستنياك',count:need(dd,'requests'),sub:'صرف وتصحيح وإلغاء خدمة — كل اللي محتاج موافقة تانية.',btn:'اعتمد',attr:'data-ft-go="requests"'});
  t.push({title:'فروق الخزينة',count:need(dd,'cash_cases'),sub:'وردية اتقفلت بفرق في الجرد — قرّر من غير خصم تلقائي.',btn:'راجع الفروق',attr:'data-ft-go="cases"'});
  t.push({title:'مراجعة الورديات',count:need(dd,'shift_review'),sub:'ورديات اتقفلت ومستنية مراجعة شخص تاني.',btn:'راجع',attr:'data-ft-go="shifts"'});
  t.push({title:'ملخص اليوم',count:0,sub:'التحصيل والصرف والكاش في الخزن والبنك.',btn:'افتح الملخص',attr:'data-ft-more-open'});
 }else{
  t.push({title:'طلبات الصرف',count:need(dd,'requests'),sub:'سجّل طلب صرف أو تابع طلباتك.',btn:'افتح الطلبات',attr:'data-ft-go="requests"'});
  t.push({title:'سند قبض / سند صرف',count:0,sub:'أي فلوس داخلة أو خارجة من غير تحصيل مريض.',btn:'السندات',attr:'data-ft-go="shifts"'});
  t.push({title:'كشف الخزينة',count:0,sub:'الرصيد والحركات لأي خزينة في أي يوم.',btn:'افتح',attr:'data-ft-go="shifts"'});
  t.push({title:'حساب دكتور أو مورد',count:0,sub:'كام له، كام اتصرف، والباقي.',btn:'افتح',attr:'data-ft-go="'+(ok('doctor-accounts')?'doctor-accounts':'suppliers')+'"'});
 }
 return t.filter(function(x){var m=/data-ft-go="([^"]+)"/.exec(x.attr);return !m||ok(m[1]);});
}

/* Accounting home: band on top, the existing overview under «تفاصيل أكتر» (rendered the first time it is opened). */
function mountAccounting(host,o){
 o=o||{};var db=w.SSMPDDb;if(!db||!db.client)return Promise.resolve(null);
 host.innerHTML='<div data-ft-band><p class="ft-loading">جاري تجهيز شغلك…</p></div><details class="ft-more" data-ft-more><summary>تفاصيل أكتر — الأرقام والرسوم</summary><div data-ft-overview></div></details>';
 var more=host.querySelector('[data-ft-more]'),drawn=false,key='ssmpd_ft_more_'+((w.SSMPDAuth&&w.SSMPDAuth.currentAdmin&&w.SSMPDAuth.currentAdmin.id)||'x');
 function draw(){if(drawn||!w.SSMPDAccountingOverview)return;drawn=true;w.SSMPDAccountingOverview.render(host.querySelector('[data-ft-overview]'),{go:o.go,onUnavailable:function(){},onReady:function(){}});}
 more.addEventListener('toggle',function(){try{localStorage.setItem(key,more.open?'1':'0');}catch(_){}if(more.open)draw();});
 return Promise.resolve(db.client.rpc('clinic_finance_overview')).then(function(r){
  if(!r||r.error)throw (r&&r.error)||Error('no data');if(!host.isConnected)return r.data;var dd=r.data||{};
  var paint=function(extra){host.querySelector('[data-ft-band]').innerHTML=band('شغلي النهارده',dd.can_review?'المهام اللي مستنياك دلوقتي — الرقم البرتقالي يعني فيه حاجة مستنياك':'اختصارات شغلك اليومي',(extra||[]).concat(financeTasks(dd,o.allowed)));
   host.querySelectorAll('[data-ft-go]').forEach(function(b){b.onclick=function(){if(o.go)o.go(b.getAttribute('data-ft-go'));};});
   host.querySelectorAll('[data-ft-main-count]').forEach(function(b){b.onclick=function(){if(w.SSMPDMainCount)w.SSMPDMainCount.autoOpen=true;if(o.go)o.go('shifts');};});
   var mo=host.querySelector('[data-ft-more-open]');if(mo)mo.onclick=function(){more.open=true;draw();more.scrollIntoView({behavior:'smooth',block:'start'});};};
  paint([]);
  /* «جرد الخزينة الرئيسية» (20261122200000): the custodian's count task first; reviewers get a hot task for counts waiting > 24h */
  if(w.SSMPDMainCount&&(!o.allowed||o.allowed('shifts')))w.SSMPDMainCount.status().then(function(v){var t=w.SSMPDMainCount.tasks(v);if(t.length&&host.isConnected)paint(t);}).catch(function(){});
  if(!dd.can_review)more.remove();else{var keep=null;try{keep=localStorage.getItem(key);}catch(_){}if(keep==='1'){more.open=true;draw();}}
  return dd;});
}

/* Cashier band for «خزينة الاستقبال ومقدمات الحجز». Buttons reuse the existing actions: the peer/main handover modal and «إنهاء الوردية». */
function cashierHtml(data){
 var me=data&&data.me,own=((data&&(data.active_shifts||data.shifts))||[]).filter(function(s){return s.cashier_id===me&&!s.is_main&&s.status==='open';})[0];
 if(!own)return band('شغلي النهارده','مفيش وردية مفتوحة باسمك — افتح ورديتك الأول علشان تحصّل وتسلّم.',[]);
 var t=[];
 if(!own.ended_at){
  t.push({title:'سلّم كاش لزميل أو للرئيسية',count:0,sub:'جزء من الكاش وأنت مكمّل، أو كله وأنت ماشي.',btn:'تسليم',attr:'data-ft-peer'});
  t.push({title:'اقفل ورديتي وسلّم الكاش',count:0,sub:'عدّ الفلوس فئة فئة، والطلب بيروح للرئيسية لوحده.',btn:'اقفل الوردية',attr:'data-fin-action="treasury-end" data-id="'+esc(own.id)+'"'});
 }else t.push({title:'ورديتك خلصت',count:1,sub:'مستني المسؤول عن الخزينة الرئيسية يعدّ ويعتمد الاستلام.',btn:'شوف التسليم',attr:'data-ft-scroll="handover"'});
 t.push({title:'مقدمات الحجز',count:0,sub:'إثبات الفيزا والتحويلات وطلبات المقدمات.',btn:'افتح',attr:'data-ft-scroll="advances"'});
 return band('شغلي النهارده',(own.register_name||'')+(own.ended_at?' — انتهت وبانتظار الاستلام':' — الوردية مفتوحة'),t);
}
function wireCashier(host){
 var p=host.querySelector('[data-ft-peer]');if(p)p.onclick=function(){if(w.SSMPDPeerHandover)w.SSMPDPeerHandover.openSend();};
 host.querySelectorAll('[data-ft-scroll]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-ft-scroll'),re=k==='handover'?/تسليم التحصيل/:/المقدمات|مقدمات/;
  var hit=[].filter.call(host.querySelectorAll('h3,h4'),function(x){return re.test(x.textContent);})[0];if(hit&&hit.scrollIntoView)hit.scrollIntoView({behavior:'smooth',block:'start'});};});
}

w.SSMPDFinanceToday={mountAccounting:mountAccounting,financeTasks:financeTasks,cashierHtml:cashierHtml,wireCashier:wireCashier};
})(window,document);
