/* «درجي» — reception daily drawer actions in one or two taps (owner «طبقه» 2026-11-26, mockup docs/ui-references/mockups/reception-drawer-actions.html).
   Shown to the reception role only (customer service has no drawer). Two places:
     * the reception home hero (role-landing.js «تشغيل اليوم») — a strip under today's numbers;
     * the top of «تشغيل اليوم» (today-operations.js) — a compact bar above the queue.
   No drawer balance anywhere (blind count). No new action: every button opens the EXISTING screen/form —
     direct calls where one is exported (SSMPDReception.openShiftOpen, SSMPDPeerHandover.openSend), otherwise it opens the
     existing tab/section and presses the same button there (data-fin-action="advance-receive" / "treasury-end",
     data-rse-spend, data-journey-action="quick_collect"). The only read is clinic_reception_shift_reminder (already called by
     reception-shift-reminder.js) to know whether the employee's own shift is open. */
(function(w,d){'use strict';
var CACHE_MS=30000,cache=null,flight=null;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function me(){return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;}
function R(){return w.SSMPDRoles;}
function canTab(a,t){var r=R();return !!(r&&a&&r.canSeeTab&&r.canSeeTab(a,t));}
function isReception(a){var r=R();return !!(a&&r&&(r.hasAnyRole?r.hasAnyRole(a,['reception']):a.role==='reception'));}
function eligible(a){return isReception(a)&&canTab(a,'booking_cash');}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'info');}
function hhmm(v){var t=new Date(v);if(isNaN(t))return '';return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit'}).format(t);}

/* ---------- own shift state (read-only, the same RPC the safe button uses) ---------- */
function shiftState(force){if(!force&&cache&&cache.at>Date.now()-CACHE_MS)return Promise.resolve(cache.v);if(flight)return flight;
 var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.resolve(null);
 return flight=Promise.resolve(c.rpc('clinic_reception_shift_reminder')).then(function(r){return !r||r.error?null:r.data||null;}).catch(function(){return null;}).then(function(v){cache={at:Date.now(),v:v};flight=null;return v;});}
function isOpen(s){return !!(s&&(s.state==='open'||s.state==='close_due'));}

/* ---------- navigation helpers ---------- */
function gotoTab(t){if(w.SSMPDGotoTab)w.SSMPDGotoTab(t);else{var n=d.querySelector('[data-goto="'+t+'"]');if(n)n.click();}}
function visible(el){return !!(el&&el.isConnected&&!el.disabled&&(el.offsetParent!==null||el.getClientRects().length));}
/* wait for the existing button to appear on the opened screen, then press it */
function pressWhenReady(sel,label,ms,anyVis){var end=Date.now()+(ms||9000);return new Promise(function(ok){(function tick(){var el=[].slice.call(d.querySelectorAll(sel)).filter(function(x){return anyVis?x.isConnected&&!x.disabled:visible(x);})[0];
 if(el){el.click();ok(true);return;}if(Date.now()>end){toast('الشاشة اتفتحت — دوس «'+label+'» من هناك.');ok(false);return;}setTimeout(tick,150);})();});}
function openReception(section){var a=me();if(!canTab(a,'reception_services'))return Promise.resolve(false);
 return Promise.resolve(w.SSMPDReception&&w.SSMPDReception.openSection?w.SSMPDReception.openSection(section):gotoTab('reception_services')).catch(function(){gotoTab('reception_services');});}

var ACT={
 open_shift:function(){var api=w.SSMPDReception&&w.SSMPDReception.openShiftOpen;if(api)return Promise.resolve(api(true)).catch(function(e){toast(e&&e.message||'تعذر فتح شاشة الوردية','error');});gotoTab('booking_cash');return pressWhenReady('[data-fin-action="booking-open"]','فتح وردية استقبال');},
 collect:function(){var here=d.querySelector('[data-journey-action="quick_collect"]');if(here){here.click();return Promise.resolve(true);}
  return openReception('journey').then(function(){return pressWhenReady('[data-journey-action="quick_collect"]','تحصيل سريع',9000,true);});},
 expense:function(){var api=w.SSMPDShiftExpenses&&w.SSMPDShiftExpenses.openSpend;if(api)return Promise.resolve(api());
  var here=[].slice.call(d.querySelectorAll('[data-rse-spend]')).filter(visible)[0];if(here){here.click();return Promise.resolve(true);}
  return openReception('appointments').then(function(){return pressWhenReady('[data-rse-spend]','صرف من مصروفات الوردية');});},
 payout:function(){var api=payoutApi();if(api)return Promise.resolve(api());return Promise.resolve(false);},
 fixvisit:function(){var api=fixVisitApi();if(api)return Promise.resolve(api());return Promise.resolve(false);},
 /* «متابعة» (owner 2026-11-28, reception-follow-up.js): follow-up on a visit / package, included or with the fee */
 followup:function(){var F=w.SSMPDFollowUp;if(F&&F.open)return Promise.resolve(F.open());return Promise.resolve(false);},
 advance:function(){gotoTab('booking_cash');return pressWhenReady('[data-fin-action="advance-receive"]','مقدم حجز جديد');},
 refund:function(){gotoTab('booking_cash');return pressWhenReady('[data-bcv-advances]','مقدمات الحجز',6000).then(function(){var s=d.querySelector('[data-bcv-advances]');if(s&&s.scrollIntoView)s.scrollIntoView({block:'start',behavior:'smooth'});});},
 peer:function(){var P=w.SSMPDPeerHandover;if(P&&P.openSend)return Promise.resolve(P.openSend());gotoTab('booking_cash');return pressWhenReady('[data-ft-peer]','سلّم كاش لزميل');},
 end:function(){gotoTab('booking_cash');return pressWhenReady('[data-fin-action="treasury-end"]','اقفل ورديتي وسلّم');},
 want:function(){wantSheet();return Promise.resolve(true);},
 /* owner 2026-11-27 «فين الشاشة اللي بيشوف منها موظف الريسبشن التحصيل بتاعه بالتفصيل … ومفيش عنده اوبشن يشوف الحسابات»:
    the approved «حركات اليوم» for MY shift, in a sheet over the reception screen (no accounting tab needed) */
 mydetail:function(){return Promise.resolve(myDetailSheet());}
};
function myDetailApi(){var M=w.SSMPDShiftMovements;return M&&typeof M.mount==='function'&&w.SSMPDDb&&w.SSMPDDb.client?M:null;}
function myDetailSheet(){var M=myDetailApi();if(!M){toast('الشاشة دي مش متاحة دلوقتي — حدّث الصفحة.','error');return false;}
 var old=d.querySelector('[data-rd-mine]');if(old)old.remove();
 var m=d.createElement('div');m.className='rd-sheet rd-mine';m.setAttribute('data-rd-mine','');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-label','تحصيلاتي بالتفصيل');
 m.innerHTML='<div class="rd-sheet-box rd-mine-box"><div class="rd-sheet-h"><b>تحصيلاتي بالتفصيل</b><small>ورديتك انت بس</small><button type="button" class="btn" data-rd-close aria-label="إغلاق">✕</button></div><div data-rd-mine-host></div></div>';
 d.body.appendChild(m);var close=function(){m.remove();};
 m.querySelector('[data-rd-close]').onclick=close;m.addEventListener('keydown',function(e){if(e.key==='Escape'&&!m.querySelector('[data-dm-ov]:not([hidden])')){close();}});
 try{M.mount(m.querySelector('[data-rd-mine-host]'),{});}catch(e){close();toast((e&&e.message)||'تعذر فتح تحصيلاتي','error');return false;}
 var x=m.querySelector('[data-rd-close]');if(x&&x.focus)x.focus();return true;}
/* «طلب صرف من الدرج» belongs to the finance chat (P2); the button appears only once that screen exports an opener */
function payoutApi(){var P=w.SSMPDDrawerPayout;return P&&typeof P.open==='function'?P.open:null;}
/* «في غلط في زيارة أو حساب مريض» (fix-visit.js, help 295): the entry shows only when that panel is loaded */
function fixVisitApi(){var F=w.SSMPDFixVisit;return F&&typeof F.open==='function'?F.open:null;}
function run(k){var f=ACT[k];if(!f)return;var a=me();if(!eligible(a)){toast('الزرار ده لموظف الاستقبال بس.');return;}
 if(w.SSMPDRoleLanding&&w.SSMPDRoleLanding.count)w.SSMPDRoleLanding.count('booking_cash');
 Promise.resolve(f()).then(function(){cache=null;});}

/* ---------- drawing ---------- */
var TILES=[['collect','＋','حصّل من مريض','كشف أو خدمة'],['expense','−','مصروف من الوردية','اشتريت حاجة للعيادة'],['payout','↩','طلب صرف من الدرج','دكتور أو مورد أو استرداد'],
 ['advance','◷','مقدم حجز','مريض دافع عربون'],['peer','⇄','سلّم كاش لزميل','من غير ما تقفل'],['mydetail','☰','تحصيلاتي بالتفصيل','كل إيصال ومريض وخصم'],['end','✓','اقفل ورديتي وسلّم','العد بيتعمل هنا']];
function tiles(){return TILES.filter(function(t){return (t[0]!=='payout'||payoutApi())&&(t[0]!=='mydetail'||myDetailApi());});}
function strip(s){
 if(s&&s.state==='need_open')return '<div class="rd-closed"><span><b>مفيش وردية مفتوحة ليك</b><small>لازم تفتح ورديتك قبل أي تحصيل أو مصروف.</small></span><button type="button" class="btn rd-open" data-rd="open_shift">افتح ورديتي</button></div>';
 if(s&&s.state==='hidden'&&s.why==='closed')return '<div class="rd-closed is-done"><span><b>ورديتك اتقفلت النهارده ✓</b><small>لو هتشتغل تاني افتح وردية جديدة.</small></span><button type="button" class="btn" data-rd="open_shift">افتح وردية</button></div>';
 var st=isOpen(s)?'ورديتك مفتوحة من '+hhmm(s.opened_at)+(s.state==='close_due'?' — <b class="rd-due">ميعاد القفل جه</b>':''):'';
 return (st?'<p class="rd-st">'+st+'</p>':'')+'<div class="rd-tiles">'+tiles().map(function(t){return '<button type="button" class="rd-t'+(t[0]==='end'?' is-end':'')+'" data-rd="'+t[0]+'"><i aria-hidden="true">'+t[1]+'</i><span>'+esc(t[2])+'</span><small>'+esc(t[3])+'</small></button>';}).join('')+'</div>';}
function wire(host){host.querySelectorAll('[data-rd]').forEach(function(b){b.onclick=function(e){e.preventDefault();run(b.getAttribute('data-rd'));};});}

/* home hero strip */
function mountHome(host){var a=me();if(!host)return Promise.resolve();if(!eligible(a)){host.hidden=true;host.innerHTML='';return Promise.resolve();}
 var serial=(host.__rd=(host.__rd||0)+1);host.hidden=false;
 function draw(s){if(host.__rd!==serial||!host.isConnected)return;host.innerHTML='<section class="rd-card" data-rd-home aria-label="درجي"><div class="rd-h"><b>درجي</b><button type="button" class="rd-want" data-rd="want">عايز تعمل كذا؟</button></div>'+strip(s)+'</section>';wire(host);}
 draw(cache&&cache.v);return shiftState().then(draw);}

/* «تشغيل اليوم» bar */
function mountBar(host){var a=me();if(!host)return Promise.resolve();if(!eligible(a)){host.innerHTML='';host.hidden=true;return Promise.resolve();}
 var serial=(host.__rd=(host.__rd||0)+1);host.hidden=false;
 function draw(s){if(host.__rd!==serial||!host.isConnected)return;
  if(s&&s.state==='need_open'){host.innerHTML='<div class="rd-bar is-closed" data-rd-bar><b>درجي</b><span class="rd-chip warn">مفيش وردية مفتوحة</span><button type="button" class="btn rd-open" data-rd="open_shift">افتح ورديتي</button></div>';wire(host);return;}
  var chip=isOpen(s)?'<span class="rd-chip'+(s.state==='close_due'?' warn':' ok')+'">'+(s.state==='close_due'?'ميعاد القفل جه':'مفتوحة من '+esc(hhmm(s.opened_at)))+'</span>':'';
  var more=[payoutApi()?['payout','طلب صرف من الدرج']:null,['peer','سلّم كاش لزميل'],['refund','رجّع مقدم لمريض'],['want','عايز تعمل كذا؟']].filter(Boolean);
  host.innerHTML='<div class="rd-bar" data-rd-bar><b>درجي</b>'+chip+'<button type="button" class="btn" data-rd="collect">＋ حصّل</button><button type="button" class="btn" data-rd="expense">− مصروف</button><button type="button" class="btn" data-rd="advance">◷ مقدم</button>'+(myDetailApi()?'<button type="button" class="btn rd-mineb" data-rd="mydetail">☰ تحصيلاتي</button>':'')+
   '<details class="rd-more"><summary class="btn" aria-label="حركات تانية">⋯</summary><div>'+more.map(function(m){return '<button type="button" class="btn" data-rd="'+m[0]+'">'+esc(m[1])+'</button>';}).join('')+'</div></details>'+
   '<button type="button" class="btn rd-endb" data-rd="end">اقفل وسلّم</button></div>';wire(host);}
 draw(cache&&cache.v);return shiftState().then(draw);}

/* «عايز تعمل كذا؟» — plain sentences that open the action directly */
var WANT=[['collect','مريض عايز يدفع','كشف، خدمة، أو باقي فاتورة'],['expense','اشتريت حاجة للعيادة من الدرج','مياه، أدوات نظافة، صيانة، إكراميات…'],['advance','مريض بيحجز ودافع عربون','مقدم حجز'],
 ['refund','مريض عايز فلوسه ترجع','استرداد مقدم الحجز'],['payout','حد طالب فلوس من الدرج','دكتور أو مورد أو سلفة'],['peer','هسلّم كاش لزميل','والوردية تفضل مفتوحة'],
 ['end','خلصت ورديتي','العد والتسليم في خطوة واحدة'],['end','الدرج فاضي وعايز أقفل','بصفر وبسبب مكتوب'],['followup','مريض جاي متابعة','على زيارة أو باقة — مشمولة أو برسوم 100'],['fixvisit','في غلط في زيارة أو حساب مريض','الخدمة، الحجز، الخصم، التحصيل اللي مش ظاهر'],['mydetail','عايز أشوف اللي حصّلته بالتفصيل','كل إيصال ومريض وخصم في ورديتي'],['open_shift','لسه ما فتحتش ورديتي','افتح وردية النهارده']];
function wantSheet(){var old=d.querySelector('[data-rd-want]');if(old)old.remove();
 var m=d.createElement('div');m.className='rd-sheet';m.setAttribute('data-rd-want','');m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-label','عايز تعمل كذا؟');
 var rows=WANT.filter(function(x){return (x[0]!=='payout'||payoutApi())&&(x[0]!=='fixvisit'||fixVisitApi())&&(x[0]!=='followup'||(w.SSMPDFollowUp&&w.SSMPDFollowUp.open))&&(x[0]!=='mydetail'||myDetailApi());});
 m.innerHTML='<div class="rd-sheet-box"><div class="rd-sheet-h"><b>عايز تعمل كذا؟</b><button type="button" class="btn" data-rd-close aria-label="إغلاق">✕</button></div><input type="search" class="rd-sheet-q" placeholder="اكتب اللي عايزه… مثلاً: مصروف" aria-label="دوّر"><div class="rd-sheet-list">'+
  rows.map(function(x){return '<button type="button" data-rd-go="'+x[0]+'"><span>'+esc(x[1])+'<small>'+esc(x[2])+'</small></span><em>←</em></button>';}).join('')+'</div></div>';
 d.body.appendChild(m);var close=function(){m.remove();};
 m.addEventListener('click',function(e){if(e.target===m)close();});m.querySelector('[data-rd-close]').onclick=close;
 m.querySelectorAll('[data-rd-go]').forEach(function(b){b.onclick=function(){close();run(b.getAttribute('data-rd-go'));};});
 var q=m.querySelector('.rd-sheet-q');q.oninput=function(){var v=q.value.trim();m.querySelectorAll('[data-rd-go]').forEach(function(b){b.hidden=!!v&&b.textContent.indexOf(v)<0;});};
 d.addEventListener('keydown',function k(e){if(e.key==='Escape'){close();d.removeEventListener('keydown',k);}});}

w.SSMPDReceptionDrawer={mountHome:mountHome,mountBar:mountBar,run:run,eligible:eligible,want:wantSheet,reset:function(){cache=null;flight=null;},_t:{strip:strip,ACT:ACT}};
})(window,document);
