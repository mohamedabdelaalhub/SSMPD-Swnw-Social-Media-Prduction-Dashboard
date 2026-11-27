/* SSMPD — «راجع قبل ما تحصّل» (owner 2026-11-27 «قبل ما يحصل فلوس يراجع تفاصيل الحجز ويعدلها اذا استدعت الحاجة»;
   mockup docs/ui-references/mockups/review-before-money.html#collect approved; mig 20261127140000; help 329).
   Inside «تسجيل تحصيل» (collect / collect-invoice, every entry: درجي «حصّل»، كارت الزيارة «حصّل»، الفواتير «تحصيل»):
   the picked patient's visits that still owe money — each service: price → discount (who asked / who approved, or «مستني موافقة»)
   → payer → paid → owed; the totals, his credit and his receipts in MY shift. READ ONLY: public.clinic_reception_collect_review.
   «عدّل»: the SAME buttons the visit card in «تشغيل اليوم» offers for that visit (طلب خدمة، تغيير الخدمة، طريقة الدفع / الخصم،
   نفس خصم الزيارة، إعادة فتح الزيارة) — shown only when the card shows them to this role, pressed through SSMPDTodayOps.press
   (same handler, same approvals). After the edit window closes, «تسجيل تحصيل» opens again with the refreshed review.
   No price / discount is edited here and nothing skips an approval. */
(function(w,d){'use strict';
var EDIT=[['request_service','＋ ضيف خدمة'],['change_service','⇄ غيّر الخدمة'],['visit_discount','⇄ الجهة / الخصم'],['visit_same_discount','٪ نفس خصم الزيارة'],['visit_reopen','↺ افتح الزيارة للتعديل']];
var METHOD={cash:'نقدي',pos:'فيزا',bank:'تحويل بنكي',instapay:'إنستا باي',wallet:'محفظة'};
var PAYER={cash:'المريض نفسه',contract:'تأمين / تعاقد',union:'نقابة / نادي'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function hhmm(v){var t=new Date(v);return isNaN(t)?'':t.toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit'});}
function day(v){var t=new Date(v);return isNaN(t)?'':t.toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'short'});}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function T(){return w.SSMPDTodayOps;}
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'info');}
function load(ws,patient){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.rpc('clinic_reception_collect_review',{p_workspace:ws,p_patient:patient})).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
function edits(v){var t=T();if(!t||!v.appointment_id||typeof t.actions!=='function')return [];var acts;try{acts=t.actions(v.appointment_id)||[];}catch(e){return [];}
 return EDIT.map(function(e){var x=acts.filter(function(a){return a&&a.name===e[0];})[0];return x?{name:x.name,id:x.id||v.appointment_id,v2:!!x.v2,label:e[1]}:null;}).filter(Boolean);}
function discountCell(s){if(s.pending)return '<span class="rbm-tag wait">خصم '+num(s.pending.percent)+'% مستني موافقة</span>'+(s.pending.reason?'<small>'+esc(s.pending.reason)+'</small>':'');
 if(+s.discount>0)return '<span class="rbm-neg" dir="ltr">−'+num(s.discount)+' ('+num(s.discount_percent)+'%)</span>'+(s.approved?'<small>'+esc(s.approved.reason||'')+(s.approved.approved_by?' · وافق: '+esc(s.approved.approved_by):'')+'</small>':'');
 return '—';}
function owedCell(s){if(s.owed==null)return '<b>'+num(s.amount)+'</b><small>لسه ما اتنفذتش</small>';
 return '<b>'+num(s.owed)+'</b>'+(+s.paid>0?'<small>اتدفع '+num(s.paid)+'</small>':'')+(+s.payer_amount>0?'<small>'+esc(s.payer||'الجهة')+' '+num(s.payer_amount)+'</small>':'');}
