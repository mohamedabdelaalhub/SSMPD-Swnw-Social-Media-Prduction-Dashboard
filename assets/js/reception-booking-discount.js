/* Owner 2026-11-21 (mockup docs/ui-references/mockups/booking-discount.html «موافق»): optional «خصم» on a new booking.
   «خصم نقابة / نادي»: الجهة نقابة / نادي / أخرى + name, card number, card valid-until and a card photo — all required.
   «خصم خاص»: a reason. Fields ride the booking payload as discount_*; the photo is uploaded first to the private bucket
   'booking-discount-cards' (path <auth uid>/<workspace>/<random>) and only its path is sent. The server
   (clinic_reception_command, 20261121180000) validates, applies it at arrival (maximum 30%) and
   refuses any other discount on that visit. Hook: SSMPDReceptionBookingDiscount.enhance(form, {data, workspace}). */
(function(w){'use strict';
var MAX=30,KMAX={syndicate:30,special:30,vezeeta:40,family:50},REL=[['spouse','زوج / زوجة'],['child','ابن / بنت'],['parent','أب / أم'],['sibling','أخ / أخت']];   /* owner «خليه ٣٠٪» — the maximum; server: clinic_reception.booking_discount_max() */
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م';}
function chips(name,opts,val){return '<div class="rbd-chips" role="radiogroup">'+opts.map(function(o){return '<label class="rbd-chip"><input type="radio" name="'+name+'" value="'+o[0]+'"'+(o[0]===val?' checked':'')+'><span>'+esc(o[1])+'</span></label>';}).join('')+'</div>';}
var ORG_LABEL={syndicate:'اسم النقابة',club:'اسم النادي',other:'اسم الجهة'};
function preview(price,pct){price=+price||0;pct=+pct||0;if(!(price>0)||!(pct>0)||pct>100)return null;var off=Math.round(price*pct)/100;return {price:price,off:off,net:Math.round((price-off)*100)/100};}
function uploadCard(ws,file){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c||!c.storage)return Promise.reject(new Error('تعذر الاتصال'));
 return Promise.resolve(c.auth.getUser()).then(function(r){var u=r&&r.data&&r.data.user;if(!u)throw new Error('سجّل دخولك تاني');
  var ext=(String(file.name||'').split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,5)||'jpg',
      rnd=(w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2),
      path=u.id+'/'+ws+'/'+rnd+'.'+ext;
  return Promise.resolve(c.storage.from('booking-discount-cards').upload(path,file,{upsert:false,contentType:file.type||undefined})).then(function(x){if(x&&x.error)throw x.error;return path;});});}
function enhance(form,ctx){if(!form||form.querySelector('[data-rbd]')||!form.elements.service_id)return;
 var data=(ctx&&ctx.data)||{},ws=ctx&&ctx.workspace;
 var box=document.createElement('section');box.className='rbd';box.setAttribute('data-rbd','');box.setAttribute('data-wide','');
 var payer=!!form.querySelector('[data-rpk]');
 box.innerHTML='<label class="rbd-sw"><input type="checkbox" data-rbd-on><span>'+(payer?'خصم إضافي (فيزيتا شامل / كارت العيلة / خاص)':'خصم (نقابة / نادي / فيزيتا / كارت العيلة / خاص)')+' <small>(اختياري)</small></span></label>'+(ctx&&ctx.appointment&&!ctx.order?'<input type="hidden" name="discount_kind" value="" data-rbd-clear disabled>':'')+
  '<fieldset class="rbd-body" data-rbd-body hidden disabled>'+
   '<div class="rbd-row"><span class="rbd-l">نوع الخصم</span>'+chips('discount_kind',(payer?[]:[['syndicate','خصم نقابة / نادي']]).concat([['vezeeta','فيزيتا شامل'],['family','كارت العيلة'],['special','خصم خاص']]),payer?'vezeeta':'syndicate')+'</div>'+
   '<div data-rbd-syn>'+
    '<div class="rbd-row" data-rbd-org><span class="rbd-l">الجهة</span>'+chips('discount_org_type',[['syndicate','نقابة'],['club','نادي'],['other','أخرى']],'syndicate')+'</div>'+
    '<label class="rbd-row" data-rbd-orgn><span class="rbd-l" data-rbd-orgl>اسم النقابة</span><input name="discount_org_name" maxlength="120" required placeholder="مثلاً نقابة المهندسين"></label>'+
    '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l" data-rbd-cardl>رقم الكارنيه</span><input name="discount_card_no" maxlength="60" required inputmode="numeric" dir="ltr"></label>'+
    '<label class="rbd-row"><span class="rbd-l" data-rbd-expl>الكارنيه ساري لحد</span><input name="discount_card_expiry" type="date" required></label></div>'+
    '<div class="rbd-row"><span class="rbd-l" data-rbd-filel>صورة الكارنيه</span><input type="file" accept="image/*,application/pdf" capture="environment" data-rbd-file><input type="hidden" name="discount_card_path" required><small class="rbd-up" data-rbd-up role="status"></small></div>'+
   '</div>'+
   '<div class="rbd-fam" data-rbd-fam hidden></div>'+
   '<label class="rbd-row" data-rbd-reason hidden><span class="rbd-l">سبب الخصم</span><input name="discount_reason" maxlength="300" placeholder="مثلاً قريب موظف"></label>'+
   '<label class="rbd-row rbd-pct"><span class="rbd-l">نسبة الخصم</span><span class="rbd-pctin"><input name="discount_percent" type="number" min="1" max="'+MAX+'" step="0.5" inputmode="decimal" required dir="ltr"> ٪</span></label>'+
   '<div class="rbd-sum" data-rbd-sum hidden></div><p class="rbd-warn" data-rbd-warn hidden></p>'+
   '<p class="rbd-note" data-rbd-note></p>'+
  '</fieldset>';
 var anchor=form.querySelector('.rbp-cont')||form.querySelector('[data-rbp]')||form.querySelector('.rx-combo-field');
 if(anchor&&anchor.parentNode)anchor.after(box);else form.appendChild(box);
 var on=box.querySelector('[data-rbd-on]'),body=box.querySelector('[data-rbd-body]'),syn=box.querySelector('[data-rbd-syn]'),reason=box.querySelector('[data-rbd-reason]'),
     pct=form.elements.discount_percent,sum=box.querySelector('[data-rbd-sum]'),warn=box.querySelector('[data-rbd-warn]'),file=box.querySelector('[data-rbd-file]'),up=box.querySelector('[data-rbd-up]'),
     orgl=box.querySelector('[data-rbd-orgl]'),exp=form.elements.discount_card_expiry,path=form.elements.discount_card_path;
 function val(n){var r=box.querySelector('input[name="'+n+'"]:checked');return r?r.value:'';}
 function pkg(){return !!(form.elements.package_id&&form.elements.package_id.value);}
 function svc(){return (data.services||[]).find(function(s){return s.id===form.elements.service_id.value;});}
 var famBox=box.querySelector('[data-rbd-fam]'),note=box.querySelector('[data-rbd-note]'),famFor='',famData=null;
 function rpc(a,p){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc('clinic_reception_family',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
 function patientId(){return form.elements.patient_id&&form.elements.patient_id.value||'';}
 function loadFam(force){var pid=patientId();if(!pid){famData=null;famFor='';drawFam();return;}if(!force&&famFor===pid)return;famFor=pid;famData=null;famBox.innerHTML='<p class="rbd-note">جاري حساب خصم العيلة…</p>';
  rpc('list',{patient_id:pid}).then(function(d){if(famFor!==pid)return;famData=d;drawFam();paint();}).catch(function(e){famBox.innerHTML='<p class="rbd-warn">'+esc((e&&e.message)||'تعذر تحميل العيلة')+'</p>';});}
 function relName(k){var r=REL.find(function(x){return x[0]===k;});return r?r[1]:'';}
 function drawFam(){if(!famData){if(!patientId())famBox.innerHTML='<p class="rbd-note">اختار المريض الأول.</p>';return;}var d=famData,step=d.visit_no||1;
  famBox.innerHTML='<div class="rbd-famhead">'+(d.members.length?'العيلة: '+(d.members.length+1)+' ملفات':'المريض لوحده (صاحب الكارت)')+' — الزيارة دي رقم <b>'+step+'</b> بخصم كارت العيلة</div>'+
   '<div class="rbd-steps">'+[10,20,30,40,50].map(function(v,i){return '<span class="rbd-st'+(i+1<step?' done':i+1===step?' now':'')+'">'+v+'٪</span>';}).join('')+'</div>'+
   (d.members.length?'<ul class="rbd-list">'+d.members.map(function(m){return '<li>'+esc(m.name)+(m.via==='link'?' — '+esc(relName(m.relation))+' — مستند ✓':' — نفس رقم التليفون')+'</li>';}).join('')+'</ul>':'')+
   (d.visits.length?'<ul class="rbd-list rbd-muted">'+d.visits.slice(-4).map(function(v){return '<li>'+esc(v.day)+' — '+esc(v.name)+' — '+esc(+v.percent)+'٪</li>';}).join('')+'</ul>':'')+
   (d.linked?'<p class="rbd-ok">✓ المريض مربوط بالعيلة ومستند القرابة متسجّل.</p>':'<p class="rbd-note">لو المريض قريب لحد عنده كارت العيلة: اربطه الأول.</p>')+
   '<button type="button" class="btn" data-rbd-link>+ اربطه بقريب</button><div class="rbd-linkbox" data-rbd-linkbox hidden></div>';
  famBox.querySelector('[data-rbd-link]').onclick=openLink;}
 function openLink(){var lb=famBox.querySelector('[data-rbd-linkbox]'),pid=patientId();lb.hidden=false;
  lb.innerHTML='<label class="rbd-row"><span class="rbd-l">القريب</span><select data-rbd-rel-p><option value="">اختار الملف</option>'+(data.patients||[]).filter(function(p){return p.id!==pid;}).map(function(p){return '<option value="'+esc(p.id)+'">'+esc((p.file_no?p.file_no+' — ':'')+p.name+(p.phone?' — '+p.phone:''))+'</option>';}).join('')+'</select></label>'+
   '<div class="rbd-row"><span class="rbd-l">صلة القرابة</span>'+chips('rbd_relation',REL,'spouse')+'</div>'+
   '<div class="rbd-row"><span class="rbd-l">مستند إثبات القرابة (إجباري)</span><input type="file" accept="image/*,application/pdf" capture="environment" data-rbd-rel-f><small class="rbd-up" data-rbd-rel-up role="status"></small></div>'+
   '<button type="button" class="btn btn-primary" data-rbd-rel-go>اربط</button>';
  ['[data-rbd-rel-p]','[data-rbd-rel-f]'].forEach(function(q){var el=lb.querySelector(q);if(el){el.name='';}});
  lb.querySelectorAll('input[name="rbd_relation"]').forEach(function(r){r.removeAttribute('required');});
  var proof='',f=lb.querySelector('[data-rbd-rel-f]'),upl=lb.querySelector('[data-rbd-rel-up]');
  f.addEventListener('change',function(e){e.stopPropagation();var x=f.files&&f.files[0];proof='';if(!x)return;if(x.size>8*1024*1024){upl.textContent='الملف أكبر من ٨ ميجا';f.value='';return;}upl.textContent='جاري الرفع…';uploadCard(ws,x).then(function(p){proof=p;upl.textContent='اترفع ✓';}).catch(function(err){upl.textContent='الرفع ما نجحش: '+((err&&err.message)||'حاول تاني');f.value='';});});
  lb.querySelector('[data-rbd-rel-go]').onclick=function(){var rid=lb.querySelector('[data-rbd-rel-p]').value,rel=(lb.querySelector('input[name="rbd_relation"]:checked')||{}).value;
   if(!rid){upl.textContent='اختار القريب';return;}if(!proof){upl.textContent='ارفع مستند إثبات القرابة';return;}var bt=this;bt.disabled=true;
   rpc('link',{patient_id:pid,relative_id:rid,relation:rel,proof_path:proof}).then(function(){loadFam(true);}).catch(function(err){bt.disabled=false;upl.textContent=(err&&err.message)||'تعذر الربط';});};}
 function paint(){var pk=form.getAttribute('data-payer'),p=pkg()||(payer&&pk!=='cash');box.hidden=p;if(p&&on.checked)on.checked=false;body.hidden=!on.checked;body.disabled=!on.checked;
  var kind=val('discount_kind')||(payer?'vezeeta':'syndicate'),isSyn=kind==='syndicate',isVz=kind==='vezeeta',isFam=kind==='family',card=isSyn||isVz,mx=KMAX[kind]||MAX;
  syn.hidden=!card;reason.hidden=kind!=='special';famBox.hidden=!isFam;
  Array.prototype.forEach.call(syn.querySelectorAll('input'),function(i){i.disabled=!on.checked||!card;});
  ['[data-rbd-org]','[data-rbd-orgn]'].forEach(function(q){var el=box.querySelector(q);el.hidden=!isSyn;el.querySelectorAll('input').forEach(function(i){i.disabled=!on.checked||!isSyn;});});
  box.querySelector('[data-rbd-cardl]').textContent=isVz?'رقم كارت فيزيتا شامل':'رقم الكارنيه';
  box.querySelector('[data-rbd-expl]').textContent=isVz?'الكارت ساري لحد':'الكارنيه ساري لحد';
  box.querySelector('[data-rbd-filel]').textContent=isVz?'صورة الكارت':'صورة الكارنيه';
  var ri=reason.querySelector('input');ri.disabled=!on.checked||kind!=='special';ri.required=kind==='special';
  pct.max=String(mx);pct.readOnly=isVz||isFam;
  if(isVz)pct.value='40';else if(isFam){if(on.checked)loadFam(false);pct.value=famData?String(famData.next_percent):'';}
  orgl.textContent=ORG_LABEL[val('discount_org_type')]||'اسم الجهة';
  var day=form.elements.day&&form.elements.day.value;if(day)exp.min=day;
  var s=svc(),q=Math.max(1,+(form.elements.quantity&&form.elements.quantity.value)||1),pr=preview(s&&s.price*q,pct.value);
  sum.hidden=!(on.checked&&pr);if(pr){var who=isSyn?(form.elements.discount_org_name.value.trim()||''):isVz?'فيزيتا شامل':isFam?'كارت العيلة'+(famData?' — الزيارة '+famData.visit_no:''):'خصم خاص';
   sum.innerHTML='<span>السعر</span><s>'+money(pr.price)+'</s><span>الخصم ('+esc(+pct.value)+'٪'+(who?' — '+esc(who):'')+')</span><span>− '+money(pr.off)+'</span><span>المريض يدفع</span><b>'+money(pr.net)+'</b>';}
  note.textContent=isVz?'نسبة فيزيتا شامل ثابتة ٤٠٪، بتتطبّق لما المريض يوصل. مفيش خصم تاني على نفس الزيارة.':isFam?'السيستم بيحسب النسبة: ١٠٪ أول زيارة وتزيد ١٠٪ كل زيارة للمريض أو أي حد من عيلته لحد ٥٠٪، وبعدها ترجع ١٠٪. بتتحسب لما المريض يوصل.':'الخصم بيتطبّق على الخدمة لما المريض يوصل. أقصى خصم ٣٠٪. الحجز اللي عليه الخصم ده مايتعملوش أي خصم تاني ولا سعر تعاقد.';
  var big=on.checked&&!isVz&&!isFam&&+pct.value>mx;warn.hidden=!big;if(big)warn.textContent='أقصى خصم على الحجز ٣٠٪ — قلّل النسبة.';if(clear)syncClear();}
 if(form.elements.patient_id)form.elements.patient_id.addEventListener('change',function(){famFor='';if(val('discount_kind')==='family'&&on.checked)loadFam(true);});
 file.addEventListener('change',function(){var f=file.files&&file.files[0];path.value='';if(!f)return;if(f.size>8*1024*1024){up.textContent='الصورة أكبر من ٨ ميجا — صوّرها تاني';file.value='';return;}
  up.textContent='جاري رفع الصورة…';uploadCard(ws,f).then(function(p){path.value=p;up.textContent='اترفعت ✓';}).catch(function(e){up.textContent='الرفع ما نجحش: '+((e&&e.message)||'حاول تاني');file.value='';});});
 path.addEventListener('invalid',function(){up.textContent='ارفع صورة الكارنيه';});
 /* owner 2026-11-23 (20261123060000): editing a booking shows its discount; unticking it sends discount_kind '' (clears it) */
 var ap=ctx&&ctx.appointment,clear=box.querySelector('[data-rbd-clear]');
 if(ap&&ap.discount_kind&&!(payer&&ap.discount_kind==='syndicate')){on.checked=true;var setR=function(n,v){var x=box.querySelector('input[name="'+n+'"][value="'+v+'"]');if(x)x.checked=true;};setR('discount_kind',ap.discount_kind);if(ap.discount_org_type)setR('discount_org_type',ap.discount_org_type);
  [['discount_org_name',ap.discount_org_name],['discount_card_no',ap.discount_card_no],['discount_card_expiry',ap.discount_card_expiry],['discount_card_path',ap.discount_card_path],['discount_reason',ap.discount_reason],['discount_percent',ap.discount_percent!=null?String(+ap.discount_percent):'']].forEach(function(x){var el=form.elements[x[0]];if(el&&x[1]!=null&&el.type!=='radio')el.value=x[1];});
  if(ap.discount_card_path)up.textContent='صورة الكارت متسجّلة ✓ (ارفع تاني لو اتغيّرت)';}
 /* «مصدر الحجز: نقابة / نادي» is only where the booking came from — the price changes from the discount box */
 var src=form.elements.source,srcHint=null;if(src&&src.closest){srcHint=document.createElement('small');srcHint.className='rbd-srchint';srcHint.setAttribute('data-rbd-srchint','');srcHint.textContent=payer?'ده مصدر الحجز بس — خصم النقابة / النادي من «طريقة الدفع» فوق':'ده مصدر الحجز بس — الخصم من خانة «خصم» تحت';srcHint.hidden=true;(src.closest('label')||src).after(srcHint);
  var hint=function(){srcHint.hidden=!(src.value==='syndicate'||src.value==='club');};src.addEventListener('change',hint);hint();}
 function syncClear(){if(clear)clear.disabled=on.checked||!(ap&&ap.discount_kind);}
 form.addEventListener('input',paint);form.addEventListener('change',paint);on.addEventListener('change',function(){paint();syncClear();});paint();syncClear();}
/* «⋯ ← خصم» on a booked card (booking_discount) and on an arrived card while the service is still «ordered» (order_discount).
   c = the reception context {data, workspace, modal, command}. */
function dayOf(iso){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));}catch(_){return '';}}
function openForBooking(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 if(ap.status!=='booked')throw new Error('الخصم على الحجز قبل الوصول بس — بعد الوصول استخدم «خصم على الزيارة»');
 if(ap.package_id)throw new Error('حجز الباكج بسعره المتعاقد عليه — مينفعش عليه خصم');
 var root=c.modal(ap.discount_kind?'تعديل / شيل الخصم':'خصم على الحجز','<input type="hidden" name="service_id" value="'+esc(ap.service_id)+'"><input type="hidden" name="patient_id" value="'+esc(ap.patient_id)+'"><input type="hidden" name="day" value="'+esc(dayOf(ap.starts_at))+'"><p class="rbd-note">'+esc((d.patients||[]).filter(function(p){return p.id===ap.patient_id;}).map(function(p){return p.name;})[0]||'')+'</p>',
  function(v){var p={id:ap.id};Object.keys(v).forEach(function(k){if(/^discount_/.test(k))p[k]=v[k];});if(!('discount_kind' in p)){if(!ap.discount_kind)throw new Error('علّم «خصم» واختار نوعه');p.discount_kind='';}
   return c.command('booking_discount',p,crypto.randomUUID()).then(function(r){if(w.SSMPDToast)w.SSMPDToast.show(p.discount_kind?'اتسجّل الخصم على الحجز ✓ — بيتطبّق لما المريض يوصل':'اتشال الخصم من الحجز');return r;});},null,{ok:'حفظ الخصم'});
 if(!root)return true;var form=root.querySelector('form');enhance(form,{data:d,workspace:c.workspace,appointment:ap});
 var on=form.querySelector('[data-rbd-on]');if(!ap.discount_kind&&on){on.checked=true;on.dispatchEvent(new Event('change',{bubbles:true}));}return true;}
