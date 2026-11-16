// Owner 2026-11-16: Masa doctor ↔ dashboard provider links, and fallback booking from the dashboard's weekly availability
// while the Masa bridge is down (WhatsApp agent first, website later). No double-booking; reception sees and handles them.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const api=async(op,p)=>(await q('select clinic_reception.fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p||{})]))[0].v;
const fb=(a,p)=>call('clinic_reception_fallback',[live,a,p||{}]);
// providers: dashboard names are canonical; Masa spellings differ («ا/», «ى», spaces)
const dalia=(await cmd(live,'provider',{name:'د/ داليا سعيد',department:'جلدية',branch:'حدائق الأهرام'})).id;
const lina=(await cmd(live,'provider',{name:'لينا الحسيني',department:'النفسية والتخاطب',branch:'حدائق الأهرام'})).id;
const aya=(await cmd(live,'provider',{name:'د.أية مفتاح',department:'النسا والتوليد',branch:'حدائق الأهرام'})).id;
const hagar=(await cmd(live,'provider',{name:'د.هاجر محي',department:'الاسنان',branch:'حدائق الأهرام'})).id;await q('update clinic_reception.providers set active=false where id=$1',[hagar]);
assert.equal(+(await q('select clinic_reception.masa_link_seed($1) n',[live]))[0].n,56);
const links=Object.fromEntries((await q('select masa_doctor_id m,status,provider_id from clinic_reception.masa_doctor_links where workspace_id=$1',[live])).map(r=>[r.m,r]));
assert.equal(links[1130].provider_id,dalia);assert.equal(links[1132].provider_id,dalia,'two Masa ids, one dashboard provider');
assert.equal(links[1075].provider_id,lina,'Masa «ا/ لينا الحسيني» → dashboard «لينا الحسيني»');
assert.equal(links[1099].provider_id,aya,'Masa «آية» → dashboard «د.أية» (prefix, hamza)');assert.equal(links[1118].provider_id,hagar,'inactive dashboard doctor is linked');assert.equal((await api('slots',{masa_doctor_id:1118})).error,'doctor_inactive','but not bookable');assert.equal(links[1063].status,'inactive');assert.equal(links[1054].status,'pending','no provider with that name');
assert.equal(+(await q('select clinic_reception.masa_link_seed($1) n',[live]))[0].n,56);
assert.equal(+(await q('select count(*) n from clinic_reception.masa_doctor_links'))[0].n,56,'re-seed adds nothing');
// weekly 10:00–12:00 every day, then slots
const wk=(a,p)=>call('clinic_reception_weekly',[live,a,p||{}]);
await wk('save',{provider_id:dalia,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'10:00',ends:'12:00'}))});
const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+864e5));
let sl=await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:2});
assert(sl.ok&&sl.provider_id===dalia,'slots ok');assert.equal(sl.slots.length,12,'2 days × 6 twenty-minute slots: '+sl.slots.length);
assert(sl.slots.every(x=>x.appointment_time>='10:00'&&x.appointment_time<='11:40'));
assert.equal((await api('slots',{masa_doctor_id:1063})).error,'doctor_not_linked');assert.equal((await api('slots',{masa_doctor_id:9})).error,'unknown_doctor');
// book
const slot=sl.slots[0],bk={booking_request_id:'BR-1',masa_doctor_id:1130,appointment_date:slot.appointment_date,appointment_time:slot.appointment_time,customer_name:'مريض تجربة',phone:'01000000001',customer_age:30,source:'whatsapp',wa_id:'201000000001'};
let b=await api('book',bk);assert(b.ok&&b.status==='pending'&&b.doctor_name==='د/ داليا سعيد',JSON.stringify(b));
assert((await api('book',bk)).duplicate,'same request id → same booking');
assert.equal((await api('book',{...bk,appointment_time:sl.slots[1].appointment_time})).error,'booking_request_id_reused');
assert.equal((await api('book',{...bk,booking_request_id:'BR-2',masa_doctor_id:1132})).error,'slot_taken','other Masa id of the same doctor');
assert.equal((await api('book',{...bk,booking_request_id:'BR-3',appointment_time:'13:00'})).error,'slot_unavailable','outside availability');
assert.equal((await api('book',{...bk,booking_request_id:'BR-4',appointment_time:'10:10'})).error,'slot_taken','overlaps the held slot');
assert.equal((await api('book',{...bk,booking_request_id:'BR-5',phone:'12'})).error,'invalid_phone');
assert.equal((await api('book',{...bk,booking_request_id:'BR-6',source:'fax'})).error,'invalid_source');
assert.equal((await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:2})).slots.length,11,'held slot no longer offered');
// reception cannot book over the hold
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
await assert.rejects(()=>cmd(live,'book',{patient_id:pat,provider_id:dalia,service_id:svc,starts_at:slot.starts_at,minutes:20}),e=>/احتياطي/.test(e.message));
// reception list
let L=(await fb('list')).bookings;assert.equal(L.length,1);assert.equal(L[0].booking_request_id,'BR-1');
await fb('confirm',{id:L[0].fallback_booking_id});assert((await fb('list')).bookings[0].reception_confirmed);
// replay to Masa
let r=await api('pending_replay');assert.deepEqual(r.bookings.map(x=>x.booking_request_id),['BR-1']);assert.equal(r.bookings[0].customer_age,30);
assert.equal((await api('pending_replay')).bookings.length,0,'leased');
r=await api('replay_result',{booking_request_id:'BR-1',ok:false,error:'timeout'});assert.equal(r.status,'pending');assert.equal(r.last_error,'timeout');
assert.equal((await api('pending_replay')).bookings.length,1,'transient error → offered again');
assert.equal((await api('replay_result',{booking_request_id:'BR-1',ok:true})).error,'official_booking_id_required');
r=await api('replay_result',{booking_request_id:'BR-1',ok:true,official_booking_id:'M-77'});assert.equal(r.status,'replayed');assert.equal(r.official_booking_id,'M-77');
assert((await api('replay_result',{booking_request_id:'BR-1',ok:true,official_booking_id:'M-78'})).ignored,'replay result is applied once');
// conflict: Masa refused → slot stays held, reception sees it
const s2=(await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:2})).slots[0];
assert((await api('book',{...bk,booking_request_id:'BR-7',appointment_time:s2.appointment_time,appointment_date:s2.appointment_date})).ok);
await api('pending_replay');r=await api('replay_result',{booking_request_id:'BR-7',ok:false,outcome:'conflict',error:'409 slot taken in Masa'});assert.equal(r.status,'conflict');
assert.equal((await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:2})).slots.length,10);
assert((await fb('list')).bookings.some(x=>x.status==='conflict'));
await assert.rejects(()=>fb('cancel',{id:r.fallback_booking_id}),/سبب/);
assert.equal((await fb('cancel',{id:r.fallback_booking_id,reason:'اتصلنا بالمريض وحجزنا يوم تاني'})).status,'cancelled');
assert.equal((await api('slots',{masa_doctor_id:1130,date_from:tomorrow,days:2})).slots.length,11,'cancelled hold frees the slot');
// release: reception books the fallback patient as a normal appointment
await fb('release',{id:L[0].fallback_booking_id});
const ap=await cmd(live,'book',{patient_id:pat,provider_id:dalia,service_id:svc,starts_at:slot.starts_at,minutes:20});assert(ap.id);
assert.equal((await api('book',{...bk,booking_request_id:'BR-8'})).error,'slot_taken','appointment blocks the fallback too');
// cancelling a replayed booking asks the agent to cancel in Masa
assert.equal((await api('cancel',{booking_request_id:'BR-1'})).status,'cancel_pending');
r=await api('pending_replay');assert.deepEqual(r.cancels.map(x=>x.booking_request_id),['BR-1']);
r=await api('replay_result',{booking_request_id:'BR-1',kind:'cancel',ok:true});assert.equal(r.status,'cancelled');
assert.equal((await api('cancel',{booking_request_id:'BR-1'})).status,'cancelled','idempotent');
// managers fix links
await fb('link_set',{masa_doctor_id:1054,provider_id:lina});
assert.equal((await fb('links')).links.find(x=>x.masa_doctor_id===1054).status,'linked');
await fb('link_set',{masa_doctor_id:1054,status:'inactive'});
assert.equal((await api('slots',{masa_doctor_id:1054})).error,'doctor_not_linked');
assert.equal((await api('health')).ok,true);
// the API is for the service role only
await assert.rejects(()=>db.query("select clinic_reception.fallback_api('health','{}')"),/permission|denied/);
await assert.rejects(()=>db.query("select public.clinic_reception_fallback_api('health','{}')"),/permission|denied/);
}
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261117140000_reception_masa_links_fallback_booking.rollback.sql'))},'utf8'));
assert.equal((await db.query("select to_regclass('clinic_reception.fallback_bookings') t, to_regclass('clinic_reception.masa_doctor_links') l")).rows[0].t,null,'rollback drops the tables');
await db.exec("insert into clinic_reception.appointments select * from clinic_reception.appointments limit 0");
await db.close();console.log('PASS Masa links + fallback booking: seed by normalized dashboard name (two Masa ids → one doctor, inactive, pending), slots from weekly availability, idempotent book, no double-booking either way, reception list/confirm/release/cancel, replay lease/retry/once, conflict holds the slot, Masa cancel, link fixes, service-role only; rollback clean.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'fallback-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
