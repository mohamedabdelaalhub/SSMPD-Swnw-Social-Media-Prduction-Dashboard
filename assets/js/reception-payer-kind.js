/* «طريقة الدفع / نوع الكشف» (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/booking-payer-kind.html).
   The first, mandatory field in «حجز موعد» / «تعديل الحجز» / «حضور بدون ميعاد», and the ⋯ «طريقة الدفع / الخصم» on a booked
   card (set_payer) and on an arrived card while its service is still «ordered» (order_payer):
     كاش — the optional extra discount (فيزيتا شامل / كارت العيلة / خاص) from SSMPDReceptionBookingDiscount;
     تأمين / تعاقد — active contracts only (public.clinic_reception_payer_options), list price, coupon / approval no,
                     «نسبة تحمّل الجهة ٪» typed from the approval, approval photo (mandatory);
     نقابات / نوادي — cash with a flat 30%, union / club list or «أخرى», card no + valid until + card photo.
   Server: 20261123070000_booking_payer_kind.sql. Hook: SSMPDReceptionPayer.enhance(form, {data, workspace, appointment}).
   «اسم سونو واسم الجهة» (owner 2026-11-26 «طبقه», mockup docs/ui-references/mockups/entity-service-names.html, server
   20261126090000_entity_service_names.sql): تأمين / تعاقد → after the entity is picked, the service search covers THAT entity's list
   (public.clinic_reception_entity_services): Sono name / Sono code / the entity's own name + code (+ its aliases); each result shows
   «عند <الجهة>: <اسمها> <كودها>» (or «نفس اسم سونو») and the entity price; services outside the list are greyed «مش متاحة للجهة».
   decorate(form) re-applies it after the service list is rebuilt (department change). */
(function(w){'use strict';
var KINDS=[['cash','كاش','المريض بيدفع'],['contract','تأمين / تعاقد','جهة بتغطي'],['union','نقابات / نوادي','كاش بخصم 30٪']],UNION=30,OTHER='__other';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م';}
function r2(n){return Math.round(n*100)/100;}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function upload(ws,file){var c=client();if(!c||!c.storage)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.auth.getUser()).then(function(r){var u=r&&r.data&&r.data.user;if(!u)throw new Error('سجّل دخولك تاني');
  var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',
      rnd=(w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2),path=u.id+'/'+ws+'/'+rnd+'.'+ext;
  return Promise.resolve(c.storage.from('booking-discount-cards').upload(path,file,{upsert:false,contentType:file.type||undefined})).then(function(x){if(x&&x.error)throw x.error;return path;});});}
/* fresh on every form (a contract can be activated / stopped any time); one call per service + day inside a form */
function options(ws,service,day){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.rpc('clinic_reception_payer_options',{p_workspace:ws,p_service:service||null,p_day:day||null})).then(function(r){if(r&&r.error)throw r.error;return (r&&r.data)||{contracts:[],unions:[]};});}
/* the entity's list, fresh per contract + day */
function entityServices(ws,contract,day){var c=client();if(!c)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.rpc('clinic_reception_entity_services',{p_workspace:ws,p_contract:contract,p_day:day||null})).then(function(r){if(r&&r.error)throw r.error;return (r&&r.data)||[];});}
/* the service <select> options under the chosen entity (form._rpkEnt = {name, map}) or back to cash */
function decorate(form,quiet){var sel=form&&form.elements&&form.elements.service_id;if(!sel||!sel.options)return;var st=form._rpkEnt||null,cur=sel.value,lost=false;
 Array.prototype.forEach.call(sel.options,function(o){if(!o.value)return;var d=o.dataset;
  if(!('rpkPrice' in d)){d.rpkPrice=d.price||'';d.rpkText=o.text;d.rpkOff=o.disabled?'1':'';}
  if(!st){d.price=d.rpkPrice;o.text=d.rpkText;o.disabled=!!d.rpkOff;delete d.alt;delete d.ent;delete d.entCode;return;}
  var r=st.map[o.value],blocked=!r||r.blocked||!!d.rpkOff,nm=d.name||d.rpkText;
  d.alt=r?[r.entity_name,r.entity_code].concat((r.aliases||[]).reduce(function(a,x){return a.concat([x.name,x.code]);},[])).filter(Boolean).join(' '):'';
  if(blocked){d.ent='مش في قايمة أسعار '+st.name;delete d.entCode;d.price='مش متاحة للجهة';o.text=nm+' — مش متاحة للجهة';o.disabled=true;if(o.value===cur)lost=true;}
  else{d.ent='عند '+st.name+': '+(r.entity_name||'نفس اسم سونو');if(r.entity_code)d.entCode=r.entity_code;else delete d.entCode;d.price=money(r.price)+' سعر الجهة';o.text=nm+' — '+money(r.price);o.disabled=false;}});
 var q=form.querySelector('#rx-svc-q');if(q)q.placeholder=st?'دوّر باسم سونو أو اسم الجهة أو كودها':'اكتب حرفين من اسم الخدمة أو كود سونو';
 if(lost&&!quiet){sel.value='';sel.dispatchEvent(new Event('change',{bubbles:true}));}
 sel.dispatchEvent(new Event('rx-svc-refresh'));}
