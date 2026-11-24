// 20261123200000 (owner 2026-11-24 «العروض ملهاش اي خصومات تانية»): a service priced by an active offer takes no desk discount.
// Manual paths refuse with «السعر ده عرض — مفيش خصم تاني عليه»; automatic ones skip the offer service only. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const ksf=(await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]})).id;
 const ofr=(await cmd('service',{code:'OFR',name:'ليزر عرض الجمعة',department:dept,price:400,minutes:15,bom:[]})).id;
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 await db.exec('reset role');
 for(const m of ['20261123060000_booking_discount_everywhere','20261123130000_visit_discount_all_services'])await db.exec(fs.readFileSync('supabase/migrations/'+m+'.sql','utf8'));
 await db.exec("alter table clinic_reception.services add column if not exists pricing_evidence jsonb");
 await db.query("update clinic_reception.services set pricing_evidence=$2 where id=$1",[ofr,{price:400,source:'offer',reason:'عرض: الجمعة البيضا'}]);
 await db.query("update clinic_reception.services set pricing_evidence=$2 where id=$1",[ksf,{price:500,source:'price_list'}]);
 const M=fs.readFileSync('supabase/migrations/20261123200000_offer_no_other_discount.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 const syn={discount_kind:'syndicate',discount_percent:'30',discount_org_type:'syndicate',discount_org_name:'نقابة الأطباء',discount_card_no:'N-1',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/n1.jpg'};
 let slot=4*60;const next=()=>{slot+=20;return date+'T'+String(Math.floor(slot/60)).padStart(2,'0')+':'+String(slot%60).padStart(2,'0')+':00Z';};
 const mk=async n=>(await q("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,$4,$5) returning id",[w,'F'+n,'مريض '+n,'0100000000'+n,id(1)]))[0].id;
 const P1=await mk(1),P2=await mk(2),P3=await mk(3);
 const OFFER=/السعر ده عرض — مفيش خصم تاني عليه/;
 // 1) booking discount on an offer booking: refused (book / booking_discount / walk_in); the normal service still takes it
 await assert.rejects(()=>cmd('book',{patient_id:P1,provider_id:provider,service_id:ofr,starts_at:next(),same_day_ok:true,...syn}),OFFER);
 const b1=(await cmd('book',{patient_id:P1,provider_id:provider,service_id:ofr,starts_at:next(),same_day_ok:true})).id;
 await assert.rejects(()=>cmd('booking_discount',{id:b1,...syn}),OFFER);
 await cmd('booking_discount',{id:b1,discount_kind:''});   // clearing is always allowed
 await assert.rejects(()=>cmd('walk_in',{patient_id:P2,provider_id:provider,service_id:ofr,...syn}),OFFER);
 const b2=(await cmd('book',{patient_id:P2,provider_id:provider,service_id:ksf,starts_at:next(),same_day_ok:true,...syn})).id;
 // 2) arrival: the normal service gets its 30 %; an offer service added to the same visit stays at 0 % (no request row)
 await cmd('arrive',{id:b2});s=await snap();const v2=s.visits.find(v=>v.appointment_id===b2);
 assert.equal(+s.orders.find(o=>o.visit_id===v2.id&&o.service_id===ksf).discount,30);
 await cmd('order_add',{visit_id:v2.id,service_id:ofr,provider_id:provider,quantity:1});s=await snap();
 const o2=s.orders.find(o=>o.visit_id===v2.id&&o.service_id===ofr);assert.equal(+o2.discount,0,'offer service added later: no discount');
 assert.equal((await q('select count(*)::int n from clinic_reception.discount_requests where order_id=$1',[o2.id]))[0].n,0);
 // 3) manual discounts on the offer order are refused with the reason
 await assert.rejects(()=>cmd('order_discount',{order_id:o2.id,...syn}),OFFER);
 await assert.rejects(()=>cmd('discount',{id:o2.id,percent:'10',reason:'خصم خاص'}),OFFER);
 await assert.rejects(()=>cmd('visit_same_discount',{visit_id:v2.id}),OFFER,'only the offer service is still open');
 // 4) a visit with only the offer service: arrival keeps price 400, no discount
 await cmd('arrive',{id:b1});s=await snap();const o1=s.orders.find(o=>o.visit_id===s.visits.find(v=>v.appointment_id===b1).id);
 assert.deepEqual([+o1.price,+o1.discount],[400,0]);
 // 5) rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123200000_offer_no_other_discount.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.order_is_offer(uuid)') r")).rows[0].r,null);
 console.log('PASS offer = no other discount: booking discount refused on an offer booking (book / booking_discount / walk-in), clearing allowed; arrival gives the normal service its 30 % and an offer service added later stays at 0 % (no request row); order_discount / generic discount / «نفس خصم الزيارة» refused on the offer with the reason; rollback clean.');
})().catch(e=>{console.error(e);process.exit(1);});
