/* «خزينة الاستقبال والحجوزات» in plain language (owner «طبقه» 2026-11-25, mockup docs/ui-references/mockups/booking-cash-ux.html, help 276).
   Display only. The same clinic_booking_snapshot payload drawn as: my shift + what I collected (clinic_finance_my_collections, #863),
   the main actions, «محتاج منك», recent handovers with names instead of ids, advances, upcoming bookings, messages.
   Every action button is the existing data-fin-action / data-ft-peer button with the same id, so SSMPDFinanceControls.act and
   SSMPDFinanceToday.wireCashier run unchanged. No live drawer balance is ever shown (blind count, #833). Raw ids are never printed. */
(function(w){'use strict';
var METHODS={cash:'نقدي',pos:'فيزا',instapay:'إنستا باي',wallet:'محفظة',bank:'تحويل بنكي'};
var ADV={pending:['مستني التأكد','warn'],received:['✓ اتقبض','ok'],rejected:['✗ اترفض','bad'],approved:['✓ اتعتمد','ok'],cancelled:['اتلغى','']};
var MSG={ready:['جاهزة — لسه ماتبعتتش','warn'],manual_sent:['✓ اتبعتت (يدوي)','ok'],sent:['✓ اتبعتت','ok'],leased:['بتتبعت دلوقتي',''],delivery_unknown:['مش متأكدين إنها اتبعتت','warn'],cancelled:['اتلغت','']};
var BOOK={confirmed:['مؤكَّد','ok'],rescheduled:['اتغير ميعاده','warn'],cancelled:['اتلغى','bad'],no_show:['ماجاش','bad']};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function chip(t){return t?'<span class="bcv-chip'+(t[1]?' is-'+t[1]:'')+'">'+esc(t[0])+'</span>':'';}
function parts(v){var t=new Date(v);if(!v||isNaN(t))return null;var p=new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(t),o={};p.forEach(function(x){o[x.type]=x.value;});return o;}
/* «24 نوفمبر · 11:15 ص» everywhere (owner: one date shape) */
function when(v){var o=parts(v);if(!o)return '';return o.day+' '+o.month+' · '+o.hour+':'+o.minute+' '+(/م|PM/i.test(o.dayPeriod||'')?'م':'ص');}
function dayOnly(v){var t=Date.parse(String(v||'').slice(0,10)+'T12:00:00Z');if(isNaN(t))return '';return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'UTC',day:'numeric',month:'long'}).format(new Date(t));}
function clock(v){var m=/^(\d{1,2}):(\d{2})/.exec(String(v||''));if(!m)return '';var h=Number(m[1]);return ((h%12)||12)+':'+m[2]+' '+(h<12?'ص':'م');}
function shortRef(v){var s=String(v||'');return /^[0-9a-f]{8}-/i.test(s)?s.slice(0,8):s;}
/* a handover's reference is «تسليم نهاية وردية <id>» or «تسليم-نص-اليوم»: say what it is, never the id */
function handoverKind(t){var r=String(t.reference||'');if(/نهاية/.test(r))return 'آخر وردية';if(/نص/.test(r))return 'نص اليوم';return 'تسليم';}
function diffChip(v){if(v==null||v==='')return '';var n=Number(v);if(!isFinite(n))return '';if(Math.abs(n)<0.005)return '<span class="bcv-diff is-ok">مطابق ✓</span>';return '<span class="bcv-diff is-bad">'+(n<0?'ناقص ':'زيادة ')+money(Math.abs(n))+' ج</span>';}
function ownShift(d){var me=d&&d.me;return ((d&&(d.active_shifts||d.shifts))||[]).filter(function(s){return s.cashier_id===me&&!s.is_main&&s.status==='open';})[0]||null;}
function patientName(a,bookings){var b=(bookings||[]).filter(function(x){return x.booking_request_id&&x.booking_request_id===a.patient_ref;})[0];if(b&&b.customer_name)return b.customer_name;if(a.patient_name)return a.patient_name;return a.patient_ref?'مريض '+shortRef(a.patient_ref):'مريض';}

