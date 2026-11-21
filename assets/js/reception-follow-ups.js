/* «متابعة مطلوبة» (owner 2026-11-21 «طبقه», mockup docs/ui-references/mockups/followups-*). A follow-up is a reminder, not an
   appointment: no slot is taken until reception books it. The card shows late + due today + due within 14 days («أسبوعين»).
   Server: public.clinic_reception_follow_ups (20261121120000); a booking for the same patient + doctor near the due date
   closes the follow-up as «اتحجزت» by itself (trigger). Hook: SSMPDFollowUps.decorate(context, section). */
(function(w,d){'use strict';
var WINDOW_DAYS=14,AFTER=[['weeks',2,'أسبوعين'],['months',1,'شهر'],['months',3,'٣ شهور'],['months',6,'٦ شهور'],['months',12,'سنة']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(ws,a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_reception_follow_ups',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function dayText(iso){try{return new Date(iso+'T12:00:00Z').toLocaleDateString('ar-EG',{day:'numeric',month:'numeric',year:'numeric',timeZone:'UTC'});}catch(_){return iso;}}
function dueBadge(r){var n=+r.days;if(n<0)return ['late','متأخرة<br>'+(-n)+' '+(-n===1?'يوم':'أيام')];if(n===0)return ['today','النهارده'];return ['soon','بعد<br>'+n+' '+(n===1?'يوم':'أيام')];}
var state={scope:'due',rows:[],counts:null,ws:null,ctx:null};
function rowHtml(r){var b=dueBadge(r),open=r.status==='open';
 var meta=esc(r.doctor_name||'')+(r.service_name?' · '+esc(r.service_name):'')+(r.days<0?' · كانت مستحقة '+esc(dayText(r.due_date)):' · '+esc(dayText(r.due_date)))+(r.note?' · «'+esc(r.note)+'»':'')+(r.attempts?' · اتصلنا '+r.attempts+' مرة':'');
 var acts=open?'<button type="button" class="btn btn-primary" data-fu="book" data-id="'+esc(r.id)+'">احجز دلوقتي</button><button type="button" class="btn" data-fu="attempt" data-id="'+esc(r.id)+'">اتصلت — مردتش</button><button type="button" class="btn" data-fu="postpone" data-id="'+esc(r.id)+'">أجّل</button>'+(r.phone?'<a class="btn" target="_blank" rel="noopener" data-fu="wa" href="'+esc(waLink(r))+'">ابعت تذكير واتساب</a>':'')+'<button type="button" class="btn" data-fu="close" data-id="'+esc(r.id)+'">مش محتاجة</button>'
  :'<span class="rfu-done">'+(r.status==='booked'?'اتحجزت ✓':'اتقفلت — '+esc(r.close_reason||''))+'</span>';
 return '<div class="rfu-row '+(open?b[0]:'done')+'"><div class="rfu-due">'+(open?b[1]:'')+'</div><div class="rfu-body"><span class="rfu-name">'+esc(r.patient_name)+(r.file_no?' <bdi dir="ltr">'+esc(r.file_no)+'</bdi>':'')+'</span><div class="rfu-meta">'+meta+'</div><div class="rfu-act">'+acts+'</div></div></div>';}
function waLink(r){var ph=String(r.phone||'').replace(/[^0-9]/g,'');if(/^01[0125][0-9]{8}$/.test(ph))ph='2'+ph;
 var t='أهلاً '+(r.patient_name||'').split(/\s+/)[0]+'، معاد متابعتك مع '+(r.doctor_name||'الدكتور')+' في مركز Swnw قرب ('+dayText(r.due_date)+'). تحب نحجزلك ميعاد؟';
 return 'https://wa.me/'+ph+'?text='+encodeURIComponent(t);}
function cardHtml(){var c=state.counts||{},tabs=[['due','المستحقة والقريبة'],['late','متأخرة'],['all','كلها'],['booked','اتحجزت']];
 return '<section class="rfu-card" data-rfu aria-label="متابعات مطلوبة"><header class="rfu-head"><h4>متابعات مطلوبة</h4><span class="rfu-count">'+(+c.late||0)+' متأخرة · '+(+c.today||0)+' النهارده · '+(+c.soon||0)+' خلال أسبوعين</span><button type="button" class="btn" data-fu="new">+ متابعة جديدة</button></header>'+
  '<div class="rfu-tabs" role="tablist">'+tabs.map(function(t){return '<button type="button" role="tab" class="rfu-tab'+(state.scope===t[0]?' on':'')+'" aria-selected="'+(state.scope===t[0])+'" data-fu-scope="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</div>'+
  '<div class="rfu-list">'+(state.rows.length?state.rows.map(rowHtml).join(''):'<p class="rfu-empty">'+(state.scope==='due'?'مفيش متابعات مستحقة خلال أسبوعين.':'مفيش متابعات هنا.')+'</p>')+'</div></section>';}
function load(){return rpc(state.ws,'list',{scope:state.scope}).then(function(r){state.rows=(r&&r.rows)||[];state.counts=(r&&r.counts)||{};render();}).catch(function(e){state.rows=[];render(e);});}
function render(err){var host=state.ctx&&state.ctx.host;if(!host||!host.isConnected)return;var old=host.querySelector('[data-rfu]');var box=d.createElement('div');box.innerHTML=cardHtml();var card=box.firstChild;if(err){card.querySelector('.rfu-list').innerHTML='<p class="rfu-empty">تعذر تحميل المتابعات — <button type="button" class="btn" data-fu-retry>حاول تاني</button></p>';}
 /* owner 2026-11-21: a small card next to «تذكيرات غداً»; the full list opens in a sheet */
 var M=w.SSMPDMiniCards;if(M){var c=state.counts||{},el=M.slot(host,'rfu',1);el.setAttribute('aria-label','متابعات مطلوبة — افتح التفاصيل');
  el.innerHTML='<h4>متابعات مطلوبة</h4><span class="go">افتح ‹</span><span class="nums"><span class="n late"><b>'+(+c.late||0)+'</b> متأخرة</span><span class="n wait"><b>'+(+c.today||0)+'</b> النهارده</span><span class="n"><b>'+(+c.soon||0)+'</b> خلال أسبوعين</span></span>';
  el.onclick=function(){state.open=true;render();};if(old)old.remove();
  if(state.open){M.sheet('rfu','متابعات مطلوبة',card,function(){state.open=false;});wire(card);}else M.sheet('rfu',null,null);return;}
 if(old)old.replaceWith(card);else{var anchor=host.querySelector('[data-rse]')||host.querySelector('.rx-section,.rx-mode-card');if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor.nextSibling);else host.prepend(card);}wire(card);}
function find(id){return state.rows.find(function(r){return r.id===id;});}
function act(a,p){return rpc(state.ws,a,p).then(function(){return load();});}
function wire(card){card.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-fu],[data-fu-scope],[data-fu-retry]');if(!t)return;
 if(t.hasAttribute('data-fu-retry'))return load();
 if(t.hasAttribute('data-fu-scope')){state.scope=t.getAttribute('data-fu-scope');return load();}
 var a=t.getAttribute('data-fu'),id=t.getAttribute('data-id'),r=find(id);if(a==='wa')return;
 if((a==='new'||a==='book')&&w.SSMPDMiniCards){state.open=false;w.SSMPDMiniCards.sheet('rfu',null,null);}
 if(a==='new')return newModal();
 if(a==='attempt')return act('attempt',{id:id,note:'مردش'}).then(function(){toast('اتسجّلت المحاولة');}).catch(function(x){toast(x.message,'error');});
 if(a==='postpone'){var v=w.prompt('التاريخ الجديد (YYYY-MM-DD)',r&&r.due_date);if(!v)return;return act('postpone',{id:id,due_date:v.trim()}).then(function(){toast('اتأجلت المتابعة');}).catch(function(x){toast(x.message,'error');});}
 if(a==='close'){var why=w.prompt('ليه مش محتاجة؟ (مثلاً: اتحجز في مكان تاني، سافر)');if(!why)return;return act('close',{id:id,reason:why}).then(function(){toast('اتقفلت المتابعة');}).catch(function(x){toast(x.message,'error');});}
 if(a==='book'&&r)return bookNow(r);});}
// «احجز دلوقتي»: the normal booking form, prefilled with the patient + doctor (+ service); the trigger links the booking.
function bookNow(r){var c=state.ctx;if(!c||typeof c.book!=='function'){toast('افتح «حجز موعد» واختار المريض والدكتور','error');return;}
 c.book(r.patient_id);var f=d.querySelector('.rx-modal form');if(!f)return;
 function setSel(n,v){var el=f.elements[n];if(!el||!v)return;el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}));}
 setSel('provider_id',r.provider_id);setSel('service_id',r.service_id);
 var st=f.querySelector('[data-rx-status]');if(st)st.textContent='حجز متابعة: '+(r.note||'')+' — اختار اليوم والساعة. المتابعة هتتقفل «اتحجزت» لوحدها.';}
