/* Owner 2026-11-19 (approved mockup docs/ui-references/mockups/home-visit-booking.html):
   home-visit address + location in the booking, permanent patient note (change/delete = request → manager approves) and a
   temporary note per booking; shown on the today board for whoever is on shift. Server: public.clinic_reception_patient_extras. */
(function(w){'use strict';
var F=['area','street','building','floor','apartment','landmark','directions','phone','maps_url'];
var L={area:'المنطقة / الحي',street:'الشارع',building:'رقم العمارة',floor:'الدور',apartment:'الشقة',landmark:'علامة مميزة جنب العمارة',directions:'إزاي توصل للشقة',phone:'رقم تليفون للوصول',maps_url:'لينك اللوكيشن (Google Maps)'};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function rpc(ws,a,p){return Promise.resolve(w.SSMPDDb.client.rpc('clinic_reception_patient_extras',{p_workspace:ws,p_action:a,p_payload:p||{}})).then(function(r){if(r.error)throw r.error;return r.data;});}
function short(a){a=a||{};return [a.area,a.street,a.building&&('عمارة '+a.building),a.floor&&('دور '+a.floor),a.apartment&&('شقة '+a.apartment)].filter(Boolean).join('، ')+(a.landmark?' · '+a.landmark:'');}
function mapsOk(u){return /^https:\/\/((w{3}\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)/i.test(String(u||''));}
function waPhone(p){var d=String(p||'').replace(/\D/g,'');if(/^01\d{9}$/.test(d))d='2'+d;return /^\d{10,15}$/.test(d)?d:'';}
function homeHtml(){return '<div class="rxe-home" data-rxe-home hidden data-wide><h5>🏠 عنوان الزيارة المنزلية <small>— بيتحفظ على ملف المريض ويتملا لوحده المرة الجاية</small></h5>'+
 F.map(function(k){return '<label class="rxe-'+k+'">'+esc(L[k])+(k==='area'||k==='building'?' *':'')+'<input name="x_'+k+'" '+(k==='maps_url'?'type="url" inputmode="url" placeholder="الصق اللينك اللي المريض بعته"':k==='phone'?'type="tel" inputmode="tel"':'type="text"')+' maxlength="300"></label>';}).join('')+
 '<div class="rxe-loc"><button type="button" class="btn" data-rxe-ask>📍 اطلب اللوكيشن على واتساب</button><a class="btn" data-rxe-go target="_blank" rel="noopener" aria-disabled="true">🧭 افتح الاتجاهات</a></div>'+
 '<p class="rxe-hint">«اطلب اللوكيشن» بيفتح واتساب برسالة جاهزة للمريض، وإنت اللي بتدوس إرسال. أول ما يبعته الصق اللينك هنا.</p></div>';}
function enhance(form,ctx){if(!form||form.querySelector('[data-rxe]'))return;var data=ctx.data,ws=ctx.workspace,ap=ctx.appointment||null;
 var cards=form.querySelectorAll('.rx-card');var c1=cards[0]||form,c2=cards[1]||form,c3=cards[2]||form;
 var mark=document.createElement('span');mark.setAttribute('data-rxe','');mark.hidden=true;form.appendChild(mark);
 // card 1: permanent note
 var nb=document.createElement('div');nb.setAttribute('data-rxe-note','');nb.setAttribute('data-wide','');c1.appendChild(nb);
 // card 2: home switch + address
 var sw=document.createElement('label');sw.className='rx-check rx-walkin rxe-switch';sw.setAttribute('data-wide','');sw.innerHTML='<input type="checkbox" name="x_home"> زيارة منزلية <small>(بتتفعّل لوحدها لو الخدمة منزلية)</small>';c2.appendChild(sw);
 c2.insertAdjacentHTML('beforeend',homeHtml());
 // card 3: temporary note
 var tn=document.createElement('label');tn.setAttribute('data-wide','');tn.className='rxe-tnote';tn.innerHTML='ملاحظة للحجز ده بس <small>(مؤقتة — بتظهر مع الميعاد ده وبس)</small><textarea name="x_appointment_note" rows="2" maxlength="500"></textarea>';c3.appendChild(tn);
 var home=form.querySelector('[data-rxe-home]'),cb=sw.querySelector('input'),go=home.querySelector('[data-rxe-go]'),maps=form.elements.x_maps_url;
 function sync(){home.hidden=!cb.checked;form.elements.x_area.required=cb.checked;form.elements.x_building.required=cb.checked;}
 function linkSync(){var ok=mapsOk(maps.value);if(ok)go.href=maps.value.trim();else go.removeAttribute('href');go.setAttribute('aria-disabled',ok?'false':'true');}
 cb.onchange=sync;maps.oninput=linkSync;
 function svcHome(){var s=(data.services||[]).find(function(x){return x.id===form.elements.service_id.value;});return !!(s&&s.is_home);}
 form.elements.service_id.addEventListener('change',function(){if(svcHome()&&!cb.checked){cb.checked=true;sync();}});
 home.querySelector('[data-rxe-ask]').onclick=function(){var p=(data.patients||[]).find(function(x){return x.id===form.elements.patient_id.value;})||{},num=waPhone(form.elements.x_phone.value)||waPhone(p.phone);
  if(!num){alert('مفيش رقم تليفون صحيح للمريض — اكتب «رقم تليفون للوصول» الأول');return;}
  var msg='أهلاً، معاك مركز عيادات سونو التخصصية بخصوص الزيارة المنزلية. ممكن تبعتلنا اللوكيشن (Location) على واتساب علشان نوصل بسهولة؟ وياريت رقم العمارة والدور والشقة وأي علامة مميزة. شكراً';
  w.open('https://wa.me/'+num+'?text='+encodeURIComponent(msg),'_blank','noopener');};
 var loadedFor=null,current=null;
 function paintNote(info){current=info;var n=info&&info.note;
  if(n){nb.className='rxe-band';nb.innerHTML='<b>📌 ملاحظة دائمة:</b><span>'+esc(n)+'<small>'+(info.note_by?'كتبها '+esc(info.note_by)+' · ':'')+'بتظهر في كل حجز للمريض ده لحد ما تتمسح</small>'+(info.pending?'<small class="rxe-pending">⏳ فيه طلب '+(info.pending.new_note?'تعديل':'مسح')+' مستني اعتماد المدير</small>':'')+'</span>'+(info.pending?'':'<button type="button" class="rxe-ed" data-rxe-req>طلب تعديل / مسح</button>');
   var bt=nb.querySelector('[data-rxe-req]');if(bt)bt.onclick=function(){requestModal(ws,form.elements.patient_id.value,n,function(){load(true);});};}
  else{nb.className='';nb.innerHTML='<label>ملاحظة دائمة للمريض <small>(اختياري — بتظهر في كل حجز، ومسحها بعد كده بيحتاج اعتماد المدير)</small><textarea name="x_note" rows="2" maxlength="500" placeholder="مثلاً: بيحب المواعيد بعد العصر · عليه باقي حساب معمل"></textarea></label>';}
  var a=(info&&info.address)||{};if(!ap||!form.elements.x_area.value)F.forEach(function(k){if(a[k]&&!form.elements['x_'+k].value)form.elements['x_'+k].value=a[k];});linkSync();}
 function load(force){var pid=form.elements.patient_id.value;if(!pid){paintNote(null);return;}if(pid===loadedFor&&!force)return;loadedFor=pid;
  rpc(ws,'get',{patient_id:pid}).then(function(r){if(form.elements.patient_id.value===pid)paintNote(r);}).catch(function(){paintNote(null);});}
 form.elements.patient_id.addEventListener('change',function(){load(false);});load(false);
 if(ap)rpc(ws,'board',{ids:[ap.id]}).then(function(r){var x=r&&r.extras&&r.extras[ap.id];if(!x)return;if(x.home){cb.checked=true;F.forEach(function(k){if(x.address&&x.address[k])form.elements['x_'+k].value=x.address[k];});}if(x.note)form.elements.x_appointment_note.value=x.note;sync();linkSync();}).catch(function(){});
 if(svcHome())cb.checked=true;sync();linkSync();}
/* split the booking payload: x_* fields stay out of the booking command */
function take(payload){var x={};Object.keys(payload).forEach(function(k){if(k.indexOf('x_')===0){x[k.slice(2)]=payload[k];delete payload[k];}});return x;}
function after(ws,result,x,patientId){var id=result&&(result.id||result.appointment_id);var home=x.home==='on'||x.home===true;
 if(home&&x.maps_url&&!mapsOk(x.maps_url))return Promise.reject(Error('لينك اللوكيشن لازم يكون لينك خرائط جوجل'));
 if(!home&&!x.note&&!x.appointment_note&&!id)return Promise.resolve(result);
 var addr={};F.forEach(function(k){if(x[k])addr[k]=x[k];});
 return rpc(ws,'save_booking',{patient_id:patientId,appointment_id:id||null,home:home,address:addr,note:x.note||'',appointment_note:x.appointment_note||''}).then(function(){return result;},function(e){alert('الحجز اتسجل، بس بيانات العنوان/الملاحظات ما اتحفظتش: '+(e&&e.message||e)+'\nافتح «تعديل الحجز» وجرّب تاني.');return result;});}
function requestModal(ws,pid,old,done){var m=document.createElement('div');m.className='modal-backdrop rx-modal';m.innerHTML='<section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h3>طلب تعديل / مسح الملاحظة الدائمة</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></header><form class="rx-form"><p class="rx-guide-tip" data-wide>الملاحظة مش بتتغيّر غير لما مدير الاستقبال يعتمد الطلب.</p><label data-wide>الملاحظة الحالية<textarea rows="2" disabled>'+esc(old)+'</textarea></label><label data-wide>الملاحظة الجديدة <small>(سيبها فاضية لو عايز تمسحها)</small><textarea name="note" rows="2" maxlength="500">'+esc(old)+'</textarea></label><label data-wide>السبب *<input name="reason" required maxlength="300" placeholder="مثلاً: الحساب اتدفع"></label><p role="status" data-st></p><footer><button class="btn btn-primary" type="submit">إرسال الطلب</button><button class="btn" type="button" data-x>إلغاء</button></footer></form></section>';
 document.body.appendChild(m);var f=m.querySelector('form'),close=function(){m.remove();};m.querySelector('.modal-close').onclick=close;m.querySelector('[data-x]').onclick=close;
 f.onsubmit=function(e){e.preventDefault();rpc(ws,'note_change_request',{patient_id:pid,note:f.elements.note.value,reason:f.elements.reason.value}).then(function(){close();if(w.SSMPDToast)w.SSMPDToast.show('اتبعت الطلب لمدير الاستقبال');if(done)done();},function(err){m.querySelector('[data-st]').textContent=err&&err.message||'تعذر الإرسال';});};}
function reviewModal(ws,list,done){var m=document.createElement('div');m.className='modal-backdrop rx-modal';m.innerHTML='<section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h3>طلبات تعديل الملاحظات الدائمة</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></header><div class="rxe-reqs">'+list.map(function(q){return '<article class="rxe-req" data-id="'+esc(q.id)+'"><h4>'+esc(q.file_no)+' — '+esc(q.patient)+'</h4><p><b>الحالية:</b> '+esc(q.old_note)+'</p><p><b>'+(q.new_note?'المطلوب:':'المطلوب: مسح الملاحظة')+'</b> '+esc(q.new_note||'')+'</p><p><b>السبب:</b> '+esc(q.reason)+' — '+esc(q.requested_by)+'</p><div class="rx-actions"><button type="button" class="btn btn-primary" data-ok>اعتماد</button><button type="button" class="btn" data-no>رفض</button></div></article>';}).join('')+'</div></section>';
 document.body.appendChild(m);m.querySelector('.modal-close').onclick=function(){m.remove();if(done)done();};
 m.querySelectorAll('.rxe-req').forEach(function(card){function go(ok){rpc(ws,'note_review',{id:card.dataset.id,approve:ok}).then(function(){card.remove();if(!m.querySelector('.rxe-req')){m.remove();if(done)done();}},function(e){alert(e&&e.message||'تعذر');});}card.querySelector('[data-ok]').onclick=function(){go(true);};card.querySelector('[data-no]').onclick=function(){go(false);};});}
/* today board: 🏠 / 📌 marks on the chip, details + directions inside the card, and the manager's pending requests */
function decorate(host,ws,apps){if(!host||!ws||!w.SSMPDDb||!w.SSMPDDb.client)return;var ids=(apps||[]).map(function(a){return a.id;}).filter(Boolean).slice(0,500);if(!ids.length)return;
 rpc(ws,'board',{ids:ids}).then(function(r){var ex=(r&&r.extras)||{};Object.keys(ex).forEach(function(id){var x=ex[id],card=host.querySelector('[data-appointment="'+(w.CSS&&CSS.escape?CSS.escape(id):id)+'"]');if(!card||card.querySelector('[data-rxe-marks]'))return;
   var chip=card.querySelector('.journey-chip');if(chip)chip.insertAdjacentHTML('beforeend','<span data-rxe-marks>'+(x.home?'<span class="rxe-tag rxe-tag-home" title="زيارة منزلية">🏠</span>':'')+(x.note||x.patient_note?'<span class="rxe-tag rxe-tag-note" title="ملاحظة">📌</span>':'')+'</span>');
   var det=card.querySelector('.journey-card-detail');if(!det)return;var a=x.address||{};
   det.insertAdjacentHTML('afterbegin','<div class="rxe-board">'+(x.home?'<p class="rxe-addr">🏠 <b>زيارة منزلية:</b> '+esc(short(a))+(a.directions?'<br><small>'+esc(a.directions)+'</small>':'')+(a.phone?'<br><small>تليفون الوصول: <bdi>'+esc(a.phone)+'</bdi></small>':'')+'</p>'+(mapsOk(a.maps_url)?'<a class="btn" target="_blank" rel="noopener" href="'+esc(a.maps_url)+'">🧭 الاتجاهات</a>':''):'')+
    (x.patient_note?'<p class="rxe-pn">📌 '+esc(x.patient_note)+'</p>':'')+(x.note?'<p class="rxe-tn">📝 '+esc(x.note)+'</p>':'')+'</div>');});}).catch(function(){});
 rpc(ws,'note_requests',{}).then(function(list){if(!list||!list.length||host.querySelector('[data-rxe-reqs]'))return;var b=document.createElement('button');b.type='button';b.className='btn rxe-reqs-btn';b.setAttribute('data-rxe-reqs','');b.textContent='طلبات تعديل الملاحظات ('+list.length+')';host.prepend(b);b.onclick=function(){reviewModal(ws,list,function(){b.remove();});};}).catch(function(){});}
function servicesModal(ws){rpc(ws,'services',{}).then(function(list){var m=document.createElement('div');m.className='modal-backdrop rx-modal';
 m.innerHTML='<section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h3>الخدمات المنزلية</h3><button type="button" class="modal-close" aria-label="إغلاق">×</button></header><div class="rxe-svcs"><p class="rx-guide-tip">علّم الخدمات اللي بتتعمل في بيت المريض. لما تتحجز، «زيارة منزلية» بتتفعّل لوحدها ويظهر عنوان الزيارة.</p>'+
  (list||[]).map(function(s){return '<label class="rx-check rx-walkin"><input type="checkbox" data-id="'+esc(s.id)+'"'+(s.is_home?' checked':'')+'> '+esc(s.name)+' <small>— '+esc(s.department||'')+'</small></label>';}).join('')+'</div></section>';
 document.body.appendChild(m);m.querySelector('.modal-close').onclick=function(){m.remove();};
 m.querySelectorAll('input[data-id]').forEach(function(i){i.onchange=function(){i.disabled=true;rpc(ws,'service_home',{service_id:i.dataset.id,is_home:i.checked}).then(function(){i.disabled=false;},function(e){i.checked=!i.checked;i.disabled=false;alert(e&&e.message||'تعذر الحفظ');});};});},function(e){alert(e&&e.message||'تعذر فتح الخدمات');});}
document.addEventListener('click',function(e){var b=e.target&&e.target.closest&&e.target.closest('[data-rxe-home-services]');if(b)servicesModal(b.getAttribute('data-ws'));});
w.SSMPDReceptionExtras={servicesModal:servicesModal,enhance:enhance,take:take,after:after,decorate:decorate,_t:{short:short,mapsOk:mapsOk,waPhone:waPhone}};
})(window);