function html(r){var vis=(r&&r.visits)||[],tot=(r&&r.totals)||{},rc=(r&&r.my_receipts)||[],pend=false;
 var body=vis.length?vis.map(function(v){var ed=edits(v),payer=PAYER[v.payer_kind]||'';
  return '<div class="rbm-lines" data-rbm-visit="'+esc(v.id)+'"><div class="rbm-v">زيارة '+esc(v.visit_no)+(v.provider?' · '+esc(v.provider):'')+' · '+esc(day(v.at))+' '+esc(hhmm(v.at))+(payer?' · <span class="rbm-tag'+(v.payer_kind==='contract'?' ins':'')+'">'+esc(payer)+'</span>':'')+
   (v.discount_kind?' · خصم الحجز '+num(v.discount_percent)+'%'+(v.discount_by?' (وافق: '+esc(v.discount_by)+')':''):'')+'</div>'+
   '<div class="rbm-r h"><span>الخدمة</span><span>السعر</span><span>الخصم</span><span>عليه</span></div>'+
   (v.services||[]).map(function(s){if(s.pending)pend=true;return '<div class="rbm-r"><span>'+esc(s.name)+'<small>'+esc(s.provider||'')+(s.payer?' · <span class="rbm-tag ins">'+esc(s.payer)+'</span>':'')+'</small></span><span>'+num(s.gross)+'</span><span>'+discountCell(s)+'</span><span>'+owedCell(s)+'</span></div>';}).join('')+
   (ed.length?'<div class="rbm-v rbm-ed" data-rbm-edits>'+ed.map(function(e){return '<button type="button" class="rbm-e" data-rbm-edit="'+esc(e.name)+'" data-rbm-id="'+esc(e.id)+'" data-rbm-v2="'+(e.v2?'1':'')+'">'+esc(e.label)+'</button>';}).join('')+'</div>':'')+'</div>';}).join('')
  :'<p class="rbm-hint">مفيش زيارة عليها فلوس للمريض ده دلوقتي.</p>';
 return '<h4>راجع قبل ما تحصّل</h4>'+body+
  (vis.length?'<div class="rbm-tot"><span>إجمالي الزيارات <b>'+num(tot.amount)+'</b></span><span>اتدفع قبل كده <b>'+num(tot.paid)+'</b></span><span>الباقي عليه <b class="big" data-rbm-owed>'+num(tot.owed)+'</b></span><span>رصيد مقدم <b>'+num(r.credit)+'</b></span></div>':'')+
  (rc.length?'<p class="rbm-hint">إيصالاته في ورديتك: '+rc.map(function(p){return esc(p.receipt_no||'إيصال')+' · '+num(p.amount)+' '+esc(METHOD[p.method]||p.method||'')+' · '+esc(hhmm(p.at));}).join(' — ')+'</p>':'')+
  (pend?'<p class="rbm-hint w">فيه خصم مستني موافقة: تقدر تحصّل دلوقتي المبلغ من غير الخصم، أو تستنى الموافقة.</p>':'')+
  '<p class="rbm-hint">التعديل بيفتح نفس شباك كارت الزيارة وبنفس موافقته، وبعده بيرجعلك «تسجيل تحصيل» بالأرقام الجديدة.</p>';}

function reopen(opts){var start=Date.now(),seen=false;
 (function tick(){var open=!!d.querySelector('.rx-modal,.modal-backdrop');if(open)seen=true;
  if((seen&&!open)||(!seen&&Date.now()-start>3000)){setTimeout(function(){var t=T(),ctx=t&&t.context&&t.context();if(!ctx||typeof ctx.act!=='function'){toast('افتح «تسجيل تحصيل» تاني بعد التعديل');return;}
    var a=opts.action,id=opts.id;if(a==='collect-invoice'&&!((ctx.data&&ctx.data.invoices)||[]).some(function(x){return x.id===id&&+x.due>0;})){a='collect';id='';}
    try{ctx.act(a,id);var root=d.querySelector('.rx-modal'),sel=root&&root.querySelector('select[name="patient_id"]');if(sel&&opts.patient){sel.value=opts.patient;sel.dispatchEvent(new Event('change',{bubbles:true}));}}catch(e){toast('افتح «تسجيل تحصيل» تاني بعد التعديل');}},700);return;}
  if(Date.now()-start>600000)return;setTimeout(tick,300);})();}

function attach(root,c,opts){opts=opts||{};if(!root||!c||!c.workspace)return null;var form=root.querySelector('form');if(!form||form.querySelector('[data-collect-review]'))return null;
 var box=d.createElement('section');box.className='rbm-box';box.setAttribute('data-collect-review','');box.setAttribute('data-wide','');box.setAttribute('aria-live','polite');
 var amt=form.elements.amount,anchor=amt&&amt.closest('label');if(anchor&&anchor.parentNode===form)form.insertBefore(box,anchor);else form.insertBefore(box,form.firstChild);
 var serial=0;
 function show(patient){var my=++serial;opts.patient=patient;if(!patient){box.hidden=true;box.innerHTML='';return Promise.resolve();}
  box.hidden=false;box.innerHTML='<h4>راجع قبل ما تحصّل</h4><p class="rbm-hint">بيحمّل تفاصيل الزيارة…</p>';
  return load(c.workspace,patient).then(function(r){if(my!==serial||!box.isConnected)return;box.innerHTML=html(r);
    box.querySelectorAll('[data-rbm-edit]').forEach(function(b){b.onclick=function(){var t=T();if(!t||typeof t.press!=='function')return;
      var name=b.getAttribute('data-rbm-edit'),aid=b.getAttribute('data-rbm-id'),v2=!!b.getAttribute('data-rbm-v2');
      root.remove();var ok=false;try{ok=t.press(name,aid,v2);}catch(e){ok=false;}
      if(ok===false){toast('تعذر فتح التعديل — افتح «تشغيل اليوم» وجرّب تاني.','error');}reopen(opts);};});},
   function(e){if(my!==serial||!box.isConnected)return;box.innerHTML='<h4>راجع قبل ما تحصّل</h4><p class="rbm-hint">مقدرتش أجيب تفاصيل الزيارة ('+esc((e&&e.message)||'')+'). تقدر تحصّل عادي.</p>';});}
 var sel=form.elements.patient_id;
 if(opts.patient)show(opts.patient);else if(sel&&sel.tagName==='SELECT'){sel.addEventListener('change',function(){show(sel.value);});if(sel.value)show(sel.value);else box.hidden=true;}
 else box.hidden=true;
 return {box:box,refresh:function(){return show(opts.patient);}};}
w.SSMPDCollectReview={attach:attach,_t:{html:html,edits:edits}};
})(window,document);
