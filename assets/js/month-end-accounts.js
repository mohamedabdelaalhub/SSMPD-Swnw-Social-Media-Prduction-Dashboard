/* «حسابات آخر الشهر» (owner 2026-11-26 «كمل باقي المراحل كلها» — daily-movements map phase 3).
   Accounting tab 'month-end' (SSMPDFinanceControls layer): per month what we owe the booking platforms (فيزيتا / كلينيدو / اكشف —
   % of the executed كشف), the external lab (price-list cost) and the dental lab (per case), and what مركز الطاهرة owes us (30% of
   the referrals). Rates (FM / super admin), details, «طلب سداد» (accountant / FM) and «اعتماد» by another person (FM / GM / SA).
   Reception card (live workspace): «تحويل لمركز الطاهرة» and «فاتورة معمل أسنان». Server: public.clinic_finance_month_end (20261126110000).
   Booking platforms (20261126180000, help 306): «مراجعة الفترة» (ours / theirs / agreed + reason, deduction destination), the audits
   list with approve / reject by another person, and the platforms rows in «مستحقات الموردين» (suppliers tab). */
(function(w,d){'use strict';
var MET={cash:'كاش من الخزينة الرئيسية',bank:'تحويل بنكي',wallet:'فودافون كاش (المحافظ)'};
var SST={pending:['مستني الاعتماد','wait'],approved:['اتعمل','ok'],rejected:['اترفض','bad']};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return (+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function day(v){return v?String(v).slice(0,10).split('-').reverse().join('-'):'';}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(a,p){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_finance_month_end',{p_action:a,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'success');}
function uuid(){return (w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function badge(s){var b=SST[s]||[s,'wait'];return '<em class="rdr-st '+b[1]+'">'+esc(b[0])+'</em>';}
/* tiny modal (works in both the accounting tab and reception) */
function modal(title,body,save,ok){if(d.querySelector('.mea-modal'))return null;var root=d.createElement('div');root.className='modal-backdrop mea-modal';
 root.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><header class="modal-head"><h3>'+esc(title)+'</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></header><form class="rx-form mea-form">'+body+'<p role="status" data-mea-status></p><footer><button class="btn btn-primary" type="submit">'+esc(ok||'حفظ')+'</button><button class="btn" type="button" data-mea-cancel>إلغاء</button></footer></form></section>';
 d.body.appendChild(root);var form=root.querySelector('form'),key=uuid(),busy=false,close=function(){root.remove();};
 root.querySelector('.modal-close').onclick=close;root.querySelector('[data-mea-cancel]').onclick=close;
 form.onsubmit=async function(e){if(e&&e.preventDefault)e.preventDefault();if(busy||(form.reportValidity&&!form.reportValidity()))return;var v={};Array.prototype.forEach.call(form.elements,function(x){if(x.name&&!x.disabled)v[x.name]=x.value;});
  busy=true;try{await save(v,key);close();}catch(err){root.querySelector('[data-mea-status]').textContent=(err&&err.message)||'تعذر الحفظ';}finally{busy=false;}};
 return root;}
function fld(n,t,type,val,extra){return '<label>'+esc(t)+'<input name="'+n+'" type="'+(type||'text')+'" value="'+esc(val==null?'':val)+'" '+(extra||'required')+'></label>';}
/* ---------- accounting tab ---------- */
var state={month:''};
function thisMonth(){var t=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});return t.slice(0,7);}
function panelHtml(s){var ps=s.parties||[],ss=s.settlements||[];
 var out='<form class="fc-filters" data-mea-month><label>شهر الحسابات<input type="month" name="month" value="'+esc((s.month||'').slice(0,7))+'" required></label><button class="btn" type="submit">عرض</button></form>'+
  '<p class="fc-note">المستحق بيتجمع لوحده مع كل كشف أو تحليل أو حالة، والسداد أو التحصيل مرة واحدة آخر الشهر بموافقة شخص تاني. المنصات: نسبة من سعر الكشف المتنفذ. المعمل: بسعر قايمة المعمل المتعاقد بيها. الطاهرة: نسبتنا من التحويلات.</p>'+
  '<div class="table-wrap"><table class="data-table"><thead><tr><th>الجهة</th><th>النسبة</th><th>الحالات</th><th>المستحق</th><th>اتسدد</th><th>مستني اعتماد</th><th>المتبقي</th><th></th></tr></thead><tbody>'+
  ps.map(function(p){var rate=(p.key==='lab'||p.key==='dental_lab')?'—':(p.percent==null?'<em class="rdr-st bad">مش متحددة</em>':esc(p.percent)+'%');
   return '<tr><td>'+esc(p.name)+'<br><small>'+(p.direction==='receivable'?'لينا':'علينا')+(p.platform?' — منصة حجز · المتبقي بعد المراجعة'+(p.audited_through?' (آخر مراجعة '+esc(String(p.audited_through).slice(0,7))+')':''):'')+'</small></td><td>'+rate+(s.can_rate&&p.key!=='lab'&&p.key!=='dental_lab'?' <button type="button" class="btn ghost" data-mea-rate="'+esc(p.key)+'">تعديل</button>':'')+'</td><td dir="ltr">'+esc(p.count)+'</td><td dir="ltr">'+money(p.accrued)+'</td><td dir="ltr">'+money(p.settled)+'</td><td dir="ltr">'+money(p.pending)+'</td><td dir="ltr"><b>'+money(p.remaining)+'</b></td>'+
    '<td><button type="button" class="btn ghost" data-mea-lines="'+esc(p.key)+'">التفاصيل</button>'+(p.platform&&s.can_audit?' <button type="button" class="btn" data-mea-audit="'+esc(p.key)+'">مراجعة الفترة</button>':'')+(s.can_request&&+p.remaining>0?' <button type="button" class="btn btn-primary" data-mea-settle="'+esc(p.key)+'">'+(p.direction==='receivable'?'طلب تحصيل':'طلب سداد')+'</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>'+
  '<h4 class="fc-st-h">طلبات السداد والتحصيل في الشهر ('+ss.length+')</h4>'+(ss.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>الجهة</th><th>المبلغ</th><th>الطريقة</th><th>المرجع</th><th>طلبه</th><th>الحالة</th><th></th></tr></thead><tbody>'+
  ss.map(function(z){var p=ps.find(function(x){return x.key===z.party;})||{};return '<tr><td>'+esc(p.name||z.party)+'</td><td dir="ltr">'+money(z.amount)+'</td><td>'+esc(MET[z.method]||z.method)+'</td><td>'+esc(z.reference)+(z.note?'<br><small>'+esc(z.note)+'</small>':'')+'</td><td>'+esc(z.by||'')+'</td><td>'+badge(z.status)+(z.review_note?'<br><small>'+esc(z.review_note)+'</small>':'')+'</td>'+
   '<td>'+(z.status==='pending'&&s.can_review&&!z.mine?'<button type="button" class="btn btn-primary" data-mea-ok="'+esc(z.id)+'">اعتماد</button> <button type="button" class="btn" data-mea-no="'+esc(z.id)+'">رفض</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':'<p class="fc-note">مفيش طلبات في الشهر ده.</p>')+'<h4 class="fc-st-h">مراجعات منصات الحجز</h4><div data-mea-audits><p class="fc-note">جاري التحميل…</p></div>';
 return out;}
function linesModal(box,s,key){var p=(s.parties||[]).find(function(x){return x.key===key;})||{};
 rpc('lines',{party:key,month:s.month}).then(function(r){var ls=r.lines||[],items=r.items;
  var body='<div data-wide class="table-wrap"><table class="data-table"><thead><tr><th>اليوم</th><th>المرجع</th><th>البيان</th><th>'+(key==='lab'?'العدد':'القاعدة')+'</th><th>المستحق</th></tr></thead><tbody>'+
   (ls.length?ls.map(function(l){return '<tr><td dir="ltr">'+esc(day(l.day))+'</td><td>'+esc(l.ref)+'</td><td>'+esc(l.description)+'</td><td dir="ltr">'+(key==='lab'?esc(+l.base):money(l.base))+'</td><td dir="ltr">'+money(l.amount)+'</td></tr>';}).join(''):'<tr><td colspan="5">مفيش حاجة في الشهر ده'+(p.percent==null&&key!=='lab'&&key!=='dental_lab'?' — النسبة لسه مش متحددة':'')+'</td></tr>')+'</tbody></table></div>'+
   (items&&items.length?'<h4 data-wide>السطور المتسجلة</h4><ul data-wide class="rse-list">'+items.map(function(i){return '<li><span>'+esc(day(i.day))+' — '+esc(i.ref)+' — '+esc(i.description)+(i.by?' <small>('+esc(i.by)+')</small>':'')+'</span><b dir="ltr">'+money(i.amount)+'</b>'+(i.voided?'<em class="rdr-st done">اتلغى</em>':'<button type="button" class="btn ghost" data-mea-void="'+esc(i.id)+'">إلغاء</button>')+'</li>';}).join('')+'</ul>':'');
  var root=modal('التفاصيل — '+(p.name||key),body,async function(){},'تمام');if(!root)return;
  root.querySelectorAll('[data-mea-void]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الإلغاء؟');if(!n||n.trim().length<3)return;b.disabled=true;
    rpc('void_item',{id:b.getAttribute('data-mea-void'),reason:n.trim()}).then(function(){toast('اتلغى');root.remove();load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 },function(e){toast(e.message||'تعذر','error');});}
function settleModal(box,s,key){var p=(s.parties||[]).find(function(x){return x.key===key;})||{},recv=p.direction==='receivable';
 var opts=recv?['wallet','bank','cash']:['cash','bank','wallet'];
 var body='<p class="rse-intro" data-wide>'+esc(p.name)+' — المتبقي للشهر ده <b dir="ltr">'+money(p.remaining)+'</b> جنيه'+(s.main_shift||!recv?'':'')+'</p>'+
  fld('amount','المبلغ (جنيه)','number',p.remaining,'required min="0.01" max="'+esc(p.remaining)+'" step="0.01" inputmode="decimal"')+
  '<label>'+(recv?'هيتحصل إزاي؟':'هيتسدد إزاي؟')+'<select name="method" required>'+opts.map(function(m){return '<option value="'+m+'"'+(m==='cash'&&!s.main_shift?' disabled':'')+'>'+esc(MET[m])+(m==='cash'&&!s.main_shift?' — مفيش وردية رئيسية مفتوحة':'')+'</option>';}).join('')+'</select></label>'+
  fld('reference','المرجع (رقم التحويل / الإيصال / الكشف)','text','','required minlength="2" maxlength="120"')+fld('note','ملاحظة','text','','maxlength="300"')+
  '<p class="rse-note" data-wide>الطلب بيتسجل لما شخص تاني (المدير المالي أو المدير العام أو السوبر أدمن) يعتمده.</p>';
 modal(recv?'طلب تحصيل — '+p.name:'طلب سداد — '+p.name,body,async function(v,k){var amt=+v.amount;if(!(amt>0))throw new Error('اكتب المبلغ');if(amt>+p.remaining)throw new Error('المبلغ أكبر من المتبقي');
   await rpc('settle_request',{party:key,month:s.month,amount:amt,method:v.method,reference:v.reference,note:v.note||'',token:k});toast('الطلب اتبعت للاعتماد');load(box);},'ابعت للاعتماد');}
/* ---------- booking platforms: period audit (help 306) ---------- */
var DK={income:'إيراد للشركة',payable:'جهة دائنة تانية',account:'حساب تاني من الشجرة'};
function ym(v){return v?String(v).slice(0,7):'';}
function addMonth(m,n){var p=m.split('-'),y=+p[0],mo=+p[1]-1+n;y+=Math.floor(mo/12);mo=((mo%12)+12)%12;return y+'-'+String(mo+1).padStart(2,'0');}
function auditsHtml(a){var xs=a.audits||[];if(!xs.length)return '<p class="fc-note">مفيش مراجعات لسه. «مراجعة الفترة» قصاد كل منصة.</p>';
 return '<div class="table-wrap"><table class="data-table"><thead><tr><th>الفترة</th><th>المنصة</th><th>رقمنا</th><th>رقمهم</th><th>المتفق</th><th>خصم / زيادة</th><th>راح فين</th><th>طلبه</th><th>الحالة</th><th></th></tr></thead><tbody>'+
  xs.map(function(x){var per=ym(x.from)+(ym(x.to)!==ym(x.from)?' ← '+ym(x.to):'');
   var diff=+x.deduction>0?'<span class="mea-pos">خصم '+money(x.deduction)+'</span>':(+x.extra>0?'<span class="mea-neg">زيادة '+money(x.extra)+'</span>':'—');
   return '<tr><td dir="ltr">'+esc(per)+'</td><td>'+esc(x.party_name)+'</td><td dir="ltr">'+money(x.ours)+'</td><td dir="ltr">'+money(x.theirs)+'<br><small>'+esc(x.theirs_ref)+'</small></td><td dir="ltr">'+money(x.agreed)+(x.agreed_mode==='percent'?'<br><small>'+esc(+x.agreed_value)+'% من رقمنا</small>':'')+'</td><td>'+diff+'</td>'+
    '<td>'+(x.dest_kind?esc(DK[x.dest_kind]||x.dest_kind)+'<br><small>'+esc(x.dest_name||'')+' ('+esc(x.dest_account)+')</small>':'—')+'</td><td>'+esc(x.by||'')+'<br><small>'+esc(x.reason)+'</small></td><td>'+badge(x.status)+(x.review_note?'<br><small>'+esc(x.review_note)+'</small>':'')+'</td>'+
    '<td>'+(x.status==='pending'&&a.can_review&&!x.mine?'<button type="button" class="btn btn-primary" data-mea-aok="'+esc(x.id)+'">اعتماد</button> <button type="button" class="btn" data-mea-ano="'+esc(x.id)+'">رفض</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>';}
function auditModal(key,name,month,a,done){
 var dest=[['income:4122',DK.income+' — '+((a.income_account||{}).name||'إيراد تسويات منصات الحجز')+' (4122)']].concat((a.payable_accounts||[]).map(function(x){return ['payable:'+x.code,DK.payable+' — '+x.name+' ('+x.code+')'];}),(a.other_accounts||[]).map(function(x){return ['account:'+x.code,DK.account+' — '+x.name+' ('+x.code+')'];}));
 var body='<p class="rse-intro" data-wide>رقمنا من السجلات: <b dir="ltr" data-mea-ours>…</b> جنيه <small data-mea-cases></small></p>'+
  '<label>الفترة<select name="span" required><option value="1">شهر</option><option value="2">شهرين (الشهر ده واللي قبله)</option></select></label>'+
  fld('month','آخر شهر في الفترة','month',ym(month),'required')+
  fld('theirs','رقمهم (مطالبة المنصة) جنيه','number','','required min="0" step="0.01" inputmode="decimal"')+fld('theirs_ref','رقم فاتورتهم أو مرجع المطالبة','text','','required minlength="2" maxlength="120"')+
  '<label>المتفق عليه<select name="agreed_mode" required><option value="amount">مبلغ</option><option value="percent">نسبة من رقمنا</option></select></label>'+
  fld('agreed_value','قيمة المتفق عليه','number','','required min="0" step="0.01" inputmode="decimal"')+
  '<label data-wide>سبب الاتفاق<input name="reason" required minlength="3" maxlength="400" placeholder="مثلاً: حجزين اتلغوا ومتحسبين عندهم"></label>'+
  '<label data-wide data-mea-destwrap hidden>خصم المراجعة يروح فين؟<select name="dest">'+dest.map(function(o){return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>';}).join('')+'</select></label>'+
  '<p class="rse-note" data-wide data-mea-sum></p>'+
  '<p class="rse-note" data-wide>الأرقام التلاتة بتتحفظ مع السبب. القيد بيتسجل لما شخص تاني (المدير المالي أو المدير العام أو السوبر أدمن) يعتمد: الاستحقاق على «مستحقات منصات الحجز»، والخصم على المكان اللي اخترته.</p>';
 var ours=null,root=modal('مراجعة الفترة — '+name,body,async function(v,k){if(ours==null)throw new Error('استنى رقمنا يتحسب');var range=per(v),ag=agreed(v),d0=ag<ours?String(v.dest||'').split(':'):[null,null];
   await rpc('audit_request',{party:key,from:range[0]+'-01',to:range[1]+'-01',theirs:v.theirs,theirs_ref:v.theirs_ref,agreed_mode:v.agreed_mode,agreed_value:v.agreed_value,reason:v.reason,dest_kind:d0[0],dest_account:d0[1],token:k});
   toast('المراجعة اتبعتت للاعتماد');if(done)done();},'ابعت للاعتماد');if(!root)return null;
 var form=root.querySelector('form');
 function per(v){var end=v.month||ym(month);return [+v.span===2?addMonth(end,-1):end,end];}
 function agreed(v){var x=+v.agreed_value||0;return v.agreed_mode==='percent'?Math.round((ours||0)*x)/100:x;}
 function vals(){var v={};Array.prototype.forEach.call(form.elements,function(x){if(x.name)v[x.name]=x.value;});return v;}
 function sum(){var v=vals(),ag=agreed(v),wrap=form.querySelector('[data-mea-destwrap]'),need=ours!=null&&v.agreed_value!==''&&ag<ours;wrap.hidden=!need;form.elements.dest.required=need;form.elements.dest.disabled=!need;
  form.querySelector('[data-mea-sum]').textContent=ours==null||v.agreed_value===''?'':'المتفق عليه '+money(ag)+' — '+(ag<ours?'خصم المراجعة '+money(ours-ag):ag>ours?'زيادة على رقمنا '+money(ag-ours)+' (بتتسجل مصروف)':'زي رقمنا بالظبط')+(v.theirs!==''?' · الفرق مع رقمهم '+money((+v.theirs||0)-ag):'');}
 function preview(){var r=per(vals());ours=null;root.querySelector('[data-mea-ours]').textContent='…';
  return rpc('audit_preview',{party:key,from:r[0]+'-01',to:r[1]+'-01'}).then(function(x){ours=+x.ours||0;root.querySelector('[data-mea-ours]').textContent=money(ours);
   root.querySelector('[data-mea-cases]').textContent='('+(x.cases||0)+' كشف × '+esc(x.percent==null?'—':+x.percent)+'%)'+(x.overlap?' — الفترة دي اتراجعت قبل كده':'');sum();},function(e){root.querySelector('[data-mea-status]').textContent=e.message||'تعذر الحساب';});}
 form.elements.span.onchange=preview;form.elements.month.onchange=preview;['agreed_mode','agreed_value','theirs'].forEach(function(n){form.elements[n].oninput=sum;form.elements[n].onchange=sum;});
 form.elements.dest.disabled=true;root._preview=preview();return root;}
function reviewAudit(id,ok,done){if(ok)return rpc('audit_review',{id:id,ok:true}).then(function(){toast('اتعتمدت واتسجل القيد');done();});
 modal('رفض المراجعة','<label data-wide>سبب الرفض<input name="note" required minlength="3" maxlength="300"></label>',async function(v){await rpc('audit_review',{id:id,ok:false,note:v.note});toast('اترفضت');done();},'رفض');return Promise.resolve();}
function wireAudits(host,a,again){host.querySelectorAll('[data-mea-aok]').forEach(function(b){b.onclick=function(){b.disabled=true;reviewAudit(b.getAttribute('data-mea-aok'),true,again).catch(function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 host.querySelectorAll('[data-mea-ano]').forEach(function(b){b.onclick=function(){reviewAudit(b.getAttribute('data-mea-ano'),false,again);};});}
function loadAudits(box,s){var host=box.querySelector('[data-mea-audits]');if(!host)return Promise.resolve();
 return rpc('audits',{}).then(function(a){a=a||{};box._a=a;host.innerHTML=auditsHtml(a);wireAudits(host,a,function(){load(box);});},function(e){host.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر التحميل')+'</p>';});}
/* «مستحقات الموردين»: the platforms next to the suppliers */
function platformsHtml(r){var ps=r.platforms||[];
 return '<h4>منصات الحجز</h4><div class="table-wrap"><table class="data-table"><thead><tr><th>الجهة</th><th>النوع</th><th>المستحق المعتمد</th><th>خصومات المراجعة</th><th>اتسدد</th><th>الباقي علينا</th><th></th></tr></thead><tbody>'+
  ps.map(function(p){return '<tr><td>'+esc(p.name)+'</td><td><em class="rdr-st mea-plat">منصة حجز</em></td><td dir="ltr">'+money(+p.audited+ +p.extra)+'</td><td dir="ltr">'+(+p.deducted?'−'+money(p.deducted):'—')+'</td><td dir="ltr">'+money(p.settled)+'</td><td dir="ltr"><b>'+money(p.balance)+'</b>'+(+p.pending?'<br><small>مستني اعتماد سداد '+money(p.pending)+'</small>':'')+'</td>'+
   '<td>'+(r.can_audit?'<button type="button" class="btn" data-mea-paudit="'+esc(p.party)+'">مراجعة الفترة</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>'+
  '<p class="fc-note">المستحق بيتسجل على «مستحقات منصات الحجز» لما مراجعة الفترة تتعتمد، والسداد من «حسابات آخر الشهر».</p>';}
function fillPlatforms(){var host=d.querySelector('[data-platform-payables]');if(!host||host._busy)return;host._busy=true;
 rpc('platforms',{}).then(function(r){host._busy=false;if(!host.isConnected)return;host.innerHTML=platformsHtml(r);
  host.querySelectorAll('[data-mea-paudit]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-mea-paudit'),p=(r.platforms||[]).find(function(x){return x.party===k;})||{};
   rpc('audits',{}).then(function(a){auditModal(k,p.name||k,thisMonth()+'-01',a,fillPlatforms);},function(e){toast(e.message||'تعذر','error');});};});},
  function(e){host._busy=false;host.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر تحميل المنصات')+'</p>';});}
function load(box){box.setAttribute('aria-busy','true');var m=state.month||thisMonth();
 return rpc('statement',{month:m+'-01'}).then(function(s){box.removeAttribute('aria-busy');box.innerHTML=panelHtml(s||{});box._s=s;wire(box,s||{});loadAudits(box,s||{});},
  function(e){box.removeAttribute('aria-busy');box.innerHTML='<p class="fc-note">'+esc(e.message||'تعذر التحميل')+'</p>';});}
function wire(box,s){
 var f=box.querySelector('[data-mea-month]');if(f)f.onsubmit=function(e){if(e&&e.preventDefault)e.preventDefault();state.month=f.elements.month.value;load(box);};
 box.querySelectorAll('[data-mea-rate]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-mea-rate'),p=(s.parties||[]).find(function(x){return x.key===k;})||{};
   modal('نسبة '+p.name,fld('percent','النسبة %','number',p.percent==null?'':p.percent,'required min="0" max="100" step="0.001" inputmode="decimal"')+'<p class="rse-note" data-wide>'+(k==='tahera'?'نسبتنا من اللي المريض بيدفعه في مركز الطاهرة.':'نسبة المنصة من سعر الكشف المتنفذ (بعد الخصم). بتتطبق على الشهر كله.')+'</p>',
    async function(v){await rpc('set_rate',{party:k,percent:v.percent});toast('النسبة اتحفظت');load(box);});};});
 box.querySelectorAll('[data-mea-audit]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-mea-audit'),p=(s.parties||[]).find(function(x){return x.key===k;})||{},go=function(a){auditModal(k,p.name||k,s.month,a,function(){load(box);});};
   if(box._a)go(box._a);else rpc('audits',{}).then(go,function(e){toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-mea-lines]').forEach(function(b){b.onclick=function(){linesModal(box,s,b.getAttribute('data-mea-lines'));};});
 box.querySelectorAll('[data-mea-settle]').forEach(function(b){b.onclick=function(){settleModal(box,s,b.getAttribute('data-mea-settle'));};});
 box.querySelectorAll('[data-mea-ok]').forEach(function(b){b.onclick=function(){b.disabled=true;rpc('settle_review',{id:b.getAttribute('data-mea-ok'),ok:true}).then(function(){toast('اتعمل واتسجل في الحسابات');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});
 box.querySelectorAll('[data-mea-no]').forEach(function(b){b.onclick=function(){var n=w.prompt('سبب الرفض؟');if(!n||n.trim().length<3)return;b.disabled=true;rpc('settle_review',{id:b.getAttribute('data-mea-no'),ok:false,note:n.trim()}).then(function(){toast('اترفض');load(box);},function(e){b.disabled=false;toast(e.message||'تعذر','error');});};});}
function fill(){var box=d.querySelector('[data-month-end]');if(box)load(box);}
var prior=w.SSMPDFinanceControls;
if(prior&&prior.panel){w.SSMPDFinanceControls=Object.assign({},prior,{panel:function(tab,dd,h){if(tab==='suppliers'){setTimeout(fillPlatforms,0);return prior.panel(tab,dd,h)+'<div class="mea" data-platform-payables><p class="fc-note">جاري تحميل منصات الحجز…</p></div>';}if(tab!=='month-end')return prior.panel(tab,dd,h);setTimeout(fill,0);return '<div class="rse mea" data-month-end><p class="rse-note">جاري التحميل…</p></div>';}});}
/* ---------- reception card ---------- */
function cardHtml(r){var items=r.items||[];
 return '<section class="rse-card mea-card" data-mea-card aria-label="تحويلات ومعمل الأسنان"><div class="rse-head"><h4>تحويلات ومعمل الأسنان <small>— بتتحسب آخر الشهر</small></h4>'+
  '<span><button type="button" class="btn" data-mea-tahera>+ تحويل لمركز الطاهرة</button> <button type="button" class="btn" data-mea-dental>+ فاتورة معمل أسنان</button></span></div>'+
  '<p class="rse-note">مفيش فلوس بتطلع أو تدخل الدرج هنا — بيتسجل بس، والحسابات بتسدد أو تحصّل آخر الشهر.</p>'+
  (items.length?'<ul class="rse-list">'+items.map(function(i){return '<li><span>'+(i.party==='tahera'?'الطاهرة':'معمل أسنان')+' — '+esc(i.ref)+' — '+esc(i.description)+'</span><b dir="ltr">'+money(i.amount)+'</b>'+(i.voided?'<em class="rdr-st done">اتلغى</em>':'')+'</li>';}).join('')+'</ul>':'')+'</section>';}
function itemModal(party,pct,done){var t=party==='tahera';
 var body=fld('ref','رقم الزيارة أو الحالة','text','','required minlength="1" maxlength="60"')+fld('description',t?'الأشعة اللي اتحوّلت':'الشغل (مثلاً: زيركون — اسم الدكتور)','text','','required minlength="2" maxlength="200"')+
  fld('amount',t?'المريض بيدفع هناك كام (جنيه)':'فاتورة المعمل (جنيه)','number','','required min="1" step="0.01" inputmode="decimal"')+
  '<p class="rse-note" data-wide>'+(t?'نسبتنا '+esc(pct==null?30:pct)+'% بتتحسب لوحدها وبتتحصل آخر الشهر.':'المبلغ بيتسدد للمعمل آخر الشهر من الخزينة الرئيسية.')+'</p>';
 modal(t?'تحويل أشعة لمركز الطاهرة':'فاتورة معمل أسنان',body,async function(v,k){var amt=+v.amount;if(!(amt>0))throw new Error('اكتب المبلغ');await rpc('add_item',{party:party,ref:v.ref,description:v.description,amount:amt,token:k});toast('اتسجل');if(done)done();},'سجّل');}
function decorate(c,section){if(!c||!c.host||!c.data||!c.data.workspace||c.data.workspace.mode!=='live')return;if(section&&section!=='operations'&&section!=='appointments')return;
 var host=c.host;if(host.querySelector('[data-mea-card]'))return;
 rpc('my_items',{}).then(function(r){if(!r||!host.isConnected||host.querySelector('[data-mea-card]'))return;var wrap=d.createElement('div');wrap.innerHTML=cardHtml(r);var card=wrap.firstElementChild;
  var after=host.querySelector('[data-rdr]')||host.querySelector('[data-rse]'),anchor=host.querySelector('.rx-actions')||host.firstElementChild;
  if(after&&after.parentNode)after.parentNode.insertBefore(card,after.nextSibling);else if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor);else host.prepend(card);
  var redo=function(){card.remove();decorate(c,section);};
  card.querySelector('[data-mea-tahera]').onclick=function(){itemModal('tahera',r.tahera_percent,redo);};
  card.querySelector('[data-mea-dental]').onclick=function(){itemModal('dental_lab',null,redo);};}).catch(function(){});}
var se=w.SSMPDShiftExpenses;if(se&&se.decorate&&!se._mea){var orig=se.decorate;se.decorate=function(c,section){orig(c,section);decorate(c,section);};se._mea=true;}
w.SSMPDMonthEnd={load:load,decorate:decorate,state:state,fillPlatforms:fillPlatforms,auditModal:auditModal,_t:{panelHtml:panelHtml,cardHtml:cardHtml,auditsHtml:auditsHtml,platformsHtml:platformsHtml}};
})(window,document);
