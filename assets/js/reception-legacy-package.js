/* «باكج مدفوع قبل السيستم» (owner 2026-11-23 «طبقه» on docs/ui-references/mockups/legacy-package.html; server 20261123110000).
   1) Patient row «باكج مدفوع قبل السيستم» (reception, live): name, paid on (before today), services × sessions × amount, old receipt
      → 'legacy_package_request' (pending; no cash today).
   2) Approvals card on the reception screen for super admin / financial manager: «اعتمد» / «ارفض (بسبب)»
      → public.clinic_reception_legacy_package_review (never the requester).
   3) Visit card ⋯ «خصم من باكج المريض»: a not-yet-paid service of the visit (ordered, or executed and unpaid) uses a package session
      → 'order_use_package'; the patient pays 0.
   Hooks: SSMPDLegacyPackage.openRequest(patientId, c), approvals(host, c), canUse(ap, data), openUse(apId, c). */
(function(w){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})+' ج.م';}
function r2(n){return Math.round(n*100)/100;}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function rpc(n,a){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(n,a)).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
function cairoDay(dt){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(dt||new Date());}
function svcOptions(d){return (d.services||[]).filter(function(s){return s.active!==false;}).map(function(s){return '<option value="'+esc(s.id)+'" data-code="'+esc(s.code||'')+'">'+esc(s.name)+(s.department?' — '+esc(s.department):'')+'</option>';}).join('');}
function lineHtml(d){return '<div class="rlp-line" data-rlp-line><label class="rlp-f rlp-svc">الخدمة<select name="rlp_service" data-service-select required><option value="">اختار الخدمة</option>'+svcOptions(d)+'</select></label>'+
 '<label class="rlp-f">جلسات<input name="rlp_sessions" type="number" min="1" max="50" step="1" inputmode="numeric" dir="ltr" required></label>'+
 '<label class="rlp-f">المبلغ المدفوع<input name="rlp_amount" type="number" min="1" step="0.01" inputmode="decimal" dir="ltr" required></label>'+
 '<button type="button" class="btn rlp-x" data-rlp-del aria-label="شيل الخدمة">×</button></div>';}
/* 1) register */
function openRequest(patientId,c){var d=c.data||{},p=(d.patients||[]).find(function(x){return x.id===patientId;})||{};
 var yday=cairoDay(new Date(Date.now()-864e5));
 var body='<p class="rlp-note" data-wide>'+esc(p.name||'')+(p.file_no?' — '+esc(p.file_no):'')+'</p>'+
  '<label>اسم الباكج<input name="rlp_name" maxlength="120" required placeholder="مثلاً ليزر نص إيد + منطقة تانية"></label>'+
  '<label>دفع يوم<input name="rlp_paid_on" type="date" max="'+yday+'" required></label>'+
  '<div class="rlp-lines" data-wide data-rlp-lines>'+lineHtml(d)+'</div>'+
  '<button type="button" class="btn rlp-add" data-wide data-rlp-add>+ خدمة تانية</button>'+
  '<label data-wide>رقم الإيصال القديم أو صورته (لو موجود)<input name="rlp_receipt" maxlength="200"></label>'+
  '<div class="rlp-sum" data-wide data-rlp-sum></div><p class="rlp-note" data-wide>مفيش فلوس بتدخل الخزينة النهارده. الطلب بيروح للسوبر أدمن أو المدير المالي يعتمده.</p>';
 var root=c.modal('باكج مدفوع قبل السيستم',body,function(){var f=root.querySelector('form'),lines=collect(f);
   if(!lines.length)throw new Error('اختار خدمة واحدة على الأقل');var total=r2(lines.reduce(function(t,l){return t+l.amount;},0));
   var payload={patient_id:patientId,name:f.elements.rlp_name.value.trim(),paid_on:f.elements.rlp_paid_on.value,total:String(total),receipt_ref:f.elements.rlp_receipt.value.trim(),
     lines:lines.map(function(l){return {service_id:l.service_id,sessions:l.sessions,amount:String(l.amount)};})};
   return c.command('legacy_package_request',payload,crypto.randomUUID()).then(function(r){if(w.SSMPDToast)w.SSMPDToast.show('اتبعت للاعتماد ✓ — '+money(total)+' مدفوع قبل التشغيل');return r;});},null,{ok:'ابعت للاعتماد'});
 if(!root)return true;var f=root.querySelector('form'),box=f.querySelector('[data-rlp-lines]');
 function collect(form){return Array.prototype.map.call(form.querySelectorAll('[data-rlp-line]'),function(x){var s=x.querySelector('select'),n=+x.querySelector('[name=rlp_sessions]').value,a=+x.querySelector('[name=rlp_amount]').value;
   return {service_id:s.value,name:s.value?s.options[s.selectedIndex].textContent:'',sessions:n,amount:a};}).filter(function(l){return l.service_id&&l.sessions>0&&l.amount>0;});}
 function paint(){var ls=collect(f),tot=ls.reduce(function(t,l){return t+l.amount;},0),sum=f.querySelector('[data-rlp-sum]');
  sum.innerHTML=ls.length?'<span>الإجمالي المدفوع</span><b>'+money(tot)+'</b>'+ls.map(function(l){return '<span>قيمة الجلسة — '+esc(l.name.split(' — ')[0])+'</span><span>'+money(r2(l.amount/l.sessions))+'</span>';}).join(''):'';
  box.querySelectorAll('[data-rlp-del]').forEach(function(b){b.hidden=box.children.length<2;});}
 f.querySelector('[data-rlp-add]').onclick=function(){box.insertAdjacentHTML('beforeend',lineHtml(d));paint();};
 box.addEventListener('click',function(e){var b=e.target.closest('[data-rlp-del]');if(b&&box.children.length>1){b.closest('[data-rlp-line]').remove();paint();}});
 f.addEventListener('input',paint);f.addEventListener('change',paint);paint();return true;}