function seg(val){return '<div class="rpk-seg" role="radiogroup" aria-label="طريقة الدفع">'+KINDS.map(function(k){return '<label class="rpk-opt"><input type="radio" name="payer_kind" value="'+k[0]+'" required'+(k[0]===val?' checked':'')+'><span>'+esc(k[1])+'<small>'+esc(k[2])+'</small></span></label>';}).join('')+'</div>';}
function fileRow(label,hidden,attr,optional){return '<div class="rbd-row"><span class="rbd-l">'+label+(optional?' <small class="rpk-opt-note">'+optional+'</small>':' <b class="rpk-req">*</b>')+'</span><input type="file" accept="image/*,application/pdf" capture="environment" '+attr+'><input type="hidden" name="'+hidden+'"'+(optional?'':' required')+'><small class="rbd-up" role="status"></small></div>';}
/* ctx: {data, workspace, appointment, order, only} — only: limit the choices (after arrival on a contract visit) */
function enhance(form,ctx){if(!form||form.querySelector('[data-rpk]')||!form.elements.service_id)return null;
 ctx=ctx||{};var data=ctx.data||{},ws=ctx.workspace,ap=ctx.appointment||null,cur=ap&&ap.payer_kind||'';
 if(!cur&&ap&&ap.discount_kind==='syndicate')cur='union';
 var box=document.createElement('section');box.className='rpk';box.setAttribute('data-rpk','');box.setAttribute('data-wide','');
 box.innerHTML='<p class="rbd-l rpk-title">طريقة الدفع <b class="rpk-req">*</b></p>'+seg(cur)+'<p class="rbd-offer" data-rpk-offer hidden>السعر ده عرض — مفيش خصم تاني عليه (لا نقابة ولا نادي ولا خصم إضافي)</p>'+
  '<fieldset class="rpk-body" data-rpk-contract hidden disabled>'+
   '<label class="rbd-row"><span class="rbd-l">الجهة (العقود المتفعّلة بس)</span><select name="payer_contract_id" required data-rpk-c><option value="">جاري التحميل…</option></select></label>'+
   '<p class="rpk-empty" data-rpk-cempty hidden>مفيش عقود متفعّلة — الحسابات تفعّل العقد الأول</p>'+
   '<p class="rbd-note" data-rpk-entnote aria-live="polite" hidden></p>'+
   '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l">رقم الكوبون / الكارنيه <b class="rpk-req">*</b></span><input name="payer_coupon_no" maxlength="60" required dir="ltr"></label>'+
   '<label class="rbd-row"><span class="rbd-l">رقم موافقة التغطية <small class="rpk-opt-note">(للخدمات بس — الكشف مش محتاج)</small></span><input name="payer_auth_ref" maxlength="80" dir="ltr"></label></div>'+
   '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l">نسبة تحمّل الجهة ٪ <b class="rpk-req">*</b></span><span class="rbd-pctin"><input name="payer_coverage_percent" type="number" min="0" max="100" step="0.5" inputmode="decimal" required dir="ltr"> ٪</span></label>'+
   fileRow('صورة الموافقة','payer_proof_path','data-rpk-cfile','(للخدمات بس — الكشف مش محتاج)')+'</div>'+
   '<div class="rbd-sum" data-rpk-csum hidden></div>'+
   '<p class="rbd-note">نسبة التحمّل بتتكتب من الموافقة والكارت الطبي للمريض، ورقم الموافقة وصورتها إجباريين للخدمات بس — الكشف مش محتاج موافقة (المالك 2026-11-27). السعر من قايمة أسعار العقد، والمريض بيتربط بعقد الجهة لوحده.</p>'+
  '</fieldset>'+
  '<fieldset class="rpk-body" data-rpk-union hidden disabled>'+
   '<label class="rbd-row"><span class="rbd-l">النقابة / النادي</span><select required data-rpk-u><option value="">اختار</option></select></label><input type="hidden" name="payer_union">'+
   '<label class="rbd-row" data-rpk-uother hidden><span class="rbd-l">اسم النقابة / النادي</span><input name="payer_union_other" maxlength="120" placeholder="مثلاً نادي الصيد"></label>'+
   '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l rpk-star">رقم كارنيه النقابة / النادي</span><input name="payer_card_no" maxlength="60" required inputmode="numeric" dir="ltr"></label>'+
   '<label class="rbd-row"><span class="rbd-l rpk-star">كارنيه النقابة / النادي ساري لحد</span><input name="payer_card_expiry" type="date" required></label></div>'+
   fileRow('صورة الكارنيه','payer_card_path','data-rpk-ufile')+
   '<div class="rbd-sum" data-rpk-usum hidden></div>'+
   '<p class="rbd-note">النسبة ثابتة 30٪ لكل النقابات والنوادي، وبتتطبّق لما المريض يوصل. مفيش خصم تاني على نفس الزيارة.</p>'+
  '</fieldset>'+
  '<div class="rbd-sum" data-rpk-cash hidden></div>';
 var anchor=form.querySelector('[data-rx-dept]');anchor=anchor&&(anchor.closest('label')||anchor);
 if(!anchor){var sv=form.elements.service_id;anchor=sv.closest('label')||sv;}
 if(anchor&&anchor.parentNode)anchor.before(box);else form.prepend(box);
 var cBox=box.querySelector('[data-rpk-contract]'),uBox=box.querySelector('[data-rpk-union]'),cSel=box.querySelector('[data-rpk-c]'),cEmpty=box.querySelector('[data-rpk-cempty]'),
     uSel=box.querySelector('[data-rpk-u]'),uOther=box.querySelector('[data-rpk-uother]'),cSum=box.querySelector('[data-rpk-csum]'),uSum=box.querySelector('[data-rpk-usum]'),cashSum=box.querySelector('[data-rpk-cash]'),
     E=form.elements,opts=null,optKey='',seq=0,entNote=box.querySelector('[data-rpk-entnote]'),entKey='',entSeq=0;
 if(ctx.only)box.querySelectorAll('input[name="payer_kind"]').forEach(function(r){if(ctx.only.indexOf(r.value)<0){r.disabled=true;r.closest('label').classList.add('rpk-off');}});
 function kind(){var r=box.querySelector('input[name="payer_kind"]:checked');return r?r.value:'';}
 function pkg(){return !!(E.package_id&&E.package_id.value);}
 function offerPriced(){var o=ctx.order,ev=o&&o.snapshot&&o.snapshot.pricing_evidence;if(ev)return ev.source==='offer';var s=svc();return !!(s&&s.pricing_evidence&&s.pricing_evidence.source==='offer');}
 function svc(){return (data.services||[]).find(function(s){return s.id===E.service_id.value;});}
 function qty(){return Math.max(1,+(E.quantity&&E.quantity.value)||1);}
 function day(){return (E.day&&E.day.value)||'';}
 function contract(){return opts&&(opts.contracts||[]).find(function(c){return c.contract_id===cSel.value;});}
 function fillContracts(){var list=(opts&&opts.contracts)||[],keep=cSel.value||(ap&&ap.payer_contract_id)||'';
  cSel.innerHTML='<option value="">اختار الجهة</option>'+list.map(function(c){return '<option value="'+esc(c.contract_id)+'"'+(c.blocked?' disabled':'')+'>'+esc(c.entity_name+(c.category==='unions'?' — لائحة خاصة':'')+(c.blocked?' (الخدمة دي مش في قايمة أسعار الجهة)':c.price!=null?' — '+money(c.price):''))+'</option>';}).join('');
  if(keep&&list.some(function(c){return c.contract_id===keep&&!c.blocked;}))cSel.value=keep;
  cEmpty.hidden=!!list.length;cSel.setCustomValidity(list.length?'':'مفيش عقود متفعّلة — الحسابات تفعّل العقد الأول');}
 function fillUnions(){var list=(opts&&opts.unions)||[],keep=E.payer_union.value||(ap&&(ap.payer_entity_name||ap.discount_org_name))||'';
  uSel.innerHTML='<option value="">اختار</option>'+list.map(function(u){return '<option value="'+esc(u.name)+'">'+esc(u.name)+'</option>';}).join('')+'<option value="'+OTHER+'">أخرى… (اكتب الاسم)</option>';
  if(keep){if(list.some(function(u){return u.name===keep;}))uSel.value=keep;else{uSel.value=OTHER;E.payer_union_other.value=keep;}}syncUnion();}
 function load(){var k=(E.service_id.value||'')+'|'+day();if(k===optKey)return;optKey=k;var my=++seq;
  options(ws,E.service_id.value,day()).then(function(o){if(my!==seq)return;opts=o;fillContracts();fillUnions();paint();}).catch(function(e){if(my!==seq)return;optKey='';opts={contracts:[],unions:[]};fillContracts();fillUnions();cEmpty.hidden=false;cEmpty.textContent=(e&&e.message)||'تعذر تحميل الجهات';});}
 /* entity first → its list drives the service search */
 function entSync(){var c=kind()==='contract'&&!pkg()?cSel.value:'',key=c?c+'|'+day():'';if(key===entKey)return;entKey=key;var my=++entSeq;
  form._rpkEnt=null;if(!c){entNote.hidden=true;decorate(form);return;}
  var nm=(contract()||{}).entity_name||'الجهة';entNote.hidden=false;entNote.textContent='جاري تحميل قايمة أسعار '+nm+'…';decorate(form);
  entityServices(ws,c,day()).then(function(rows){if(my!==entSeq)return;var map={};rows.forEach(function(r){map[r.service_id]=r;});form._rpkEnt={name:nm,map:map};
   entNote.textContent='دوّر على الخدمة تحت باسم سونو أو اسم '+nm+' أو كودها — اللي مش في قايمة أسعار '+nm+' بتظهر رمادي ومش بتتختار';decorate(form);})
  .catch(function(e){if(my!==entSeq)return;entKey='';entNote.textContent=(e&&e.message)||'تعذر تحميل قايمة أسعار الجهة';});}
 function syncUnion(){var other=uSel.value===OTHER;uOther.hidden=!other;E.payer_union_other.required=other;E.payer_union_other.disabled=uBox.disabled||!other;E.payer_union.value=other?'':uSel.value;}
 function wireFile(sel,hidden,msg){var f=box.querySelector(sel),h=E[hidden],up=f.parentNode.querySelector('.rbd-up');
  f.addEventListener('change',function(ev){ev.stopPropagation();var x=f.files&&f.files[0];h.value='';if(!x)return;if(x.size>8*1024*1024){up.textContent='الصورة أكبر من ٨ ميجا — صوّرها تاني';f.value='';return;}
   up.textContent='جاري رفع الصورة…';upload(ws,x).then(function(p){h.value=p;up.textContent='اترفعت ✓';}).catch(function(e){up.textContent='الرفع ما نجحش: '+((e&&e.message)||'حاول تاني');f.value='';});});
  h.addEventListener('invalid',function(){up.textContent=msg;});return up;}
 var cUp=wireFile('[data-rpk-cfile]','payer_proof_path','ارفع صورة الموافقة'),uUp=wireFile('[data-rpk-ufile]','payer_card_path','ارفع صورة الكارنيه');
 uSel.addEventListener('change',syncUnion);
 function paint(){var p=pkg(),k=kind();box.hidden=p;
  form.setAttribute('data-payer',p?'cash':(k||'none'));
  cBox.hidden=p||k!=='contract';cBox.disabled=cBox.hidden;uBox.hidden=p||k!=='union';uBox.disabled=uBox.hidden;syncUnion();
  box.querySelectorAll('input[name="payer_kind"]').forEach(function(r){if(!ctx.only)r.disabled=p;});
  /* owner 2026-11-24: an offer-priced service takes no union discount (server 20261123200000) */
  var off=offerPriced(),un=box.querySelector('input[name="payer_kind"][value="union"]');if(un){if(off){un.disabled=true;if(un.checked){un.checked=false;}}un.closest('label').classList.toggle('is-off',off);}
  var oN=box.querySelector('[data-rpk-offer]');if(oN)oN.hidden=!off;
  if(!p&&(k==='contract'||k==='union'))load();
  var s=svc(),base=s?+s.price*qty():0;
  if(k==='contract'){var c=contract(),cov=+E.payer_coverage_percent.value,price=c&&c.price!=null?+c.price*qty():0,ok=c&&E.payer_coverage_percent.value!==''&&cov>=0&&cov<=100;
   cSum.hidden=!c;if(c)cSum.innerHTML='<span>سعر العقد</span><span>'+money(price)+'</span>'+(ok?'<span>الجهة بتدفع ('+esc(cov)+'٪)</span><span>'+money(r2(price*cov/100))+'</span><span>المريض يدفع</span><b>'+money(r2(price*(100-cov)/100))+'</b>':'<span>المريض يدفع</span><span>اكتب نسبة تحمّل الجهة</span>');}
  if(k==='union'){var nm=E.payer_union.value||E.payer_union_other.value.trim();uSum.hidden=!(base>0);
   if(base>0)uSum.innerHTML='<span>السعر</span><s>'+money(base)+'</s><span>خصم 30٪'+(nm?' — '+esc(nm):'')+'</span><span>− '+money(r2(base*UNION/100))+'</span><span>المريض يدفع</span><b>'+money(r2(base*(100-UNION)/100))+'</b>';}
  cashSum.hidden=k!=='cash'||!(base>0)||!!form.querySelector('[data-rbd-on]:checked');if(!cashSum.hidden)cashSum.innerHTML='<span>المريض يدفع</span><b>'+money(base)+'</b>';
  var d=day();if(d)E.payer_card_expiry.min=d;entSync();}
 /* prefill when editing */
 if(ap){if(ap.payer_kind==='contract'){E.payer_coupon_no.value=ap.payer_coupon_no||'';E.payer_auth_ref.value=ap.payer_auth_ref||'';E.payer_coverage_percent.value=ap.payer_coverage_percent!=null?String(+ap.payer_coverage_percent):'';
   if(ap.payer_proof_path){E.payer_proof_path.value=ap.payer_proof_path;cUp.textContent='صورة الموافقة متسجّلة ✓ (ارفع تاني لو اتغيّرت)';}}
  if(cur==='union'&&ap.discount_kind==='syndicate'){E.payer_card_no.value=ap.discount_card_no||'';E.payer_card_expiry.value=ap.discount_card_expiry||'';
   if(ap.discount_card_path){E.payer_card_path.value=ap.discount_card_path;uUp.textContent='صورة الكارنيه متسجّلة ✓ (ارفع تاني لو اتغيّرت)';}}}
 /* service search: «خصم» / «تأمين» typed where the service goes */
 var q=form.querySelector('#rx-svc-q')||form.querySelector('.rx-combo input'),hint=null;
 if(q){hint=document.createElement('small');hint.className='rbd-srchint';hint.setAttribute('data-rpk-svchint','');hint.hidden=true;hint.textContent='الخصم والتأمين مش خدمة — اختارهم من «طريقة الدفع» فوق';(q.closest('.rx-combo')||q).after(hint);
  q.addEventListener('input',function(){hint.hidden=!/خصم|تأمين|تامين|نقاب|كارت|فيزيتا/.test(q.value||'');});}
 form.addEventListener('input',paint);form.addEventListener('change',function(e){if(e.target===E.service_id||e.target===E.day)load();paint();});paint();
 return box;}
