/* «أول شاشة حسب شغلك» (owner «طبقه» 2026-11-25, mockup docs/ui-references/mockups/nav-landing-by-role.html, help 271).
   The top of the personal home becomes the person's own work board:
     * reception / customer service: «تشغيل اليوم» numbers + buttons that open the reception sections directly;
     * nursing (day ops): one button to «تشغيل اليوم — التمريض»;
     * accountant / financial manager / GM / super admin with accounting: «شغلي النهارده» tasks with their counts;
     * everyone: «الأقسام اللي بتستخدمها أكتر», ordered by this browser's own use of the tabs.
   Display only. It reads with RPCs these roles already call on their own screens (clinic_reception_workspaces,
   clinic_reception_journey_hub_snapshot, clinic_finance_overview); every read fails quietly (the part is not shown).
   Buttons only navigate to screens the person can already open (checked with SSMPDRoles.canSeeTab). No writes. */
(function(w,d){'use strict';
var CACHE_MS=60000,cache={},USE_KEY='ssmpd_tab_use_v1',SKIP={home:1};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function R(){return w.SSMPDRoles;}
function me(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;}
function can(a,tab){var r=R();return !!(r&&a&&r.canSeeTab(a,tab));}
function any(a,list){var r=R();return !!(r&&a&&r.hasAnyRole&&r.hasAnyRole(a,list));}
function rpc(n,args){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.resolve(null);return Promise.resolve(c.rpc(n,args||{})).then(function(r){return !r||r.error?null:r.data;}).catch(function(){return null;});}
function cairoDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function dateWords(){return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'long'}).format(new Date());}
function nursingOnly(a){var r=R();return !!(r&&r.isNursingDayOnly&&r.isNursingDayOnly(a));}

/* which board this person gets (first match wins; content and other roles keep the home as it is) */
function kind(a){
 if(!a)return null;
 if(can(a,'reception_services')&&any(a,['reception','customer_service']))return 'desk';
 if(can(a,'reception_services')&&(nursingOnly(a)||any(a,['nursing','head_nursing'])))return 'nurse';
 if(can(a,'accounting')&&any(a,['accountant','financial_manager','general_manager','super_admin']))return 'finance';
 return null;}

/* ---------- tab use, kept in this browser only, per account ---------- */
function useKey(a){return USE_KEY+':'+a.id;}
function readUse(a){try{var o=JSON.parse(w.localStorage.getItem(useKey(a))||'{}');return o&&typeof o==='object'?o:{};}catch(e){return {};}}
function count(tab){var a=me();if(!a||!a.id||!tab||SKIP[tab]||!/^[a-z_]{2,40}$/.test(tab))return;var o=readUse(a);o[tab]=Math.min(9999,(Number(o[tab])||0)+1);try{w.localStorage.setItem(useKey(a),JSON.stringify(o));}catch(e){}}
function topTabs(a,n){var o=readUse(a),T=w.SSMPDUITitles;return Object.keys(o).filter(function(t){return can(a,t)&&Number(o[t])>0;}).sort(function(x,y){return o[y]-o[x];}).slice(0,n).map(function(t){return {tab:t,label:T&&T.label?T.label(t,a):t,uses:o[t]};});}
d.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-goto],[data-home-tab],[data-rl-tab]');if(!b)return;count(b.dataset.goto||b.dataset.homeTab||b.dataset.rlTab);},true);

/* ---------- navigation ---------- */
function gotoTab(tab){if(w.SSMPDGotoTab)w.SSMPDGotoTab(tab);}
function openReception(section){var a=me();if(!can(a,'reception_services'))return;if(w.SSMPDReception&&w.SSMPDReception.openSection){Promise.resolve(w.SSMPDReception.openSection(section)).catch(function(){gotoTab('reception_services');});return;}gotoTab('reception_services');}
function openFinanceToday(){var a=me();if(!can(a,'accounting'))return;if(w.SSMPDRenderAccounting&&w.SSMPDRenderAccounting.selectSection)w.SSMPDRenderAccounting.selectSection('overview',null);gotoTab('accounting');}

/* ---------- data ---------- */
function lane(s){s=s||'expected';if(s==='expected'||s==='on_the_way')return 'coming';if(s==='waiting'||s==='called')return 'waiting';if(s==='in_service'||s==='on_hold')return 'inside';return 'done';}
function deskData(){return rpc('clinic_reception_workspaces',{}).then(function(list){var live=(Array.isArray(list)?list:[]).filter(function(x){return x&&x.mode==='live';})[0];if(!live)return null;var day=cairoDay();
 return rpc('clinic_reception_journey_hub_snapshot',{p_workspace:live.id,p_day:day}).then(function(j){if(!j)return null;var apps=j.appointments||[],now=Date.now(),c={total:apps.length,waiting:0,inside:0,done:0,late:0};
  /* same counting as the «تشغيل اليوم» chips: late = still coming after its time; done excludes no-show and cancelled */
  apps.forEach(function(x){var l=lane(x.queue_status),t=Date.parse(x.starts_at);if(l==='waiting')c.waiting++;else if(l==='inside')c.inside++;else if(l==='done'){if(x.queue_status!=='no_show'&&x.queue_status!=='cancelled')c.done++;}else if(!isNaN(t)&&t<now-60000)c.late++;});
  return c;});});}