/* 2) approvals card (super admin / financial manager) */
function approvals(host,c){if(!host||!c||!c.workspace)return;var a=w.SSMPDAuth&&w.SSMPDAuth.currentAdmin,R=w.SSMPDRoles;
 var ok=a&&R&&(R.hasAnyRole?R.hasAnyRole(a,['super_admin','financial_manager']):(a.role==='super_admin'||a.role==='financial_manager'));if(!ok)return;
 rpc('clinic_reception_legacy_packages',{p_workspace:c.workspace,p_patient:null}).then(function(r){if(!host.isConnected)return;var old=host.querySelector('[data-rlp-approvals]');if(old)old.remove();
  var list=(r&&r.pending||[]).filter(function(x){return !x.mine;});if(!r||!r.can_review||!list.length)return;
  var sec=document.createElement('section');sec.className='rlp-appr';sec.setAttribute('data-rlp-approvals','');
  sec.innerHTML='<h3>باكجات مدفوعة قبل السيستم — مستنية اعتمادك</h3>'+list.map(function(x){return '<article class="rlp-req" data-rlp-req="'+esc(x.id)+'"><div><b>'+esc(x.patient)+'</b> — '+money(x.total)+
   ' <span class="rlp-badge">مدفوع قبل التشغيل بتاريخ '+esc(String(x.paid_on).split('-').reverse().join('/'))+'</span><small>'+esc(x.name)+' · '+(x.lines||[]).map(function(l){return esc(l.name)+' '+l.sessions+' × '+money(l.per_session);}).join(' · ')+
   ' — سجّلته: '+esc(x.requester||'')+(x.receipt_ref?' · '+esc(x.receipt_ref):'')+'</small></div><div class="rlp-btns"><button type="button" class="btn btn-primary" data-rlp-ok>اعتمد</button><button type="button" class="btn rx-danger" data-rlp-no>ارفض (بسبب)</button></div></article>';}).join('');
  var anchor=host.querySelector('.rx-header');if(anchor)anchor.after(sec);else host.prepend(sec);
  sec.addEventListener('click',function(e){var art=e.target.closest('[data-rlp-req]');if(!art)return;var id=art.getAttribute('data-rlp-req'),approve=!!e.target.closest('[data-rlp-ok]'),reject=!!e.target.closest('[data-rlp-no]');if(!approve&&!reject)return;
   var note=null;if(reject){note=w.prompt('سبب الرفض');if(!note)return;}
   art.querySelectorAll('button').forEach(function(b){b.disabled=true;});
   rpc('clinic_reception_legacy_package_review',{p_id:id,p_approve:approve,p_note:note}).then(function(){if(w.SSMPDToast)w.SSMPDToast.show(approve?'اتعتمد الباكج ✓ — جلساته جاهزة':'اترفض الطلب');art.remove();if(!sec.querySelector('[data-rlp-req]'))sec.remove();if(c.load)c.load();})
    .catch(function(err){art.querySelectorAll('button').forEach(function(b){b.disabled=false;});w.alert((err&&err.message)||'تعذر الحفظ');});});
 }).catch(function(){});}