function openForVisit(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 var visit=(d.visits||[]).find(function(v){return v.appointment_id===ap.id;});
 var orders=visit?(d.orders||[]).filter(function(o){return o.visit_id===visit.id&&o.status==='ordered'&&!o.entitlement_id&&!(+o.discount>0);}):[];
 if(ap.discount_kind)throw new Error('الزيارة دي عليها خصم بالفعل — خصم واحد بس لكل زيارة');
 if(!orders.length)throw new Error('مفيش خدمة لسه متنفذتش على الزيارة دي — الخصم قبل التحصيل بس');
 var svcName=function(o){return (o.snapshot&&o.snapshot.name)||((d.services||[]).find(function(s){return s.id===o.service_id;})||{}).name||'خدمة';};
 var root=c.modal('خصم على الزيارة (قبل التحصيل)','<label>الخدمة<select name="order_id" required>'+orders.map(function(o){return '<option value="'+esc(o.id)+'" data-svc="'+esc(o.service_id)+'">'+esc(svcName(o))+' — '+money(o.price*(o.quantity||1))+'</option>';}).join('')+'</select></label><input type="hidden" name="service_id" value="'+esc(orders[0].service_id)+'"><input type="hidden" name="patient_id" value="'+esc(ap.patient_id)+'"><input type="hidden" name="day" value="'+esc(dayOf(new Date().toISOString()))+'">',
  function(v){if(!v.discount_kind)throw new Error('علّم «خصم» واختار نوعه');var p={order_id:v.order_id};Object.keys(v).forEach(function(k){if(/^discount_/.test(k))p[k]=v[k];});
   return c.command('order_discount',p,crypto.randomUUID()).then(function(r){if(w.SSMPDToast)w.SSMPDToast.show('اتسجّل الخصم ✓ — المريض يدفع '+money(r&&r.net));return r;});},null,{ok:'حفظ الخصم'});
 if(!root)return true;var form=root.querySelector('form'),sel=form.elements.order_id;sel.addEventListener('change',function(){form.elements.service_id.value=sel.options[sel.selectedIndex].getAttribute('data-svc');form.dispatchEvent(new Event('change'));});
 enhance(form,{data:d,workspace:c.workspace,appointment:ap,order:true});var on=form.querySelector('[data-rbd-on]');if(on){on.checked=true;on.dispatchEvent(new Event('change',{bubbles:true}));}return true;}
