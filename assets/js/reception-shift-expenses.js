/* «مصروفات الوردية» (owner 2026-11-20, mockup docs/ui-references/mockups/reception-petty-cash.html): every reception shift has
   a fixed spending allowance; the cashier pays small items (tissues, electricity card, water, internet…) from the open shift
   with the reason, amount and a photo of the receipt. Server: public.clinic_finance_shift_expense (20261120230000).
   Reception card: SSMPDShiftExpenses.decorate(context, section). Finance review tab: SSMPDFinanceControls layer 'shift-expenses'. */
(function(w,d){'use strict';
var BUCKET='shift-expense-receipts';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function hm(iso){try{return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}}
function dt(iso){try{return new Date(iso).toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_finance_shift_expense',{p_action:a,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
async function upload(file){var c=client();if(!c||!c.storage)throw new Error('تعذر رفع الإيصال');if(!file||!file.size)throw new Error('صوّر الإيصال الأول');if(file.size>8*1024*1024)throw new Error('الصورة أكبر من ٨ ميجا');
 var u=c.auth&&c.auth.getUser?await c.auth.getUser():null,uid=u&&u.data&&u.data.user&&u.data.user.id;if(!uid)throw new Error('سجل الدخول تاني');
 var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',path=uid+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
 var r=await c.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||undefined});if(r&&r.error)throw r.error;return path;}
/* ---------- reception card ---------- */
function cardHtml(s){var left=Math.max(0,(+s.allowance||0)-(+s.spent||0));
 return '<section class="rse-card" data-rse aria-label="مصروفات الوردية"><div class="rse-head"><h4>مصروفات الوردية <small>— '+esc(s.register)+'</small></h4>'+
  '<button type="button" class="btn btn-primary" data-rse-spend'+(left>0?'':' disabled')+'>− صرف من مصروفات الوردية</button></div>'+
  '<div class="rse-k"><div><span>هامش الوردية</span><b dir="ltr">'+money(s.allowance)+'</b></div><div><span>اتصرف</span><b dir="ltr">'+money(s.spent)+'</b></div><div><span>باقي</span><b dir="ltr">'+money(left)+'</b></div></div>'+
  ((s.expenses||[]).length?'<ul class="rse-list">'+s.expenses.slice(0,5).map(function(x){return '<li><time dir="ltr">'+esc(hm(x.at))+'</time><span>'+esc(x.item)+'</span><b dir="ltr">'+money(x.amount)+'</b>'+(x.post_review==='rejected'?'<em class="rse-bad">مرفوض</em>':x.post_review==='ok'?'<em class="rse-ok">اتراجع</em>':'<em>مستني مراجعة</em>')+'</li>';}).join('')+'</ul>':'')+'</section>';}
function spendModal(c,s,done){var left=Math.max(0,(+s.allowance||0)-(+s.spent||0)),lim=Math.min(+s.max||0,left,+s.cash||0);
 var body='<p class="rse-intro" data-wide>باقي من مصروفات الوردية <b dir="ltr">'+money(left)+'</b> جنيه · حد المصروف الواحد <b dir="ltr">'+money(s.max)+'</b> · نقدية الوردية <b dir="ltr">'+money(s.cash)+'</b></p>'+
  '<fieldset class="rse-items" data-wide><legend>البند</legend>'+(s.items||[]).map(function(it,i){return '<label class="rse-chip"><input type="radio" name="item" value="'+esc(it.key)+'"'+(i===0?' required':'')+'> '+esc(it.label)+'</label>';}).join('')+'</fieldset>'+
  c.field('amount','المبلغ (جنيه)','number','','required min="1" max="'+lim+'" step="0.01" inputmode="decimal"')+c.field('vendor','اشتريت من مين / المورد','text','','maxlength="120"')+
  '<label data-wide>السبب / التفاصيل<input name="reason" required minlength="3" maxlength="300" placeholder="مثلاً: ٢ كرتونة مناديل + صابون للحمام"></label>'+
  '<label data-wide class="rse-up" data-rse-up>📷 صورة الفاتورة أو الإيصال (إجباري)<input type="file" name="receipt" accept="image/*,application/pdf" capture="environment" required></label>'+
  '<p class="rse-note" data-wide data-rse-noreceipt hidden>البند ده من غير إيصال — اكتب في السبب لمين وليه (٥ حروف على الأقل)، والحسابات بتراجعه.</p>'+
  '<p class="rse-note" data-wide>المبلغ بيتخصم من نقدية ورديتك على طول، والحسابات بتراجعه بالإيصال. لو المبلغ أكبر من المسموح، اطلبه من الحسابات.</p>';
 var m=c.modal('صرف من مصروفات الوردية',body,async function(v,key){var amt=+v.amount;if(!(amt>0))throw new Error('اكتب المبلغ');if(amt>lim)throw new Error('المبلغ أكبر من المسموح ('+money(lim)+' جنيه) — اطلبه من الحسابات');
   var it=(s.items||[]).filter(function(x){return x.key===v.item;})[0],nr=!!(it&&it.no_receipt);
   if(nr&&String(v.reason||'').trim().length<5)throw new Error('اكتب سبب الإكرامية بالتفصيل (لمين وليه)');
   var path=nr?'':await upload(v.receipt);return rpc('spend',{shift_id:s.shift_id,item:v.item,amount:amt,vendor:v.vendor||'',reason:v.reason,receipt_path:path,token:key});},function(r){toast('اتصرف '+money(r&&r.amount)+' جنيه من مصروفات الوردية');if(done)done();});
 /* «إكراميات» (no_receipt): no photo field; the reason is the evidence */
 var f=(m&&m.querySelector&&m.querySelector('form'))||d.querySelector('.rx-modal form');
 if(f&&f.querySelector('[data-rse-up]')){var sync=function(){var k=(f.querySelector('input[name=item]:checked')||{}).value,it=(s.items||[]).filter(function(x){return x.key===k;})[0],nr=!!(it&&it.no_receipt);
   var up=f.querySelector('[data-rse-up]'),inp=up.querySelector('input');up.hidden=nr;up.style.display=nr?'none':'';inp.required=!nr;inp.disabled=nr;f.querySelector('[data-rse-noreceipt]').hidden=!nr;};
  f.addEventListener('change',sync);sync();}
 return m;}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 var host=c.host;if(host.querySelector('[data-rse]'))return;
 rpc('status',{}).then(function(s){if(!s||!s.open||!(+s.allowance>0)||!host.isConnected||host.querySelector('[data-rse]'))return;
  var anchor=host.querySelector('.rx-actions')||host.firstElementChild;var wrap=d.createElement('div');wrap.innerHTML=cardHtml(s);var card=wrap.firstElementChild;
  if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor);else host.prepend(card);
  card.querySelector('[data-rse-spend]').onclick=function(){spendModal(c,s,function(){card.remove();decorate(c,section);});};}).catch(function(){});}
