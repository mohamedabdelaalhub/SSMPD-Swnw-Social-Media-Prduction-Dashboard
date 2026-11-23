/* Owner 2026-11-23 «طبق حل الحجوزات» (mockup docs/ui-references/mockups/masa-day-only-auto-time-*): in «حجز موعد» / «تعديل
   الحجز», under the date, the doctor's day «المحجوز X من Y» (booked incl. overbook / capacity = the doctor's hours that day ÷
   the service minutes) so reception sees an over-full day (e.g. Masa bookings made for a day without a time) before booking
   more. Read-only: public.clinic_reception_auto_book('capacity') (20261122330000). Hook: SSMPDDayCapacity.enhance(form,{workspace}). */
(function(w){'use strict';
function rpc(ws,p){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c||typeof c.rpc!=='function')return Promise.resolve(null);
 return Promise.resolve(c.rpc('clinic_reception_auto_book',{p_workspace:ws,p_action:'capacity',p_payload:p})).then(function(r){return r&&!r.error?r.data:null;},function(){return null;});}
function enhance(form,ctx){var ws=ctx&&ctx.workspace;if(!form||!ws||!form.elements.provider_id||!form.elements.day||form.querySelector('[data-rx-cap]'))return;
 var lab=form.elements.day.closest('label')||form.elements.day,el=document.createElement('p');el.className='rx-cap';el.setAttribute('data-rx-cap','');el.setAttribute('role','status');el.hidden=true;lab.after(el);
 var gen=0,timer=null;
 function draw(){var prov=form.elements.provider_id.value,day=form.elements.day.value,g=++gen;if(!prov||!/^\d{4}-\d\d-\d\d$/.test(day)){el.hidden=true;return;}
  rpc(ws,{provider_id:prov,from:day,to:day}).then(function(r){if(g!==gen)return;var d=r&&r.days&&r.days[0];if(!d||!d.capacity){el.hidden=true;return;}
   var full=d.booked>=d.capacity;el.className='rx-cap'+(full?' is-full':'');el.textContent='المحجوز عند الدكتور في اليوم ده: '+d.booked+' من '+d.capacity+(full?' · اليوم مليان':'');el.hidden=false;});}
 function later(){clearTimeout(timer);timer=setTimeout(draw,150);}
 form.addEventListener('change',function(e){var n=e.target&&e.target.name;if(n==='provider_id'||n==='day')later();});
 form.addEventListener('input',function(e){if(e.target&&e.target.name==='day')later();});
 draw();}
w.SSMPDDayCapacity={enhance:enhance};
})(window);