function newModal(){var c=state.ctx,data=c&&c.data;if(!data||typeof c.modal!=='function')return;
 var today=(data.appointments||[]).filter(function(a){return a.status!=='cancelled';}).slice(0,200);
 var body='<label>من مواعيد النهارده (اختياري)<select name="from_appt"><option value="">—</option>'+today.map(function(a){var p=(data.patients||[]).find(function(x){return x.id===a.patient_id;}),pr=(data.providers||[]).find(function(x){return x.id===a.provider_id;});return '<option value="'+esc(a.id)+'">'+esc((p&&p.name)||'مريض')+' — '+esc((pr&&pr.name)||'')+'</option>';}).join('')+'</select></label>'+
  c.select('patient_id','المريض',(data.patients||[]).map(function(p){return [p.id,(p.name||'')+(p.file_no?' — '+p.file_no:'')];}))+
  c.select('provider_id','الطبيب',(data.providers||[]).filter(function(p){return p.active!==false;}).map(function(p){return [p.id,p.name+(p.department?' — '+p.department:'')];}))+
  '<fieldset class="rfu-after"><legend>المتابعة بعد</legend><div class="po-chips">'+AFTER.map(function(x,i){return '<button type="button" class="po-chip'+(i===2?' on':'')+'" data-after="'+x[0]+':'+x[1]+'" aria-pressed="'+(i===2)+'">'+x[2]+'</button>';}).join('')+'<button type="button" class="po-chip" data-after="date" aria-pressed="false">تاريخ…</button></div><input type="date" name="due_date" hidden></fieldset>'+
  '<label>ملاحظة للمتابعة (اختياري)<input name="note" maxlength="300" placeholder="مثلاً: إعادة تحليل سكر تراكمي قبل الكشف"></label>'+
  '<p class="rfu-hint">مفيش ميعاد بيتحجز دلوقتي ومفيش مكان بيتشغل في جدول الدكتور. هتظهر في «متابعات مطلوبة» قبل ميعادها بأسبوعين.</p>';
 var root=c.modal('متابعة مطلوبة',body,function(v){var on=root.querySelector('[data-after].on'),p={patient_id:v.patient_id,provider_id:v.provider_id,note:v.note||undefined,source_appointment_id:v.from_appt||undefined};
   if(!on)throw new Error('اختار المتابعة بعد قد إيه');var k=on.getAttribute('data-after');if(k==='date'){if(!v.due_date)throw new Error('اختار التاريخ');p.due_date=v.due_date;}else{var s=k.split(':');p[s[0]]=+s[1];}
   return rpc(state.ws,'create',p);},function(){toast('اتسجّلت المتابعة');load();});
 if(!root)return;var f=root.querySelector('form');
 f.elements.from_appt.onchange=function(){var a=(data.appointments||[]).find(function(x){return x.id===this.value;}.bind(this));if(!a)return;f.elements.patient_id.value=a.patient_id;f.elements.provider_id.value=a.provider_id;};
 root.querySelector('.rfu-after').addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-after]');if(!b)return;root.querySelectorAll('[data-after]').forEach(function(x){x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});f.elements.due_date.hidden=b.getAttribute('data-after')!=='date';});}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 state.ctx=c;state.ws=c.data.workspace.id||c.workspace;render();load();}
w.SSMPDFollowUps={decorate:decorate,load:load,state:state,_t:{rowHtml:rowHtml,cardHtml:cardHtml,dueBadge:dueBadge,waLink:waLink,WINDOW_DAYS:WINDOW_DAYS}};
})(window,document);
