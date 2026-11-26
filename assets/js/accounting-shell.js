/* «الحسابات» — unified shell (owner-approved mockup docs/ui-references/mockups/accounting.html, 2026-11-18).
   One side rail replaces the three sub-tabs, the treasury group bar, the «فتح القسم» cards and the back buttons.
   Every section of pricing / treasury / inventory is one click away; on phones the rail is a drawer.
   The shell only draws navigation: each section is still rendered by its own module. */
(function(){
'use strict';
var I={shifts:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',invoices:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',payments:'<path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H8"/>','masa-payments':'<path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H8"/>','masa-net':'<path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/>',advances:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',requests:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',doctors:'<path d="M8 3v5a4 4 0 0 0 8 0V3M12 12v3a4 4 0 0 0 8 0v-2"/><circle cx="20" cy="11" r="2"/>','doctor-accounts':'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M17 8v6M14 11h6"/>',suppliers:'<path d="M3 7h11v10H3zM14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',payroll:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>','staff-insurance':'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>','staff-tax':'<path d="M6 3h12v18H6zM9 8l6 8M9 16l6-8"/>','staff-settlement':'<path d="M5 12l4 4L19 6"/>',bank:'<path d="M4 21V9l8-6 8 6v12M8 21v-7M12 21v-7M16 21v-7M3 21h18"/>',insurance:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12h6M12 9v6"/>',cases:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>','shift-expenses':'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 12h8"/>',ledger:'<path d="M5 4h14v16H5z"/><path d="M9 4v16M12 8h4M12 12h4"/>',manual:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',chart:'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 8v3h12V8M12 11v5"/>',assets:'<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M8 8V5h8v3"/>',taxes:'<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',reports:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',audit:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',supplies:'<path d="M9 3h6v4l3 3v11H6V10l3-3z"/>',services:'<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v8M8 12h8"/>',packages:'<path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/>','inv:overview':'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>','inv:stock':'<path d="M3 7h18M3 12h18M3 17h18"/>','inv:operations':'<path d="M4 12h12M12 6l6 6-6 6"/>','inv:stocktakes':'<path d="M9 11l3 3 8-8"/><path d="M20 12v7H4V5h11"/>','inv:reporting':'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',overview:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'};
/* Rail groups (owner mockup). Colours follow the menu's group palette. */
var GROUPS=[
 {id:'home',name:'',c:'#0F369D',t:'#E8EEFB',items:[['overview','نظرة عامة']]},
 {id:'cash',name:'الخزينة اليومية',c:'#2563EB',t:'#E5ECFD',items:[['shifts','الخزائن والورديات'],['invoices','الخدمات والفواتير'],['payments','التحصيل'],['advances','مقدمات الحجز']]},
 {id:'dues',name:'الصرف والمستحقات',c:'#D4087F',t:'#FBE6F2',items:[['requests','طلبات الصرف'],['month-end','حسابات آخر الشهر'],['doctor-accounts','حساب الأطباء'],['doctors','عقود الأطباء'],['suppliers','الموردين'],['payroll','المرتبات والسلف'],['staff-insurance','سداد التأمينات'],['staff-tax','ضريبة المرتبات'],['staff-settlement','مخالصات الموظفين']]},
 {id:'review',name:'المراجعة والتسويات',c:'#09A0BE',t:'#E1F4F7',items:[['bank','البنك والبطاقات'],['insurance','التأمين'],['cases','فروق الخزينة'],['shift-expenses','مصروفات الورديات']]},
 {id:'accounting',name:'المحاسبة',c:'#6600FF',t:'#EFE5FF',items:[['ledger','القيود وميزان المراجعة'],['manual','الأرصدة والتصحيحات'],['chart','الشجرة المحاسبية'],['assets','الأصول والإهلاك'],['taxes','الضرائب']]},
 {id:'reports',name:'التقارير',c:'#2F7D5C',t:'#E7F3EE',items:[['reports','القوائم المالية'],['masa-payments','تحصيل ماسا'],['masa-net','صافي القديم (ماسا)'],['audit','سجل المراجعة']]},
 {id:'pricing',name:'التسعير',c:'#A87B00',t:'#F5EFE0',items:[['supplies','المستلزمات'],['services','الخدمات'],['packages','الباكدجات']]},
 {id:'inventory',name:'المخازن',c:'#4D7C0F',t:'#EAEFE2',items:[['inv:overview','نظرة على المخزن'],['inv:stock','المخزون'],['inv:operations','العمليات'],['inv:stocktakes','الجرد'],['inv:reporting','تقارير المخزن']]},
 {id:'settings',name:'الإعدادات',c:'#475569',t:'#EEF1F5',items:[['settings','الخزن والإقفال']]}
];
var PRICING=['supplies','services','packages'];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function kind(id){if(id==='overview')return 'overview';return PRICING.indexOf(id)>=0?'pricing':/^inv:/.test(id)?'inventory':'cash';}
function closedKey(){var a=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;return 'ssmpd_acs_closed_'+(a&&a.id||'x');}
function readClosed(){try{return JSON.parse(localStorage.getItem(closedKey())||'[]')||[];}catch(_){return [];}}
function writeClosed(list){try{localStorage.setItem(closedKey(),JSON.stringify(list));}catch(_){}}
function sound(on){var M=window.SSMPDMotion;try{if(M&&M.sound&&M.sound.toggle)M.sound.toggle(on);}catch(_){}}
function label(id){for(var i=0;i<GROUPS.length;i++)for(var j=0;j<GROUPS[i].items.length;j++)if(GROUPS[i].items[j][0]===id)return GROUPS[i].items[j][1];return '';}

/* mount(container,{allowed:fn(id)->bool, active:id, onSelect:fn(id)}) → {view, setActive, setBadges, refresh} */
function mount(container,opts){
 var active=opts.active,badges={};document.querySelectorAll('body>.acs-rail,body>.acs-scrim').forEach(function(n){n.remove();});
 container.innerHTML='<div class="acs" dir="rtl"><div class="acs-mbar"><button type="button" class="acs-open" data-acs-open aria-haspopup="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h16"/></svg><span>أقسام الحسابات</span><b data-acs-current></b></button></div>'+
  '<aside class="acs-rail" data-acs-rail aria-label="أقسام الحسابات"><div class="acs-rail-head"><b>أقسام الحسابات</b><button type="button" class="acs-close" data-acs-close aria-label="إغلاق">×</button></div><label class="acs-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input type="search" data-acs-q placeholder="ابحث في الحسابات…" aria-label="ابحث في أقسام الحسابات"></label><nav data-acs-groups></nav></aside>'+
  '<div class="acs-scrim" data-acs-scrim></div><div class="acs-main" id="acc-sub-view"></div></div>';
 var root=container.firstChild,rail=root.querySelector('[data-acs-groups]'),q=root.querySelector('[data-acs-q]');
 function draw(){var closed=readClosed();
  rail.innerHTML=GROUPS.map(function(g){var items=g.items.filter(function(it){return opts.allowed(it[0]);});if(!items.length)return '';
   var isClosed=closed.indexOf(g.id)>=0&&!items.some(function(it){return it[0]===active;});
   if(!g.name)return '<div class="acs-g acs-g-top" data-acs-group="'+g.id+'" style="--c:'+g.c+';--t:'+g.t+'">'+items.map(function(it){return '<button type="button" class="acs-i" data-acs-go="'+it[0]+'"'+(it[0]===active?' aria-current="page"':'')+'><span class="acs-ic"><svg viewBox="0 0 24 24" aria-hidden="true">'+(I[it[0]]||I.settings)+'</svg></span><span class="acs-l">'+esc(it[1])+'</span></button>';}).join('')+'</div>';
   return '<div class="acs-g'+(isClosed?' closed':'')+'" data-acs-group="'+g.id+'" style="--c:'+g.c+';--t:'+g.t+'"><button type="button" class="acs-gh" aria-expanded="'+!isClosed+'"><i aria-hidden="true"></i><span>'+esc(g.name)+'</span><svg class="acs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="acs-gi"><div>'+
    items.map(function(it){var b=badges[it[0]];return '<button type="button" class="acs-i" data-acs-go="'+it[0]+'"'+(it[0]===active?' aria-current="page"':'')+'><span class="acs-ic"><svg viewBox="0 0 24 24" aria-hidden="true">'+(I[it[0]]||I.settings)+'</svg></span><span class="acs-l">'+esc(it[1])+'</span>'+(b?'<em aria-label="'+b+' محتاج متابعة">'+b+'</em>':'')+'</button>';}).join('')+'</div></div></div>';}).join('');
  root.querySelector('[data-acs-current]').textContent=label(active);
  filter();}
 function filter(){var t=(q.value||'').trim();rail.querySelectorAll('.acs-i').forEach(function(b){b.hidden=!!t&&b.textContent.indexOf(t)<0;});rail.querySelectorAll('.acs-g').forEach(function(g){var any=[].some.call(g.querySelectorAll('.acs-i'),function(b){return !b.hidden;});g.hidden=!any;if(t)g.classList.remove('closed');});}
 /* phones: the drawer is moved to <body> while open, so no transformed/animated ancestor can trap position:fixed */
 var railEl=root.querySelector('[data-acs-rail]'),scrimEl=root.querySelector('[data-acs-scrim]');
 function open(on){if(on){document.body.appendChild(scrimEl);document.body.appendChild(railEl);railEl.getBoundingClientRect();}
  document.body.classList.toggle('acs-drawer-open',!!on);
  if(on){var cur=rail.querySelector('[aria-current]');if(cur)railEl.scrollTop=Math.max(0,cur.offsetTop-railEl.clientHeight/2);var f=railEl.querySelector('[data-acs-close]');if(f)f.focus({preventScroll:true});}
  else if(railEl.parentNode!==root){var back=function(){if(document.body.classList.contains('acs-drawer-open'))return;if(!root.isConnected){railEl.remove();scrimEl.remove();return;}root.insertBefore(railEl,root.querySelector('.acs-main'));root.insertBefore(scrimEl,root.querySelector('.acs-main'));};setTimeout(back,400);}}
 rail.addEventListener('click',function(e){var h=e.target.closest('.acs-gh');if(h){var g=h.parentNode,id=g.dataset.acsGroup,closed=readClosed().filter(function(x){return x!==id;});var now=!g.classList.contains('closed');g.classList.toggle('closed',now);h.setAttribute('aria-expanded',String(!now));if(now)closed.push(id);writeClosed(closed);sound(!now);return;}
  var b=e.target.closest('[data-acs-go]');if(!b)return;open(false);if(b.dataset.acsGo===active&&!opts.reselect)return;api.setActive(b.dataset.acsGo);opts.onSelect(b.dataset.acsGo);});
 q.addEventListener('input',filter);
 root.querySelector('[data-acs-open]').onclick=function(){open(true);};root.querySelector('[data-acs-close]').onclick=function(){open(false);};root.querySelector('[data-acs-scrim]').onclick=function(){open(false);};
 railEl.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.body.classList.contains('acs-drawer-open')){open(false);root.querySelector('[data-acs-open]').focus();}});
 var api={view:root.querySelector('#acc-sub-view'),setActive:function(id){active=id;rail.querySelectorAll('.acs-i').forEach(function(b){if(b.dataset.acsGo===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});var g=rail.querySelector('[data-acs-go="'+id+'"]');g=g&&g.closest('.acs-g');if(g&&g.classList.contains('closed')){g.classList.remove('closed');g.querySelector('.acs-gh').setAttribute('aria-expanded','true');}root.querySelector('[data-acs-current]').textContent=label(id);},
  setBadges:function(map){badges=map||{};draw();},refresh:draw};
 /* phones (owner 2026-11-18): every treasury table turns into one card per row. Each cell gets its column title
    (data-th) so the card can show «الرصيد 1,000» instead of a sideways-scrolling table. */
 /* in-page shortcuts to another section: <button data-acs-jump="doctors"> */
 root.addEventListener('click',function(e){var j=e.target.closest('[data-acs-jump]');if(!j)return;var id=j.getAttribute('data-acs-jump');if(!opts.allowed(id))return;api.setActive(id);opts.onSelect(id);window.scrollTo(0,0);});
 function labelTables(){api.view.querySelectorAll('.fc-table table:not([data-acs-cards]),.rx-table table:not([data-acs-cards]),table.acc-table:not([data-acs-cards]),.inv-scroll table:not([data-acs-cards])').forEach(function(t){var th=[].map.call(t.querySelectorAll('thead th'),function(x){return x.textContent.trim();});if(!th.length)return;t.setAttribute('data-acs-cards','');t.querySelectorAll('tbody tr').forEach(function(tr){[].forEach.call(tr.children,function(td,i){if(th[i]&&!td.hasAttribute('data-th'))td.setAttribute('data-th',th[i]);});});});}
 if(window.MutationObserver){var mo=new MutationObserver(function(){if(!root.isConnected){mo.disconnect();return;}labelTables();if(window.SSMPDFinanceLabels)window.SSMPDFinanceLabels.translate(api.view);});mo.observe(api.view,{childList:true,subtree:true});}
 document.body.classList.remove('acs-drawer-open');draw();return api;
}
/* floating help / assistant buttons (owner 2026-11-18): on phones they slide away while you scroll down and come
   back when you scroll up, so they never sit on an amount or a button you are reading */
var lastY=0;window.addEventListener('scroll',function(){var b=document.body,y=window.scrollY||0;if(!document.querySelector('.acs')){b.classList.remove('acs-fab-hide');lastY=y;return;}
 if(y>lastY+8&&y>160)b.classList.add('acs-fab-hide');else if(y<lastY-8||y<60)b.classList.remove('acs-fab-hide');if(Math.abs(y-lastY)>8)lastY=y;},{passive:true});
window.SSMPDAccountingShell={mount:mount,groups:GROUPS,kind:kind,label:label,pricing:PRICING};
})();