function collectionsHtml(c){if(!c||!c.shift)return '';var methods=(c.methods||[]).filter(function(m){return Number(m.count)>0;});
 return '<section class="bcv-card bcv-coll" data-bcv-collections><div class="bcv-coll-top"><div><small>اتحصّل في ورديتك</small><b>'+money(c.total)+' ج</b><small>'+esc(c.count||0)+' إيصال'+(c.shift.register?' · '+esc(c.shift.register):'')+'</small></div></div>'+
  (methods.length?'<div class="bcv-methods">'+methods.map(function(m){return '<span><b>'+esc(METHODS[m.method]||m.method)+'</b> '+money(m.total)+' ج <small>('+esc(m.count)+')</small></span>';}).join('')+'</div>':'')+'</section>';}

/* advances, bookings and messages — shared by «خزينة الاستقبال» and the accounting «مقدمات الحجز» tab (help 280) */
function advNeed(x,btn){var need=[],bookings=x.bookings||[];
 (x.messages||[]).forEach(function(c){var valid=c.current_version&&['confirmed','rescheduled'].indexOf(c.booking_status)>=0;if(!valid)return;
  if(c.status==='ready')need.push({t:'رسالة لسه ماتبعتتش',s:String(c.body||'').slice(0,90),a:btn('booking-preview',c.id,'افتح واتساب')+btn('booking-sent',c.id,'اتبعتت فعلًا')});
  else if(c.status==='delivery_unknown'&&x.can_review)need.push({t:'رسالة مش متأكدين إنها اتبعتت',s:String(c.body||'').slice(0,90),a:btn('booking-resolve',c.id,'راجع الرسالة')});});
 (x.advances||[]).filter(function(a){return a.status==='pending'&&x.can_review&&a.created_by!==x.me;}).forEach(function(a){need.push({t:patientName(a,bookings)+' — اتأكد إن المقدم وصل',s:money(a.amount)+' ج · '+(METHODS[a.method]||a.method||''),a:(a.method!=='cash'?btn('advance-proof',a.id,'بيانات الإيصال'):'')+btn('advance-verify',a.id,'اتأكدت إنه وصل')});});
 (x.advance_uses||[]).filter(function(u){return u.kind==='refund'&&u.status==='pending'&&x.can_review&&u.created_by!==x.me;}).forEach(function(u){need.push({t:'طلب استرداد مقدم — مستني مراجعتك',s:money(u.amount)+' ج · '+(METHODS[u.method]||''),a:btn('advance-refund-review',u.id,'راجع')});});
 return need;}
