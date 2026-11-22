/* Owner 2026-11-22 «طبق الحجز من الليدز وخلي كل الأرقام انجليزي» (mockup docs/ui-references/mockups/lead-booking.html):
   «مؤشرات الحجز من الليدز» — per customer-service employee: leads → booked → attended → paid, with the step percentage.
   Data: public.lead_booking_funnel(from, to) (managers see everyone, others their own row). All digits are Western (0-9).
   Hook: SSMPDLeadFunnel.mount(subView) after «داشبورد الإدارة» / «خدمة العملاء»; .unmount() elsewhere. */
(function(w){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function cairoDay(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d||new Date());}
function pct(a,b){return b>0?Math.round(a*100/b)+'%':'—';}
function unmount(){var o=document.getElementById('ld-funnel');if(o)o.remove();}
function mount(sub){unmount();if(!sub||!sub.parentNode)return;var box=document.createElement('section');box.id='ld-funnel';box.className='ld-funnel';
 var to=cairoDay(),from=to.slice(0,8)+'01';
 box.innerHTML='<header class="ld-funnel-h"><h3>مؤشرات الحجز من الليدز</h3><div class="ld-funnel-f"><label>من <input type="date" data-f-from value="'+from+'"></label><label>لحد <input type="date" data-f-to value="'+to+'"></label></div></header><div data-f-body><p class="ld-funnel-note">جاري التحميل…</p></div>'+
  '<p class="ld-funnel-note">«اتحجز» = حجز اتعمل من الليد. «حضر» = المريض سجّل حضور. «دفع» = الزيارة اتحصّلت (كلها أو جزء). النسبة من الخطوة اللي قبلها.</p>';
 sub.after(box);var body=box.querySelector('[data-f-body]');
 function load(){var f=box.querySelector('[data-f-from]').value,t=box.querySelector('[data-f-to]').value,c=w.SSMPDDb&&w.SSMPDDb.client;if(!c||!f||!t)return;body.innerHTML='<p class="ld-funnel-note">جاري التحميل…</p>';
  Promise.resolve(c.rpc('lead_booking_funnel',{p_from:f,p_to:t})).then(function(r){if(r&&r.error)throw r.error;var rows=(r&&r.data)||[],T={leads:0,booked:0,attended:0,paid:0};
   rows.forEach(function(x){['leads','booked','attended','paid'].forEach(function(k){T[k]+=+x[k]||0;});});
   if(!rows.length){body.innerHTML='<p class="ld-funnel-note">مفيش ليدز في الفترة دي.</p>';return;}
   function tr(name,x,b){return '<tr'+(b?' class="tot"':'')+'><td>'+esc(name)+'</td><td>'+(+x.leads)+'</td><td>'+(+x.booked)+'<span>'+pct(+x.booked,+x.leads)+'</span></td><td>'+(+x.attended)+'<span>'+pct(+x.attended,+x.booked)+'</span></td><td>'+(+x.paid)+'<span>'+pct(+x.paid,+x.attended)+'</span></td></tr>';}
   body.innerHTML='<table class="ld-funnel-t" dir="rtl"><thead><tr><th>الموظف</th><th>ليدز</th><th>اتحجز</th><th>حضر</th><th>دفع</th></tr></thead><tbody>'+rows.map(function(x){return tr(x.agent,x);}).join('')+(rows.length>1?tr('الإجمالي',T,true):'')+'</tbody></table>';
  }).catch(function(e){body.innerHTML='<p class="ld-funnel-err">'+esc((e&&e.message)||'تعذر التحميل')+'</p>';});}
 box.addEventListener('change',function(e){if(e.target&&e.target.type==='date')load();});load();}
w.SSMPDLeadFunnel={mount:mount,unmount:unmount,pct:pct};
})(window);
