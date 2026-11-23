// 20261123130000: a visit discount covers every service of the visit (union patient: consult 500 + physio 500 → 700).
// Booking discount (نقابة 30%) → a service added later gets 30% automatically; an approved generic discount → «نفس خصم الزيارة»
// copies it to the other ordered services; a DIFFERENT second discount still refused; no duplicate generic request. Reception user.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(3);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department,[A,B]=s.patients.map(p=>p.id);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const consult=(await cmd('service',{code:'KSF',name:'كشف',department:dept,price:500,minutes:15,bom:[]})).id,physio=(await cmd('service',{code:'PT',name:'جلسة علاج طبيعي',department:dept,price:500,minutes:15,bom:[]})).id;
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 await db.exec('reset role');const M=fs.readFileSync('supabase/migrations/20261123130000_visit_discount_all_services.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');await as(3);
 const ordersOf=async ap=>{const s2=await snap();const v=s2.visits.find(x=>x.appointment_id===ap);return {v,orders:s2.orders.filter(o=>o.visit_id===v.id)};};
 // (1) booking discount نقابة 30% → arrival order 30% → physio added later → 30% automatically
 const syn={discount_kind:'syndicate',discount_percent:'30',discount_org_type:'syndicate',discount_org_name:'نقابة المهندسين',discount_card_no:'N-1',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/n1.jpg'};
 const a1=(await cmd('book',{patient_id:A,provider_id:provider,service_id:consult,starts_at:date+'T09:00:00Z',same_day_ok:true,...syn})).id;
 await cmd('arrive',{id:a1});let {v,orders}=await ordersOf(a1);assert.equal(+orders[0].discount,30);
 await cmd('order_add',{visit_id:v.id,service_id:physio,provider_id:provider,quantity:1});({orders}=await ordersOf(a1));
 const ph=orders.find(o=>o.service_id===physio);assert.equal(+ph.discount,30,'added service gets the union 30% automatically');
 assert.equal(orders.reduce((t,o)=>t+o.price*(1-o.discount/100),0),700,'500+500 → 700');
 const why=await q('select reason,status from clinic_reception.discount_requests where order_id=$1',[ph.id]);assert.equal(why[0].status,'approved');assert.match(why[0].reason,/^خصم الحجز: .*\(نفس خصم الزيارة\)$/);
 // (2) generic approved discount 30% on the consult (نعمه) → physio has none → order_discount refused (one discount) → «نفس خصم الزيارة»
 const a2=(await cmd('book',{patient_id:B,provider_id:provider,service_id:consult,starts_at:date+'T10:00:00Z',same_day_ok:true})).id;await cmd('arrive',{id:a2});
 ({v,orders}=await ordersOf(a2));const c2=orders[0];
 await cmd('discount',{id:c2.id,percent:'30',reason:'نقابة — كارنيه 77'});
 await assert.rejects(()=>cmd('discount',{id:c2.id,percent:'30',reason:'نقابة — كارنيه 77'}),/عليها طلب خصم بالفعل|بانتظار المراجعة/,'no duplicate request');
 await assert.rejects(()=>cmd('visit_same_discount',{visit_id:v.id}),/مفيش عليها خصم معتمد/,'pending is not enough');
 await q("update clinic_reception.discount_requests set status='approved',reviewed_by=$2 where order_id=$1",[c2.id,id(1)]);await q('update clinic_reception.orders set discount=30 where id=$1',[c2.id]);
 await assert.rejects(()=>cmd('discount',{id:c2.id,percent:'10',reason:'تاني'}),/عليها طلب خصم بالفعل/,'approved → no new request');
 await cmd('order_add',{visit_id:v.id,service_id:physio,provider_id:provider,quantity:1});({orders}=await ordersOf(a2));let p2=orders.find(o=>o.service_id===physio);
 assert.equal(+p2.discount,0,'generic discount is not copied automatically');
 await assert.rejects(()=>cmd('order_discount',{order_id:p2.id,discount_kind:'special',discount_percent:'10',discount_reason:'تاني'}),/خصم/,'a DIFFERENT second discount still refused');
 const r=await cmd('visit_same_discount',{visit_id:v.id});assert.equal(+r.percent,30);assert.equal(r.services,1);
 ({orders}=await ordersOf(a2));p2=orders.find(o=>o.service_id===physio);assert.equal(+p2.discount,30);
 assert.equal(orders.reduce((t,o)=>t+o.price*(1-o.discount/100),0),700);
 assert.match((await q('select reason from clinic_reception.discount_requests where order_id=$1',[p2.id]))[0].reason,/^نفس خصم الزيارة: نقابة — كارنيه 77$/);
 await assert.rejects(()=>cmd('visit_same_discount',{visit_id:v.id}),/عليها الخصم بالفعل/);
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='visit_same_discount'"))[0].n,1);
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123130000_visit_discount_all_services.rollback.sql','utf8'));
 await as(3);await assert.rejects(()=>cmd('visit_same_discount',{visit_id:v.id}));
 console.log('PASS visit discount all services: booking discount copied to a service added later (500+500 → 700), approved generic discount copied by «نفس خصم الزيارة», different 2nd discount refused, no duplicate generic request, pending not enough, rollback — as a reception user');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
