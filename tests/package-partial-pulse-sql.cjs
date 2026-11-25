// 20261125130000 «من الباكج» for laser PULSE packages: one entitlement line (pulse service × 1000) is drawn down over several visits
// by the device meter — 320 today, 680 next visit — instead of being used once. Non-pulse sessions keep the once-only rule.
// Real reception functions (PGlite), reception user, live workspace. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_laser_meter']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ago=n=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t}),snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const pulse=(await cmd('service',{code:'PLS',name:'سعر النبضة الواحدة كانديلا',department:dept,price:2,minutes:20,bom:[]})).id;
 const hand=(await cmd('service',{code:'LZH',name:'جلسة ليزر نص اليدين',department:dept,price:400,minutes:20,bom:[]})).id;
 for(const code of ['PLS','LZH']){const ag=(await cmd('agreement',{provider_id:provider,service_code:code,rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG-'+code})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);}
 const dev=(await cmd('device',{code:'CAN1',name:'كانديلا',meter_kind:'shots'})).id;
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 await db.exec('reset role');
 await db.exec("insert into clinic_reception.laser_pulse_services values('PLS') on conflict do nothing");
 await db.exec(`create schema if not exists clinic_finance;create table if not exists clinic_finance.accounts(code text primary key,name text not null,kind text not null);
   insert into clinic_finance.accounts values('2151','مقدمات باكجات','liability') on conflict do nothing;
   create or replace function clinic_finance.lock_day() returns void language sql as $$select$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261123110000_legacy_prepaid_package.sql','utf8'));
 await as(1);
 // a 1000-pulse package (1600 = 1.6 / pulse) + a normal 2-session package, both sold to the patient
 const tP=(await cmd('template',{code:'P1000',name:'باكج 1000 نبضة',price:'1600',visits:1,validity_days:120,terms:'نبضات',lines:[{visit_no:1,service_id:pulse,quantity:'1000'}]})).id;
 const tH=(await cmd('template',{code:'H2',name:'باكج نص اليدين جلستين',price:'600',visits:2,validity_days:120,terms:'جلسات',lines:[1,2].map(n=>({visit_no:n,service_id:hand,quantity:'1'}))})).id;
 await as(3);const P=(await cmd('package_sell',{patient_id:patient,template_id:tP})).id;const H=(await cmd('package_sell',{patient_id:patient,template_id:tH})).id;
 const visit=async(svc,at)=>{await as(1);const ap=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:svc,starts_at:date+'T'+at+':00Z',same_day_ok:true})).id;await as(3);
  await cmd('arrive',{id:ap});const s2=await snap();const v=s2.visits.find(x=>x.appointment_id===ap);return s2.orders.find(x=>x.visit_id===v.id&&x.status==='ordered');};
 const sessions=async()=>(await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient})).sessions;
 const ent=async e=>(await q('select used,recognized,quantity from clinic_reception.entitlements where id=$1',[e]))[0];
 const run=(a,p)=>cmd(a,p).then(r=>r,e=>({error:e.message}));
 // apply (the once-only rule that remains for normal sessions is checked at the end)
 await db.exec('reset role');const M=fs.readFileSync('supabase/migrations/20261125130000_package_partial_pulse.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');await as(3);
 // visit 1: attach the ordered pulse service → takes the 1000 remaining pulses at 1.6
 let ss=await sessions();let sp=ss.find(x=>x.service_id===pulse);assert(sp,'pulse session listed');assert.equal(sp.pulses,true);assert.equal(+sp.remaining,1000);assert.equal(+sp.quantity,1000);
 const o1=await visit(pulse,'08:00');let u=await cmd('order_use_package',{order_id:o1.id,entitlement_id:sp.entitlement_id});
 assert.equal(u.pulses,true);assert.equal(+u.remaining,1000);
 let ord=(await q('select quantity,price from clinic_reception.orders where id=$1',[o1.id]))[0];assert.equal(+ord.quantity,1000);assert.equal(+ord.price,1.6);
 // execute with the meter: 5000 → 5320 = 320 pulses
 await cmd('execute',{id:o1.id,device_id:dev,minutes:'20',meter_before:'5000',meter_after:'5320',additional_confirmed:false});
 let e=await ent(sp.entitlement_id);assert.equal(+e.used,320);assert.equal(+e.recognized,512,'320 × 1.6');
 // still listed with 680 left; visit 2 takes the rest exactly
 ss=await sessions();sp=ss.find(x=>x.service_id===pulse);assert(sp,'still listed after a partial visit');assert.equal(+sp.remaining,680);
 const o2=await visit(pulse,'09:00');u=await cmd('order_use_package',{order_id:o2.id,entitlement_id:sp.entitlement_id});assert.equal(+u.remaining,680);
 ord=(await q('select quantity,price from clinic_reception.orders where id=$1',[o2.id]))[0];assert.equal(+ord.quantity,680);assert.equal(+ord.price,1.6);
 // more pulses than remain → refused by the laser execute; then 680 exactly
 assert.match((await run('execute',{id:o2.id,device_id:dev,minutes:'20',meter_before:'6000',meter_after:'6700',additional_confirmed:false})).error,/تتجاوز الرصيد/);
 await cmd('execute',{id:o2.id,device_id:dev,minutes:'20',meter_before:'6000',meter_after:'6680',additional_confirmed:false});
 e=await ent(sp.entitlement_id);assert.equal(+e.used,1000);assert.equal(+e.recognized,1600,'exact remainder recognized');
 ss=await sessions();assert(!ss.find(x=>x.service_id===pulse),'used up → not listed');
 const o3=await visit(pulse,'10:00');assert.match((await run('order_use_package',{order_id:o3.id,entitlement_id:sp.entitlement_id})).error,/نبضات الباكج دي خلصت/);
 // a second OPEN order cannot hold the same pulse line twice (a new 1000-pulse package, attached to o3, then o4 tries the same line)
 const P2=(await cmd('package_sell',{patient_id:patient,template_id:tP})).id;const sp2=(await sessions()).find(x=>x.service_id===pulse);
 await cmd('order_use_package',{order_id:o3.id,entitlement_id:sp2.entitlement_id});
 const o4=await visit(pulse,'11:00');assert.match((await run('order_use_package',{order_id:o4.id,entitlement_id:sp2.entitlement_id})).error,/اتستخدمت/,'one open order per pulse line');
 // NON-pulse sessions: unchanged once-only rule
 const sh=(await sessions()).find(x=>x.service_id===hand);assert.equal(sh.pulses,false);assert.equal(sh.left,2);
 const h1=await visit(hand,'12:00');u=await cmd('order_use_package',{order_id:h1.id,entitlement_id:sh.entitlement_id});assert.equal(u.pulses,undefined);assert.equal(u.left,1);
 await cmd('execute',{id:h1.id});
 const h2=await visit(hand,'13:00');assert.match((await run('order_use_package',{order_id:h2.id,entitlement_id:sh.entitlement_id})).error,/اتستخدمت/,'normal session still once');
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261125130000_package_partial_pulse.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.pulse_entitlement(uuid)') r")).rows[0].r,null);
 await as(3);assert(!(await sessions()).some(x=>x.pulses!==undefined),'rollback restores the old session list');
 console.log('PASS package partial pulse: a 1000-pulse line is drawn 320 + 680 over two visits through «من الباكج» (quantity = remaining, unit price = remaining value, meter decides, over-draw refused, exact remainder), listed with remaining pulses until used up, one open order per line; normal sessions keep the once-only rule; rollback restores.');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
