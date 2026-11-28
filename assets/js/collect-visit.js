/* «حصّل» على الزيارة — كل فواتير الزيارة (owner 2026-11-28 «موافق على تصليح التحصيل», mockup docs/ui-references/mockups/collect-visit-split.html).
   Bug (Amina): the card's «حصّل X» showed the visit total but «تسجيل تحصيل» opened on the FIRST invoice only, so the whole amount
   went to it and the rest became patient credit. Now «حصّل» (today board / visit card / fix-visit) opens «تسجيل تحصيل» with every open
   invoice of that visit ticked under «فواتير الزيارة اللي هتتحصّل»; the amount = their total. Saving uses the existing
   «الدفعة دي لأكتر من فاتورة» path (collect_multi: one receipt, allocated per invoice in order) — no server change.
   More than the ticked invoices → an orange line «الزيادة هتبقى رصيد للمريض», and if the visit still has unticked open invoices
   a question before saving: «ضيفهم للتحصيل» / «لا — خليها رصيد للمريض» / «رجوع».
   Wiring: SSMPDTodayOps collectDue sets SSMPDCollectVisit.pending = {fixed, ids}; reception-services «collect-invoice» calls attach().
   «تحصيل» from the invoices table (no pending) is unchanged. */
(function(w,d){'use strict';
var CSS='.cv{border:1px solid #E3E8F2;border-radius:12px;padding:10px;display:grid;gap:6px;margin:0 0 8px}.cv legend{font-weight:700;font-size:13px;padding:0 6px}'+
 '.cv-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:13px}.cv-row b{direction:ltr}.cv-row small{color:#5b6577}'+
 '.cv-tot{display:flex;justify-content:space-between;border-top:1px dashed #CBD5E1;padding-top:6px;font-weight:700;color:#0F369D;font-size:13px}'+
 '.cv-split{background:#E8F4EE;color:#1f5d43;border-radius:10px;padding:8px 10px;font-size:12.5px;margin:0;line-height:1.7}'+
 '.cv-excess{background:#FFF6E5;color:#8A5A00;border-radius:10px;padding:8px 10px;font-size:12.5px;margin:0;line-height:1.7}'+
 '.cv-ask{border:2px solid #F15A22;border-radius:12px;padding:10px;display:grid;gap:8px;background:#fff}.cv-ask p{margin:0;font-size:13px;line-height:1.7}'+
 '.cv-acts{display:flex;gap:8px;flex-wrap:wrap}.cv-ask .btn-orange{background:#F15A22;border-color:#F15A22;color:#fff}.cv[hidden],.cv-ask[hidden],.cv-split[hidden],.cv-excess[hidden]{display:none}';
function css(){if(d.getElementById('cv-css'))return;var s=d.createElement('style');s.id='cv-css';s.textContent=CSS;(d.head||d.documentElement).appendChild(s);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function r2(n){return Math.round((Number(n)||0)*100)/100;}
var api={pending:null};
api.attach=function(root,c,fixed,data){
 var P=api.pending;api.pending=null;if(!P||!fixed||P.fixed!==fixed.id||!root)return null;
 var all=(data&&data.invoices)||[],byId=function(id){return all.filter(function(x){return x.id===id;})[0];};
 var invs=[fixed].concat((P.ids||[]).filter(function(id){return id!==fixed.id;}).map(byId).filter(function(i){return i&&Number(i.due)>0&&!i.package_id&&i.patient_id===fixed.patient_id;}));
 if(invs.length<2)return null;css();
 var form=root.querySelector('form'),amount=form&&form.elements.amount,multi=form&&form.querySelector('[data-rx-multi]');if(!form||!amount)return null;
 var on=multi&&multi.querySelector('[data-rx-multi-on]'),mrow=function(id){return multi&&multi.querySelector('[data-rx-multi-inv][value="'+id+'"]');};
 if(invs.slice(1).some(function(i){return !mrow(i.id);}))return null;   // the saving path must exist for every sibling
 var box=d.createElement('fieldset');box.className='cv';box.setAttribute('data-cv','');
 box.innerHTML='<legend>فواتير الزيارة اللي هتتحصّل</legend>'+invs.map(function(i,n){return '<label class="cv-row"><input type="checkbox" data-cv-inv value="'+esc(i.id)+'" data-due="'+esc(i.due)+'" checked'+(n?'':' disabled')+'><span>'+esc(i.description||'فاتورة')+(n?'':' <small>(الفاتورة اللي فتحت منها)</small>')+'</span><b>'+money(i.due)+'</b></label>';}).join('')+
  '<div class="cv-tot"><span>الإجمالي</span><span dir="ltr" data-cv-total></span></div><p class="cv-split" data-cv-split></p><p class="cv-excess" data-cv-excess role="status" hidden></p>'+
  '<div class="cv-ask" data-cv-ask role="alertdialog" aria-label="قبل الحفظ" hidden><p><b>قبل الحفظ:</b> فيه فواتير تانية مفتوحة للزيارة دي (<span data-cv-left></span>). تحب تحصّلهم بالفلوس دي بدل ما تبقى رصيد؟</p>'+
  '<div class="cv-acts"><button type="button" class="btn btn-primary" data-cv-add>ضيفهم للتحصيل</button><button type="button" class="btn btn-orange" data-cv-credit>لا — خليها رصيد للمريض</button><button type="button" class="btn" data-cv-back>رجوع</button></div></div>';
 var anchor=amount.closest('label')||amount;anchor.parentNode.insertBefore(box,anchor);
 invs.slice(1).forEach(function(i){var x=mrow(i.id),row=x&&x.closest('[data-rx-multi-row]');if(row)row.hidden=true;});
 var boxes=[].slice.call(box.querySelectorAll('[data-cv-inv]')),ask=box.querySelector('[data-cv-ask]'),ok=false;
 function ticked(){return boxes.filter(function(b){return b.checked;}).map(function(b){return byId(b.value)||fixed;});}
 function others(){if(!multi||!on||!on.checked)return 0;var oOn=multi.querySelector('[data-rx-multi-other-on]'),ids=invs.map(function(i){return i.id;});
  return [].slice.call(multi.querySelectorAll('[data-rx-multi-inv]:checked')).filter(function(x){return ids.indexOf(x.value)<0&&(!x.hasAttribute('data-rx-multi-x')||(oOn&&oOn.checked));}).reduce(function(s,x){return s+(Number(x.getAttribute('data-due'))||0);},0);}
 function wire(){var t=ticked(),sib=t.length>1;if(on&&sib)on.checked=true;
  invs.slice(1).forEach(function(i){var x=mrow(i.id);if(x)x.checked=t.indexOf(i)>=0;});}
 function show(){var t=ticked(),total=r2(t.reduce(function(s,i){return s+Number(i.due);},0)),amt=Number(amount.value)||0,left=amt,ex=r2(amt-total-others());
  box.querySelector('[data-cv-total]').textContent=money(total);
  var parts=t.map(function(i){var p=Math.min(left,Number(i.due));left=r2(left-p);return p>0?esc(i.description||'فاتورة')+' '+money(p):'';}).filter(Boolean);
  var sp=box.querySelector('[data-cv-split]');sp.hidden=!parts.length;sp.innerHTML='هيتوزع: '+parts.join(' · ')+' — <b>إيصال واحد</b> ورقم عملية واحد.';
  var xe=box.querySelector('[data-cv-excess]');xe.hidden=!(ex>0);if(ex>0)xe.innerHTML='⚠ المبلغ أكبر من الفواتير المتعلّمة بـ <b dir="ltr">'+money(ex)+'</b> — الزيادة دي هتبقى <b>رصيد للمريض</b>.';
  return ex;}
 function sync(auto){wire();if(auto){var t=ticked();amount.value=r2(t.reduce(function(s,i){return s+Number(i.due);},0)+others());amount.dispatchEvent(new Event('input',{bubbles:true}));}ok=false;ask.hidden=true;show();}
 boxes.forEach(function(b){b.addEventListener('change',function(){sync(true);});});
 amount.addEventListener('input',function(){ok=false;ask.hidden=true;show();});
 if(on)on.addEventListener('change',function(){sync(true);});
 if(multi)multi.addEventListener('change',function(e){if(e.target!==on&&!box.contains(e.target))setTimeout(function(){show();},0);});
 root.addEventListener('submit',function(e){wire();var ex=show(),un=boxes.filter(function(b){return !b.checked;});if(!(ex>0)||!un.length||ok)return;
  e.preventDefault();e.stopImmediatePropagation();box.querySelector('[data-cv-left]').textContent=un.map(function(b){var i=byId(b.value);return (i&&i.description||'فاتورة')+' '+money(i&&i.due);}).join(' · ');ask.hidden=false;
  var first=ask.querySelector('[data-cv-add]');if(first&&first.focus)first.focus();},true);
 ask.querySelector('[data-cv-add]').onclick=function(){var keep=amount.value;boxes.forEach(function(b){b.checked=true;});sync(false);amount.value=keep;show();};
 ask.querySelector('[data-cv-credit]').onclick=function(){ok=true;ask.hidden=true;if(form.requestSubmit)form.requestSubmit();else form.dispatchEvent(new Event('submit',{cancelable:true}));};
 ask.querySelector('[data-cv-back]').onclick=function(){ask.hidden=true;amount.focus();};
 sync(true);return box;};
w.SSMPDCollectVisit=api;
})(window,document);
