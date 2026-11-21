/* «تذكيرات بكرة» (owner approved mockup docs/ui-references/mockups/tomorrow-reminders.*). Reception list of tomorrow's
   bookings (WhatsApp agent + Masa). The employee reminds each patient BY HAND: «افتح واتساب بالرسالة» only opens WhatsApp
   with a ready message (wa.me) — it does NOT send. The reminder counts as «اتبعت» only when the employee presses «✓ اتبعت»
   (server records who + when). Server: public.clinic_reception_reminders (20261121160000).
   Hook: SSMPDReminders.decorate(context, section) from reception-workspace.js, next to «متابعات مطلوبة». */
(function(w,d){'use strict';
var DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
var SOURCES={masa:'ماسا',whatsapp:'واتساب',messenger:'ماسنجر',instagram:'إنستجرام',facebook:'فيسبوك',other:'أخرى'};
var TABS=[['pending','لسه ماتبعتش'],['sent','اتبعت'],['no_answer','مردش'],['all','الكل']];
var NOTE='«افتح واتساب بالرسالة» بيفتح الواتساب برسالة جاهزة بس — مش بيبعت. التذكير بيتحسب «اتبعت» لما الموظف يدوس «✓ اتبعت» بعد ما يبعتها، وبيتسجّل باسمه ووقته.';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(ws,a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_reception_reminders',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
// «الأحد 22/11»
function dayLabel(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));if(!m)return String(iso||'');var dt=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],12));return DAYS[dt.getUTCDay()]+' '+(+m[3])+'/'+(+m[2]);}
// digits only; Egyptian mobile 01xxxxxxxxx → 201xxxxxxxxx; 20… stays; anything else → '' (no button)
function waPhone(v){var p=String(v||'').replace(/[^0-9]/g,'');if(p.indexOf('00')===0)p=p.slice(2);if(/^01[0-9]{9}$/.test(p))p='2'+p;return /^201[0-9]{9}$/.test(p)?p:'';}
function firstName(n){return String(n||'').trim().split(/\s+/)[0]||'';}
function message(r,day){var lines=['أهلاً '+firstName(r.name)+' 👋','تذكير من Swnw للعيادات التخصصية بموعدك:','مع: '+(r.doctor||'الدكتور'),
  'الموعد: '+dayLabel(day)+(r.time?' الساعة '+r.time:' — بدون ساعة محددة')];
 if(r.booking_ref)lines.push('رقم الحجز: '+r.booking_ref);
 lines.push('نتشرف بزيارتك. لو مش هتقدر تيجي ابعتلنا هنا نغيّر الميعاد.');return lines.join('\n');}
function waLink(r,day){var p=waPhone(r.phone);return p?'https://wa.me/'+p+'?text='+encodeURIComponent(message(r,day)):'';}
var state={tab:'pending',rows:[],counts:null,day:null,ws:null,ctx:null,busy:false};
function chip(r){if(r.status==='sent')return '<span class="rtr-st ok">اتبعت ✓ — '+esc(r.marked_by_name||'')+(r.marked_time?' <bdi dir="ltr">'+esc(r.marked_time)+'</bdi>':'')+'</span>';
 if(r.status==='no_answer')return '<span class="rtr-st no">مردش / الرقم مقفول'+(r.marked_by_name?' — '+esc(r.marked_by_name):'')+(r.marked_time?' <bdi dir="ltr">'+esc(r.marked_time)+'</bdi>':'')+'</span>';
 return '<span class="rtr-st wait">لسه</span>';}
function rowHtml(r){var link=waLink(r,state.day),ref=esc(r.ref),acts='';
 var meta=[r.doctor,r.service].filter(Boolean).map(esc).join(' · ')+(r.phone?' · <bdi dir="ltr">'+esc(r.phone)+'</bdi>':'');
 if(r.status!=='sent')acts=(link?'<a class="btn btn-primary" target="_blank" rel="noopener" data-rtr="wa" href="'+esc(link)+'">افتح واتساب بالرسالة</a>':'<span class="rtr-nophone">مفيش رقم موبايل صالح</span>')+
  '<button type="button" class="btn" data-rtr="sent" data-ref="'+ref+'">✓ اتبعت</button>'+(r.status!=='no_answer'?'<button type="button" class="btn" data-rtr="no_answer" data-ref="'+ref+'">مردش / الرقم مقفول</button>':'');
 if(r.status!=='pending')acts+='<button type="button" class="rtr-undo" data-rtr="pending" data-ref="'+ref+'">تراجع</button>';
 return '<div class="rtr-row '+esc(r.status)+'" data-ref="'+ref+'"><div class="rtr-t'+(r.time?'':' none')+'">'+(r.time?esc(r.time):'بدون ساعة محددة')+'</div>'+
  '<div class="rtr-body"><span class="rtr-n">'+esc(r.name||'')+'</span><span class="rtr-tag">'+esc(SOURCES[r.source]||r.source||'')+'</span> '+chip(r)+'<div class="rtr-s">'+meta+'</div>'+(acts?'<div class="rtr-act">'+acts+'</div>':'')+'</div></div>';}
