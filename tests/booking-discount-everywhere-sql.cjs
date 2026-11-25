// 20261123060000 (owner 2026-11-23 «لا نقابات ولا خصومات»): base = tests/discount-vezeeta-family-sql.cjs.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const fam=(a,p)=>rpc('clinic_reception_family',{p_workspace:w,p_action:a,p_payload:p});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(1);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]});s=await snap();const svc=s.services.find(x=>x.code==='KSF').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 const mk=async(n,ph)=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'F'+n,'مريض '+n,ph,id(1)]))[0].id;
 const A=await mk(1,'01000000001'),B=await mk(2,'01000000002'),C=await mk(3,'0100 000 0001'),D=await mk(4,'01000000004');
 let slot=4*60;const nowMin=(()=>{const d=new Date();return d.getUTCHours()*60+d.getUTCMinutes();})();
 // booked slots skip ±75 min around NOW: the walk-ins below take the current time, so a slot there overlapped («الموعد يتداخل مع حجز قائم») at some hours of the day
 const next=()=>{do slot+=20;while(Math.abs(slot-nowMin)<75);const h=String(Math.floor(slot/60)).padStart(2,'0'),m=String(slot%60).padStart(2,'0');return date+'T'+h+':'+m+':00Z';};
 const book=(pat,extra)=>cmd('book',{patient_id:pat,provider_id:provider,service_id:svc,starts_at:next(),same_day_ok:true,...extra});
 const orderOf=async ap=>{const s2=await snap();return s2.orders.find(o=>s2.visits.find(v=>v.id===o.visit_id).appointment_id===ap);};

 const syn={discount_kind:'syndicate',discount_percent:'30',discount_org_type:'syndicate',discount_org_name:'نقابة الأطباء',discount_card_no:'N-1',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/n1.jpg'};
 const ap=async i=>(await snap()).appointments.find(x=>x.id===i);
 // BEFORE: walk-in silently drops the discount; reschedule cannot change it; nothing after arrival
 const wb=(await cmd('walk_in',{patient_id:A,provider_id:provider,service_id:svc,...syn})).id;assert.equal((await ap(wb)).discount_kind,null,'bug before: walk-in drops the discount');
 await cmd('cancel',{id:wb,reason:'تجربة'}).catch(()=>{});
 await assert.rejects(()=>cmd('order_discount',{order_id:randomUUID(),...syn}));
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await db.exec('reset role');const M=fs.readFileSync('supabase/migrations/20261123060000_booking_discount_everywhere.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');await as(3);
 // (c) walk-in keeps the discount → applied at arrival like a normal booking (reception user)
 const wk=(await cmd('walk_in',{patient_id:B,provider_id:provider,service_id:svc,...syn})).id;
 let a=await ap(wk);assert.equal(a.discount_kind,'syndicate');assert.equal(+a.discount_percent,30);
 await cmd('arrive',{id:wk});let o=await orderOf(wk);assert.equal(+o.discount,30,'walk-in discount applied at arrival');
 await assert.rejects(()=>cmd('walk_in',{patient_id:C,provider_id:provider,service_id:svc,...syn,discount_card_no:''}),/الكارنيه إجباري/);
 // (a) reschedule: change the discount, then clear it with an empty kind; without the key it stays untouched
 const r1=(await book(C,{})).id;assert.equal((await ap(r1)).discount_kind,null);
 const a1=await ap(r1);
 const rs=p=>cmd('reschedule',{id:r1,patient_id:C,provider_id:provider,service_id:svc,starts_at:a1.starts_at,same_day_ok:true,...p});
 const r1b=(await rs(syn)).id||r1;assert.equal((await ap(r1b)).discount_org_name,'نقابة الأطباء','discount added on edit');
 await rs({discount_kind:'special',discount_percent:'15',discount_reason:'قريب موظف'});a=await ap(r1b);assert.equal(a.discount_kind,'special');assert.equal(+a.discount_percent,15);
 await rs({});assert.equal((await ap(r1b)).discount_kind,'special','no key → unchanged');
 await rs({discount_kind:''});assert.equal((await ap(r1b)).discount_kind,null,'empty kind clears');
 // (b) booking_discount on an existing booked appointment (the ⋯ «خصم» item): set / clear
 await cmd('booking_discount',{id:r1b,...syn});assert.equal((await ap(r1b)).discount_kind,'syndicate');
 await cmd('booking_discount',{id:r1b,discount_kind:''});assert.equal((await ap(r1b)).discount_kind,null);
 // (d) after arrival, service still «ordered»: نقابة 30% → 500 → 350, auto-approved, audited; one per visit
 const r2=(await book(D,{})).id;await cmd('arrive',{id:r2});o=await orderOf(r2);assert.equal(o.status,'ordered');
 await assert.rejects(()=>cmd('order_discount',{order_id:o.id,...syn,discount_percent:'35'}),/أقصى خصم/);
 await assert.rejects(()=>cmd('order_discount',{order_id:o.id,...syn,discount_card_expiry:'2020-01-01'}),/منتهي/);
 const od=await cmd('order_discount',{order_id:o.id,...syn});assert.equal(od.status,'approved');assert.equal(+od.net,350);
 o=await orderOf(r2);assert.equal(+o.discount,30);assert.equal((await ap(r2)).discount_kind,'syndicate','kept on the booking for the record');
 const dr=await q("select percent,status,reason from clinic_reception.discount_requests where order_id=$1",[o.id]);assert.equal(dr.length,1);assert.match(dr[0].reason,/خصم الحجز: نقابة — نقابة الأطباء — كارنيه N-1 \(بعد الوصول\)/);
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='order_discount' and entity_id=$1",[o.id]))[0].n,1);
 await assert.rejects(()=>cmd('order_discount',{order_id:o.id,discount_kind:'special',discount_percent:'5',discount_reason:'تاني'}),/خصم بالفعل/);
 await assert.rejects(()=>cmd('discount',{order_id:o.id,percent:5,reason:'تجربة'}),/خصم/,'generic discount still exclusive');
 // a visit whose booking already had a discount: refused; vezeeta fixed 40 after arrival
 o=await orderOf(wk);await assert.rejects(()=>cmd('order_discount',{order_id:o.id,discount_kind:'special',discount_percent:'5',discount_reason:'تاني'}),/خصم بالفعل/);
 const r3=(await book(A,{})).id;await cmd('arrive',{id:r3});o=await orderOf(r3);
 assert.equal(+(await cmd('order_discount',{order_id:o.id,discount_kind:'vezeeta',discount_card_no:'VZ9',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/v9.jpg',discount_percent:'10'})).percent,40);
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123060000_booking_discount_everywhere.rollback.sql','utf8'));
 assert.equal((await q("select to_regprocedure('clinic_reception.order_discount(uuid,uuid,jsonb,uuid)') r"))[0].r,null);
 await as(3);await assert.rejects(()=>cmd('order_discount',{order_id:o.id,...syn}));
 console.log('PASS booking discount everywhere: walk-in keeps the discount (was dropped), reschedule sets/changes/clears it, booking_discount on an existing booking, after-arrival discount on an ordered service (caps, card expiry, auto-approved, audited, one per visit), rollback — as a reception user');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
