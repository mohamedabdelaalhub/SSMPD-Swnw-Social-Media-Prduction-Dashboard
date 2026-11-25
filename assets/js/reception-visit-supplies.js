/* Supplies at service — PR1 (owner approved 2026-11-25 «طبق المستلزمات», docs/ui-references/mockups/supplies-at-service.html).
   - finishGuard: before «إنهاء الزيارة», clinic_reception_finish_check lists billable supplies that were not recorded. It does not
     block: «كمّل الإنهاء» → «متأكد عايز تنهي؟» (shows the note that will be written on the visit) → the close is sent with
     missing_ack. «رجوع وسجّل المستلزم» stops.
   - «مستلزمات الزيارة» (clinic_reception_visit_supplies list / check / add): what was recorded on each executed service, who
     and when; reception adds a supply. A duplicate (who / when / qty) or an item already in the price of the service needs
     «متأكد، ضيفه». A billable supply goes on that service's invoice at the sale price.
   - «تعديل قبل التحصيل» (clinic_reception_visit_reopen): a visit finished today with nothing collected goes back to open.
   - visit_close from «تفاصيل الزيارة» goes through the same guard. */
(function(w,d){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function qty(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:3});}
function when(t){if(!t)return '';try{return new Date(t).toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return String(t);}}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function rpc(name,args){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(name,args||{})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function msg(e){return (e&&(e.message||e.hint))||'تعذر تنفيذ الإجراء';}
/* resolve null when the person closes / cancels the modal */
function onCancel(m,fn){if(!m)return;var done=false,once=function(){if(!done){done=true;fn();}};var b=m.querySelector('[data-rx-cancel]'),x=m.querySelector('.modal-close');if(b)b.addEventListener('click',once);if(x)x.addEventListener('click',once);m.addEventListener('keydown',function(e){if(e.key==='Escape')once();});}

function noteText(chk){return 'تم التنبيه على '+(chk.employee||'الموظف')+' إن فيه مستلزم ناقص '+(chk.missing||[]).map(function(x){return x.item+' قيمته '+money(x.value)+' ج';}).join(' و')+' واختار الإنهاء رغم ذلك';}
/* o: {c (has modal), workspace, payload:{appointment_id|visit_id}} → Promise<{ack:boolean}|null> */
function finishGuard(o){var c=o.c;
 return rpc('clinic_reception_finish_check',{p_workspace:o.workspace,p_payload:o.payload}).then(function(chk){
  if(!chk||!chk.missing||!chk.missing.length)return {ack:false,check:chk};
  return new Promise(function(resolve){
   var rows=chk.missing.map(function(x){return '<tr><td>'+esc(x.service)+'</td><td>'+esc(x.item)+'</td><td dir="ltr">'+qty(x.quantity)+'</td><td dir="ltr">'+money(x.value)+' ج</td></tr>';}).join('');
   var m1=c.modal('⚠️ فيه مستلزم ناقص على الزيارة','<div class="vs-alert vs-stop" data-vs-missing><p>المستلزم ده بيتحاسب على المريض والمعتاد إنه يتسجّل مع الخدمة، ومتسجّلش:</p><table class="vs-t"><thead><tr><th>الخدمة</th><th>الناقص</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="vs-note">تقدر ترجع تسجّله من «مستلزمات الزيارة»، أو تكمّل الإنهاء وهيتسجّل تنبيه على الزيارة.</p>',
    function(){return Promise.resolve();},
    function(){var m2=c.modal('متأكد عايز تنهي؟','<p class="vs-note" data-vs-note>هيتكتب على الزيارة: «'+esc(noteText(chk))+'».</p>',function(){return Promise.resolve();},function(){resolve({ack:true,check:chk});},{ok:'أيوه، إنهي الزيارة',cancel:'لأ، رجوع',danger:true});
     if(!m2)resolve(null);else onCancel(m2,function(){resolve(null);});},
    {ok:'كمّل الإنهاء',cancel:'رجوع وسجّل المستلزم',danger:true});
   if(!m1)resolve(null);else onCancel(m1,function(){resolve(null);});
  });});}

/* «مستلزمات الزيارة» */
function open(c,visitId){var st={data:null,pending:null,busy:false};
 var m=c.modal('مستلزمات الزيارة','<div data-vs-root><p>جاري التحميل…</p></div>',function(){return Promise.resolve();},function(){});
 if(!m)return null;m.querySelector('[type="submit"]').hidden=true;var cancel=m.querySelector('[data-rx-cancel]');cancel.textContent='إغلاق';
 cancel.addEventListener('click',function(){if(c.load)c.load();});
 var root=m.querySelector('[data-vs-root]'),status=m.querySelector('[data-rx-status]');
 function say(t,bad){status.textContent=t||'';status.className=bad?'vs-bad':'';}
 function load(){return rpc('clinic_reception_visit_supplies',{p_workspace:c.workspace,p_action:'list',p_payload:{visit_id:visitId}}).then(function(data){st.data=data;draw();}).catch(function(e){say(msg(e),true);});}
 function draw(){var D=st.data,open=D.visit.status==='open',done=(D.orders||[]).filter(function(o){return o.status==='completed';});
  var html=(D.missing&&D.missing.length?'<div class="vs-alert vs-warn" data-vs-missing>ناقص بيتحاسب: '+D.missing.map(function(x){return esc(x.item)+' ('+esc(x.service)+') '+money(x.value)+' ج';}).join('، ')+'</div>':'');
  html+=(D.orders||[]).map(function(o){var lines=o.lines||[];
   return '<section class="vs-order"><h4>'+esc(o.name)+' <small>'+(o.status==='completed'?'اتنفذت':o.status==='ordered'?'لسه متنفذتش':esc(o.status))+'</small></h4>'+
    (lines.length?'<table class="vs-t"><thead><tr><th>المستلزم</th><th>الكمية</th><th></th><th>سجّله</th></tr></thead><tbody>'+lines.map(function(l){return '<tr><td>'+esc(l.item)+'</td><td dir="ltr">'+qty(l.quantity)+'</td><td>'+(l.billed?'<span class="vs-chip vs-bil">بيتحاسب'+(l.amount?' '+money(l.amount)+' ج':'')+'</span>':'<span class="vs-chip vs-inc">في سعر الخدمة</span>')+'</td><td>'+esc(l.by)+' — '+esc(when(l.at))+(l.source==='reception'?' (الاستقبال)':'')+'</td></tr>';}).join('')+'</tbody></table>':'<p class="vs-note">مفيش مستلزمات متسجّلة.</p>')+'</section>';}).join('');
  if(open&&done.length){
   html+='<fieldset class="vs-add" data-vs-add><legend>إضافة مستلزم</legend>'+
    '<label>الخدمة<select data-vs-order>'+done.map(function(o){return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>';}).join('')+'</select></label>'+
    '<label>المستلزم<select data-vs-item><option value="">اختار المستلزم</option>'+(D.items||[]).map(function(i){return '<option value="'+esc(i.id)+'">'+esc(i.name)+(i.billable?' — بيتحاسب '+money(i.sale_price)+' ج':'')+'</option>';}).join('')+'</select></label>'+
    '<label>المخزن<select data-vs-loc><option value="">اختار المخزن</option>'+(D.locations||[]).map(function(l){return '<option value="'+esc(l.id)+'">'+esc(l.name)+'</option>';}).join('')+'</select></label>'+
    '<label>الكمية<input data-vs-qty type="number" min="0.001" step="0.001" value="1" inputmode="decimal"></label>'+
    '<div data-vs-warn></div><button type="button" class="btn btn-primary" data-vs-go>إضافة المستلزم</button></fieldset>';
  }else if(!open){html+='<p class="vs-note">الزيارة اتقفلت. لو لسه متحصّلش عليها، اضغط «تعديل قبل التحصيل» من لوحة اليوم الأول.</p>';}
  root.innerHTML=html;wire();}
 function form(){var g=function(s){var el=root.querySelector(s);return el?el.value:'';};return {order_id:g('[data-vs-order]'),item_id:g('[data-vs-item]'),location_id:g('[data-vs-loc]'),quantity:g('[data-vs-qty]')};}
 function add(f,confirm){if(st.busy)return;st.busy=true;say('');
  return rpc('clinic_reception_visit_supplies',{p_workspace:c.workspace,p_action:'add',p_payload:Object.assign({},f,confirm||{},{token:st.pending&&st.pending.token||uuid()})})
   .then(function(r){st.pending=null;say(r.billable?'اتضاف — '+money(r.amount)+' ج على فاتورة الخدمة':'اتضاف — في سعر الخدمة (مش على الفاتورة)');return load();})
   .catch(function(e){say(msg(e),true);}).then(function(){st.busy=false;});}
 function wire(){var go=root.querySelector('[data-vs-go]');if(!go)return;
  go.onclick=function(){var f=form();if(!f.item_id)return say('اختار المستلزم',true);if(!f.location_id)return say('اختار المخزن اللي هيتصرف منه',true);if(!(Number(f.quantity)>0))return say('اكتب الكمية',true);
   rpc('clinic_reception_visit_supplies',{p_workspace:c.workspace,p_action:'check',p_payload:{order_id:f.order_id,item_id:f.item_id,quantity:f.quantity}}).then(function(w1){
    var warn=[];if(w1&&w1.duplicate)warn.push('المستلزم ده متسجّل قبل كده على الخدمة: '+esc(w1.duplicate.by)+' — '+esc(when(w1.duplicate.at))+' — الكمية '+qty(w1.duplicate.quantity)+'.');
    if(w1&&w1.included)warn.push('المستلزم ده في سعر الخدمة — مش هيتحاسب عليه المريض وهيتخصم من المخزن بس.');
    if(!warn.length)return add(f);
    st.pending={f:f,confirm:{confirm_duplicate:!!(w1&&w1.duplicate),confirm_included:!!(w1&&w1.included)},token:uuid()};
    root.querySelector('[data-vs-warn]').innerHTML='<div class="vs-alert vs-warn" data-vs-confirm-box>'+warn.map(function(x){return '<p>'+x+'</p>';}).join('')+'<div class="vs-act"><button type="button" class="btn btn-primary" data-vs-confirm>متأكد، ضيفه</button><button type="button" class="btn" data-vs-drop>إلغاء</button></div></div>';
    root.querySelector('[data-vs-confirm]').onclick=function(){add(st.pending.f,st.pending.confirm);};
    root.querySelector('[data-vs-drop]').onclick=function(){st.pending=null;root.querySelector('[data-vs-warn]').innerHTML='';};
   }).catch(function(e){say(msg(e),true);});};}
 load();return m;}

function reopen(c,visitId,done){
 var m=c.modal('تعديل قبل التحصيل','<p class="vs-note">الزيارة هترجع مفتوحة عشان تضيف أو تعدّل خدمات ومستلزمات. ده متاح في نفس اليوم ولحد ما يتحصّل أي مبلغ. بعد ما تخلّص اضغط «إنهاء الزيارة» تاني.</p>'+(c.field?c.field('reason','السبب (اختياري)','text','',' '):''),
  function(v){return rpc('clinic_reception_visit_reopen',{p_workspace:c.workspace,p_visit:visitId,p_reason:String(v.reason||'').trim(),p_token:uuid()});},
  function(){if(done)return done();if(c.load)return c.load();},{ok:'افتح الزيارة للتعديل'});
 return m;}

/* reception-services act hook */
function act(a,id,c){
 if(a==='visit-supplies'){open(c,id);return true;}
 if(a==='visit-reopen'){reopen(c,id);return true;}
 if(a==='visit_close'&&c&&c.workspace&&c.modal){
  finishGuard({c:c,workspace:c.workspace,payload:{visit_id:id}}).then(function(g){if(!g)return;
   var f=c.field?c.field('reason','سبب إنهاء الزيارة دون خدمة منفذة إن وجد','text','',' '):'';
   if(g.ack){return c.command('visit_close',{id:id,missing_ack:true,reason:''},uuid()).then(function(){if(c.load)c.load();});}
   c.modal('إنهاء الزيارة','<p>راجع تنفيذ أو إلغاء كل الخدمات المطلوبة أولًا. يحتفظ حساب المريض بأي مبلغ غير مسدد بعد إنهاء الزيارة.</p>'+f,function(v,k){return c.command('visit_close',Object.assign({},v,{id:id}),k);});
  }).catch(function(e){w.alert(msg(e));});
  return true;}
 return false;}

w.SSMPDVisitSupplies={finishGuard:finishGuard,open:open,reopen:reopen,act:act,noteText:noteText};
(function(){if(d.getElementById('vs-style'))return;var s=d.createElement('style');s.id='vs-style';s.textContent=
 '.vs-alert{border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.8;margin:8px 0}.vs-warn{background:#FFF8EC;border:1px solid #F5D9A8}.vs-stop{background:#FDEEEB;border:1px solid #F3C2B8}'+
 '.vs-t{width:100%;border-collapse:collapse;font-size:13px}.vs-t th,.vs-t td{padding:6px;border-bottom:1px solid #EEF1F6;text-align:right}.vs-t th{color:#5b6577;font-weight:400}'+
 '.vs-chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px}.vs-inc{background:#E6F2EC;color:#2F7D5C}.vs-bil{background:#FFF1E9;color:#C2410C}'+
 '.vs-order h4{margin:10px 0 4px;color:#0F369D}.vs-order h4 small{color:#5b6577;font-weight:400}.vs-note{font-size:13px;color:#3B4658}.vs-add{display:grid;gap:8px;border:1px solid #D5DEEE;border-radius:12px;padding:10px;margin-top:10px}'+
 '.vs-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.vs-bad{color:#D0402A}';d.head.appendChild(s);})();
})(window,document);