/* the payload part a ⋯ modal sends: payer_* and (cash) discount_* */
function pick(v){var p={};Object.keys(v).forEach(function(k){if(/^(payer|discount)_/.test(k))p[k]=v[k];});if(p.payer_kind!=='cash')Object.keys(p).forEach(function(k){if(/^discount_/.test(k))delete p[k];});return p;}
function dayOf(iso){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch(_){return '';}}
function patientName(d,id){return ((d.patients||[]).find(function(p){return p.id===id;})||{}).name||'';}
function done(r,p){var t=p.payer_kind==='contract'?'اتسجّلت طريقة الدفع: تأمين / تعاقد ✓'+(r&&r.patient_share!=null?' — المريض يدفع '+money(r.patient_share):''):p.payer_kind==='union'?'اتسجّل خصم النقابة / النادي 30٪ ✓':'اتسجّلت طريقة الدفع: كاش ✓';if(w.SSMPDToast)w.SSMPDToast.show(t);return r;}
function withDiscount(form,c,ap,order){var BD=w.SSMPDReceptionBookingDiscount;if(BD)BD.enhance(form,{data:c.data,workspace:c.workspace,appointment:order?null:ap,order:order});}
/* booked card ⋯ → set_payer */
function openForBooking(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 if(ap.status!=='booked')throw new Error('طريقة الدفع على الحجز قبل الوصول بس — بعد الوصول من «طريقة الدفع / الخصم» في كارت الزيارة');
 if(ap.package_id)throw new Error('حجز الباكج بسعره المتعاقد عليه — طريقة الدفع كاش');
 var root=c.modal('طريقة الدفع / الخصم','<p class="rbd-note">'+esc(patientName(d,ap.patient_id))+'</p><input type="hidden" name="service_id" value="'+esc(ap.service_id)+'"><input type="hidden" name="patient_id" value="'+esc(ap.patient_id)+'"><input type="hidden" name="day" value="'+esc(dayOf(ap.starts_at))+'">',
  function(v){var p=pick(v);if(!p.payer_kind)throw new Error('اختار طريقة الدفع');p.id=ap.id;if(p.payer_kind==='cash'&&!('discount_kind' in p)&&ap.discount_kind)p.discount_kind='';
   return c.command('set_payer',p,crypto.randomUUID()).then(function(r){return done(r,p);});},null,{ok:'حفظ'});
 if(!root)return true;var form=root.querySelector('form');enhance(form,{data:d,workspace:c.workspace,appointment:ap});withDiscount(form,c,ap,false);return true;}
