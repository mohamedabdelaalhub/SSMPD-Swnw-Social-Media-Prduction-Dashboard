// 20261123170000 package offers: sell window (Cairo dates) refuses a sale outside it; min first payment % snapshotted at sale;
// payments towards the package must reach max(%, owed ÷ visits left) (first: the %), paying everything owed is always allowed;
// the first package session needs funded ≥ the %. Packages without a rule (NULL) behave as before. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ago=n=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t}),snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const svc=(await cmd('service',{code:'LZ1',name:'جلسة ليزر تجربة',department:dept,price:1200,minutes:20,bom:[]})).id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'LZ1',rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 const tpl=async code=>(await cmd('template',{code,name:'عرض ليزر 4 جلسات',price:'4000',visits:4,validity_days:120,terms:'عرض الموسم',lines:[1,2,3,4].map(n=>({visit_no:n,service_id:svc,quantity:'1'}))})).id;
 const plain=await tpl('PLAIN');const T=await tpl('OFFER');
 await db.exec('reset role');
 const M=fs.readFileSync('supabase/migrations/20261123170000_package_offers.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await db.query('update clinic_reception.package_templates set min_first_percent=25 where id=$1',[T]);
 await as(3);
 // window
 await q('update clinic_reception.package_templates set sell_until=$2 where id=$1',[T,ago(1)]);
 await assert.rejects(()=>cmd('package_sell',{patient_id:patient,template_id:T}),/العرض ده خلص يوم/);
 await q("update clinic_reception.package_templates set sell_until=null, sell_from=$2::date+2 where id=$1",[T,date]);
 await assert.rejects(()=>cmd('package_sell',{patient_id:patient,template_id:T}),/لسه ما بداش/);
 await q('update clinic_reception.package_templates set sell_from=$2, sell_until=$2 where id=$1',[T,date]);
 const P=(await cmd('package_sell',{patient_id:patient,template_id:T})).id;
 let k=(await q('select * from clinic_reception.packages where id=$1',[P]))[0];assert.equal(+k.min_first_percent,25,'snapshot');assert.equal(+k.contract_price,4000);
 assert.equal(String(k.expires_on.toISOString?k.expires_on.toISOString().slice(0,10):k.expires_on).slice(0,10),(await q("select (current_date+120)::text d"))[0].d,'4 months = 120 days (the sale stamps expires_on from the server date — not the Cairo date the test uses for the sell window; they differ 22:00–24:00 UTC)');
 const minNow=async()=>(await q('select clinic_reception.package_min_payment($1) m',[P]))[0].m;
 let m=await minNow();assert.deepEqual([m.first,+m.minimum,+m.owed],[true,1000,4000]);
 const pay=(amount,ref)=>cmd('collect',{patient_id:patient,package_id:P,method:'wallet',reference:ref,amount:String(amount)});
 // first session before any payment → refused
 await as(1);const ap=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:svc,starts_at:date+'T09:00:00Z',same_day_ok:true})).id;await as(3);
 await cmd('arrive',{id:ap});s=await snap();const visit=s.visits.find(v=>v.appointment_id===ap);const o=s.orders.find(x=>x.visit_id===visit.id);
 const ent=(await q('select id from clinic_reception.entitlements where package_id=$1 order by visit_no limit 1',[P]))[0].id;
 await q('update clinic_reception.orders set entitlement_id=$2, price=1000 where id=$1',[o.id,ent]);
 await assert.rejects(()=>cmd('execute',{id:o.id}),/لازم المريض يدفع 25 ٪ من الباكج \(1,000.00 ج.م\) قبل أول جلسة/);
 // payments
 await assert.rejects(()=>pay(500,'W-1'),/أقل دفعة للباكج دلوقتي 1,000.00 ج.م/);
 await pay(1000,'W-2');m=await minNow();assert.deepEqual([m.first,+m.minimum,+m.owed],[false,1000,3000],'later: max(25% = 1000, 3000 ÷ 4 = 750)');
 await cmd('execute',{id:o.id});k=(await q('select * from clinic_reception.packages where id=$1',[P]))[0];assert(+k.recognized>0,'first session executed once 25% paid');
 await assert.rejects(()=>pay(900,'W-3'),/أقل دفعة/);await pay(1000,'W-4');
 m=await minNow();assert.equal(+m.owed,2000);await pay(2000,'W-5');m=await minNow();assert.equal(+m.owed,0);
 // a package without a rule: any amount, first session without payment (today's behaviour)
 const P2=(await cmd('package_sell',{patient_id:patient,template_id:plain})).id;assert.equal((await q('select min_first_percent from clinic_reception.packages where id=$1',[P2]))[0].min_first_percent,null);
 await cmd('collect',{patient_id:patient,package_id:P2,method:'wallet',reference:'W-9',amount:'50'});
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123170000_package_offers.rollback.sql','utf8'));
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_schema='clinic_reception' and column_name in ('min_first_percent','sell_from','sell_until')")).rows[0].n,0);
 console.log('PASS package offers: sell window refuses before / after (Cairo date), sale inside it snapshots 25 % and 120-day validity; first session refused until 25 % paid; payments below max(25 %, owed ÷ visits left) refused, full remainder allowed; a package without a rule unchanged; rollback clean.');
})().catch(e=>{console.error(e);process.exit(1);});
