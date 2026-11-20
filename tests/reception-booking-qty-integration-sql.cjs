// Owner 2026-11-20: quantity and «جلسة استكمال» on the real reception functions — arrival order, invoice, payment, continuation at 0.
const assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('service',{code:'CRW',name:'طربوش زيركون',department:dept,price:300,minutes:30,bom:[]});await cmd('service',{code:'FIL',name:'حشو عصب',department:dept,price:150,minutes:30,bom:[]});
 s=await snap();const crown=s.services.find(x=>x.code==='CRW').id,fill=s.services.find(x=>x.code==='FIL').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'CRW',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T06:00:00Z',ends_at:date+'T20:00:00Z'});
 // book 3 crowns → arrival order quantity 3 → invoice 900
 const a1=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:crown,starts_at:date+'T07:00:00Z',quantity:'3',continuation_of:''})).id;
 s=await snap();assert.equal(s.appointments.find(x=>x.id===a1).quantity,3,'snapshot carries quantity');
 const na=await cmd('no_answer',{id:a1});assert.equal(na.no_answer_count,1);s=await snap();assert.equal(s.appointments.find(x=>x.id===a1).no_answer_count,1);assert.equal(s.appointments.find(x=>x.id===a1).status,'booked');
 await cmd('arrive',{id:a1});s=await snap();const o1=s.orders.find(o=>o.service_id===crown);assert.equal(+o1.quantity,3);assert.equal(+o1.price,300);
 assert.equal((await rpc('clinic_reception_continuation_candidates',{p_workspace:w,p_patient:patient,p_service:crown})).length,0,'not billed yet');
 await cmd('execute',{id:o1.id,provider_id:provider,materials:[]});s=await snap();const inv=s.invoices.find(i=>i.order_id===o1.id);assert.equal(+inv.amount,900,'price × quantity');
 assert.equal((await rpc('clinic_reception_continuation_candidates',{p_workspace:w,p_patient:patient,p_service:crown})).length,0,'unpaid');
 await cmd('collect',{patient_id:patient,invoice_id:inv.id,amount:500,method:'instapay',reference:'IP1'});
 assert.equal((await rpc('clinic_reception_continuation_candidates',{p_workspace:w,p_patient:patient,p_service:crown})).length,0,'partly paid');
 await cmd('collect',{patient_id:patient,invoice_id:inv.id,amount:400,method:'instapay',reference:'IP2'});
 const c=await rpc('clinic_reception_continuation_candidates',{p_workspace:w,p_patient:patient,p_service:crown});assert.equal(c.length,1);assert.equal(c[0].id,o1.id);assert.equal(+c[0].amount,900);
 await assert.rejects(()=>cmd('book',{patient_id:patient,provider_id:provider,service_id:fill,starts_at:date+'T09:00:00Z',continuation_of:o1.id}),/مالوش جلسة سابقة/);
 // continuation → arrival order at 0
 const a2=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:crown,starts_at:date+'T10:00:00Z',quantity:'1',continuation_of:o1.id,same_day_ok:true})).id;
 await cmd('arrive',{id:a2});s=await snap();const o2=s.orders.find(o=>o.service_id===crown&&o.id!==o1.id);assert.equal(+o2.price,0);assert.equal(o2.snapshot.continuation_of,o1.id);
 // a service added to the same visit later keeps its own price
 const v2=s.visits.find(v=>v.appointment_id===a2).id;await cmd('order_add',{visit_id:v2,service_id:fill,provider_id:provider,quantity:'2'});s=await snap();
 const o3=s.orders.find(o=>o.service_id===fill);assert.equal(+o3.price,150);assert.equal(+o3.quantity,2);
 console.log('PASS reception booking quantity / continuation on the real reception functions');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
