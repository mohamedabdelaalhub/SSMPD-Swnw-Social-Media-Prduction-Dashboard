/* «الفواتير الضريبية والإلكترونية + اترفعت على بوابة الضرائب؟» (owner 2026-11-22 «طبق الفواتير الضريبية»; server 20261122280000;
   mockup docs/ui-references/mockups/tax-invoice-portal.html).
     SSMPDTaxStatus.box(el, kind, id, {onSaved})  «الضرائب» box inside an invoice (visit_invoice | finance_invoice | purchase_invoice)
     SSMPDTaxStatus.open(kind, id)                the same box in a small window (finance invoices list, purchase screens)
     SSMPDTaxStatus.report(body)                  tax report on top of «الضرائب» (+ start dates and doctor rate for the financial manager)
     SSMPDTaxStatus.bindPayout(form)              doctor payout form: suggests the withholding from uploaded e-invoices
   Metadata only: no amount or entry changes here. The accountant records the upload, the financial manager (another person) confirms. */
(function(w,d){
'use strict';
var KIND={visit_invoice:'فاتورة زيارة',finance_invoice:'فاتورة خدمة',purchase_invoice:'فاتورة مشتريات'};
var ST={not_uploaded:'لسه ما اترفعتش',pending:'مستنية تأكيد المدير المالي',uploaded:'اترفعت على البوابة'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return Number(v||0).toLocaleString('ar-EG-u-nu-latn',{minimumFractionDigits:2,maximumFractionDigits:2});}
function day(v){if(!v)return '—';var t=new Date(v);return isNaN(t)?'—':t.toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'2-digit',month:'2-digit',year:'numeric'});}
function stamp(v){if(!v)return '—';var t=new Date(v);return isNaN(t)?'—':day(v)+' '+t.toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'});}
function iso(dt){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(dt);}
function uuid(){if(w.crypto&&w.crypto.randomUUID)return w.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16);});}
function rpc(n,a){var db=w.SSMPDDb;if(!db||!db.client)return Promise.reject(Error('تعذر الاتصال'));return Promise.resolve(db.client.rpc(n,a||{})).then(function(r){if(!r||r.error)throw (r&&r.error)||Error('تعذر التحميل');return r.data;});}
function errText(e){var m=e&&(e.message||e.details)||'';return /[؀-ۿ]/.test(m)?m:'حصلت مشكلة ومقدرناش نكمل — جرّب تاني';}
function act(kind,id,action,payload){return rpc('clinic_finance_invoice_tax',{p_kind:kind,p_id:id,p_action:action,p_payload:payload||{},p_token:uuid()});}

