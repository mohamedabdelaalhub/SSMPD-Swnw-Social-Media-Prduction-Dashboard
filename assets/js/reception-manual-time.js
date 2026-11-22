/* Owner 2026-11-22 (mockup docs/ui-references/mockups/booking-manual-time.html «طبقه»): «حجز بميعاد يدوي (متفق عليه مع
   الدكتور)». In «حجز موعد» / «تعديل الحجز» step «امتى؟»: a switch lets reception type any time (doctor / reception
   arrangements the system doesn't know). It reuses the existing «وقت تاني» time box (starts_at = '__custom__'), so the
   time is converted to Cairo time exactly like today; fields ride the payload: manual_time, manual_reason_kind,
   manual_reason. The server (clinic_reception_command, 20261122080000) adds a one-off availability for that slot, books
   normally (closures / overlap / gap still refused) and flags the booking. Highlighted when the day has no free time.
   Hooks: SSMPDManualTime.enhance(form,{appointment}), .tag(a). */
(function(w){'use strict';
var KINDS=[['doctor_agreement','اتفاق مع الدكتور'],['doctor_other_time','الدكتور جاي في ميعاد تاني'],['other','أخرى']];
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function enhance(form,ctx){var sel=form&&form.elements.starts_at;if(!sel||form.querySelector('[data-mt]'))return;
 var appt=ctx&&ctx.appointment,lab=sel.closest('label'),anchor=form.querySelector('[data-rx-custom-time]')||lab;
 var box=document.createElement('div');box.className='rx-mt';box.setAttribute('data-mt','');box.setAttribute('data-wide','');
 box.innerHTML='<label class="rx-mt-sw"><input type="checkbox" name="manual_time" value="true" data-mt-on><span><b>حجز بميعاد يدوي (متفق عليه مع الدكتور)</b><small>لو الميعاد مش في القايمة: اكتب الساعة بإيدك.</small></span></label>'+
  '<fieldset class="rx-mt-body" data-mt-body hidden disabled><div class="rx-mt-l">السبب</div><div class="rx-mt-chips" role="radiogroup">'+
  KINDS.map(function(k,i){return '<label class="rx-mt-chip"><input type="radio" name="manual_reason_kind" value="'+k[0]+'"'+(i===0?' checked':'')+'><span>'+esc(k[1])+'</span></label>';}).join('')+
  '</div><label>ملاحظة الاتفاق (اختياري)<input name="manual_reason" maxlength="200" placeholder="مثلاً: الدكتورة قالت هتيجي 7 ونص"></label>'+
  '<p class="rx-mt-warn">لو الميعاد برّه مواعيد الدكتور المسجّلة، هيتسجل الحجز وهيتضاف الوقت ده لمواعيد الدكتور في اليوم ده بس. الأجازة الرسمية أو التعارض مع حجز تاني بيترفضوا.</p></fieldset>';
 anchor.after(box);
 var cb=box.querySelector('[data-mt-on]'),body=box.querySelector('[data-mt-body]'),note=box.querySelector('[name=manual_reason]'),busy=false,ready=false;
 function custom(){if(!cb.checked||busy)return;busy=true;try{if(!Array.prototype.some.call(sel.options,function(o){return o.value==='__custom__';})){var o=new Option('وقت يدوي (اكتبه بإيدك)…','__custom__');o.dataset.mt='1';sel.add(o);}
  if(sel.value!=='__custom__'){sel.value='__custom__';sel.dispatchEvent(new Event('change',{bubbles:true}));}}finally{busy=false;}}
 function empty(){return !Array.prototype.some.call(sel.options,function(o){return o.value&&o.value!=='__custom__';});}
 function sync(){var on=cb.checked;body.hidden=!on;body.disabled=!on;lab.hidden=on;box.classList.toggle('is-suggest',!on&&!!sel.options.length&&empty());
  var other=(box.querySelector('[name=manual_reason_kind]:checked')||{}).value==='other';note.required=on&&other;note.minLength=other?3:0;
  if(on){custom();return;}if(!ready)return;var mine=sel.querySelector('option[data-mt]');if(mine)mine.remove();if(sel.value==='__custom__'||mine){sel.value='';sel.dispatchEvent(new Event('change',{bubbles:true}));}}
 cb.addEventListener('change',sync);box.addEventListener('change',function(e){if(e.target&&e.target.name==='manual_reason_kind')sync();});
 if(w.MutationObserver)new MutationObserver(function(){if(cb.checked)custom();else box.classList.toggle('is-suggest',!!sel.options.length&&empty());}).observe(sel,{childList:true});
 if(appt&&appt.manual_time)cb.checked=true;
 sync();ready=true;}
function tag(a){return a&&a.manual_time?' <span class="rx-manual-tag" title="'+esc(a.manual_reason||'')+'">ميعاد يدوي</span>':'';}
w.SSMPDManualTime={enhance:enhance,tag:tag};
})(window);
