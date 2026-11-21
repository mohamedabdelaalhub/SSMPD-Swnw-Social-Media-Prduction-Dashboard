// Owner 2026-11-21: «تسجيل حضور المريض» sets several sessions / areas — on the real reception functions: arrival order
// quantity + areas, invoice price × quantity, validation, other actions untouched, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_arrival_sessions']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('service',{code:'LSR',name:'جلسة ليزر — منطقة',department:dept,price:600,minutes:30,bom:[]});
 s=await snap();const laser=s.services.find(x=>x.code==='LSR').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'LSR',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;
 await as(2);await cmd('agreement_review',{id:ag,approve:true,note:'ok'});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T06:00:00Z',ends_at:date+'T20:00:00Z'});
 const a1=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:laser,starts_at:date+'T07:00:00Z'})).id;
 await assert.rejects(()=>cmd('arrive',{id:a1,encounter_type:'session',quantity:'0'}),/من 1 لـ 99/);
 s=await snap();assert.equal(s.appointments.find(x=>x.id===a1).status,'booked','refused arrival changes nothing');
 await cmd('arrive',{id:a1,encounter_type:'session',quantity:'2',session_areas:'الوش + الإبط'});
 s=await snap();const ap=s.appointments.find(x=>x.id===a1);assert.equal(ap.quantity,2);assert.notEqual(ap.status,'booked');
 const o=s.orders.find(x=>x.service_id===laser);assert.equal(+o.quantity,2);assert.equal(o.snapshot.areas,'الوش + الإبط');
 await cmd('execute',{id:o.id,provider_id:provider,materials:[]});s=await snap();assert.equal(+s.invoices.find(i=>i.order_id===o.id).amount,1200,'2 × 600');
 // plain arrival (no quantity) still works and keeps the booking quantity
 const a2=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:laser,starts_at:date+'T09:00:00Z',quantity:'3',same_day_ok:true})).id;
 await cmd('arrive',{id:a2,encounter_type:'session'});s=await snap();assert.equal(+s.orders.find(x=>x.service_id===laser&&x.id!==o.id).quantity,3);
 const fn=(await db.query("select count(*)::int n from pg_proc where proname='command_before_arrival_qty'")).rows[0].n;assert.equal(fn,1);
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261121140000_reception_arrival_sessions.rollback.sql','utf8'));
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname='command_before_arrival_qty'")).rows[0].n,0,'rollback');
 console.log('PASS arrival sessions / areas on the real reception functions');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
