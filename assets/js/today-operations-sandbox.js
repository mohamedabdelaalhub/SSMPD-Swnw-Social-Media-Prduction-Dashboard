/* Existing trial workspace adapter. No WhatsApp transport or live command fallback. */
(function(){
'use strict';
if(window.SWNJourneySandbox)return;
var style=document.createElement('link');style.rel='stylesheet';style.href='assets/css/today-operations-sandbox.css?v=journey-sandbox-20261031-1';document.head.appendChild(style);
function rpc(name,args){return window.SSMPDDb.client.rpc(name,args).then(function(r){if(r.error)throw r.error;return r.data;});}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function open(day){return rpc('clinic_reception_sandbox_open',{p_day:day});}
function command(model,name,payload,key){return rpc('clinic_reception_sandbox_command',{p_workspace:model.workspace,p_action:name==='patient_help'?'help_requested':name,p_payload:payload||{},p_token:key||crypto.randomUUID()});}
function book(c,model,day,save,appointment){
 var d=model.catalog,a=appointment||{},body='<p data-wide>حجز تجربة محفوظ داخل الداشبورد فقط. الموعد بتوقيت القاهرة.</p>'+
 c.select('patient_id','مريض التجربة',d.patients.map(function(p){return[p.id,p.name];}),a.patient_id||d.patients[0]&&d.patients[0].id)+
 c.select('service_id','الخدمة التجريبية',d.services.map(function(s){return[s.id,s.name];}),a.service_id||d.services[0]&&d.services[0].id)+
 c.select('provider_id','طبيب التجربة',[])+c.select('starts_at','موعد '+day+' بتوقيت القاهرة',[]);
 var m=c.modal(a.id?'تغيير موعد التجربة':'حجز تجريبي جديد',body,function(v,key){return save(a.id?'reschedule':'book',Object.assign({},v,a.id?{id:a.id}:{source:'sandbox',source_evidence:'unknown'}),key);});
 if(!m)return;
 var form=m.querySelector('form'),services=form.elements.service_id,providers=form.elements.provider_id,times=form.elements.starts_at;
 function slots(){var s=d.services.find(function(x){return x.id===services.value;}),rows=[];if(s)(d.availability||[]).filter(function(x){return x.provider_id===providers.value;}).forEach(function(x){for(var t=Date.parse(x.starts_at);t+Number(s.minutes)*60000<=Date.parse(x.ends_at);t+=Number(s.minutes)*60000){var end=t+Number(s.minutes)*60000;if((d.appointments||[]).some(function(b){return b.id!==a.id&&b.provider_id===providers.value&&!['cancelled','no_show'].includes(b.status)&&Date.parse(b.starts_at)<end&&Date.parse(b.ends_at)>t;}))continue;rows.push([new Date(t).toISOString(),new Date(t).toLocaleTimeString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'})]);}});times.innerHTML='<option value="">اختر الموعد</option>'+rows.map(function(r){return '<option value="'+r[0]+'">'+esc(r[1])+'</option>';}).join('');if(a.starts_at)times.value=new Date(a.starts_at).toISOString();m.querySelector('[type=submit]').disabled=rows.length===0;}
 function doctors(){var s=d.services.find(function(x){return x.id===services.value;});providers.innerHTML=(d.providers||[]).filter(function(p){return s&&p.department===s.department;}).map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>';}).join('');if(a.provider_id)providers.value=a.provider_id;slots();}
 services.onchange=doctors;providers.onchange=slots;doctors();
}
function orders(c,model,visit,save){
 var m=c.modal('خدمات زيارة التجربة','<div data-wide data-sandbox-orders></div>',function(){return Promise.resolve();});if(!m)return;
 m.querySelector('[type=submit]').hidden=true;m.querySelector('[data-rx-cancel]').textContent='إغلاق';
 function draw(){var rows=(model.catalog.orders||[]).filter(function(o){return o.visit_id===visit;});m.querySelector('[data-sandbox-orders]').innerHTML=rows.map(function(o){return '<article class="journey-sandbox-order"><strong>'+esc(o.snapshot.name)+'</strong><span>'+esc({ordered:'بانتظار التنفيذ',completed:'تم التنفيذ',cancelled:'ملغاة'}[o.status]||o.status)+'</span>'+(o.status==='ordered'?'<div class="journey-card-actions"><button type="button" class="btn btn-primary" data-sandbox-order="execute" data-id="'+esc(o.id)+'">تنفيذ تجريبي</button><button type="button" class="btn" data-sandbox-order="order_cancel" data-id="'+esc(o.id)+'">إلغاء الخدمة</button></div>':'')+'</article>';}).join('')||'<p>لا توجد خدمات في الزيارة.</p>';}
 m.onclick=function(e){var b=e.target.closest('[data-sandbox-order]');if(!b)return;b.disabled=true;save(b.dataset.sandboxOrder,{id:b.dataset.id,reason:'إجراء في بيئة التجربة'}).then(draw).catch(function(error){m.querySelector('[data-rx-status]').textContent=error.message;b.disabled=false;});};draw();
}
function feedback(c,id,save){c.modal('تقييم تجربة الزيارة',c.field('rating','التقييم من 1 إلى 5','number','5','required min="1" max="5" step="1"')+c.field('comment','تعليق اختياري','text','','maxlength="500"'),function(v,key){return save('feedback',{appointment_id:id,rating:Number(v.rating),comment:v.comment},key);});}
function messages(model){var rows=model.journey.outbox||[];return '<section class="journey-section journey-sandbox-messages"><div class="journey-section-head"><h3>محاكاة رسائل واتساب</h3></div><p>معاينة داخل التجربة فقط؛ لا تصل هذه الرسائل إلى أي هاتف.</p>'+rows.map(function(o){return '<article><small>'+esc(o.kind)+' · '+(o.simulated_at?'تمت المحاكاة':'بانتظار المحاكاة')+'</small><p>'+esc(o.body)+'</p></article>';}).join('')+(rows.length?'<button type="button" class="btn" data-journey-action="sandbox_messages">محاكاة الإرسال</button>':'<p class="journey-empty">تظهر الرسائل بعد الوصول أو النداء أو إتمام الزيارة.</p>')+'</section>';}
window.SWNJourneySandbox={open:open,command:command,book:book,orders:orders,feedback:feedback,messages:messages};
})();