function cardHtml(){var c=state.counts||{},rows=state.rows.filter(function(r){return state.tab==='all'||r.status===state.tab;});
 return '<section class="rtr-card" data-rtr-card aria-label="تذكيرات بكرة"><header class="rtr-head"><h4>تذكيرات بكرة'+(state.day?' — '+esc(dayLabel(state.day)):'')+'</h4><span class="rtr-count">'+(+c.pending||0)+' لسه · '+(+c.sent||0)+' اتبعت · '+(+c.no_answer||0)+' مردش</span></header>'+
  '<div class="rtr-tabs" role="tablist">'+TABS.map(function(t){return '<button type="button" role="tab" class="rtr-tab'+(state.tab===t[0]?' on':'')+'" aria-selected="'+(state.tab===t[0])+'" data-rtr-tab="'+t[0]+'">'+t[1]+' ('+(+c[t[0]]||0)+')</button>';}).join('')+'</div>'+
  '<div class="rtr-list">'+(rows.length?rows.map(rowHtml).join(''):'<p class="rtr-empty">'+(state.counts&&!c.all?'مفيش حجوزات بكرة.':'مفيش حجوزات هنا.')+'</p>')+'</div>'+
  '<p class="rtr-note">'+NOTE+'</p></section>';}
function load(){return rpc(state.ws,'list',{}).then(function(r){state.rows=(r&&r.rows)||[];state.counts=(r&&r.counts)||{};state.day=(r&&r.day)||state.day;render();}).catch(function(e){state.rows=[];render(e);});}
function render(err){var host=state.ctx&&state.ctx.host;if(!host||!host.isConnected)return;var old=host.querySelector('[data-rtr-card]');var box=d.createElement('div');box.innerHTML=cardHtml();var card=box.firstChild;
 if(err)card.querySelector('.rtr-list').innerHTML='<p class="rtr-empty">تعذر تحميل تذكيرات بكرة — <button type="button" class="btn" data-rtr-retry>حاول تاني</button></p>';
 if(old)old.replaceWith(card);else{var anchor=host.querySelector('[data-rfu]')||host.querySelector('[data-rse]')||host.querySelector('.rx-section,.rx-mode-card');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor.nextSibling);else host.prepend(card);}wire(card);}
function mark(ref,status){if(state.busy)return Promise.resolve();state.busy=true;
 return rpc(state.ws,'mark',{ref:ref,day:state.day,status:status}).then(function(){toast(status==='sent'?'اتسجّل «اتبعت» باسمك':status==='no_answer'?'اتسجّل «مردش»':'اترجع «لسه ماتبعتش»');return load();})
  .catch(function(x){toast((x&&x.message)||'تعذر الحفظ','error');}).then(function(){state.busy=false;});}
function wire(card){card.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-rtr],[data-rtr-tab],[data-rtr-retry]');if(!t)return;
 if(t.hasAttribute('data-rtr-retry'))return load();
 if(t.hasAttribute('data-rtr-tab')){state.tab=t.getAttribute('data-rtr-tab');return render();}
 var a=t.getAttribute('data-rtr');if(a==='wa')return;   // opens WhatsApp only — nothing is recorded
 return mark(t.getAttribute('data-ref'),a);});}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 state.ctx=c;state.ws=c.data.workspace.id||c.workspace;render();load();}
w.SSMPDReminders={decorate:decorate,load:load,state:state,_t:{message:message,waPhone:waPhone,waLink:waLink,dayLabel:dayLabel,rowHtml:rowHtml,cardHtml:cardHtml,NOTE:NOTE}};
})(window,document);
