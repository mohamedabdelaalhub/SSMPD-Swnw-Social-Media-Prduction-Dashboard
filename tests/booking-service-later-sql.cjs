// Owner 2026-11-22: «الخدمة تتحدد عند الحضور» on the real reception functions — book the doctor's time with an inactive
// per-department placeholder, service required at arrival (department / scope / length re-checked), order + price from the
// real service, discount / package refused, «تعديل الحجز» keeps or replaces it, placeholders never listed, rollback.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_manual_overbook','reception_lab_units','reception_booking_qty_continuation_no_answer','reception_arrival_sessions','booking_service_later'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const long=(await cmd(live,'service',{code:'DERM60',name:'جلسة طويلة',department:'جلدية',price:300,minutes:60,bom:[]})).id;
await cmd(live,'service',{code:'LAB9',name:'تحليل',department:'التحاليل',price:50,minutes:10,bom:[]});
const lab9=(await snap(live)).services.find(x=>x.code==='LAB9').id;
const book=(p,t)=>cmd(live,'book',{patient_id:pat,provider_id:provider,starts_at:date+'T'+t+':00Z',same_day_ok:true,...p});
// refused combinations
await assert.rejects(()=>book({service_later:true,discount_kind:'special',discount_percent:'5',discount_reason:'x'},'10:00'),/الخصم بيتحدد مع الخدمة/);
await assert.rejects(()=>book({service_later:true,package_id:'61000000-0000-4000-8000-000000000999'},'10:00'),/الباكج/);
const a1=(await book({service_later:true},'10:00')).id;
let s=await snap(live);const ap=s.appointments.find(x=>x.id===a1);
assert.equal(ap.service_later,true);assert.equal(ap.service_name,'الخدمة تتحدد عند الحضور');
assert.equal((Date.parse(ap.ends_at)-Date.parse(ap.starts_at))/60000,30,'department default 30 minutes');
const ph=s.service_later.find(x=>x.department==='جلدية');assert(ph&&ph.id===ap.service_id&&ph.minutes===30,'snapshot lists the placeholder');
assert(!s.services.some(x=>x.placeholder||x.id===ph.id),'placeholder never in the service list (inactive)');
assert.equal((await q('select active from clinic_reception.services where id=$1',[ph.id]))[0].active,false);
// booking by the placeholder id also works (what the screen sends) + chosen length
const a2=(await book({service_id:ph.id,minutes:'45'},'12:00')).id;s=await snap(live);const ap2=s.appointments.find(x=>x.id===a2);
assert.equal(ap2.service_later,true);assert.equal((Date.parse(ap2.ends_at)-Date.parse(ap2.starts_at))/60000,45);
// a normal booking right after a1
await book({service_id:service},'10:35');
// arrival: service required, of the doctor's department, and must fit
await assert.rejects(()=>cmd(live,'arrive',{id:a1}),/تتحدد عند الحضور/);
await assert.rejects(()=>cmd(live,'arrive',{id:a1,service_id:ph.id}),/تتحدد عند الحضور/,'placeholder is not a choice');
await assert.rejects(()=>cmd(live,'arrive',{id:a1,service_id:lab9}),/مش من خدمات الدكتور/);
await assert.rejects(()=>cmd(live,'arrive',{id:a1,service_id:long}),/أطول من الوقت المحجوز|لازم/);
s=await snap(live);assert.equal(s.appointments.find(x=>x.id===a1).status,'booked','refused arrival changes nothing');
assert.equal(s.appointments.find(x=>x.id===a1).service_later,true);
const v1=(await cmd(live,'arrive',{id:a1,service_id:service,encounter_type:'session'})).id;s=await snap(live);
const o1=s.orders.find(o=>o.visit_id===v1);assert.equal(o1.service_id,service);assert.equal(+o1.price,100,'real price at arrival');
const done=s.appointments.find(x=>x.id===a1);assert.equal(done.service_later,false);assert.equal(done.service_id,service);
assert.equal(s.orders.filter(o=>o.service_id===ph.id).length,0,'no order ever carries the placeholder');
// placeholder cannot be ordered on a visit
await assert.rejects(()=>cmd(live,'order_add',{visit_id:v1,service_id:ph.id,provider_id:provider,quantity:'1'}));
// «تعديل الحجز»: keeps «تتحدد عند الحضور» without a service, a real service ends it
await cmd(live,'reschedule',{id:a2,starts_at:date+'T13:00:00Z',same_day_ok:true});s=await snap(live);
assert.equal(s.appointments.find(x=>x.id===a2).service_later,true);assert.equal(s.appointments.find(x=>x.id===a2).service_id,ph.id);
await cmd(live,'reschedule',{id:a2,service_id:service,starts_at:date+'T13:00:00Z',same_day_ok:true});s=await snap(live);
assert.equal(s.appointments.find(x=>x.id===a2).service_later,false);assert.equal(s.appointments.find(x=>x.id===a2).service_id,service);
await cmd(live,'reschedule',{id:a2,service_later:true,starts_at:date+'T13:00:00Z',same_day_ok:true});s=await snap(live);
assert.equal(s.appointments.find(x=>x.id===a2).service_later,true,'back to «تتحدد عند الحضور»');
assert.equal((await q('select count(*)::int n from clinic_reception.services where placeholder and active'))[0].n,0,'placeholders stay inactive');
// rollback refuses while a booking waits for its service
await db.exec('reset role');const rb=require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261122060000_booking_service_later.rollback.sql'))},'utf8');
await assert.rejects(()=>db.exec(rb),/لسه مستنية/);await db.exec('rollback').catch(()=>{});
await db.query("update clinic_reception.appointments set status='cancelled',cancel_reason='اختبار' where service_later and status='booked'");
await db.exec(rb);
assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('command_before_service_later','snapshot_before_service_later','service_later_id','provider_serves','has_provider_service_scope_before_later')")).rows[0].n,0,'rollback');
await as(1);s=await snap(live);assert.equal(s.service_later,undefined);
await db.close();console.log('PASS booking service later: placeholder booking (default / chosen length), discount + package refused, arrival requires a department service that fits, real order + price, reschedule keeps / ends it, placeholders hidden, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.service-later-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