/* ---------- the «الضرائب» box ---------- */
function boxHtml(x,g){
 var edit=g.can_edit,rev=g.can_review,st=x.portal_status||'not_uploaded',mine=x.recorded_by_id&&x.recorded_by_id===g.me,h='';
 h+='<div class="tx-head"><b>الضرائب</b><small>'+esc(KIND[x.kind]||'فاتورة')+(x.no?' — '+esc(x.no):'')+(x.amount!=null?' — '+money(x.amount)+' ج.م':'')+'</small></div>';
 h+='<div class="tx-types">'+['is_tax_invoice','is_e_invoice'].map(function(k){var auto=k==='is_tax_invoice'?x.tax_auto:x.e_auto;
  return '<label class="tx-chk"><input type="checkbox" data-tx-type="'+k+'"'+(x[k]?' checked':'')+(edit&&st==='not_uploaded'?'':' disabled')+'> '+(k==='is_tax_invoice'?'فاتورة ضريبية':'فاتورة إلكترونية')+(auto?' <small>(تلقائي)</small>':'')+'</label>';}).join('')+'</div>';
 h+='<div class="tx-portal is-'+esc(st)+'"><div class="tx-row"><b>اترفعت على بوابة الضرائب؟</b><span class="tx-seg"><b class="'+(st==='uploaded'?'on':st==='pending'?'wait':'')+'">أيوه</b><b class="'+(st==='not_uploaded'?'on no':'')+'">لأ</b></span></div>';
 if(st!=='not_uploaded')h+='<div class="tx-kv"><span>الحالة</span><span>'+esc(ST[st])+'</span><span>تاريخ الرفع</span><span>'+esc(stamp(x.uploaded_at))+'</span><span>رقم البوابة (UUID)</span><span class="tx-ltr">'+esc(x.portal_uuid)+'</span>'+(x.portal_ref?'<span>رقم الفاتورة على البوابة</span><span class="tx-ltr">'+esc(x.portal_ref)+'</span>':'')+
  '<span>سجّلها</span><span>'+esc(x.recorded_by||'—')+' — '+esc(stamp(x.recorded_at))+'</span>'+(st==='uploaded'?'<span>أكّدها</span><span>'+esc(x.confirmed_by||'—')+' — '+esc(stamp(x.confirmed_at))+'</span>':'')+'</div>';
 if(x.note)h+='<p class="tx-note">'+esc(x.note)+'</p>';
 h+='<div class="tx-actions">';
 if(st==='not_uploaded'&&edit&&x.is_tax_invoice)h+='<button type="button" class="btn btn-primary" data-tx-do="record">سجّل إنها اترفعت</button>';
 if(st==='pending'&&rev&&!mine)h+='<button type="button" class="btn btn-primary" data-tx-do="confirm">تأكيد الرفع</button><button type="button" class="btn" data-tx-do="refuse">رفض</button>';
 if(st==='pending'&&mine)h+='<span class="tx-note">مستنية تأكيد المدير المالي (شخص غير اللي سجّل).</span>';
 if(st==='uploaded'&&rev)h+='<button type="button" class="btn" data-tx-do="unmark">رجوع (الفاتورة اتلغت على البوابة)</button>';
 if(st==='not_uploaded'&&!x.is_tax_invoice)h+='<span class="tx-note">الفاتورة مش ضريبية — علّم «فاتورة ضريبية» الأول لو لازم تترفع.</span>';
 h+='</div></div><div data-tx-form></div><p class="tx-status" data-tx-status role="status"></p><p class="tx-note">الخانة دي بيانات بس — مبتغيّرش مبلغ الفاتورة ولا القيود.</p>';
 return h;
}
function box(el,kind,id,o){
 o=o||{};if(!el||!id)return Promise.resolve(null);el.classList.add('tx-box');
 return rpc('clinic_finance_invoice_tax_get',{p_kind:kind,p_ids:[id]}).then(function(g){
  var x=g&&g.docs&&g.docs[0];if(!x||!el.isConnected){el.hidden=true;el.innerHTML='';return null;}x.kind=kind;el.hidden=false;el.innerHTML=boxHtml(x,g);wireBox(el,kind,id,x,o);return x;
 }).catch(function(){el.hidden=true;el.innerHTML='';return null;});
}
function wireBox(el,kind,id,x,o){
 var status=el.querySelector('[data-tx-status]'),form=el.querySelector('[data-tx-form]');
 function after(msg){return function(){status.textContent=msg;box(el,kind,id,o).then(function(){var s=el.querySelector('[data-tx-status]');if(s)s.textContent=msg;});if(o.onSaved)o.onSaved();};}
 function fail(b){return function(e){if(b)b.disabled=false;status.textContent=errText(e);};}
 el.querySelectorAll('[data-tx-type]').forEach(function(c){c.onchange=function(){var p={};p[c.getAttribute('data-tx-type')]=c.checked;c.disabled=true;act(kind,id,'set_type',p).then(after('اتحفظ نوع الفاتورة.')).catch(function(e){c.checked=!c.checked;fail(c)(e);});};});
 var b=function(k){return el.querySelector('[data-tx-do="'+k+'"]');};
 if(b('record'))b('record').onclick=function(){form.innerHTML='<form class="tx-form"><label>رقم الفاتورة على البوابة (UUID)<input name="portal_uuid" required minlength="4" maxlength="120" dir="ltr" placeholder="مثلاً: 7F3K9Q2M…"></label><label>رقم الفاتورة الداخلي على البوابة (اختياري)<input name="portal_ref" maxlength="120" dir="ltr"></label><label>تاريخ الرفع<input type="date" name="uploaded_at" value="'+iso(new Date())+'"></label><label>ملاحظة (اختياري)<input name="note" maxlength="500"></label><div class="tx-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn" data-tx-cancel>إلغاء</button></div></form>';
  var f=form.querySelector('form');f.querySelector('[data-tx-cancel]').onclick=function(){form.innerHTML='';};
  f.onsubmit=function(e){e.preventDefault();var s=f.querySelector('[type=submit]');s.disabled=true;act(kind,id,'record_upload',{portal_uuid:f.elements.portal_uuid.value,portal_ref:f.elements.portal_ref.value,uploaded_at:f.elements.uploaded_at.value,note:f.elements.note.value}).then(after('اتسجّل الرفع — مستني تأكيد المدير المالي.')).catch(fail(s));};};
 if(b('confirm'))b('confirm').onclick=function(){this.disabled=true;act(kind,id,'confirm',{}).then(after('اتأكد الرفع على البوابة.')).catch(fail(this));};
 ['refuse','unmark'].forEach(function(k){if(b(k))b(k).onclick=function(){form.innerHTML='<form class="tx-form"><label>'+(k==='refuse'?'سبب الرفض':'سبب الرجوع')+'<input name="reason" required minlength="3" maxlength="400"></label><div class="tx-actions"><button type="submit" class="btn btn-primary">حفظ</button><button type="button" class="btn" data-tx-cancel>إلغاء</button></div></form>';
  var f=form.querySelector('form');f.querySelector('[data-tx-cancel]').onclick=function(){form.innerHTML='';};
  f.onsubmit=function(e){e.preventDefault();var s=f.querySelector('[type=submit]');s.disabled=true;act(kind,id,k,{reason:f.elements.reason.value}).then(after(k==='refuse'?'اترفض التأكيد ورجعت «لسه ما اترفعتش».':'رجعت «لسه ما اترفعتش».')).catch(fail(s));};};});
}
function open(kind,id){
 var o=d.createElement('div');o.className='tx-overlay';o.innerHTML='<div class="tx-dialog" role="dialog" aria-modal="true" aria-label="الضرائب"><button type="button" class="btn tx-close" data-tx-close aria-label="إغلاق">إغلاق</button><div data-tx-host></div></div>';
 d.body.appendChild(o);var close=function(){o.remove();};o.querySelector('[data-tx-close]').onclick=close;o.addEventListener('click',function(e){if(e.target===o)close();});
 return box(o.querySelector('[data-tx-host]'),kind,id,{}).then(function(x){if(!x){o.querySelector('[data-tx-host]').hidden=false;o.querySelector('[data-tx-host]').innerHTML='<p>مش متاح لحسابك أو الفاتورة مش موجودة.</p>';}return o;});
}