/* ---------- finance review tab ---------- */
var state={from:'',to:'',only:''};
function panelHtml(x){var can=!!x.can_review,list=(x.expenses||[]).filter(function(e){return !state.only||(e.post_review||'pending')===state.only;});
 var tot=list.reduce(function(a,e){return a+(+e.amount||0);},0);
 return '<div class="rse-bar"><label>من<input type="date" data-rse-f="from" value="'+esc(state.from||x.from)+'"></label><label>إلى<input type="date" data-rse-f="to" value="'+esc(state.to||x.to)+'"></label>'+
  '<label>الحالة<select data-rse-f="only"><option value="">الكل</option><option value="pending"'+(state.only==='pending'?' selected':'')+'>مستني مراجعة</option><option value="ok"'+(state.only==='ok'?' selected':'')+'>اتراجع</option><option value="rejected"'+(state.only==='rejected'?' selected':'')+'>مرفوض</option></select></label></div>'+
  '<p class="rse-note">مصروفات صغيرة صرفها الاستقبال من ورديته في حدود هامش الوردية، كل واحد بإيصاله. الإجمالي المعروض <b dir="ltr">'+money(tot)+'</b> جنيه. الرفض بيسجّل للمتابعة ومش بيخصم من حد تلقائي.</p>'+
  '<div class="rse-tw"><table class="rse-t"><thead><tr><th>الوقت</th><th>الخزنة / مين</th><th>البند والسبب</th><th>المبلغ</th><th>الإيصال</th><th>المراجعة</th></tr></thead><tbody>'+
  (list.length?list.map(function(e){var st=e.post_review==='ok'?'<span class="rse-ok">اتراجع'+(e.reviewed_by?' — '+esc(e.reviewed_by):'')+'</span>':e.post_review==='rejected'?'<span class="rse-bad">مرفوض — '+esc(e.review_note||'')+'</span>':
     (can&&!e.own?'<button type="button" class="btn" data-rse-ok="'+esc(e.id)+'">اتراجع ✓</button> <button type="button" class="btn" data-rse-no="'+esc(e.id)+'">رفض</button>':'<span>مستني مراجعة</span>');
    return '<tr><td dir="ltr">'+esc(dt(e.at))+'</td><td>'+esc(e.register)+'<br><small>'+esc(e.by||'')+'</small></td><td>'+esc(e.reason)+(e.vendor?'<br><small>'+esc(e.vendor)+'</small>':'')+'</td><td dir="ltr">'+money(e.amount)+'</td><td>'+(e.receipt&&e.receipt!=='no-receipt'?'<button type="button" class="btn" data-rse-file="'+esc(e.receipt)+'">عرض</button>':'<small>من غير إيصال</small>')+'</td><td>'+st+'</td></tr>';}).join(''):'<tr><td colspan="6">مفيش مصروفات في الفترة دي</td></tr>')+'</tbody></table></div>'+
  (can?'<h4>هامش مصروفات الوردية لكل خزنة</h4><div class="rse-tw"><table class="rse-t"><thead><tr><th>الخزنة</th><th>هامش الوردية</th><th>حد المصروف الواحد</th><th></th></tr></thead><tbody>'+(x.registers||[]).filter(function(r){return r.kind!=='main';}).map(function(r){
    return '<tr><td>'+esc(r.name)+'</td><td dir="ltr">'+money(r.allowance)+'</td><td dir="ltr">'+money(r.max)+'</td><td><button type="button" class="btn" data-rse-lim="'+esc(r.id)+'" data-a="'+esc(r.allowance)+'" data-m="'+esc(r.max)+'">تعديل</button></td></tr>';}).join('')+'</tbody></table></div><p class="rse-note">صفر = مصروفات الوردية مقفولة للخزنة دي.</p>':'');}