/* arrived card ⋯ (service still «ordered») → order_payer */
function visitOrders(ap,d){var v=((d&&d.visits)||[]).find(function(x){return x.appointment_id===ap.id;});return v?((d.orders||[]).filter(function(o){return o.visit_id===v.id&&o.status==='ordered'&&!o.entitlement_id;})):[];}
function openForVisit(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 if(ap.discount_kind)throw new Error('الزيارة دي عليها خصم بالفعل — خصم واحد بس لكل زيارة');
 var orders=visitOrders(ap,d).filter(function(o){return !(+o.discount>0);});if(!orders.length)throw new Error('مفيش خدمة لسه متنفذتش على الزيارة دي — طريقة الدفع قبل التحصيل بس');
 var svcName=function(o){return (o.snapshot&&o.snapshot.name)||((d.services||[]).find(function(s){return s.id===o.service_id;})||{}).name||'خدمة';};
 var root=c.modal('طريقة الدفع / الخصم (قبل التحصيل)','<p class="rbd-note">'+esc(patientName(d,ap.patient_id))+'</p><label>الخدمة<select name="order_id" required>'+orders.map(function(o){return '<option value="'+esc(o.id)+'" data-svc="'+esc(o.service_id)+'">'+esc(svcName(o))+' — '+money(o.price*(o.quantity||1))+'</option>';}).join('')+'</select></label><input type="hidden" name="service_id" value="'+esc(orders[0].service_id)+'"><input type="hidden" name="patient_id" value="'+esc(ap.patient_id)+'"><input type="hidden" name="day" value="'+esc(dayOf(new Date().toISOString()))+'">',
  function(v){var p=pick(v);if(!p.payer_kind)throw new Error('اختار طريقة الدفع');if(p.payer_kind==='cash'&&!p.discount_kind)throw new Error('كاش من غير خصم مش محتاج حفظ — علّم «خصم» واختار نوعه، أو اقفل');p.order_id=v.order_id;
   return c.command('order_payer',p,crypto.randomUUID()).then(function(r){return done(r,p);});},null,{ok:'حفظ'});
 if(!root)return true;var form=root.querySelector('form'),sel=form.elements.order_id;
 sel.addEventListener('change',function(){form.elements.service_id.value=sel.options[sel.selectedIndex].getAttribute('data-svc');form.dispatchEvent(new Event('change'));});
 enhance(form,{data:d,workspace:c.workspace,appointment:ap,only:ap.payer_kind==='contract'?['contract']:null});withDiscount(form,c,ap,true);return true;}
/* ⋯ items appear only where the server accepts them */
function canBooking(ap){return !!ap&&ap.status==='booked'&&!ap.package_id;}
function canVisit(ap,d){return !!ap&&ap.status==='arrived'&&!ap.discount_kind&&visitOrders(ap,d).some(function(o){return !(+o.discount>0);});}
function label(ap){return ap&&ap.payer_kind==='contract'?'طريقة الدفع (تأمين / تعاقد)':'طريقة الدفع / الخصم';}
w.SSMPDReceptionPayer={enhance:enhance,decorate:decorate,openForBooking:openForBooking,openForVisit:openForVisit,canBooking:canBooking,canVisit:canVisit,label:label,pick:pick,UNION:UNION};
})(window);