function needHtml(need){return need.length?'<section class="bcv-card bcv-need" data-bcv-need><h3>محتاج منك ('+need.length+')</h3>'+need.map(function(n){return '<div class="bcv-row'+(n.bad?' is-bad':'')+'"><div><b>'+esc(n.t)+'</b><small>'+esc(n.s)+'</small></div><div class="bcv-row-acts">'+n.a+'</div></div>';}).join('')+'</section>':'';}
function advSections(x,btn){var html='',bookings=x.bookings||[];
 var adv=(x.advances||[]),uses=(x.advance_uses||[]),empty=[];
 var advHtml=adv.length?'<section class="bcv-card" data-bcv-advances><h3>مقدمات الحجز</h3><div class="bcv-list">'+adv.map(function(a){
  var acts=[];if(a.status==='received'){if(x.can_allocate)acts.push(btn('advance-allocate',a.id,'استخدمه على فاتورة'));acts.push(btn('advance-refund',a.id,'استرداد'));}if(a.method!=='cash'&&(x.can_review||a.created_by===x.me)&&a.status!=='pending')acts.push(btn('advance-proof',a.id,'بيانات الإيصال'));
  var left=a.available!=null&&Number(a.available)!==Number(a.amount)?'<small>فاضل منه '+money(a.available)+'</small>':'';
  return '<div class="bcv-it bcv-it3"><div><b>'+esc(patientName(a,bookings))+'</b><small>'+esc(METHODS[a.method]||a.method||'')+(a.created_at?' · '+esc(when(a.created_at)):'')+'</small></div><span class="bcv-m">'+money(a.amount)+' ج'+left+'</span><span>'+chip(ADV[a.status]||[a.status,''])+'</span><div class="bcv-row-acts">'+acts.join('')+'</div></div>';}).join('')+
  (uses.length?'<h4>اتخصم أو اترجع</h4>'+uses.map(function(u){return '<div class="bcv-it bcv-it3"><div><b>'+(u.kind==='allocate'?'اتخصم على خدمة':'استرداد')+' — '+esc(patientName(u,bookings))+'</b><small>'+esc(METHODS[u.method]||'')+'</small></div><span class="bcv-m">'+money(u.amount)+' ج</span><span>'+chip(ADV[u.status]||[u.status,''])+'</span><span></span></div>';}).join(''):'')+'</div></section>':'';
 if(!adv.length)empty.push('مقدمات');
 var bookHtml=bookings.length?'<section class="bcv-card" data-bcv-bookings><h3>الحجوزات</h3><div class="bcv-list">'+bookings.map(function(c){
  return '<div class="bcv-it bcv-it2"><div><b>'+esc(c.customer_name||'مريض')+' — '+esc(dayOnly(c.appointment_date))+(c.appointment_time?' · '+esc(clock(c.appointment_time)):'')+'</b><small>'+chip(BOOK[c.status]||[(w.SSMPDFinanceLabels?w.SSMPDFinanceLabels.label(c.status):c.status),''])+(c.booking_request_id?' <span class="bcv-ref" title="رقم الربط بالفاتورة">مرجع '+esc(shortRef(c.booking_request_id))+' <button type="button" data-bcv-copy="'+esc(c.booking_request_id)+'">نسخ</button></span>':'')+'</small></div><div class="bcv-row-acts">'+(x.can_create&&['confirmed','rescheduled'].indexOf(c.status)>=0?btn('booking-message',c.id,'جهّز تأكيد أو تذكير'):'')+'</div></div>';}).join('')+'<p class="bcv-hint">لما تسجّل خدمة لمريض جاي من حجز، انسخ «المرجع» وحطه في الفاتورة علشان المقدم يتخصم.</p></div></section>':'';
 if(!bookings.length)empty.push('حجوزات');
 var msgs=(x.messages||[]).filter(function(c){return !(c.current_version&&['confirmed','rescheduled'].indexOf(c.booking_status)>=0&&(c.status==='ready'||c.status==='delivery_unknown'));});
 var msgHtml=msgs.length?'<section class="bcv-card" data-bcv-messages><h3>الرسائل</h3><div class="bcv-list">'+msgs.map(function(c){var valid=c.current_version&&['confirmed','rescheduled'].indexOf(c.booking_status)>=0;return '<div class="bcv-it bcv-it2"><div><b>'+esc(String(c.body||'').slice(0,120))+'</b><small>'+(valid?chip(MSG[c.status]||[c.status,'']):chip(['الحجز اتغير — محتاج رسالة جديدة','warn']))+'</small></div><span></span></div>';}).join('')+'</div></section>':'';
 if(!(x.messages||[]).length)empty.push('رسائل');
 html+=(advHtml||bookHtml?'<div class="bcv-two">'+advHtml+bookHtml+'</div>':'')+msgHtml;
 if(empty.length)html+='<p class="bcv-card bcv-empty" data-bcv-empty>✓ مفيش '+empty.join(' ولا ')+' في الفترة دي.</p>';
 return html;}