function financeData(){return rpc('clinic_finance_overview',{}).then(function(dd){if(!dd||typeof dd!=='object')return null;var F=w.SSMPDFinanceToday,tasks=F&&F.financeTasks?F.financeTasks(dd,null):[];return {review:!!dd.can_review,tasks:tasks.filter(function(t){return Number(t.count)>0;}).map(function(t){return {title:t.title,count:Number(t.count),sub:t.sub,btn:t.btn};})};});}
var flight={};
function load(k,a){var key=a.id+'|'+k,hit=cache[key];if(hit&&hit.at>Date.now()-CACHE_MS)return Promise.resolve(hit.data);if(flight[key])return flight[key];var p=k==='desk'?deskData():k==='finance'?financeData():Promise.resolve({});return flight[key]=p.then(function(v){cache[key]={at:Date.now(),data:v};delete flight[key];return v;});}

/* ---------- drawing ---------- */
function kpi(n,t,hot){return '<div class="rl-k'+(hot?' is-hot':'')+'"><b>'+esc(n)+'</b><small>'+esc(t)+'</small></div>';}
function btn(label,attr,cls){return '<button type="button" class="btn '+(cls||'')+'" '+attr+'>'+esc(label)+'</button>';}
function hero(k,a,v){
 if(k==='desk'){var acts=btn('افتح تشغيل اليوم','data-rl-rx="journey"','rl-main')+btn('الحجز والاستقبال','data-rl-rx="appointments"')+btn('ملفات المرضى','data-rl-rx="patients"','rl-ghost');
  var kp=v?'<div class="rl-kp">'+kpi(v.total,'حجز النهارده')+kpi(v.waiting,'مستنيين دلوقتي',v.waiting>0)+kpi(v.late,'متأخرين عن ميعادهم',v.late>0)+kpi(v.done,'خلّصوا الكشف')+'</div>':'';
  return '<h2>تشغيل اليوم — '+esc(dateWords())+'</h2><p class="rl-sub">'+(v?'أرقام النهارده من شاشة تشغيل اليوم.':'افتح تشغيل اليوم علشان تشوف الطابور والحجوزات.')+'</p>'+kp+'<div class="rl-acts">'+acts+'</div><div data-rd-home-slot hidden></div>';}
 if(k==='nurse')return '<h2>تشغيل اليوم — التمريض</h2><p class="rl-sub">مرضى النهارده في كل قسم، والتجهيز قبل الكشف.</p><div class="rl-acts">'+btn('افتح تشغيل اليوم','data-rl-rx="'+(nursingOnly(a)?'nursing':'journey')+'"','rl-main')+'</div>';
 if(k==='finance'){var rows=v&&v.tasks||[],total=rows.reduce(function(s,t){return s+t.count;},0);
  return '<h2>شغلي النهارده — الحسابات</h2><p class="rl-sub">'+(v?(total?(total===1?'حاجة واحدة مستنياك':total+' حاجات مستنياك'):'مفيش حاجة مستنياك دلوقتي ✓'):'افتح الحسابات علشان تشوف شغلك.')+'</p>'+
   (rows.length?'<ul class="rl-rows">'+rows.map(function(t){return '<li class="rl-row"><div><b>'+esc(t.title)+'</b><small>'+esc(t.sub)+'</small></div><span class="rl-n">'+esc(t.count)+'</span>'+btn(t.btn,'data-rl-ft')+'</li>';}).join('')+'</ul>':'')+
   '<div class="rl-acts">'+btn('افتح شغلي النهارده','data-rl-ft','rl-main')+'</div>';}
 return '';}
function tiles(a){var top=topTabs(a,4);if(top.length<2)return '';return '<section class="rl-card rl-used" data-rl-used><h3>الأقسام اللي بتستخدمها أكتر</h3><p class="rl-sub">بتترتب لوحدها حسب استخدامك على الجهاز ده.</p><div class="rl-tiles">'+top.map(function(x){return '<button type="button" data-rl-tab="'+esc(x.tab)+'">'+esc(x.label)+'</button>';}).join('')+'</div></section>';}
function wire(host){
 host.querySelectorAll('[data-rl-rx]').forEach(function(b){b.onclick=function(){openReception(b.dataset.rlRx);};});
 host.querySelectorAll('[data-rl-ft]').forEach(function(b){b.onclick=openFinanceToday;});
 host.querySelectorAll('[data-rl-tab]').forEach(function(b){b.onclick=function(){gotoTab(b.dataset.rlTab);};});
 /* «درجي» (reception only, reception-drawer.js) under the desk numbers */
 var rd=host.querySelector('[data-rd-home-slot]');if(rd&&w.SSMPDReceptionDrawer)w.SSMPDReceptionDrawer.mountHome(rd);}

/* mount into the slot the personal home leaves at its top; safe to call on every home redraw */
function mount(host,a){
 a=a||me();if(!host||!a||!a.id)return Promise.resolve();
 var k=kind(a),serial=(host.__rl=(host.__rl||0)+1),key=a.id+'|'+k,hit=k&&cache[key];
 function draw(v){if(host.__rl!==serial||!host.isConnected)return;host.innerHTML=(k?'<section class="rl-card rl-hero" data-rl-kind="'+k+'">'+hero(k,a,v)+'</section>':'')+tiles(a);host.hidden=!host.innerHTML;wire(host);}
 draw(hit?hit.data:null);
 if(!k||k==='nurse')return Promise.resolve();
 return load(k,a).then(draw);}
w.SSMPDRoleLanding={mount:mount,kind:kind,count:count,topTabs:topTabs,reset:function(){cache={};flight={};}};
})(window,document);
