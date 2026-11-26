/* «على حساب الموظف — يتخصم من المرتب» (owner «طبّق شكل مديونية الموظف» 2026-11-26, mockup docs/ui-references/mockups/employee-account.html).
   1) «تسجيل تحصيل» of a service invoice (live workspace): a payment method «على حساب الموظف (يتخصم من المرتب)» when the patient is an
      employee or a first-degree relative → sends the debt for approval (no cash enters the drawer).
   2) Reception card «على حساب الموظف»: «تحويل التحصيل لمديونية على الموظف» for a cash receipt recorded by mistake + my requests.
   3) Finance tab «طلبات صرف من الدرج»: approvals (financial manager / owner, never the requester) + «مديونيات الموظفين».
   Server: public.clinic_finance_employee_debt (20261126210000). The salary deduction is automatic on the payroll request. */
(function(w,d){'use strict';
var KIND={service:'خدمة على حساب الموظف',convert:'تحويل تحصيل لمديونية'};
var REL={self:'الموظف نفسه',spouse:'زوج / زوجة',child:'ابن / بنت',parent:'أب / أم',sibling:'أخ / أخت'};
var ST={pending:['مستني موافقة','wait'],approved:['اتعتمد القيد','ok'],rejected:['اترفض','bad'],cancelled:['اتلغى','done']};
var MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
var last=null;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return (+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function dt(v){if(!v)return '';var x=new Date(v);return isNaN(x)?'':x.toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function monthName(iso){var m=/^(\d{4})-(\d{2})/.exec(String(iso||''));return m?MONTHS[+m[2]-1]+' '+m[1]:'';}
function addMonths(iso,n){var m=/^(\d{4})-(\d{2})/.exec(String(iso||''));if(!m)return '';var y=+m[1],k=+m[2]-1+n;y+=Math.floor(k/12);k=((k%12)+12)%12;return y+'-'+String(k+1).padStart(2,'0')+'-01';}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_finance_employee_debt',{p_action:a,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function badge(s){var b=ST[s]||[s,'wait'];return '<em class="rdr-st '+b[1]+'">'+esc(b[0])+'</em>';}
function plan(x){return +x.months>1?x.months+' × '+money(x.installment):'مرة واحدة';}
function who(x){return esc(x.person_name)+(x.relation&&x.relation!=='self'?' <small>('+esc(REL[x.relation]||x.relation)+')</small>':'');}
function staffOptions(list,def){return (list||[]).map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===def?' selected':'')+'>'+esc(s.name)+' — '+esc(s.code||'')+' · '+esc(REL[s.relation]||s.relation)+'</option>';}).join('');}
/* the shared block: employee + once / installments + start month + reason + the entry preview */
function planBlock(o,amount,debit,credit){var start=o.next_month;
 return '<div class="emd-plan" data-emd-plan data-wide>'+
  '<label>الموظف (المديونية عليه)<select name="emd_person" required>'+staffOptions(o.staff,o.default_person)+'</select></label>'+
  '<fieldset class="rse-items"><legend>الخصم من المرتب</legend>'+
   '<label class="rse-chip"><input type="radio" name="emd_mode" value="once" checked> مرة واحدة</label>'+
   '<label class="rse-chip"><input type="radio" name="emd_mode" value="split"> أقساط</label></fieldset>'+
  '<label data-emd-months hidden>عدد الشهور<input name="emd_months" type="number" min="2" max="12" step="1" value="3" inputmode="numeric"></label>'+
  '<label>أول خصم من مرتب<select name="emd_first">'+[0,1,2,3].map(function(i){var m=addMonths(start,i-1);return '<option value="'+m+'"'+(i===1?' selected':'')+'>'+esc(monthName(m))+'</option>';}).join('')+'</select></label>'+
  '<label data-wide>السبب<input name="emd_reason" minlength="3" maxlength="300" placeholder="مثلاً: كشف ابن الموظف — يتخصم من المرتب"></label>'+
  '<div class="emd-entry" data-emd-entry><b>بعد الموافقة</b><span data-emd-sum></span><span>مدين: سلف ومديونيات العاملين (1142) <b dir="ltr">'+money(amount)+'</b></span><span>دائن: '+esc(credit)+' <b dir="ltr">'+money(amount)+'</b></span><span>'+esc(debit)+'</span></div>'+
  '<p class="rse-note">الموافقة: المدير المالي أو المالك — مش نفس اللي طلب. القسط بيتخصم لوحده من المرتب كل شهر.</p></div>';}
function bindPlan(root,amount){var sync=function(){var split=(root.querySelector('[name=emd_mode]:checked')||{}).value==='split',box=root.querySelector('[data-emd-months]'),n=split?Math.max(2,Math.min(12,+root.querySelector('[name=emd_months]').value||2)):1;
  box.hidden=!split;var first=root.querySelector('[name=emd_first]').value;
  root.querySelector('[data-emd-sum]').textContent=n>1?n+' شهور × '+money(Math.round(amount/n*100)/100)+' — من '+monthName(first)+' لحد '+monthName(addMonths(first,n-1)):'مرة واحدة من مرتب '+monthName(first);};
 root.querySelectorAll('[name=emd_mode],[name=emd_months],[name=emd_first]').forEach(function(x){x.addEventListener('change',sync);x.addEventListener('input',sync);});sync();}
function planValues(root){var split=(root.querySelector('[name=emd_mode]:checked')||{}).value==='split';
 return {person_id:root.querySelector('[name=emd_person]').value,months:split?Math.max(2,Math.min(12,+root.querySelector('[name=emd_months]').value||2)):1,
  first_month:root.querySelector('[name=emd_first]').value,reason:String(root.querySelector('[name=emd_reason]').value||'').trim()};}
/* ---------- 1) «تسجيل تحصيل» ---------- */
var HIDE=['amount','reference','shift_id','proof_file','note'];
function enhanceCollect(root){if(!root||root._emd)return;var form=root.querySelector('form'),title=root.querySelector('#rx-title');
 if(!form||!title||title.textContent.trim()!=='تسجيل تحصيل')return;var inv=form.querySelector('input[type=hidden][name=invoice_id]'),method=form.elements.method;
 if(!inv||!method||!last||!last.workspace||!last.data||!last.data.workspace||last.data.workspace.mode!=='live')return;root._emd=true;
 rpc('options',{workspace_id:last.workspace,invoice_id:inv.value}).then(function(o){if(!o||!o.live||!root.isConnected)return;
  if(o.open){form.insertAdjacentHTML('afterbegin','<p class="emd-wait" data-emd-open>'+(o.open.status==='pending'?'الفاتورة دي مستنية اعتماد الخصم من المرتب ('+esc(o.open.person_name)+') — مش مدفوعة لحد الموافقة.':'الفاتورة دي اتحسبت على حساب الموظف ('+esc(o.open.person_name)+').')+'</p>');return;}
  if(!(o.staff||[]).length||o.package||!(+o.due>0))return;
  var opt=d.createElement('option');opt.value='employee';opt.textContent='على حساب الموظف (يتخصم من المرتب)';method.appendChild(opt);
  var holder=d.createElement('div');holder.hidden=true;holder.setAttribute('data-emd-collect','');holder.setAttribute('data-wide','');
  holder.innerHTML='<p class="rse-note">المريض هو الموظف أو قريبه من الدرجة الأولى (نفس شرط خصم العاملين). مفيش فلوس بتدخل الدرج — المبلغ بيتسجل مديونية على الموظف. لحد الموافقة الفاتورة بتبان «مستنية اعتماد الخصم من المرتب».</p>'+planBlock(o,o.due,'درج الكاش: مفيش فلوس دخلت','مدينو المرضى / تحصيل الخدمة (1122)');
  method.closest('label').insertAdjacentElement('afterend',holder);bindPlan(holder,+o.due);
  var others=function(){return HIDE.map(function(n){return form.elements[n];}).filter(Boolean).map(function(el){return el.length&&!el.tagName?el[0]:el;});};
  var sync=function(){var on=method.value==='employee';holder.hidden=!on;holder.querySelector('[name=emd_reason]').required=on;holder.querySelector('[name=emd_person]').required=on;
   others().forEach(function(el){var l=el.closest('label');if(l)l.hidden=on;el.disabled=on;});
   form.querySelectorAll('[data-pay-ref-hint],[data-rx-multi]').forEach(function(x){x.hidden=on;});
   var ok=root.querySelector('footer [type=submit]');if(ok){if(!ok._t)ok._t=ok.textContent;ok.textContent=on?'ابعت للموافقة':ok._t;}};
  method.addEventListener('change',sync);sync();
  root.addEventListener('submit',function(e){if(method.value!=='employee')return;e.preventDefault();e.stopPropagation();if(!form.reportValidity())return;
   var v=planValues(holder),st=root.querySelector('[data-rx-status]'),btns=root.querySelectorAll('button');btns.forEach(function(b){b.disabled=true;});
   rpc('request',Object.assign({kind:'service',invoice_id:inv.value,token:(w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():String(Date.now()))},v)).then(function(){
     root.remove();toast('اتبعت للموافقة — الفاتورة مستنية اعتماد الخصم من المرتب');if(last&&last.load)last.load();},
    function(err){btns.forEach(function(b){b.disabled=false;});if(st)st.textContent=err.message||'تعذر الإرسال';});},true);
 }).catch(function(){});}
var mo=w.MutationObserver?new w.MutationObserver(function(){var r=d.querySelector('.rx-modal');if(r&&!r._emd)enhanceCollect(r);}):null;
if(mo&&d.body)mo.observe(d.body,{childList:true});
/* ---------- 2) reception card ---------- */
function cardHtml(mine){return '<section class="rse-card emd-card" data-emd aria-label="على حساب الموظف"><div class="rse-head"><h4>على حساب الموظف <small>— يتخصم من المرتب</small></h4>'+
  '<button type="button" class="btn" data-emd-convert>تحويل تحصيل لمديونية على الموظف</button></div>'+
  '<p class="rse-note">للإيصال النقدي اللي اتسجل بالغلط ومادخلش فلوس، والمريض موظف أو قريبه. بعد الموافقة الكاش المتوقع في الدرج بيقل بنفس المبلغ.</p>'+
  (mine.length?'<ul class="rse-list rdr-list">'+mine.map(function(x){return '<li><span>'+esc(KIND[x.kind]||x.kind)+' — '+who(x)+(x.visit_no?' · زيارة '+esc(x.visit_no):'')+'</span><b dir="ltr">'+money(x.amount)+'</b><small>'+esc(plan(x))+'</small>'+badge(x.status)+
   (x.status==='rejected'&&x.note?'<small>'+esc(x.note)+'</small>':'')+(x.status==='pending'&&x.mine?'<button type="button" class="btn ghost" data-emd-cancel="'+esc(x.id)+'">الغي</button>':'')+'</li>';}).join('')+'</ul>':'')+'</section>';}
function convertModal(c,items,done,next){if(!items.length){toast('مفيش إيصالات نقدي لموظف أو قريبه في آخر 14 يوم','error');return null;}
 var free=items.filter(function(x){return !x.open;});if(!free.length){toast('كل الإيصالات دي عليها طلب بالفعل','error');return null;}
 var body='<label data-wide>الإيصال النقدي<select name="payment_id" required>'+free.map(function(x){return '<option value="'+esc(x.payment_id)+'">'+esc((x.visit_no?'زيارة '+x.visit_no+' — ':'')+x.patient+' — '+money(x.amount)+' — '+(x.cashier||'')+(x.shift_open?' (مفتوحة)':' (اتقفلت)'))+'</option>';}).join('')+'</select></label><div data-emd-host data-wide></div>';
 var root=c.modal('تحويل التحصيل لمديونية على الموظف',body,function(v,key){var x=planValues(root);if(x.reason.length<3)throw new Error('اكتب السبب');
   return rpc('request',Object.assign({kind:'convert',payment_id:v.payment_id,token:key},x));},function(){toast('اتبعت للموافقة');if(done)done();},{ok:'ابعت للموافقة',cancel:'رجوع'});
 if(!root)return null;var sel=root.querySelector('[name=payment_id]'),host=root.querySelector('[data-emd-host]');
 var paint=function(){var x=free.find(function(y){return y.payment_id===sel.value;})||free[0];
  host.innerHTML='<p class="rse-note">للحالات اللي اتسجلت «نقدي» بالغلط ومادخلش فلوس.</p>'+planBlock({staff:x.staff,next_month:next||addMonths(new Date().toISOString().slice(0,7)+'-01',1)},x.amount,
   x.shift_open?'الوردية مفتوحة: الكاش المتوقع في الدرج يقل −'+money(x.amount):'الوردية اتقفلت: تسوية على فرق الخزينة بتاعها بنفس المبلغ','الخزنة — درج الوردية (1111)');
  bindPlan(host,+x.amount);var r=host.querySelector('[name=emd_reason]');r.required=true;r.value='اتسجل كاش بالغلط — هيتخصم من المرتب';};
 sel.addEventListener('change',paint);paint();return root;}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace)return;last=c;if(c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 var host=c.host;if(host.querySelector('[data-emd]'))return;
 rpc('list',{}).then(function(l){if(!host.isConnected||host.querySelector('[data-emd]'))return;var mine=(l.items||[]).filter(function(x){return x.mine;}).slice(0,8);
  var wrap=d.createElement('div');wrap.innerHTML=cardHtml(mine);var card=wrap.firstElementChild;
  var after=host.querySelector('[data-rdr]')||host.querySelector('[data-rse]'),anchor=host.querySelector('.rx-actions')||host.firstElementChild;
  if(after&&after.parentNode)after.parentNode.insertBefore(card,after.nextSibling);else if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor);else host.prepend(card);
  var redo=function(){card.remove();decorate(c,section);};
  card.querySelector('[data-emd-convert]').onclick=function(){rpc('convertible',{workspace_id:c.workspace}).then(function(r){convertModal(c,r.items||[],redo,r.next_month);},function(e){toast(e.message||'تعذر','error');});};
  card.querySelectorAll('[data-emd-cancel]').forEach(function(b){b.onclick=function(){if(!w.confirm('تلغي الطلب؟'))return;b.disabled=true;rpc('cancel',{id:b.getAttribute('data-emd-cancel')}).then(function(){toast('الطلب اتلغى');redo();},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 }).catch(function(){});}
var se=w.SSMPDShiftExpenses;if(se&&se.decorate&&!se._emd){var orig=se.decorate;se.decorate=function(c,section){orig(c,section);decorate(c,section);};se._emd=true;}
/* ---------- 3) finance: approvals + balances ---------- */
function rowHtml(x,act){return '<tr><td dir="ltr">'+esc(dt(x.at))+'</td><td>'+esc(KIND[x.kind]||x.kind)+(x.visit_no?'<br><small>زيارة '+esc(x.visit_no)+'</small>':'')+'</td><td>'+who(x)+'</td><td dir="ltr">'+money(x.amount)+'</td><td>'+esc(plan(x))+'<br><small>من '+esc(monthName(x.first_month))+'</small></td><td>'+esc(x.by||'')+'<br><small>'+esc(x.reason||'')+'</small></td><td>'+(act||badge(x.status)+(x.note?'<br><small>'+esc(x.note)+'</small>':''))+'</td></tr>';}
function panelHtml(l){var inbox=l.inbox||[],items=l.items||[],bal=l.balances||[],head='<thead><tr><th>الوقت</th><th>النوع</th><th>الموظف</th><th>المبلغ</th><th>الخصم</th><th>طلبه</th><th>الحالة</th></tr></thead>';
 return '<h4 class="fc-st-h">على حساب الموظف — يتخصم من المرتب</h4><p class="fc-note">الموافقة: المدير المالي أو السوبر أدمن (المالك) — أي واحد فيهم، بشرط مايكونش اللي طلب. بعد الموافقة القيد بيتسجل، والقسط بيتخصم لوحده من المرتب كل شهر.</p>'+
  (l.can_review?'<h4 class="fc-st-h">مستني موافقتك ('+inbox.length+')</h4>'+(inbox.length?'<div class="table-wrap"><table class="data-table">'+head+'<tbody>'+inbox.map(function(x){return rowHtml(x,'<button type="button" class="btn btn-primary" data-emd-ok="'+esc(x.id)+'">موافقة</button> <button type="button" class="btn" data-emd-no="'+esc(x.id)+'">رفض</button>');}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات مستنياك.</p>'):'')+
  '<h4 class="fc-st-h">الطلبات ('+items.length+')</h4>'+(items.length?'<div class="table-wrap"><table class="data-table">'+head+'<tbody>'+items.map(function(x){return rowHtml(x);}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات في الفترة دي.</p>')+
  (bal.length?'<h4 class="fc-st-h">مديونيات الموظفين — في المرتبات</h4><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>المديونية</th><th>اتخصم</th><th>الباقي</th><th>قسط الشهر ده</th><th>آخر قسط</th></tr></thead><tbody>'+
   bal.map(function(b){return '<tr data-emd-bal><td>'+esc(b.name)+'</td><td dir="ltr">'+money(b.total)+'</td><td dir="ltr">'+money(b.recovered)+'</td><td dir="ltr">'+money((+b.total||0)-(+b.recovered||0))+'</td><td dir="ltr">'+money(b.this_month)+'</td><td>'+esc(monthName(b.last_month))+'</td></tr>';}).join('')+'</tbody></table></div>':'');}
function load(box){box.setAttribute('aria-busy','true');
 return rpc('list',{}).then(function(l){box.removeAttribute('aria-busy');box.innerHTML=panelHtml(l||{});wire(box);},function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر التحميل')+'</p>';});}
function wire(box){
 box.querySelectorAll('[data-emd-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('review',{id:b.getAttribute('data-emd-ok'),ok:true}).then(function(){toast('اتوافق — القيد اتسجل');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-emd-no]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;b.disabled=true;rpc('review',{id:b.getAttribute('data-emd-no'),ok:false,note:n.trim()}).then(function(){toast('اترفض');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});}
function fill(){var box=d.querySelector('[data-employee-debts]');if(box)load(box);}
var prior=w.SSMPDFinanceControls;
if(prior&&prior.panel){w.SSMPDFinanceControls=Object.assign({},prior,{panel:function(tab,dd,h){var html=prior.panel(tab,dd,h);if(tab!=='drawer-requests')return html;setTimeout(fill,0);return html+'<div class="rse emd" data-employee-debts><p class="rse-note">جاري التحميل…</p></div>';}});}
w.SSMPDEmployeeDebt={decorate:decorate,load:load,enhanceCollect:enhanceCollect,_t:{cardHtml:cardHtml,panelHtml:panelHtml,planBlock:planBlock,addMonths:addMonths,monthName:monthName}};
})(window,document);
