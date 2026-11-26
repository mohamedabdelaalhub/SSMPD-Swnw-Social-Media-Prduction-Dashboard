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
var state={from:'',to:'',only:'',setOpen:false};
/* help 299 (owner «طبقه» 2026-11-26, mockup docs/ui-references/mockups/shift-expenses-redesign.html): ONE period (the accounting shell's), numbers on top,
   status chips, one card per expense, a plain empty state, the limits behind a button, small sheets (✕) instead of window.prompt().
   Same RPC (clinic_finance_shift_expense list / review / set_limits) and the same payload keys; the status filter stays client-side. */
function shellPeriod(){var f=d.querySelector('.fc-filters');if(f&&f.elements&&f.elements.from&&f.elements.to&&f.elements.from.value&&f.elements.to.value)return {from:f.elements.from.value,to:f.elements.to.value};return {from:state.from,to:state.to};}
function chip(v,label,cur){return '<button type="button" class="rse-chip'+(cur===v?' on':'')+'" data-rse-only="'+v+'" aria-pressed="'+(cur===v?'true':'false')+'">'+label+'</button>';}
function expenseCard(e,can){var rv=e.post_review||'pending',stl=rv==='ok'?'<span class="rse-st ok">اتراجع ✓'+(e.reviewed_by?' — '+esc(e.reviewed_by):'')+'</span>':rv==='rejected'?'<span class="rse-st bad">مرفوض'+(e.review_note?' — «'+esc(e.review_note)+'»':'')+'</span>':'<span class="rse-st w">مستني مراجعة</span>';
 var act=(rv==='pending'&&can&&!e.own?'<button type="button" class="btn btn-primary" data-rse-ok="'+esc(e.id)+'">اتراجع ✓</button><button type="button" class="btn" data-rse-no="'+esc(e.id)+'" data-r="'+esc(e.reason||'')+'">رفض</button>':'')+(e.receipt&&e.receipt!=='no-receipt'?'<button type="button" class="btn" data-rse-file="'+esc(e.receipt)+'">الإيصال</button>':'');
 return '<article class="rse-ex"><div class="rse-ex-top"><b>'+esc(e.reason)+'</b><span class="rse-amt"><span dir="ltr">'+money(e.amount)+'</span> ج.م</span></div><small>'+esc(e.register)+(e.by?' · '+esc(e.by):'')+' · <span dir="ltr">'+esc(dt(e.at))+'</span>'+(e.vendor?' · '+esc(e.vendor):'')+(e.receipt&&e.receipt!=='no-receipt'?'':' · من غير إيصال')+'</small>'+stl+(act?'<div class="rse-ex-act">'+act+'</div>':'')+'</article>';}
function panelHtml(x){var can=!!x.can_review,all=x.expenses||[],list=all.filter(function(e){return !state.only||(e.post_review||'pending')===state.only;});
 var tot=all.reduce(function(a,e){return a+(+e.amount||0);},0),pend=all.filter(function(e){return (e.post_review||'pending')==='pending'&&(!can||!e.own);}).length,per=shellPeriod();
 var regs=(x.registers||[]).filter(function(r){return r.kind!=='main';});
 return '<p class="rse-period">الفترة: <b>من <bdi dir="ltr">'+esc(per.from||x.from||'')+'</bdi> إلى <bdi dir="ltr">'+esc(per.to||x.to||'')+'</bdi></b> — بتتغيّر من شريط الفترة اللي فوق</p>'+
  '<div class="rse-kpis"><div class="rse-kpi"><span>عدد المصروفات</span><b dir="ltr">'+all.length+'</b></div><div class="rse-kpi"><span>الإجمالي</span><b><bdi dir="ltr">'+money(tot)+'</bdi> ج.م</b></div><div class="rse-kpi'+(pend?' need':'')+'"><span>'+(can?'مستني مراجعتك':'مستني مراجعة')+'</span><b dir="ltr">'+pend+'</b></div></div>'+
  '<p class="rse-note">مصروفات صغيرة صرفها الاستقبال من ورديته في حدود هامش الوردية، كل واحد بإيصاله. الرفض علامة للمتابعة بس ومش بيرجّع الفلوس.</p>'+
  '<div class="rse-chips" role="group" aria-label="الحالة">'+chip('','الكل',state.only)+chip('pending','مستني مراجعة',state.only)+chip('ok','اتراجع',state.only)+chip('rejected','مرفوض',state.only)+'</div>'+
  (list.length?'<div class="rse-cards">'+list.map(function(e){return expenseCard(e,can);}).join('')+'</div>':'<div class="rse-empty"><b>'+(all.length?'مفيش مصروفات بالحالة دي':'مفيش مصروفات في الفترة دي')+'</b><span>'+(all.length?'جرّب حالة تانية من فوق.':'غيّر الفترة من الشريط اللي فوق لو عايز تشوف أيام تانية.')+'</span></div>')+
  (can?'<button type="button" class="rse-ah'+(state.setOpen?' open':'')+'" data-rse-set aria-expanded="'+(state.setOpen?'true':'false')+'"><b>هامش الصرف لكل خزينة</b><span aria-hidden="true">'+(state.setOpen?'⌃':'⌄')+'</span></button>'+
   '<div class="rse-set" data-rse-setbody'+(state.setOpen?'':' hidden')+'>'+regs.map(function(r){return '<div class="rse-srow"><span><b>'+esc(r.name)+'</b><small>هامش الوردية <span dir="ltr">'+money(r.allowance)+'</span> ج.م · حد المصروف الواحد <span dir="ltr">'+money(r.max)+'</span> ج.م</small></span><button type="button" class="btn" data-rse-lim="'+esc(r.id)+'" data-n="'+esc(r.name)+'" data-a="'+esc(r.allowance)+'" data-m="'+esc(r.max)+'">تعديل</button></div>';}).join('')+
   '<p class="rse-note">الهامش = أقصى إجمالي للكاشير في الوردية الواحدة. صفر في أي رقم = كارت المصروفات مقفول للخزينة دي. التعديل بيسري على المصروفات الجاية.</p></div>':'');}
