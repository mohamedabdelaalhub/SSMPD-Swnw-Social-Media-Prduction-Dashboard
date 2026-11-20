/* Owner 2026-11-20 (reception request; mockup docs/ui-references/mockups/booking-qty-continuation-noanswer.html approved):
   «العدد» next to the service (e.g. 3 crowns → 3 on the bill) and «جلسة استكمال» linked to an earlier paid session of the
   same service (no new bill). Fields ride the booking payload as quantity / continuation_of; the server
   (clinic_reception_command, 20261120200000) validates them. The «لم يرد» button lives on the timeline card. */
(function(w){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})+' جم';}
function day(t){try{return new Date(t).toLocaleDateString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'long'});}catch(_){return '';}}
function times(n){n=+n||0;return n===1?'مرة':n===2?'مرتين':n+' مرات';}
function candidates(ws,patient,service){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.resolve([]);
 return Promise.resolve(c.rpc('clinic_reception_continuation_candidates',{p_workspace:ws,p_patient:patient,p_service:service})).then(function(r){if(r.error)throw r.error;return r.data||[];});}
function enhance(form,ctx){if(!form||form.querySelector('[data-rbp]'))return;var field=form.querySelector('.rx-combo-field');if(!field||!form.elements.service_id)return;
 var data=ctx.data||{},ap=ctx.appointment||null,live=ctx.mode!=='trial';
 var row=document.createElement('div');row.className='rbp-row';row.setAttribute('data-rbp','');row.setAttribute('data-wide','');field.parentNode.insertBefore(row,field);row.appendChild(field);
 var q=document.createElement('div');q.className='rbp-qty';q.innerHTML='<label for="rbp-q">عدد الخدمة</label><div class="rbp-step"><button type="button" data-rbp-step="1" aria-label="زوّد العدد">+</button><input id="rbp-q" name="quantity" type="number" inputmode="numeric" min="1" max="99" step="1" value="'+(ap&&ap.quantity>1?+ap.quantity:1)+'" required><button type="button" data-rbp-step="-1" aria-label="قلّل العدد">−</button></div>';row.appendChild(q);
 var total=document.createElement('p');total.className='rbp-total';total.setAttribute('data-wide','');total.setAttribute('role','status');total.hidden=true;row.after(total);
 var box=document.createElement('div');box.className='rbp-cont';box.setAttribute('data-wide','');
 box.innerHTML='<label class="rx-check rx-walkin"><input type="checkbox" data-rbp-cont> جلسة استكمال لعلاج اتعمل قبل كده <small>(بتحجز وقت الدكتور من غير فاتورة جديدة — الخدمة اتحاسب عليها في الجلسة الأولى)</small></label><input type="hidden" name="continuation_of" value=""><div class="rbp-pick" data-rbp-pick hidden></div>';
 total.after(box);
 var input=q.querySelector('input'),cb=box.querySelector('[data-rbp-cont]'),hid=form.elements.continuation_of,pick=box.querySelector('[data-rbp-pick]'),want=ap&&ap.continuation_of||'',ver=0;
 if(!live){cb.disabled=true;box.hidden=true;}
 function svc(){return (data.services||[]).find(function(s){return s.id===form.elements.service_id.value;});}
 function pkg(){return !!(form.elements.package_id&&form.elements.package_id.value);}
 function qty(){var n=Math.floor(+input.value||1);return Math.min(99,Math.max(1,n));}
 function paint(){var p=pkg(),s=svc(),on=cb.checked;q.hidden=p||on;box.hidden=p||!live;if(p||on){input.value=1;}
  var n=qty();total.hidden=!(s&&n>1&&!on&&!p);if(!total.hidden)total.innerHTML='<span>'+n+' × '+esc(money(s.price))+'</span><b>الإجمالي '+esc(money(n*(+s.price||0)))+'</b>';}
 function choose(id){hid.value=id||'';pick.querySelectorAll('[data-rbp-id]').forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-rbp-id')===hid.value));});}
 function load(){var v=++ver,pid=form.elements.patient_id&&form.elements.patient_id.value,sid=form.elements.service_id.value;hid.value='';
  if(!cb.checked){pick.hidden=true;pick.innerHTML='';return;}
  pick.hidden=false;if(!pid||!sid){pick.innerHTML='<p class="rbp-warn">اختار المريض والخدمة الأول علشان تظهر جلساته السابقة.</p>';return;}
  pick.innerHTML='<p class="rbp-hint">بيدوّر على الجلسات السابقة…</p>';
  candidates(ctx.workspace,pid,sid).then(function(list){if(v!==ver||!form.isConnected)return;
   if(!list.length){pick.innerHTML='<p class="rbp-warn">المريض مالوش جلسة سابقة للخدمة دي في آخر ٦ شهور — احجزها كخدمة عادية.</p>';cb.checked=false;want='';paint();return;}
   pick.innerHTML='<span class="rbp-hint">استكمال لأنهي جلسة؟</span>'+list.map(function(c){return '<button type="button" data-rbp-id="'+esc(c.id)+'" aria-pressed="false"><i aria-hidden="true"></i>'+esc(c.service)+' — '+esc(day(c.at))+(c.doctor?' مع '+esc(c.doctor):'')+' · اتدفع '+esc(money(c.amount))+'</button>';}).join('');
   pick.querySelectorAll('[data-rbp-id]').forEach(function(b){b.onclick=function(){choose(b.getAttribute('data-rbp-id'));};});
   choose(list.some(function(c){return c.id===want;})?want:list[0].id);},function(e){if(v===ver)pick.innerHTML='<p class="rbp-warn">'+esc(e&&e.message||'تعذر تحميل الجلسات السابقة')+'</p>';});}
 q.querySelectorAll('[data-rbp-step]').forEach(function(b){b.onclick=function(){input.value=Math.min(99,Math.max(1,qty()+(+b.getAttribute('data-rbp-step'))));paint();};});
 input.addEventListener('input',paint);input.addEventListener('change',function(){input.value=qty();paint();});
 cb.onchange=function(){paint();load();};
 form.elements.service_id.addEventListener('change',function(){paint();if(cb.checked)load();});
 if(form.elements.patient_id)form.elements.patient_id.addEventListener('change',function(){if(cb.checked)load();});
 if(form.elements.package_id)form.elements.package_id.addEventListener('change',paint);
 form.addEventListener('submit',function(e){if(cb.checked&&!hid.value){e.preventDefault();e.stopImmediatePropagation();pick.hidden=false;if(!pick.querySelector('.rbp-warn'))pick.insertAdjacentHTML('afterbegin','<p class="rbp-warn">اختار الجلسة الأولى اللي بتستكملها، أو اقفل «جلسة استكمال».</p>');}},true);
 if(want){cb.checked=true;load();}paint();}
/* timeline card bits */
function cardBits(a,tlTime){a=a||{};var name='',line='';
 if(a.status==='booked'&&!a.confirmed_at&&+a.no_answer_count>0)name=' <span class="rbp-na">لم يرد · '+esc(times(a.no_answer_count))+(a.last_no_answer_at?' · آخر مرة '+esc(tlTime?tlTime(a.last_no_answer_at):''):'')+'</span>';
 if(+a.quantity>1)line+=' <b class="rbp-x">× '+(+a.quantity)+'</b>';
 if(a.continuation_of)line+=' <span class="rbp-cont-tag">استكمال</span>';
 return {name:name,line:line};}
w.SSMPDReceptionBookingPlus={enhance:enhance,cardBits:cardBits,_t:{times:times}};
})(window);
