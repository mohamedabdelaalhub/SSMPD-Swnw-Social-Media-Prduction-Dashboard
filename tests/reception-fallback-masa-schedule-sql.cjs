// Owner requirement 2026-11-18: fallback slots follow Masa's latest schedule/bookings; stale sync is visible to reception.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_fallback_reconcile','reception_fallback_masa_schedule','reception_fallback_stale_autoresolve'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const api=async(op,p)=>(await q('select clinic_reception.fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p||{})]))[0].v;
const fb=(a,p)=>call('clinic_reception_fallback',[live,a,p||{}]);
const dalia=(await cmd(live,'provider',{name:'د/ داليا سعيد',department:'جلدية',branch:'حدائق الأهرام'})).id;
await q('select clinic_reception.masa_link_seed($1)',[live]);
await call('clinic_reception_weekly',[live,'save',{provider_id:dalia,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'10:00',ends:'12:00'}))}]);
const day=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+n*864e5));const d1=day(1),d2=day(2);
await q('update clinic_reception.workspaces set booking_gap_minutes=0 where id=$1',[live]);
const def=async()=>(await q("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d"))[0].d.split('provider_gap(p_provider)').length-1;
assert.equal(await def(),8,'slot_busy keeps the provider gap on all four sources');
const slots=async(d=d1)=>{const r=await api('slots',{masa_doctor_id:1130,date_from:d,days:1});return r;};
// before any Masa schedule: dashboard availability only; stale, but no alert yet
let r=await slots();assert.equal(r.slots.length,6);assert.equal(r.stale,true);assert.equal(r.snapshot_at,null);
assert.equal((await fb('list')).alerts.length,0,'no alert before the first sync');
// Masa schedule: 1130 open 10:30–11:20 on d1 only; 1132 (same doctor) 11:00–12:00 on d1 → union inside the dashboard window
r=await api('masa_schedule',{generated_at:new Date().toISOString(),date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'10:30',end:'11:20'},{masa_doctor_id:1132,date:d1,start:'11:00',end:'00:00'},{masa_doctor_id:9999,date:d1,start:'10:00',end:'12:00'}]});
assert.deepEqual([r.ok,r.upserted,r.skipped],[true,2,1],'unknown Masa doctor skipped: '+JSON.stringify(r));
r=await slots();assert.deepEqual(r.slots.map(x=>x.appointment_time),['10:40','11:00','11:20','11:40'],'Masa day ∩ dashboard availability: '+JSON.stringify(r.slots.map(x=>x.appointment_time)));
assert.equal((await slots(d2)).slots.length,0,'a day missing from the window is closed');
assert.equal((await api('book',{booking_request_id:'S-1',masa_doctor_id:1130,appointment_date:d1,appointment_time:'10:00',customer_name:'مريض',phone:'01000000001'})).error,'slot_unavailable','book obeys Masa days too');
// bad row → nothing replaced
r=await api('masa_schedule',{date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'12:00',end:'11:00'}]});assert.equal(r.error,'invalid_day');
assert.equal((await slots()).slots.length,4,'unchanged after a rejected schedule');
assert.equal((await api('masa_schedule',{date_from:d1,date_to:'2030-01-01',days:[]})).error,'invalid_range');
// bookings sync → fresh
await api('masa_import',{items:[]});r=await slots();assert.equal(r.stale,false);assert(r.snapshot_at&&r.schedule_synced_at&&r.bookings_synced_at);
// stale → one alert per hour
await q("update clinic_reception.fallback_sync_state set synced_at=now()-interval '2 hours' where key='bookings'");
r=await slots();assert.equal(r.stale,true);await slots();
let al=(await fb('list')).alerts.filter(x=>x.kind==='stale_sync');assert.equal(al.length,1,'one stale alert per hour');assert(/آخر مزامنة مع ماسا/.test(al[0].detail));
await api('reconcile_list',{date_from:d1,date_to:d1});assert.equal((await slots()).stale,false,'reconcile_list counts as a bookings sync');
assert.equal((await fb('list')).alerts.filter(x=>x.kind==='stale_sync').length,0,'fresh sync closes the stale alert');
// Masa cancelled OUR bookings → blocks released
assert((await api('book',{booking_request_id:'S-2',masa_doctor_id:1130,appointment_date:d1,appointment_time:'10:40',customer_name:'مريض',phone:'01000000001'})).ok);
await q('alter table public.customer_bookings disable trigger user');
await q("insert into public.customer_bookings(id,booking_request_id,official_booking_id,doctor_id,masa_doctor_id,appointment_date,appointment_time,status) values(gen_random_uuid(),'AG-9','M-77','doc_m1130',1130,$1,'11:00','confirmed')",[d1]);
assert.deepEqual((await slots()).slots.map(x=>x.appointment_time),['11:20','11:40']);
assert((await api('reconcile_flag',{booking_request_id:'S-2',kind:'cancelled_in_masa',detail:'d t doctor 1130'})).created);
assert((await api('reconcile_flag',{official_booking_id:'M-77',kind:'cancelled_in_masa'})).created);
assert.equal((await api('status',{booking_request_id:'S-2'})).status,'cancelled');
assert.deepEqual((await slots()).slots.map(x=>x.appointment_time),['10:40','11:00','11:20','11:40'],'both released');
assert.equal((await q("select status from public.customer_bookings where booking_request_id='AG-9'"))[0].status,'confirmed','customer_bookings not written');
await assert.rejects(()=>db.query("select clinic_reception.fallback_api('health','{}')"),/permission|denied/);
}
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261118180000_reception_fallback_masa_schedule.rollback.sql'))},'utf8'));
assert.equal((await db.query("select to_regclass('clinic_reception.masa_schedule_days') t")).rows[0].t,null);
assert.equal((await db.query("select clinic_reception.fallback_api('reconcile_list','{}') v")).rows[0].v.ok,true,'1b API back after rollback');
assert.equal((await db.query("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d")).rows[0].d.split('provider_gap(p_provider)').length-1,8,'rollback restores the 1b (gap) version');
await db.close();console.log('PASS fallback Masa schedule: slots = Masa days ∩ dashboard availability (closed when missing, atomic replace, unknown doctors skipped), book obeys it, snapshot/stale with one alert per hour, syncs refresh it, Masa-cancelled own bookings released without touching customer_bookings, rollback restores 1b.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'fallback-schedule-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