function paint(box){var x=box._x||{};box.innerHTML=panelHtml(x);wire(box,x);}
function load(box){box.setAttribute('aria-busy','true');var per=shellPeriod();state.from=per.from;state.to=per.to;return rpc('list',{from:state.from,to:state.to}).then(function(x){box.removeAttribute('aria-busy');box._x=x||{};paint(box);})
 .catch(function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="rse-bad" role="alert">'+esc(e&&e.message||'تعذر تحميل مصروفات الورديات')+'</p>';});}
function sheet(title,body,save,after){var FC=w.SSMPDFinanceCash,h=FC&&FC.helpers;if(h&&typeof h.modal==='function'){h.modal(title,body,save,after);return true;}return false;}
function wire(box,x){box.querySelectorAll('[data-rse-only]').forEach(function(b){b.onclick=function(){state.only=b.getAttribute('data-rse-only');paint(box);};});
 var sb=box.querySelector('[data-rse-set]');if(sb)sb.onclick=function(){state.setOpen=!state.setOpen;paint(box);};
 box.querySelectorAll('[data-rse-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('review',{id:b.getAttribute('data-rse-ok'),ok:true}).then(function(){load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-no]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-rse-no'),why=b.getAttribute('data-r')||'';
  if(sheet('رفض مصروف «'+why+'»','<label class="fc-field">سبب الرفض (٣ حروف على الأقل)<input name="note" type="text" required minlength="3" maxlength="300" autocomplete="off"></label><p class="rse-note">الرفض علامة للمتابعة بس — الفلوس والقيد مابيتغيروش.</p>',function(v){var n=String(v.note||'').trim();if(n.length<3)throw new Error('اكتب سبب الرفض (٣ حروف على الأقل)');return rpc('review',{id:id,ok:false,note:n});},function(){return load(box);}))return;
  var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;rpc('review',{id:id,ok:false,note:n.trim()}).then(function(){load(box);},function(e){toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-lim]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-rse-lim'),nm=b.getAttribute('data-n')||'',a0=b.getAttribute('data-a'),m0=b.getAttribute('data-m');
  if(sheet('تعديل هامش '+nm,'<label class="fc-field">هامش مصروفات الوردية (ج.م)<input name="allowance" type="number" min="0" step="0.01" inputmode="decimal" required value="'+esc(a0)+'"></label><label class="fc-field">حد المصروف الواحد (ج.م)<input name="max" type="number" min="0" step="0.01" inputmode="decimal" required value="'+esc(m0)+'"></label>',function(v){return rpc('set_limits',{register_id:id,allowance:+v.allowance,max:+v.max});},function(){toast('اتحفظ');return load(box);}))return;
  var a=w.prompt('هامش مصروفات الوردية (جنيه)؟',a0);if(a==null)return;var m=w.prompt('حد المصروف الواحد (جنيه)؟',m0);if(m==null)return;
  rpc('set_limits',{register_id:id,allowance:+a,max:+m}).then(function(){toast('اتحفظ');load(box);},function(e){toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rse-file]').forEach(function(b){b.onclick=async function(){try{var c=client(),r=await c.storage.from(BUCKET).createSignedUrl(b.getAttribute('data-rse-file'),300);if(r.error)throw r.error;w.open(r.data.signedUrl,'_blank','noopener');}catch(e){toast(e.message||'تعذر فتح الإيصال','error');}};});}
var prior=w.SSMPDFinanceControls;
if(prior){var fill=function(){d.querySelectorAll('[data-shift-expenses]:not([data-ready])').forEach(function(b){b.setAttribute('data-ready','');load(b);});};
 w.SSMPDFinanceControls={panel:function(tab,dd,h){if(tab!=='shift-expenses')return prior.panel(tab,dd,h);setTimeout(fill,0);return '<div class="rse" data-shift-expenses><p class="rse-note">جاري التحميل…</p></div>';},act:prior.act,due:prior.due,ledger:prior.ledger};}
w.SSMPDShiftExpenses={decorate:decorate,load:load,state:state,_t:{cardHtml:cardHtml,panelHtml:panelHtml}};
})(window,document);
