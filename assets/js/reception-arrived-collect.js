/* «تحصيل» on the card of a patient who arrived (owner 2026-11-21: «اعمل زرار «تحصيل» على كارت المريض اللي حضر»).
   One click: if the visit's services are not executed yet, they are executed in the clicker's name (after a clear
   confirmation — the invoice only exists after execution; reception already has the 'execute' capability), then the
   existing «تسجيل تحصيل» form opens on the visit's invoice that still has something due. A service that needs a device
   reading or a chosen doctor cannot be executed blindly: the message says so and the visit details open instead.
   Hook: SSMPDArrivedCollect.run(appointmentId, getContext) — getContext() returns a fresh workspace context. */
(function(w){'use strict';
function toast(m,k){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(m,k||'info');}
function uuid(){return w.crypto&&w.crypto.randomUUID?w.crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2);}
function plan(d,appointmentId){var v=(d.visits||[]).find(function(x){return x.appointment_id===appointmentId;});if(!v)return {visit:null,pending:[],due:[]};
 return {visit:v,pending:(d.orders||[]).filter(function(o){return o.visit_id===v.id&&o.status==='ordered';}),
  due:(d.invoices||[]).filter(function(i){return i.visit_id===v.id&&Number(i.due)>0;})};}
function names(orders){return orders.map(function(o){return (o.snapshot&&o.snapshot.name)||'خدمة';}).join('، ');}
async function run(appointmentId,getContext,ask){ask=ask||function(m){return w.confirm(m);};
 var c=getContext(),p=plan(c.data,appointmentId);
 if(!p.visit){toast('الزيارة لسه مش ظاهرة — اعمل تحديث وجرب تاني','warning');return 'no_visit';}
 if(p.pending.length){
  if(!ask('الفاتورة بتطلع بعد تنفيذ الخدمة.\nهيتسجل إن «'+names(p.pending)+'» اتنفّذت باسمك دلوقتي، وبعدين تفتح شاشة التحصيل.\nتكمّل؟'))return 'cancelled';
  for(var i=0;i<p.pending.length;i++){var o=p.pending[i];
   try{await c.command('execute',{id:o.id,provider_id:o.provider_id||''},uuid());}
   catch(e){toast('مقدرناش ننفّذ «'+names([o])+'» من هنا: '+((e&&e.message)||'')+' — كمّل التنفيذ من تفاصيل الزيارة.','error');
    if(c.data.workspace&&w.SSMPDReceptionModules)w.SSMPDReceptionModules.act('visit-detail',p.visit.id,c);return 'execute_failed';}}
  await c.load();c=getContext();p=plan(c.data,appointmentId);}
 if(!p.due.length){toast('الزيارة دي مسدّدة بالكامل ✓','success');return 'paid';}
 if(p.due.length>1)toast('فيه '+p.due.length+' فواتير على الزيارة — بعد ما تحصّل دي دوس «تحصيل» تاني للباقي.','info');
 if(w.SSMPDReceptionModules)w.SSMPDReceptionModules.act('collect-invoice',p.due[0].id,c);
 return 'collect';}
w.SSMPDArrivedCollect={run:run,plan:plan};
})(window);