/* 3) visit ⋯ «خصم من باكج المريض» */
function eligibleOrders(ap,d){var v=((d&&d.visits)||[]).find(function(x){return x.appointment_id===ap.id;});if(!v)return [];
 var inv=d.invoices||[],disc=d.discounts||[];
 return (d.orders||[]).filter(function(o){if(o.visit_id!==v.id||o.entitlement_id)return false;if(o.status==='ordered')return !(+o.discount>0)&&!disc.some(function(r){return r.order_id===o.id&&(r.status==='pending'||r.status==='approved');});
  if(o.status!=='completed')return false;var i=inv.find(function(x){return x.order_id===o.id;});return !!i&&+i.due>0&&+i.due===+i.amount-(+i.credit_amount||0)-(+i.payer_amount||0);});}
function canUse(ap,d){if(!ap||(ap.status!=='arrived'&&ap.status!=='completed'))return false;
 var pk=(d.packages||[]).some(function(k){return k.patient_id===ap.patient_id&&k.status==='active';});return pk&&eligibleOrders(ap,d).length>0;}
function openUse(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 var orders=eligibleOrders(ap,d);if(!orders.length)throw new Error('مفيش خدمة على الزيارة تتخصم من باكج');
 return rpc('clinic_reception_legacy_packages',{p_workspace:c.workspace,p_patient:ap.patient_id}).then(function(r){var sess=(r&&r.sessions)||[];
  var pairs=[];orders.forEach(function(o){sess.filter(function(s){return s.service_id===o.service_id;}).forEach(function(s){pairs.push({o:o,s:s});});});
  if(!pairs.length)throw new Error('المريض مالوش جلسات باكج للخدمات دي');
  var name=function(o){return (o.snapshot&&o.snapshot.name)||((d.services||[]).find(function(x){return x.id===o.service_id;})||{}).name||'خدمة';};
  var body=pairs.map(function(x,i){return '<label class="rlp-ent'+(i?'':' on')+'"><input type="radio" name="rlp_pick" value="'+i+'"'+(i?'':' checked')+' required><span><b>'+esc(name(x.o))+'</b> — '+money(x.o.price*(x.o.quantity||1))+(x.o.status==='completed'?' (اتنفذت ولسه متدفعتش)':'')+
   '<small>'+esc(x.s.package)+' · فاضل '+x.s.left+' من '+x.s.of+' · قيمة الجلسة '+money(x.s.value)+'</small></span>'+(x.s.legacy_paid_on?'<em class="rlp-badge">مدفوع قبل التشغيل</em>':'')+'</label>';}).join('')+
   '<div class="rlp-sum" data-wide><span>المريض يدفع</span><b>0 ج.م</b></div>';
  c.modal('خصم من باكج المريض',body,function(v){var x=pairs[+v.rlp_pick];
   return c.command('order_use_package',{order_id:x.o.id,entitlement_id:x.s.entitlement_id},crypto.randomUUID()).then(function(res){if(w.SSMPDToast)w.SSMPDToast.show('الجلسة اتخصمت من الباكج ✓ — فاضل '+(res&&res.left)+' من '+x.s.of);return res;});},null,{ok:'خصم من الباكج'});
 }).catch(function(e){w.alert((e&&e.message)||e);});}
w.SSMPDLegacyPackage={openRequest:openRequest,approvals:approvals,canUse:canUse,openUse:openUse};
})(window);