function draw(body,data,h,opts){
 opts=opts||{};var d=data||{},x=d.advance_data||d,me=d.me,own=ownShift(d),btn=h.btn,bookings=x.bookings||[];
 var transfers=(d.treasury_transfers||[]).slice().sort(function(a,b){return String(b.created_at||'').localeCompare(String(a.created_at||''));});
 var pendingMine=transfers.filter(function(t){return t.status==='pending';});
 var lastOk=transfers.filter(function(t){return t.status==='approved';})[0];
 var need=[],html='';
 /* ---- head ---- */
 var sub=own?(esc(own.register_name||'')+(own.ended_at?' · ورديتك خلصت وبانتظار الاستلام':(own.opened_at?' · الوردية مفتوحة من '+esc(when(own.opened_at)):' · الوردية مفتوحة'))):'مفيش وردية مفتوحة باسمك — افتح ورديتك الأول علشان تحصّل وتسلّم.';
 var acts=[];
 if(own&&!own.ended_at){if(w.SSMPDPeerHandover)acts.push('<button type="button" class="btn bcv-main" data-ft-peer>سلّم كاش لزميل أو للرئيسية</button>');acts.push(btn('treasury-end',own.id,'اقفل ورديتي وسلّم'));}
 if(d.can_create&&d.treasury_main)acts.push(btn('treasury-transfer','','طلب تسليم للرئيسية'));
 if(x.can_create)acts.push(btn('advance-receive','','مقدم حجز جديد'));
 if(!own)(x.shifts||[]).filter(function(s){return s.status==='open'&&!s.ended_at;}).forEach(function(s){acts.push(btn('booking-close',s.id,'جرد وتسليم «'+(s.register_name||'')+'»'));});
 /* owner 2026-11-27: a shift already handed over (ended_at set, waiting for the main treasury receipt) never blocks a new one — the server allows it (20261123100000) */
 if(x.can_create&&(!own||own.ended_at))acts.push(btn('booking-open','','فتح وردية استقبال'));
 var tiles=[];
 tiles.push('<div><small>تسليمات مستنية الاستلام</small><b>'+pendingMine.length+'</b></div>');
 tiles.push('<div><small>مقدمات في الفترة</small><b>'+(x.advances||[]).length+'</b></div>');
 tiles.push('<div><small>حجوزات في الفترة</small><b>'+bookings.length+'</b></div>');
 tiles.push('<div><small>آخر تسليم اتسلّم</small><b class="bcv-sm">'+(lastOk?esc(when(lastOk.reviewed_at||lastOk.created_at)):'—')+'</b></div>');
 html+='<section class="bcv-card bcv-head"><div class="bcv-title"><div><h2>خزينة الاستقبال والحجوزات</h2><p class="bcv-sub">'+sub+'</p></div><div class="bcv-period" data-bcv-period><button type="button" data-bcv-range="today">النهارده</button><button type="button" data-bcv-range="week">آخر 7 أيام</button><button type="button" data-bcv-range="month">الشهر ده</button><button type="button" data-bcv-range="custom">فترة تانية…</button></div></div>'+
  '<div data-bcv-collections-slot></div><div class="bcv-kp">'+tiles.join('')+'</div>'+(acts.length?'<div class="bcv-acts">'+acts.join('')+'</div>':'')+'</section>';
 /* ---- what needs me ---- */
 ((d.active_shifts||d.shifts)||[]).filter(function(s){return s.cashier_id===me&&!s.is_main&&s.status==='open'&&s.ended_at;}).forEach(function(s){
  if(transfers.some(function(t){return t.from_shift===s.id&&t.status==='pending';}))return;
  var rej=transfers.filter(function(t){return t.from_shift===s.id&&t.status==='rejected';})[0];
  need.push({bad:1,t:'تسليم ورديتك'+(rej?' اترفض':' محتاج إعادة جرد'),s:(rej?money(rej.amount)+' ج · '+(rej.review_note?'السبب: «'+rej.review_note+'»':'اترفض من غير سبب مكتوب'):(s.register_name||'')),a:btn('treasury-recount',s.id,'عِد الجرد وسلّم تاني')});});
 need=need.concat(advNeed(x,btn));
 html+=needHtml(need);
 /* ---- «تحصيلاتي بالتفصيل» (owner 2026-11-27 «فين الشاشة اللي بيشوف منها موظف الريسبشن التحصيل بتاعه بالتفصيل … ومفيش عنده اوبشن يشوف الحسابات»):
    the SAME approved «حركات الوردية بالتفصيل» + «حركات اليوم» (finance-shift-movements.js + finance-day-movements.js), mounted here for the
    cashier's OWN shift. The RPCs scope a non-manager to his own shift; no accounting access is added. ---- */
 if(own)html+='<section class="bcv-card bcv-mv" data-bcv-movements><h3>تحصيلاتي بالتفصيل</h3><p class="bcv-sub">ورديتك انت بس — كل إيصال، كل مريض، كل خصم.</p><div data-bcv-mv></div></section>';
 /* ---- handovers ---- */
 if(transfers.length)html+='<section class="bcv-card" data-bcv-handovers><h3>آخر التسليمات للرئيسية</h3><div class="bcv-list">'+transfers.map(function(t){
  var st=t.status==='approved'?['✓ اتسلّم','ok']:t.status==='rejected'?['✗ اترفض','bad']:['مستني الاستلام','warn'];
  var note=t.review_note?(t.status==='rejected'?'<span class="bcv-why">السبب: '+esc(t.review_note)+'</span>':'<small>«'+esc(t.review_note)+'»</small>'):'';
  var act=x.can_review&&t.status==='pending'&&t.created_by!==me?btn('treasury-review',t.id,'عِد واستلم'):'';
  return '<div class="bcv-it"><span class="bcv-d">'+esc(when(t.created_at))+(t.status!=='pending'&&t.reviewed_at?'<small>'+(t.status==='rejected'?'اترفض ':'اتستلم ')+esc(when(t.reviewed_at))+'</small>':'')+'</span><div><b>'+esc(handoverKind(t))+' — '+esc(t.from_register||'')+'</b><small>إلى '+esc(t.to_register_name||'الخزينة الرئيسية')+'</small>'+note+'</div><span class="bcv-m">'+money(t.amount)+' ج</span><span>'+diffChip(t.end_difference)+'</span><span>'+chip(st)+act+'</span></div>';}).join('')+'</div></section>';
 html+=advSections(x,btn);
 body.innerHTML='<div class="bcv" dir="rtl">'+html+'</div>';
 /* copy the full booking reference (the visible one is short) */
 /* period chips drive the existing from/to form */
 body.querySelectorAll('[data-bcv-range]').forEach(function(b){if(opts.range===b.dataset.bcvRange)b.classList.add('is-on');b.onclick=function(){if(opts.onRange)opts.onRange(b.dataset.bcvRange);};});
 /* «اتحصّل في ورديتك» (#863): read-only, only my open shift; hidden when there is no shift or the function is not live */
 var slot=body.querySelector('[data-bcv-collections-slot]'),c=w.SSMPDDb&&w.SSMPDDb.client;
 var mvh=body.querySelector('[data-bcv-mv]');if(mvh&&c&&w.SSMPDShiftMovements&&typeof w.SSMPDShiftMovements.mount==='function'){try{w.SSMPDShiftMovements.mount(mvh,{});}catch(_){var ms=mvh.closest('[data-bcv-movements]');if(ms)ms.remove();}}else if(mvh){var ms2=mvh.closest('[data-bcv-movements]');if(ms2)ms2.remove();}
 /* not gated on own: the RPC itself answers shift=null when there is no open shift */if(slot&&c)Promise.resolve(c.rpc('clinic_finance_my_collections',{})).then(function(r){if(r&&!r.error&&slot.isConnected)slot.innerHTML=collectionsHtml(r.data);}).catch(function(){});
}
/* «نسخ» on a booking reference — delegated so it also works inside string-rendered panels */
if(!w.__bcvCopy){w.__bcvCopy=true;document.addEventListener('click',function(ev){var b=ev.target.closest&&ev.target.closest('[data-bcv-copy]');if(!b)return;var v=b.getAttribute('data-bcv-copy');var done=function(){b.textContent='اتنسخ ✓';setTimeout(function(){b.textContent='نسخ';},1500);};try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(v).then(done,done);else done();}catch(e){done();}});}
/* accounting «مقدمات الحجز» tab (help 280): the same plain sections, as a string for SSMPDFinanceControls.panel */
function advancesPanel(d,h){var x=d.advance_data||d,btn=h.btn,acts=(x.can_create?btn('advance-receive','','سجّل مقدم'):'');return '<div class="bcv" dir="rtl"><p class="bcv-sub">المقدم فلوس المريض دفعها قبل الخدمة: بتتخصم من فاتورته، أو بترجعله.</p>'+(acts?'<div class="bcv-acts" style="margin:0">'+acts+'</div>':'')+needHtml(advNeed(x,btn))+advSections(x,btn)+'</div>';}
w.SSMPDBookingCashView={draw:draw,when:when,ownShift:ownShift,advancesPanel:advancesPanel};
})(window);
