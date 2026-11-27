/* «طلب صرف من الدرج» (owner 2026-11-26 «كمل باقي المراحل كلها» — daily-movements map phase 2).
   Reception card (next to «مصروفات الوردية»): ask for an employee advance, a staff incentive or a supplier invoice; after the
   approvals the SAME cashier presses «اتصرف» and it is paid from his own open shift. Finance tab «طلبات صرف من الدرج»
   (SSMPDFinanceControls layer 'drawer-requests'): the approvals inbox for GM / super admin (first), FM (second) and accountant /
   FM (supplier invoices), plus the period list. Server: public.clinic_finance_drawer_request (20261126100000). */
(function(w,d){'use strict';
var BUCKET='shift-expense-receipts';
var KIND={advance:'سلفة موظف',incentive:'حافز / باقي نسبة',supplier:'فاتورة مورد'};
var ST={pending:['مستني الموافقة الأولى','wait'],first_ok:['مستني أ/محمود','wait'],approved:['اتوافق — اصرف','ok'],paid:['اتصرف','done'],rejected:['اترفض','bad'],cancelled:['اتلغى','done']};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return (+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function dt(v){if(!v)return '';var x=new Date(v);return isNaN(x)?'':x.toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_finance_drawer_request',{p_action:a,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
async function upload(file){var c=client();if(!c||!c.storage)throw new Error('تعذر رفع الفاتورة');if(!file||!file.size)throw new Error('صوّر فاتورة المورد الأول');if(file.size>8*1024*1024)throw new Error('الصورة أكبر من ٨ ميجا');
 var u=c.auth&&c.auth.getUser?await c.auth.getUser():null,uid=u&&u.data&&u.data.user&&u.data.user.id;if(!uid)throw new Error('سجل الدخول تاني');
 var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',path=uid+'/drw-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
 var r=await c.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||undefined});if(r&&r.error)throw r.error;return path;}
function who(x){return x.kind==='supplier'?(x.supplier||''):(x.subject_name||x.subject||'');}
function badge(s){var b=ST[s]||[s,'wait'];return '<em class="rdr-st '+b[1]+'">'+esc(b[0])+'</em>';}
/* ---------- reception card ---------- */
function cardHtml(s){var mine=s.mine||[],pend=mine.filter(function(x){return x.status==='pending'||x.status==='first_ok';}).length,appr=mine.filter(function(x){return x.status==='approved';}).length;
 return '<section class="rse-card rdr-card" data-rdr data-rht-pending="'+pend+'" data-rht-approved="'+appr+'" data-rht-total="'+mine.length+'" data-rht-can="'+(s.can_request?1:0)+'" aria-label="طلب صرف من الدرج"><div class="rse-head"><h4>طلب صرف من الدرج <small>— سلفة · حافز · فاتورة مورد</small></h4>'+
  '<button type="button" class="btn" data-rdr-new'+(s.can_request?'':' disabled')+'>+ طلب صرف من الدرج</button></div>'+
  '<p class="rse-note">الفلوس مابتطلعش من الدرج غير بعد الموافقة. بعد ما يتوافق، دوس «اتصرف» وسلّم الفلوس.</p>'+
  (mine.length?'<ul class="rse-list rdr-list">'+mine.map(function(x){var act='';
    if(x.status==='approved')act='<button type="button" class="btn btn-primary" data-rdr-pay="'+esc(x.id)+'">اتصرف</button>';
    else if(x.status==='pending'||x.status==='first_ok')act='<button type="button" class="btn ghost" data-rdr-cancel="'+esc(x.id)+'">الغي</button>';
    return '<li><span>'+esc(KIND[x.kind]||x.kind)+' — '+esc(who(x))+'</span><b dir="ltr">'+money(x.amount)+'</b>'+badge(x.status)+(x.status==='rejected'&&x.note?'<small>'+esc(x.note)+'</small>':'')+act+'</li>';}).join('')+'</ul>':'')+'</section>';}
function newModal(c,s,done){
 var emp=(s.employees||[]).map(function(e){return [e.subject,e.name];}),sup=(s.suppliers||[]).map(function(x){return [x.id,x.name];});
 var body='<fieldset class="rse-items" data-wide><legend>نوع الصرف</legend>'+['advance','incentive','supplier'].map(function(k,i){return '<label class="rse-chip"><input type="radio" name="kind" value="'+k+'"'+(i===0?' checked required':'')+'> '+esc(KIND[k])+'</label>';}).join('')+'</fieldset>'+
  '<div data-rdr-emp data-wide>'+c.select('subject','الموظف',emp)+'</div>'+
  '<div data-rdr-sup data-wide hidden>'+c.select('supplier_id','المورد / الصيدلية',sup)+'<label class="rse-up">📷 صورة فاتورة المورد (إجباري)<input type="file" name="invoice" accept="image/*,application/pdf" capture="environment" required></label>'+
  '<p class="rse-note">الحاجة بتدخل المخزن: المحاسب بيسجل الفاتورة بأصنافها الأول وبعدين يوافق.</p></div>'+
  c.field('amount','المبلغ (جنيه)','number','','required min="1" max="100000" step="0.01" inputmode="decimal"')+
  '<label data-wide>السبب<input name="reason" required minlength="3" maxlength="300" placeholder="مثلاً: سلفة شخصية — تتخصم من مرتب الشهر"></label>'+
  '<p class="rse-note" data-wide data-rdr-flow>السلفة والحافز: د. دينا أو محمد عبدالعال يوافق الأول، وبعدها أ/محمود. فاتورة المورد: المحاسب. كاش درجك دلوقتي <b dir="ltr">'+money(s.cash)+'</b> جنيه.</p>';
 var root=c.modal('طلب صرف من الدرج',body,async function(v,key){var amt=+v.amount;if(!(amt>0))throw new Error('اكتب المبلغ');
   var p={kind:v.kind,amount:amt,reason:v.reason,token:key};
   if(v.kind==='supplier'){p.supplier_id=v.supplier_id;p.evidence=await upload(root.querySelector('[name=invoice]').files[0]);}else p.subject=v.subject;
   return rpc('request',p);},function(){toast('الطلب اتبعت للموافقة');if(done)done();},{ok:'ابعت للموافقة'});
 if(!root)return null;
 var sync=function(){var k=(root.querySelector('[name=kind]:checked')||{}).value,isSup=k==='supplier';
  var e=root.querySelector('[data-rdr-emp]'),u=root.querySelector('[data-rdr-sup]');e.hidden=isSup;u.hidden=!isSup;
  e.querySelectorAll('select,input').forEach(function(x){x.disabled=isSup;});u.querySelectorAll('select,input').forEach(function(x){x.disabled=!isSup;});};
 root.querySelectorAll('[name=kind]').forEach(function(r){r.onchange=sync;});sync();return root;}
function wireCard(card,c,section){
 var redo=function(){card.remove();decorate(c,section);};
 var nb=card.querySelector('[data-rdr-new]');if(nb)nb.onclick=function(){rpc('status',{}).then(function(s){newModal(c,s,redo);},function(e){toast(e.message||'تعذر','error');});};
 card.querySelectorAll('[data-rdr-pay]').forEach(function(b){b.onclick=function(){var x=(card._s.mine||[]).find(function(y){return y.id===b.getAttribute('data-rdr-pay');})||{};
   if(!w.confirm('هتصرف '+money(x.amount)+' جنيه من درجك ('+(KIND[x.kind]||'')+' — '+who(x)+'). سلّم الفلوس بعد التأكيد.'))return;b.disabled=true;
   rpc('pay',{id:x.id}).then(function(){toast('اتصرف '+money(x.amount)+' جنيه واتخصم من ورديتك');redo();},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 card.querySelectorAll('[data-rdr-cancel]').forEach(function(b){b.onclick=function(){if(!w.confirm('تلغي الطلب؟'))return;b.disabled=true;
   rpc('cancel',{id:b.getAttribute('data-rdr-cancel')}).then(function(){toast('الطلب اتلغى');redo();},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 var host=c.host;if(host.querySelector('[data-rdr]'))return;
 rpc('status',{}).then(function(s){if(!s||!s.shift_id||!host.isConnected||host.querySelector('[data-rdr]'))return;
  var wrap=d.createElement('div');wrap.innerHTML=cardHtml(s);var card=wrap.firstElementChild;card._s=s;
  var after=host.querySelector('[data-rse]'),anchor=host.querySelector('.rx-actions')||host.firstElementChild;
  if(after&&after.parentNode)after.parentNode.insertBefore(card,after.nextSibling);else if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor);else host.prepend(card);
  wireCard(card,c,section);}).catch(function(){});}
/* hook into the reception decorate chain without touching reception-workspace.js */
var se=w.SSMPDShiftExpenses;if(se&&se.decorate&&!se._rdr){var orig=se.decorate;se.decorate=function(c,section){orig(c,section);decorate(c,section);};se._rdr=true;}
/* ---------- finance tab ---------- */
var state={from:'',to:''};
function inboxHtml(s){var inbox=s.inbox||[];
 var step={first:'الموافقة الأولى',final:'الموافقة التانية (أ/محمود)',supplier:'فاتورة مورد'};
 return '<h4 class="fc-st-h">مستني موافقتك ('+inbox.length+')</h4>'+(inbox.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>الوقت</th><th>النوع</th><th>لمين</th><th>المبلغ</th><th>السبب</th><th>الخطوة</th><th></th></tr></thead><tbody>'+
  inbox.map(function(x){var extra=x.kind==='supplier'?'<br><small>رصيد المورد <span dir="ltr">'+money(x.supplier_balance)+'</span></small>':x.kind==='advance'?'<br><small>سلف عليه <span dir="ltr">'+money(x.employee_advance)+'</span></small>':'';
   return '<tr><td dir="ltr">'+esc(dt(x.at))+'</td><td>'+esc(KIND[x.kind]||x.kind)+'<br><small>'+esc(x.by||'')+'</small></td><td>'+esc(who(x))+extra+'</td><td dir="ltr">'+money(x.amount)+'</td><td>'+esc(x.reason)+(x.first_by?'<br><small>وافق: '+esc(x.first_by)+'</small>':'')+'</td><td>'+esc(step[x.step]||'')+'</td>'+
    '<td><button type="button" class="btn btn-primary" data-rdr-ok="'+esc(x.id)+'">موافقة</button> <button type="button" class="btn" data-rdr-no="'+esc(x.id)+'">رفض</button>'+(x.evidence?' <button type="button" class="btn ghost" data-rdr-file="'+esc(x.evidence)+'">الفاتورة</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات مستنياك.</p>');}
function listHtml(items){return '<h4 class="fc-st-h">كل الطلبات في الفترة ('+items.length+')</h4>'+(items.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>الوقت</th><th>النوع</th><th>لمين</th><th>المبلغ</th><th>طلبه</th><th>الحالة</th></tr></thead><tbody>'+
  items.map(function(x){return '<tr><td dir="ltr">'+esc(dt(x.at))+'</td><td>'+esc(KIND[x.kind]||x.kind)+'</td><td>'+esc(who(x))+'</td><td dir="ltr">'+money(x.amount)+'</td><td>'+esc(x.by||'')+'</td><td>'+badge(x.status)+(x.note?'<br><small>'+esc(x.note)+'</small>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات في الفترة دي.</p>');}
function load(box){box.setAttribute('aria-busy','true');
 return rpc('status',{}).then(function(s){return rpc('list',{from:state.from||null,to:state.to||null}).then(function(l){return [s,l];},function(){return [s,null];});}).then(function(r){var s=r[0]||{},l=r[1];
   box.removeAttribute('aria-busy');box.innerHTML='<p class="fc-note">طلبات الاستقبال للصرف من الدرج: السلفة والحافز (موافقة أولى للمدير العام أو السوبر أدمن، وتانية للمدير المالي)، وفاتورة المورد (المحاسب أو المدير المالي — سجّل الفاتورة بأصنافها في المخزن قبل الموافقة). الفلوس بتطلع من درج الموظف اللي طلب بعد الموافقة بس.</p>'+inboxHtml(s)+(l?listHtml(l.items||[]):'');wire(box);},
  function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر التحميل')+'</p>';});}
function wire(box){
 box.querySelectorAll('[data-rdr-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('review',{id:b.getAttribute('data-rdr-ok'),ok:true}).then(function(){toast('اتوافق');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rdr-no]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;b.disabled=true;rpc('review',{id:b.getAttribute('data-rdr-no'),ok:false,note:n.trim()}).then(function(){toast('اترفض');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-rdr-file]').forEach(function(b){b.onclick=function(){var c=client();if(!c||!c.storage)return;Promise.resolve(c.storage.from(BUCKET).createSignedUrl(b.getAttribute('data-rdr-file'),300)).then(function(r){if(r&&r.data&&r.data.signedUrl)w.open(r.data.signedUrl,'_blank','noopener');else toast('تعذر فتح الفاتورة','error');});};});}
function fill(){var box=d.querySelector('[data-drawer-requests]');if(box)load(box);}
var prior=w.SSMPDFinanceControls;
if(prior&&prior.panel){w.SSMPDFinanceControls=Object.assign({},prior,{panel:function(tab,dd,h){if(tab!=='drawer-requests')return prior.panel(tab,dd,h);setTimeout(fill,0);return '<div class="rse rdr" data-drawer-requests><p class="rse-note">جاري التحميل…</p></div>';}});}
w.SSMPDDrawerRequests={decorate:decorate,load:load,state:state,_t:{cardHtml:cardHtml,inboxHtml:inboxHtml,listHtml:listHtml}};
/* one-tap opener for the reception «درجي» strip (UX #881 feature-detects this name): clicks the card's «+ طلب صرف من الدرج» */
w.SSMPDDrawerPayout={open:function(){var b=d.querySelector('[data-rdr-new]');if(b&&!b.disabled){b.click();return true;}return false;}};
})(window,document);
