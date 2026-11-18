// Owner 2026-11-18 «كلهم بترتيب»: fallback step 1b — reconcile with Masa (list, import reception's Masa bookings, alerts).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_fallback_reconcile'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const api=async(op,p)=>(await q('select clinic_reception.fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p||{})]))[0].v;
const fb=(a,p)=>call('clinic_reception_fallback',[live,a,p||{}]);
const dalia=(await cmd(live,'provider',{name:'د/ داليا سعيد',department:'جلدية',branch:'حدائق الأهرام'})).id;
await q('select clinic_reception.masa_link_seed($1)',[live]);
await call('clinic_reception_weekly',[live,'save',{provider_id:dalia,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'10:00',ends:'12:00'}))}]);
const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+864e5));
const slots=async()=>(await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:1})).slots.map(x=>x.appointment_time);
assert.deepEqual(await slots(),['10:00','10:20','10:40','11:00','11:20','11:40']);
// a fallback booking and an agent booking already in Masa (mirrored in customer_bookings, doctor_id = Masa id)
assert((await api('book',{booking_request_id:'FB-1',masa_doctor_id:1130,appointment_date:tomorrow,appointment_time:'10:00',customer_name:'مريض احتياطي',phone:'01000000001'})).ok);
await q('alter table public.customer_bookings disable trigger user');await q("insert into public.customer_bookings(id,booking_request_id,official_booking_id,doctor_id,appointment_date,appointment_time,status,customer_name,phone) values(gen_random_uuid(),'AG-1','M-500','1132',$1,'10:20','confirmed','مريض واتساب','01000000002')",[tomorrow]);
assert.deepEqual(await slots(),['10:40','11:00','11:20','11:40'],'agent Masa booking blocks the fallback (1132 = same doctor)');
// masa_import: reception's own Masa bookings
const item={official_booking_id:'M-900',masa_doctor_id:1130,masa_specialization_id:400,appointment_date:tomorrow,appointment_time:'10:40',status:'active',needed_service:'كشف',patient_name:'مريض ماسا',phone:'010 0000 0003'};
let r=await api('masa_import',{items:[item,{...item,official_booking_id:'M-500'},{...item,official_booking_id:'M-901',masa_doctor_id:9999},{...item,official_booking_id:''}]});
assert.deepEqual([r.inserted,r.updated,r.skipped],[1,0,3],'known agent booking, unknown doctor and empty id are skipped: '+JSON.stringify(r));
r=await api('masa_import',{items:[item]});assert.deepEqual([r.inserted,r.updated,r.skipped],[0,0,1],'idempotent');
assert.deepEqual(await slots(),['11:00','11:20','11:40'],'import blocks the fallback');
assert.equal((await api('book',{booking_request_id:'FB-2',masa_doctor_id:1130,appointment_date:tomorrow,appointment_time:'10:40',customer_name:'مريض تاني',phone:'01000000004'})).error,'slot_taken');
r=await api('masa_import',{items:[{...item,appointment_time:'11:00'}]});assert.equal(r.updated,1,'moved in Masa');
assert.deepEqual(await slots(),['10:40','11:20','11:40']);
// reception can still book over a Masa import (they enter the same patient in both systems)
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
assert((await cmd(live,'book',{patient_id:pat,provider_id:dalia,service_id:svc,starts_at:(await q("select starts_at from clinic_reception.masa_bookings where official_booking_id='M-900'"))[0].starts_at,minutes:20})).id);
// reconcile_list: all three kinds, no names or phones
let L=(await api('reconcile_list',{date_from:tomorrow,date_to:tomorrow})).bookings;
assert.deepEqual(L.map(x=>[x.booking_request_id,x.source,x.status,x.official_booking_id,x.masa_doctor_id,x.appointment_time]),
 [['FB-1','whatsapp','pending',null,1130,'10:00'],['AG-1','whatsapp','confirmed','M-500',1132,'10:20'],['masa:M-900','masa_import','confirmed','M-900',1130,'11:00']]);
assert(!JSON.stringify(L).includes('مريض')&&!JSON.stringify(L).includes('0100'),'no names/phones');
assert.equal((await api('reconcile_list',{date_from:tomorrow,date_to:'2030-01-01'})).error,'invalid_range');
// cancelled in Masa → import cancelled, time free again for the fallback
r=await api('masa_import',{items:[{official_booking_id:'M-900',status:'cancelled'}]});assert.equal(r.updated,1);
assert.equal((await api('masa_import',{items:[{official_booking_id:'M-900',status:'cancelled'}]})).skipped,1);
assert.equal((await api('reconcile_list',{date_from:tomorrow,date_to:tomorrow})).bookings.find(x=>x.official_booking_id==='M-900').status,'cancelled');
// alerts: once per (kind, booking), shown to reception, resolvable
assert.deepEqual(await api('reconcile_flag',{booking_request_id:'FB-1',kind:'missing_in_masa',detail:'replayed but not in Masa list'}),{ok:true,created:true});
assert.deepEqual(await api('reconcile_flag',{booking_request_id:'FB-1',kind:'missing_in_masa',detail:'again'}),{ok:true,created:false});
assert((await api('reconcile_flag',{official_booking_id:'M-500',kind:'double_booked'})).created);
assert.equal((await api('reconcile_flag',{booking_request_id:'FB-1',kind:'bad'})).error,'invalid_kind');
let list=await fb('list');assert.equal(list.alerts.length,2);
const a1=list.alerts.find(x=>x.kind==='missing_in_masa');assert.equal(a1.customer_name,'مريض احتياطي');assert.equal(a1.appointment_time,'10:00');
assert.equal(list.bookings.length,1,'the fallback list is unchanged');
await fb('alert_resolve',{id:a1.id});assert.equal((await fb('list')).alerts.length,1);
await assert.rejects(()=>fb('alert_resolve',{id:a1.id}),/التنبيه/);
assert.equal((await api('reconcile_flag',{booking_request_id:'FB-1',kind:'missing_in_masa'})).created,false,'a resolved alert is not re-raised');
// active imports show to reception
await api('masa_import',{items:[{...item,official_booking_id:'M-902',appointment_time:'11:40'}]});
assert.deepEqual((await fb('list')).masa_imports.map(x=>[x.official_booking_id,x.patient_name,x.phone]),[['M-902','مريض ماسا','01000000003']]);
// the earlier ops still work through the wrapper
assert.equal((await api('status',{booking_request_id:'FB-1'})).status,'pending');assert.equal((await api('health')).ok,true);
await assert.rejects(()=>db.query("select clinic_reception.fallback_api('health','{}')"),/permission|denied/);
}
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261118170000_reception_fallback_reconcile.rollback.sql'))},'utf8'));
assert.equal((await db.query("select to_regclass('clinic_reception.masa_bookings') t")).rows[0].t,null);
assert.equal((await db.query("select clinic_reception.fallback_api('health','{}') v")).rows[0].v.ok,true,'step-1 API back after rollback');
await db.close();console.log('PASS fallback reconcile: agent Masa bookings and Masa imports block fallback slots, import idempotent/move/cancel/skip known & unknown, reception can still book, reconcile_list without names, alerts once per booking and resolvable, old ops intact, service-role only, rollback restores step 1.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'fallback-reconcile-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