/* ---------- tax report («الضرائب» section) ---------- */
var FIL=[['all','الكل'],['uploaded','اترفعت'],['open','لسه'],['pending','مستني تأكيد'],['e','إلكترونية'],['purchase_invoice','مشتريات']];
function pass(r,f){return f==='all'||(f==='uploaded'&&r.portal_status==='uploaded')||(f==='open'&&r.is_tax_invoice&&r.portal_status!=='uploaded')||(f==='pending'&&r.portal_status==='pending')||(f==='e'&&r.is_e_invoice)||(f===r.doc_kind);}
function report(body){
 if(!body)return Promise.resolve(null);var host=body.querySelector('[data-tx-report]');
 if(!host){host=d.createElement('section');host.className='tx-report';host.setAttribute('data-tx-report','');host.setAttribute('aria-live','polite');body.insertBefore(host,body.firstChild);}
 var now=new Date(),from=host.getAttribute('data-from')||iso(new Date(now.getFullYear(),now.getMonth(),1)),to=host.getAttribute('data-to')||iso(now),f=host.getAttribute('data-filter')||'all';
 host.innerHTML='<p class="tx-note">جاري تحميل تقرير الضرائب…</p>';
 return rpc('clinic_finance_tax_report',{p_from:from,p_to:to}).then(function(R){
  if(!host.isConnected)return R;var rows=R.rows||[],t=R.totals||{},s=R.settings||{},count=function(k){return rows.filter(function(r){return pass(r,k);}).length;},list=rows.filter(function(r){return pass(r,f);});
  var h='<div class="tx-rhead"><div><b>تقرير الضرائب</b><small>الفواتير الضريبية والإلكترونية — اترفعت على البوابة ولا لسه</small></div><form class="tx-period" data-tx-period><label>تقرير الضرائب من<input type="date" name="from" value="'+esc(from)+'"></label><label>تقرير الضرائب لحد<input type="date" name="to" value="'+esc(to)+'"></label><button class="btn" type="submit">عرض</button></form></div>';
  h+='<div class="tx-pills">'+FIL.map(function(p){return '<button type="button" class="tx-pill'+(p[0]===f?' on':'')+'" data-tx-filter="'+p[0]+'">'+esc(p[1])+' '+count(p[0])+'</button>';}).join('')+'</div>';
  h+='<div class="tx-kpis"><div class="tx-kpi"><span>إجمالي الفواتير الضريبية</span><b>'+money(t.tax_amount)+'</b><small>'+(t.tax_count||0)+' فاتورة</small></div><div class="tx-kpi ok"><span>اترفعت على البوابة</span><b>'+money(t.uploaded_amount)+'</b><small>'+(t.uploaded_count||0)+' فاتورة</small></div><div class="tx-kpi wait"><span>لسه ما اترفعتش</span><b>'+money(t.not_uploaded_amount)+'</b><small>'+(t.not_uploaded_count||0)+' فاتورة'+(t.pending_count?' — منهم '+t.pending_count+' مستني تأكيد':'')+'</small></div></div>';
  if(!s.tax_invoices_from)h+='<p class="tx-warn">لسه ما اتحددش «الفواتير الضريبية من تاريخ» — لحد ما يتحدد، محدش بيتعلّم ضريبي تلقائي.</p>';
  h+='<div class="tx-table"><table><thead><tr><th>الفاتورة</th><th>النوع</th><th>الطرف</th><th>التاريخ</th><th>المبلغ</th><th>البوابة</th><th></th></tr></thead><tbody>'+(list.length?list.map(function(r){var st=r.portal_status;
   return '<tr><td>'+esc(r.no)+'</td><td>'+esc(KIND[r.doc_kind])+(r.is_tax_invoice?' · ضريبية':'')+(r.is_e_invoice?' · إلكترونية':'')+'</td><td>'+esc(r.party||'—')+'</td><td>'+esc(day(r.date))+'</td><td>'+money(r.amount)+'</td><td><span class="tx-st is-'+esc(st)+'">'+esc(st==='uploaded'?'اترفعت':st==='pending'?'مستني تأكيد':(r.is_tax_invoice?'لسه':'مش ضريبية'))+'</span></td><td><button type="button" class="btn sm" data-tx-open="'+esc(r.doc_kind)+'|'+esc(r.doc_id)+'">افتح</button></td></tr>';}).join(''):'<tr><td colspan="7">مفيش فواتير في الفترة دي.</td></tr>')+'</tbody></table></div>';
  h+='<div class="tx-actions"><button type="button" class="btn" data-tx-csv>تصدير Excel (CSV)</button></div>';
  if(R.can_review)h+='<details class="tx-settings"><summary>إعدادات الضرائب (المدير المالي)</summary><form data-tx-settings><label>الفواتير الضريبية من تاريخ<input type="date" name="tax_invoices_from" value="'+esc(s.tax_invoices_from||'')+'"></label><label>الفواتير الإلكترونية من تاريخ<input type="date" name="e_invoices_from" value="'+esc(s.e_invoices_from||'')+'"></label><label>نسبة خصم ضريبة الأطباء % (واحدة للكل)<input type="number" name="doctor_withholding_rate" min="0" max="100" step="0.01" value="'+esc(s.doctor_withholding_rate==null?'':s.doctor_withholding_rate)+'"></label><button type="submit" class="btn btn-primary">حفظ الإعدادات</button><p class="tx-note">النسبة القانونية يأكدها المحاسب. أي فاتورة من التاريخ ده بتبقى ضريبية لوحدها، والمحاسب يقدر يشيل العلامة من فاتورة معيّنة.</p></form></details>';
  h+='<p class="tx-status" data-tx-status role="status"></p>';
  host.innerHTML=h;
  var period=host.querySelector('[data-tx-period]');period.onsubmit=function(e){e.preventDefault();host.setAttribute('data-from',period.elements.from.value);host.setAttribute('data-to',period.elements.to.value);report(body);};
  host.querySelectorAll('[data-tx-filter]').forEach(function(b){b.onclick=function(){host.setAttribute('data-filter',b.getAttribute('data-tx-filter'));report(body);};});
  host.querySelectorAll('[data-tx-open]').forEach(function(b){b.onclick=function(){var p=b.getAttribute('data-tx-open').split('|');open(p[0],p[1]).then(function(o){var c=o.querySelector('[data-tx-close]'),old=c.onclick;c.onclick=function(){old();report(body);};});};});
  host.querySelector('[data-tx-csv]').onclick=function(){var lines=[['الفاتورة','النوع','ضريبية','إلكترونية','الطرف','التاريخ','المبلغ','البوابة','UUID','تاريخ الرفع']].concat(list.map(function(r){return [r.no,KIND[r.doc_kind],r.is_tax_invoice?'نعم':'لا',r.is_e_invoice?'نعم':'لا',r.party||'',day(r.date),Number(r.amount||0).toFixed(2),ST[r.portal_status]||'',r.portal_uuid||'',r.uploaded_at?day(r.uploaded_at):''];}));
   var csv='﻿'+lines.map(function(l){return l.map(function(c){return '"'+String(c==null?'':c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
   var a=d.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='tax-report-'+from+'-'+to+'.csv';d.body.appendChild(a);a.click();a.remove();};
  var sf=host.querySelector('[data-tx-settings]');if(sf)sf.onsubmit=function(e){e.preventDefault();var st=host.querySelector('[data-tx-status]');
   rpc('clinic_finance_tax_settings_save',{p_payload:{tax_invoices_from:sf.elements.tax_invoices_from.value,e_invoices_from:sf.elements.e_invoices_from.value,doctor_withholding_rate:sf.elements.doctor_withholding_rate.value}}).then(function(){report(body).then(function(){var x=host.querySelector('[data-tx-status]');if(x)x.textContent='اتحفظت إعدادات الضرائب.';});}).catch(function(er){st.textContent=errText(er);});};
  return R;
 }).catch(function(e){if(host.isConnected)host.innerHTML='<p class="tx-note">'+esc(errText(e))+'</p>';return null;});
}

/* ---------- doctor payout: suggested withholding ---------- */
function bindPayout(form){
 if(!form||!form.elements.withheld||!form.elements.doctor_key)return;var hint=d.createElement('p');hint.className='tx-hint';hint.setAttribute('data-tx-payout','');form.elements.withheld.closest('label').insertAdjacentElement('afterend',hint);
 var touched=false,seq=0;form.elements.withheld.addEventListener('input',function(){touched=true;});
 function run(){var my=++seq,dk=form.elements.doctor_key.value,f=form.elements.from&&form.elements.from.value,t=form.elements.to&&form.elements.to.value;if(!dk){hint.textContent='';return;}
  rpc('clinic_finance_doctor_tax_suggest',{p_doctor:dk,p_from:f||null,p_to:t||null}).then(function(s){if(my!==seq)return;
   if(s.rate==null){hint.textContent='نسبة خصم ضريبة الأطباء لسه ما اتحددتش في إعدادات الضرائب.';return;}
   hint.innerHTML='ضريبة مقترحة: <b>'+money(s.suggested)+'</b> = '+esc(s.rate)+'% × '+money(s.uploaded_fees)+' أتعاب على '+esc(s.uploaded_visits)+' فاتورة إلكترونية اترفعت'+(Number(s.pending_fees)>0?' — و'+money(s.pending_fees)+' على '+esc(s.pending_visits)+' فاتورة لسه ما اترفعتش (ضريبتها لما تترفع)':'')+'. تقدر تعدّل الرقم حسب المستند.';
   if(!touched)form.elements.withheld.value=Number(s.suggested||0).toFixed(2);}).catch(function(){if(my===seq)hint.textContent='';});}
 ['doctor_key','from','to'].forEach(function(n){if(form.elements[n])form.elements[n].addEventListener('change',run);});run();
}

function mountIn(body,tab){if(tab==='taxes')return report(body);return null;}
w.SSMPDTaxStatus={box:box,open:open,report:report,bindPayout:bindPayout,mountIn:mountIn,html:boxHtml,pass:pass};
})(window,document);
