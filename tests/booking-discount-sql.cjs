// Owner 2026-11-21: optional discount on a booking (نقابة / نادي / أخرى or خاص) on the real reception functions — card
// number + valid-until + photo required, 30% maximum applied at arrival, exclusive
// (no second discount on the visit), edit/clear before arrival, expired card blocks arrival, packages excluded, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','booking_discount']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(1);return r;};
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:400,minutes:15,bom:[]});s=await snap();const svc=s.services.find(x=>x.code==='KSF').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T06:00:00Z',ends_at:date+'T20:00:00Z'});
 const syn={discount_kind:'syndicate',discount_org_type:'syndicate',discount_org_name:'نقابة المهندسين',discount_card_no:'12345',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/card.jpg',discount_percent:'10'};
 const book=(m,extra)=>cmd('book',{patient_id:patient,provider_id:provider,service_id:svc,starts_at:date+'T'+m+':00Z',same_day_ok:true,...extra});
 for(const [bad,re] of [[{discount_card_no:''},/الكارنيه إجباري/],[{discount_card_expiry:''},/ساري/],[{discount_card_expiry:'2020-01-01'},/منتهي/],[{discount_card_path:''},/صورة الكارنيه/],[{discount_org_type:'x'},/الجهة/],[{discount_org_name:'ن'},/اسم الجهة/],[{discount_percent:'0'},/نسبة/],[{discount_percent:'31'},/أقصى خصم/]])
  await assert.rejects(()=>book('07:00',{...syn,...bad}),re);
 s=await snap();assert.equal(s.appointments.length,0,'refused discount books nothing');
 const a1=(await book('07:00',syn)).id;s=await snap();const ap=s.appointments.find(x=>x.id===a1);
 assert.equal(ap.discount_kind,'syndicate');assert.equal(ap.discount_org_name,'نقابة المهندسين');assert.equal(+ap.discount_percent,10);
 await cmd('arrive',{id:a1});s=await snap();const o1=s.orders.find(o=>s.visits.find(v=>v.id===o.visit_id).appointment_id===a1);
 assert.equal(+o1.discount,10,'≤ 30% applied at arrival');
 const dr=(await q('select status,reason from clinic_reception.discount_requests where order_id=$1',[o1.id]))[0];assert.equal(dr.status,'approved');assert.match(dr.reason,/^خصم الحجز: نقابة — نقابة المهندسين — كارنيه 12345/);
 await assert.rejects(()=>cmd('discount',{id:o1.id,percent:'3',reason:'خصم إضافي'}),/مينفعش خصم تاني/,'exclusive');
 // owner: 30% is the maximum (one constant); 30% itself is applied at arrival
 await assert.rejects(()=>book('09:00',{...syn,discount_percent:'40'}),/أقصى خصم على الحجز 30/);
 const a2=(await book('09:00',{...syn,discount_percent:'30'})).id;await cmd('arrive',{id:a2});s=await snap();const o2=s.orders.find(o=>s.visits.find(v=>v.id===o.visit_id).appointment_id===a2);
 assert.equal(+o2.discount,30);assert.equal((await q('select status from clinic_reception.discount_requests where order_id=$1',[o2.id]))[0].status,'approved');
 // special discount needs a reason; edit + clear before arrival; no booking discount → normal
 await assert.rejects(()=>book('11:00',{discount_kind:'special',discount_percent:'5',discount_reason:''}),/سبب/);
 const a3=(await book('11:00',{discount_kind:'special',discount_percent:'5',discount_reason:'موظف المركز'})).id;
 await cmd('booking_discount',{id:a3,discount_kind:''});s=await snap();assert.equal(s.appointments.find(x=>x.id===a3).discount_kind,null,'cleared');
 await cmd('arrive',{id:a3});s=await snap();const o3=s.orders.find(o=>s.visits.find(v=>v.id===o.visit_id).appointment_id===a3);assert.equal(+o3.discount,0);
 await cmd('discount',{id:o3.id,percent:'3',reason:'خصم عادي'});s=await snap();assert.equal(+s.orders.find(o=>o.id===o3.id).discount,3,'other bookings keep the normal discount');
 await assert.rejects(()=>cmd('booking_discount',{id:a3,...syn}),/قبل وصول المريض/);
 // card expires before arrival → arrival blocked until the discount is removed
 const a4=(await book('13:00',syn)).id;await db.exec('reset role');await db.query("update clinic_reception.appointments set discount_card_expiry=current_date-1 where id=$1",[a4]);await as(1);
 await assert.rejects(()=>cmd('arrive',{id:a4}),/منتهي/);await cmd('booking_discount',{id:a4,discount_kind:''});await cmd('arrive',{id:a4});
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261121180000_booking_discount.rollback.sql','utf8'));
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('command_before_booking_discount','set_booking_discount','booking_discount_apply')")).rows[0].n,0,'rollback');
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='appointments' and column_name like 'discount_%'")).rows[0].n,0);
 console.log('PASS booking discount: validation, 1–30% applied at arrival, above 30% refused, exclusive, special, edit/clear, expired card, rollback');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