/* which ⋯ item a card gets (shown only when the server would accept it) */
function canBooking(ap){return !!ap&&ap.status==='booked'&&!ap.package_id;}
function canVisit(ap,d){if(!ap||ap.discount_kind||(ap.status!=='arrived'))return false;var v=((d&&d.visits)||[]).find(function(x){return x.appointment_id===ap.id;});return !!v&&((d.orders||[]).some(function(o){return o.visit_id===v.id&&o.status==='ordered'&&!o.entitlement_id&&!(+o.discount>0);}));}
/* owner case 2026-11-23 (20261123130000): «نفس خصم الزيارة» — the visit's approved discount on every other ordered service */
function sameInfo(ap,d){if(!ap||ap.status!=='arrived')return null;var v=((d&&d.visits)||[]).find(function(x){return x.appointment_id===ap.id;});if(!v)return null;
 var ords=(d.orders||[]).filter(function(o){return o.visit_id===v.id&&o.status!=='cancelled';}),ids=ords.map(function(o){return o.id;}),reqs=(d.discounts||[]);
 var appr=reqs.filter(function(r){return ids.indexOf(r.order_id)>=0&&r.status==='approved'&&+r.percent>0;}).sort(function(a,b){return b.percent-a.percent;})[0];if(!appr)return null;
 var todo=ords.filter(function(o){return o.status==='ordered'&&!o.entitlement_id&&!(+o.discount>0)&&!reqs.some(function(r){return r.order_id===o.id&&(r.status==='pending'||r.status==='approved');});});
 return todo.length?{visit_id:v.id,percent:+appr.percent,count:todo.length}:null;}
function canSame(ap,d){return !!sameInfo(ap,d);}
function sameLabel(ap,d){var i=sameInfo(ap,d);return i?'نفس خصم الزيارة ('+i.percent+'٪) على باقي الخدمات':'';}
function applySame(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;}),i=sameInfo(ap,d);if(!i)throw new Error('مفيش خدمات محتاجة نفس الخصم');
 return c.command('visit_same_discount',{visit_id:i.visit_id},crypto.randomUUID()).then(function(r){if(w.SSMPDToast)w.SSMPDToast.show('اتطبّق نفس خصم الزيارة '+(r&&r.percent)+'٪ على '+(r&&r.services)+' خدمة ✓');if(c.load)c.load();return r;});}
w.SSMPDReceptionBookingDiscount={canSame:canSame,sameLabel:sameLabel,applySame:applySame,enhance:enhance,preview:preview,MAX:MAX,openForBooking:openForBooking,openForVisit:openForVisit,canBooking:canBooking,canVisit:canVisit};
})(window);
