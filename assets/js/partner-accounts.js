/* «حساب الشريك» (owner 2026-11-26 «كمل باقي المراحل كلها» — daily-movements map phase 4). Accounting tab 'partners'
   (SSMPDFinanceControls layer): a card per partner with the balance, «كشف الحساب», «توريد من الشريك» / «صرف للشريك» (FM / accountant),
   the pending requests with «اعتماد» / «رفض» (FM / GM / super admin — never the requester) and «+ شريك» (super admin).
   Main treasury only. Server: public.clinic_finance_partner (20261126120000). */
(function(w,d){'use strict';
var KIND={deposit:'توريد من الشريك',withdrawal:'صرف للشريك'},MET={cash:'كاش — الخزينة الرئيسية',bank:'البنك'};
var SST={pending:['مستني الاعتماد','wait'],approved:['اتسجل','ok'],rejected:['اترفض','bad']};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return (+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function dt(v){if(!v)return '';var x=new Date(v);return isNaN(x)?'':x.toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric'});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_finance_partner',{p_action:a,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function uuid(){return (w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function badge(s){var b=SST[s]||[s,'wait'];return '<em class="pa-st '+b[1]+'">'+esc(b[0])+'</em>';}
function bal(v){v=+v||0;return v>0?'المركز عليه للشريك <b dir="ltr">'+money(v)+'</b>':v<0?'الشريك عليه للمركز <b dir="ltr">'+money(-v)+'</b>':'مفيش رصيد';}
function modal(title,body,save,ok){if(d.querySelector('.pa-modal'))return null;var root=d.createElement('div');root.className='modal-backdrop pa-modal';
 root.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header class="modal-head"><h3>'+esc(title)+'</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></header><form class="rx-form pa-form">'+body+'<p role="status" data-pa-status></p><footer>'+(save?'<button class="btn btn-primary" type="submit">'+esc(ok||'حفظ')+'</button>':'')+'<button class="btn" type="button" data-pa-cancel>'+(save?'إلغاء':'قفل')+'</button></footer></form></section>';
 d.body.appendChild(root);var form=root.querySelector('form'),key=uuid(),busy=false,close=function(){root.remove();};
 root.querySelector('.modal-close').onclick=close;root.querySelector('[data-pa-cancel]').onclick=close;
 form.onsubmit=async function(e){if(e&&e.preventDefault)e.preventDefault();if(!save||busy||(form.reportValidity&&!form.reportValidity()))return;var v={};Array.prototype.forEach.call(form.elements,function(x){if(x.name&&!x.disabled)v[x.name]=x.value;});
  busy=true;try{await save(v,key);close();}catch(err){root.querySelector('[data-pa-status]').textContent=(err&&err.message)||'تعذر الحفظ';}finally{busy=false;}};
 return root;}
function fld(n,t,type,val,extra){return '<label>'+esc(t)+'<input name="'+n+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" '+(extra||'required')+'></label>';}
function panelHtml(s){var ps=s.partners||[],pend=s.pending||[];
 return '<p class="fc-note">حساب لكل شريك في الخزينة الرئيسية بس: «توريد من الشريك» (فلوس داخلة منه — المركز بقى عليه ليه) و«صرف للشريك» (فلوس طالعة له). ده مش إيراد ولا مصروف — الإيجار وغيره بيتصرفوا مصروفات عادي. كل حركة بتتسجل بعد اعتماد شخص تاني.</p>'+
  '<div class="pa-cards">'+ps.map(function(p){return '<section class="pa-card"><h4>'+esc(p.name)+' <small dir="ltr">'+esc(p.account)+'</small></h4><p>'+bal(p.balance)+'</p>'+(+p.pending?'<p><small>'+esc(p.pending)+' طلب مستني اعتماد</small></p>':'')+
   '<div class="pa-actions"><button type="button" class="btn ghost" data-pa-st="'+esc(p.id)+'">كشف الحساب</button>'+(s.can_request&&p.active?'<button type="button" class="btn" data-pa-req="'+esc(p.id)+'" data-kind="deposit">+ توريد من الشريك</button><button type="button" class="btn" data-pa-req="'+esc(p.id)+'" data-kind="withdrawal">− صرف للشريك</button>':'')+'</div></section>';}).join('')+
  (s.can_add?'<section class="pa-card pa-add"><button type="button" class="btn ghost" data-pa-add>+ شريك</button></section>':'')+'</div>'+
  '<h4 class="fc-st-h">مستني الاعتماد ('+pend.length+')</h4>'+(pend.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>الوقت</th><th>الشريك</th><th>الحركة</th><th>المبلغ</th><th>السبب</th><th>طلبه</th><th></th></tr></thead><tbody>'+
  pend.map(function(m){return '<tr><td dir="ltr">'+esc(dt(m.at))+'</td><td>'+esc(m.partner)+'</td><td>'+esc(KIND[m.kind]||m.kind)+'<br><small>'+esc(MET[m.method]||m.method)+'</small></td><td dir="ltr">'+money(m.amount)+'</td><td>'+esc(m.reason)+(m.reference?'<br><small>'+esc(m.reference)+'</small>':'')+'</td><td>'+esc(m.by||'')+'</td>'+
   '<td>'+(s.can_review&&!m.mine?'<button type="button" class="btn btn-primary" data-pa-ok="'+esc(m.id)+'">اعتماد</button> <button type="button" class="btn" data-pa-no="'+esc(m.id)+'">رفض</button>':'<small>مستني شخص تاني</small>')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات مستنية.</p>');}
function reqModal(box,s,pid,kind){var p=(s.partners||[]).find(function(x){return x.id===pid;})||{};
 var body='<p class="rse-intro" data-wide>'+esc(KIND[kind])+' — '+esc(p.name)+'. '+bal(p.balance)+'.</p>'+
  fld('amount','المبلغ (جنيه)','number','','required min="0.01" step="0.01" inputmode="decimal"')+
  '<label>كاش ولا بنك؟<select name="method" required><option value="cash"'+(s.main_shift?'':' disabled')+'>'+esc(MET.cash)+(s.main_shift?(kind==='withdrawal'?' (فيها '+money(s.main_cash)+')':''):' — مفيش وردية مفتوحة')+'</option><option value="bank"'+(s.main_shift?'':' selected')+'>'+esc(MET.bank)+'</option></select></label>'+
  '<label data-wide>السبب<input name="reason" required minlength="3" maxlength="300" placeholder="مثلاً: توريد لدفع إيجار المركز"></label>'+fld('reference','المرجع (رقم التحويل / الإيصال)','text','','maxlength="120"')+
  '<p class="rse-note" data-wide>الحركة مابتتسجلش غير لما المدير المالي أو المدير العام أو السوبر أدمن (غيرك) يعتمدها.</p>';
 modal(KIND[kind]+' — '+p.name,body,async function(v,k){var amt=+v.amount;if(!(amt>0))throw new Error('اكتب المبلغ');
  await rpc('request',{partner_id:pid,kind:kind,amount:amt,method:v.method,reason:v.reason,reference:v.reference||'',token:k});toast('الطلب اتبعت للاعتماد');load(box);},'ابعت للاعتماد');}
function stModal(pid){rpc('statement',{partner_id:pid}).then(function(r){var ls=r.lines||[],mv=r.moves||[];
  var body='<p data-wide>'+bal(r.balance)+'</p><div data-wide class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>البيان</th><th>داخل منه</th><th>طالع له</th><th>رصيد الشريك</th></tr></thead><tbody>'+
   (ls.length?ls.map(function(l){return '<tr><td dir="ltr">'+esc(dt(l.at))+'</td><td>'+esc(l.description)+'</td><td dir="ltr">'+(+l.in?money(l.in):'')+'</td><td dir="ltr">'+(+l.out?money(l.out):'')+'</td><td dir="ltr">'+money(l.balance)+'</td></tr>';}).join(''):'<tr><td colspan="5">مفيش حركات لسه</td></tr>')+'</tbody></table></div>'+
   (mv.filter(function(m){return m.status!=='approved';}).length?'<h4 data-wide>طلبات مااتسجلتش</h4><ul data-wide class="rse-list">'+mv.filter(function(m){return m.status!=='approved';}).map(function(m){return '<li><span>'+esc(KIND[m.kind])+' — '+esc(m.reason)+'</span><b dir="ltr">'+money(m.amount)+'</b>'+badge(m.status)+(m.review_note?'<small>'+esc(m.review_note)+'</small>':'')+'</li>';}).join('')+'</ul>':'');
  modal('كشف حساب — '+r.partner,body,null);},function(e){toast(e.message||'تعذر','error');});}
function load(box){box.setAttribute('aria-busy','true');
 return rpc('status',{}).then(function(s){box.removeAttribute('aria-busy');box.innerHTML=panelHtml(s||{});wire(box,s||{});},function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر التحميل')+'</p>';});}
function wire(box,s){
 box.querySelectorAll('[data-pa-st]').forEach(function(b){b.onclick=function(){stModal(b.getAttribute('data-pa-st'));};});
 box.querySelectorAll('[data-pa-req]').forEach(function(b){b.onclick=function(){reqModal(box,s,b.getAttribute('data-pa-req'),b.getAttribute('data-kind'));};});
 var add=box.querySelector('[data-pa-add]');if(add)add.onclick=function(){modal('شريك جديد',fld('name','اسم الشريك','text','','required minlength="2" maxlength="80"')+'<p class="rse-note" data-wide>بيتعمله حساب جاري لوحده في الشجرة المحاسبية.</p>',async function(v){await rpc('add_partner',{name:v.name});toast('الشريك اتضاف');load(box);});};
 box.querySelectorAll('[data-pa-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('review',{id:b.getAttribute('data-pa-ok'),ok:true}).then(function(){toast('اتسجل في الحسابات');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-pa-no]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;b.disabled=true;rpc('review',{id:b.getAttribute('data-pa-no'),ok:false,note:n.trim()}).then(function(){toast('اترفض');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});}
function fill(){var box=d.querySelector('[data-partners]');if(box)load(box);}
var prior=w.SSMPDFinanceControls;
if(prior&&prior.panel){w.SSMPDFinanceControls=Object.assign({},prior,{panel:function(tab,dd,h){if(tab!=='partners')return prior.panel(tab,dd,h);setTimeout(fill,0);return '<div class="rse pa" data-partners><p class="rse-note">جاري التحميل…</p></div>';}});}
w.SSMPDPartners={load:load,_t:{panelHtml:panelHtml}};
})(window,document);