function load(box){box.setAttribute('aria-busy','true');return rpc('list',{from:state.from,to:state.to}).then(function(x){box.removeAttribute('aria-busy');box.innerHTML=panelHtml(x||{});wire(box,x||{});})
 .catch(function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="rse-bad" role="alert">'+esc(e&&e.message||'تعذر تحميل مصروفات الورديات')+'</p>';});}
function wire(box,x){box.querySelectorAll('[data-rse-f]').forEach(function(el){el.onchange=function(){state[el.getAttribute('data-rse-f')]=el.value;load(box);};});
 box.querySelectorAll('[data-rse-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('review',{id:b.getAttribute('data-rse-ok'),ok:true}).then(function(){load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-no]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;rpc('review',{id:b.getAttribute('data-rse-no'),ok:false,note:n.trim()}).then(function(){load(box);},function(e){toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-lim]').forEach(function(b){b.onclick=function(){var a=w.prompt('هامش مصروفات الوردية (جنيه)؟',b.getAttribute('data-a'));if(a==null)return;var m=w.prompt('حد المصروف الواحد (جنيه)؟',b.getAttribute('data-m'));if(m==null)return;
   rpc('set_limits',{register_id:b.getAttribute('data-rse-lim'),allowance:+a,max:+m}).then(function(){toast('اتحفظ');load(box);},function(e){toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-file]').forEach(function(b){b.onclick=async function(){try{var c=client(),r=await c.storage.from(BUCKET).createSignedUrl(b.getAttribute('data-rse-file'),300);if(r.error)throw r.error;w.open(r.data.signedUrl,'_blank','noopener');}catch(e){toast(e.message||'تعذر فتح الإيصال','error');}};});}
var prior=w.SSMPDFinanceControls;
if(prior){var fill=function(){d.querySelectorAll('[data-shift-expenses]:not([data-ready])').forEach(function(b){b.setAttribute('data-ready','');load(b);});};
 w.SSMPDFinanceControls={panel:function(tab,dd,h){if(tab!=='shift-expenses')return prior.panel(tab,dd,h);setTimeout(fill,0);return '<div class="rse" data-shift-expenses><p class="rse-note">جاري التحميل…</p></div>';},act:prior.act,due:prior.due,ledger:prior.ledger};}
w.SSMPDShiftExpenses={decorate:decorate,load:load,state:state,_t:{cardHtml:cardHtml,panelHtml:panelHtml}};
})(window,document);
