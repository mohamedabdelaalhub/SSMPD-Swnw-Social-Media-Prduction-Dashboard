/* Owner 2026-11-22 (mockup docs/ui-references/mockups/booking-service-later.html «طبقه»): «الخدمة تتحدد عند الحضور».
   * «حجز موعد» / «تعديل الحجز»: a switch books the doctor's time without a service. It selects the department's placeholder
     (snapshot.service_later: id, department, minutes — 30 by default) as the booking's service, so the doctor list and the
     free times work exactly as for any service; discount / extra services / external amount are turned off.
     The payload carries service_later:true (the server, clinic_reception_command 20261122060000, books the placeholder).
   * «تسجيل حضور المريض» on such a booking: the real service is required (doctor's departments / scope) before the arrival.
   * The booking card shows the tag «الخدمة تتحدد عند الحضور».
   Hooks: SSMPDServiceLater.enhance(form,{data,appointment}), .take(payload), .arrival(root,appointment,{data}), .tag(a). */
(function(w){'use strict';
var LABEL='الخدمة تتحدد عند الحضور',FAKE='__later__:';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function purge(data){var l=data&&data.services;if(!l)return;for(var i=l.length-1;i>=0;i--)if(l[i]&&l[i]._sl)l.splice(i,1);}
function provider(data,id){return (data.providers||[]).find(function(p){return p.id===id;})||null;}
function serves(data,p,dept){return !!(p&&dept&&(p.department===dept||((data.provider_departments||{})[p.id]||[]).indexOf(dept)>=0));}
// «طبيب مقيّد» (20261126050000): a department management restricted for the doctor offers only his scoped services (basics stay open)
function restrictedOut(data,p,s){var r=(data.provider_restricted||{})[p.id],codes=r&&r[s.department];return !!(codes&&codes.indexOf(s.code)<0&&(data.basic_service_ids||[]).indexOf(s.id)<0);}
function placeholder(data,dept){var x=(data.service_later||[]).find(function(s){return s.department===dept;});
 return {id:x?x.id:FAKE+dept,code:x?x.code:'',name:LABEL,department:dept,minutes:x?+x.minutes||30:30,price:0,placeholder:true,_sl:true};}

function enhance(form,ctx){var data=ctx&&ctx.data,appt=ctx&&ctx.appointment;
 if(!form||!data||!Array.isArray(data.service_later)||form.querySelector('[data-sl]')||!form.elements.service_id)return;
 purge(data);
 var sel=form.elements.service_id,deptSel=form.querySelector('[data-rx-dept]'),field=sel.closest('.rx-combo-field')||sel.closest('label');
 var box=document.createElement('div');box.className='rx-sl';box.setAttribute('data-sl','');box.setAttribute('data-wide','');
 box.innerHTML='<label class="rx-sl-sw"><input type="checkbox" name="service_later" value="true" data-sl-on><span><b>'+LABEL+'</b><small>المريض لسه ماقررش. هنحجز وقت الدكتور بس، والخدمة والسعر يتحددوا في الاستقبال لما ييجي.</small></span></label><p class="rx-sl-note" data-sl-note hidden></p>';
 field.before(box);
 var cb=box.querySelector('[data-sl-on]'),note=box.querySelector('[data-sl-note]'),cur=null,busy=false;
 function others(on){
  var d=form.querySelector('[data-rbd-on]');if(on&&d&&d.checked){d.checked=false;d.dispatchEvent(new Event('change',{bubbles:true}));}
  var x=form.querySelector('[name=external_service]');if(on&&x&&x.checked){x.checked=false;x.dispatchEvent(new Event('change',{bubbles:true}));}
  if(on)form.querySelectorAll('[data-rx-extra]').forEach(function(r){r.remove();});
  ['[data-rbd]','[data-rx-external]','[data-rx-extras]'].forEach(function(q){var el=form.querySelector(q);if(el)el.hidden=on;});}
 function dept(){var d=deptSel&&deptSel.value;if(d&&d!=='__none__')return d;var p=provider(data,form.elements.provider_id&&form.elements.provider_id.value);return p&&p.department||'';}
 function apply(){if(busy)return;busy=true;try{
  purge(data);Array.prototype.slice.call(sel.options).forEach(function(o){if(o.dataset.sl)o.remove();});
  var on=cb.checked;field.hidden=on;sel.required=!on;others(on);
  if(!on){note.hidden=true;if(cur){sel.value='';cur=null;sel.dispatchEvent(new Event('change',{bubbles:true}));}return;}
  var d=dept();note.hidden=false;
  if(!d){note.textContent='اختار القسم الأول';cur=null;sel.value='';return;}
  cur=placeholder(data,d);data.services.push(cur);var o=new Option(LABEL,cur.id);o.dataset.sl='1';o.dataset.name=LABEL;o.dataset.price='—';sel.add(o);sel.value=cur.id;
  note.textContent='— هتتحدد عند الحضور — قسم '+d+' · الوقت المحجوز مبدئياً '+cur.minutes+' دقيقة (تقدر تغيّره من «مدة الجلسة»)';
  sel.dispatchEvent(new Event('change',{bubbles:true}));
 }finally{busy=false;}}
 cb.addEventListener('change',apply);
 if(deptSel)deptSel.addEventListener('change',function(){if(cb.checked)apply();});
 if(appt&&appt.service_later){cb.checked=true;apply();}
 var t=setInterval(function(){if(!form.isConnected){clearInterval(t);purge(data);}},1000);}

function take(payload){if(!payload)return payload;
 if(payload.service_later==='true'||payload.service_later===true){payload.service_later=true;
  if(String(payload.service_id||'').indexOf(FAKE)===0)delete payload.service_id;
  Object.keys(payload).forEach(function(k){if(k.indexOf('discount_')===0)delete payload[k];});delete payload.external_service;delete payload.external_extra;}
 else delete payload.service_later;
 return payload;}

function arrival(root,appt,ctx){var data=ctx&&ctx.data;if(!root||!appt||!appt.service_later||!data)return;
 var form=root.querySelector('form');if(!form||form.elements.service_id)return;
 var p=provider(data,appt.provider_id)||{},scopes=(data.provider_service_scopes||{})[p.id]||[];
 var list=(data.services||[]).filter(function(s){return !s.placeholder&&!s._sl&&s.active!==false&&(serves(data,p,s.department)||scopes.indexOf(s.code)>=0)&&!restrictedOut(data,p,s);})
  .sort(function(a,b){return String(a.name).localeCompare(String(b.name),'ar');});
 var box=document.createElement('div');box.className='rx-sl-arrive';box.setAttribute('data-wide','');
 box.innerHTML='<p class="rx-sl-warn">الحجز ده «'+LABEL+'». اختار الخدمة اللي المريض قررها علشان نكمّل الحضور.</p><label>الخدمة (إجباري)<select name="service_id" required><option value="">— اختار خدمة'+(p.department?' من قسم '+esc(p.department):'')+' —</option>'+list.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+' — '+esc(money(s.price))+'</option>';}).join('')+'</select></label><p class="rx-sl-err" data-sl-err>اختار الخدمة الأول</p>';
 var first=form.firstElementChild;form.insertBefore(box,first&&first.tagName==='P'?first.nextSibling:first);
 var s=box.querySelector('select'),err=box.querySelector('[data-sl-err]'),btn=root.querySelector('[type=submit]');
 function sync(){var ok=!!s.value;err.hidden=ok;if(btn)btn.disabled=!ok;var q=form.elements.quantity;if(q)q.dispatchEvent(new Event('input',{bubbles:true}));}
 s.addEventListener('change',sync);sync();}

function tag(a){return a&&a.service_later?'<span class="rx-later-tag">'+LABEL+'</span>':'';}

w.SSMPDServiceLater={enhance:enhance,take:take,arrival:arrival,tag:tag,purge:purge,LABEL:LABEL};
})(window);
