/* «الطبيب المحوِّل» (owner 2026-11-23 «الاتنين، من جوة المركز او من بره»; server 20261123120000).
   Optional field in «حجز موعد» / «تعديل الحجز» / «حضور بدون ميعاد»: مفيش / من جوه المركز (a centre doctor) / من بره المركز (name +
   optional specialty, clinic, phone). The same field from «⋯ ← الطبيب المحوِّل» on a booked / arrived card until the visit is collected
   ('set_referrer'). It prints on the approved invoice header next to «الطبيب».
   Hooks: SSMPDReceptionReferrer.enhance(form, {data, appointment}), open(appointmentId, ctx), can(appointment, data), label(appointment). */
(function(w){'use strict';
var KINDS=[['','مفيش'],['internal','من جوه المركز'],['external','من بره المركز']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function enhance(form,ctx){if(!form||form.querySelector('[data-rrf]'))return null;
 ctx=ctx||{};var data=ctx.data||{},ap=ctx.appointment||{},cur=ap.referrer_kind||'';
 var box=document.createElement('section');box.className='rrf';box.setAttribute('data-rrf','');box.setAttribute('data-wide','');
 box.innerHTML='<p class="rbd-l rrf-title">الطبيب المحوِّل <small>(اختياري)</small></p>'+
  '<div class="rrf-seg" role="radiogroup" aria-label="الطبيب المحوِّل">'+KINDS.map(function(k){return '<label class="rrf-opt"><input type="radio" name="referrer_kind" value="'+k[0]+'"'+(k[0]===cur?' checked':'')+'><span>'+k[1]+'</span></label>';}).join('')+'</div>'+
  '<label class="rbd-row" data-rrf-in hidden><span class="rbd-l">اختار الطبيب</span><select name="referrer_provider_id"><option value="">اختار</option>'+
   (data.providers||[]).filter(function(p){return p.active!==false;}).map(function(p){return '<option value="'+esc(p.id)+'"'+(p.id===ap.referrer_provider_id?' selected':'')+'>'+esc(p.name+(p.department?' — '+p.department:''))+'</option>';}).join('')+'</select></label>'+
  '<div class="rrf-ext" data-rrf-ex hidden><label class="rbd-row"><span class="rbd-l">اسم الطبيب</span><input name="referrer_name" maxlength="120" placeholder="د. …" value="'+esc(ap.referrer_kind==='external'?ap.referrer_name:'')+'"></label>'+
   '<div class="rbd-two"><label class="rbd-row"><span class="rbd-l">تخصص الطبيب المحوِّل</span><input name="referrer_specialty" maxlength="120" value="'+esc(ap.referrer_kind==='external'?ap.referrer_specialty||'':'')+'"></label>'+
   '<label class="rbd-row"><span class="rbd-l">العيادة / المستشفى</span><input name="referrer_clinic" maxlength="120" value="'+esc(ap.referrer_clinic||'')+'"></label></div>'+
   '<label class="rbd-row"><span class="rbd-l">تليفون الطبيب المحوِّل</span><input name="referrer_phone" maxlength="30" inputmode="tel" dir="ltr" value="'+esc(ap.referrer_phone||'')+'"></label></div>';
 var anchor=form.querySelector('[data-rbd]')||form.querySelector('.rx-combo-field')||(form.elements.service_id&&(form.elements.service_id.closest('label')||form.elements.service_id));
 if(anchor&&anchor.parentNode)anchor.after(box);else form.appendChild(box);
 var inn=box.querySelector('[data-rrf-in]'),ex=box.querySelector('[data-rrf-ex]'),E=form.elements;
 function kind(){var r=box.querySelector('input[name="referrer_kind"]:checked');return r?r.value:'';}
 function paint(){var k=kind();inn.hidden=k!=='internal';ex.hidden=k!=='external';
  E.referrer_provider_id.disabled=k!=='internal';E.referrer_provider_id.required=k==='internal';
  ['referrer_name','referrer_specialty','referrer_clinic','referrer_phone'].forEach(function(n){E[n].disabled=k!=='external';});E.referrer_name.required=k==='external';}
 if(!box.querySelector('input[name="referrer_kind"]:checked'))box.querySelector('input[name="referrer_kind"][value=""]').checked=true;
 box.addEventListener('change',paint);paint();return box;}
function pick(v){var p={};Object.keys(v).forEach(function(k){if(/^referrer_/.test(k))p[k]=v[k];});if(!('referrer_kind' in p))p.referrer_kind='';return p;}
function collected(ap,d){var v=((d&&d.visits)||[]).find(function(x){return x.appointment_id===ap.id;});return !!v&&((d.orders||[]).some(function(o){return o.visit_id===v.id&&o.status==='completed';}));}
function can(ap,d){return !!ap&&(ap.status==='booked'||ap.status==='arrived')&&!collected(ap,d);}
function label(ap){return ap&&ap.referrer_kind?'الطبيب المحوِّل: '+(ap.referrer_name||''):'الطبيب المحوِّل';}
function open(apId,c){var d=c.data||{},ap=(d.appointments||[]).find(function(x){return x.id===apId;});if(!ap)return false;
 if(!can(ap,d))throw new Error('الزيارة دي اتحصّلت — الطبيب المحوِّل اتسجّل على الفاتورة');
 var name=((d.patients||[]).find(function(p){return p.id===ap.patient_id;})||{}).name||'';
 var root=c.modal('الطبيب المحوِّل','<p class="rbd-note">'+esc(name)+'</p><input type="hidden" name="service_id" value="'+esc(ap.service_id||'')+'">',function(v){var p=pick(v);p.id=ap.id;
   return c.command('set_referrer',p,crypto.randomUUID()).then(function(r){if(w.SSMPDToast)w.SSMPDToast.show(p.referrer_kind?'اتسجّل الطبيب المحوِّل ✓ — هيطلع في الفاتورة':'اتشال الطبيب المحوِّل');return r;});},null,{ok:'حفظ'});
 if(!root)return true;enhance(root.querySelector('form'),{data:d,appointment:ap});return true;}
w.SSMPDReceptionReferrer={enhance:enhance,open:open,can:can,label:label,pick:pick};
})(window);
