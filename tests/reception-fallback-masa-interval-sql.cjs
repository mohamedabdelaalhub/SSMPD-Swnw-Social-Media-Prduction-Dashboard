// 2026-11-18 live comparison: fallback slots per Masa id and on the Masa interval grid (20 = 15 visit + 5 gap).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_fallback_reconcile','reception_fallback_masa_schedule','reception_fallback_masa_interval'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const api=async(op,p)=>(await q('select clinic_reception.fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p||{})]))[0].v;
const dalia=(await cmd(live,'provider',{name:'د/ داليا سعيد',department:'جلدية',branch:'حدائق الأهرام'})).id;
await q('select clinic_reception.masa_link_seed($1)',[live]);
await call('clinic_reception_weekly',[live,'save',{provider_id:dalia,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'09:00',ends:'00:00'}))}]);
assert.equal(+(await q('select extract(epoch from clinic_reception.provider_gap($1))/60 m',[dalia]))[0].m,5,'owner gap 5');
const day=n=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+n*864e5));const d1=day(1),d2=day(2);
const times=async(mid,d)=>(await api('slots',{masa_doctor_id:mid,date_from:d,days:1})).slots.map(x=>x.appointment_time);
// 1130 derm only on d1 16:00–17:00 (interval 20); 1132 ortho only on d2 17:00–18:45 (interval 35)
let r=await api('masa_schedule',{generated_at:new Date().toISOString(),date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'16:00',end:'17:00',interval_minutes:20},{masa_doctor_id:1132,date:d2,start:'17:00',end:'18:45',interval_minutes:35}]});
assert(r.ok,JSON.stringify(r));
assert.deepEqual(await times(1130,d1),['16:00','16:20','16:40'],'Masa grid, 20-minute step');
assert.deepEqual(await times(1130,d2),[],'1132 open on d2 does not open 1130 (per Masa id)');
assert.deepEqual(await times(1132,d1),[],'and the other way round');
assert.deepEqual(await times(1132,d2),['17:00','17:35','18:10'],'35-minute step');
r=await api('slots',{masa_doctor_id:1130,date_from:d1,days:1});assert.equal(r.step,'masa_interval');assert.equal(r.slots[0].interval_minutes,20);assert('stale' in r,'staleness fields kept');
// book: on the grid only; lasts interval − gap, so the next Masa time stays free
const bk={masa_doctor_id:1130,appointment_date:d1,customer_name:'مريض',phone:'01000000001'};
assert.equal((await api('book',{...bk,booking_request_id:'I-0',appointment_time:'16:10'})).error,'slot_unavailable','off the Masa grid');
assert.equal((await api('book',{...bk,booking_request_id:'I-x',masa_doctor_id:1132,appointment_time:'16:00'})).error,'slot_unavailable','1132 closed on d1');
r=await api('book',{...bk,booking_request_id:'I-1',appointment_time:'16:20'});assert(r.ok,JSON.stringify(r));
assert.equal((Date.parse(r.ends_at)-Date.parse(r.starts_at))/60000,15,'15-minute visit');
assert.deepEqual(await times(1130,d1),['16:00','16:40'],'neighbours on the grid stay free');
// a Masa import / agent booking blocks exactly its own Masa time
await api('masa_import',{items:[{official_booking_id:'M-1',masa_doctor_id:1130,appointment_date:d1,appointment_time:'16:40',status:'active',patient_name:'x',phone:'01000000002'}]});
assert.deepEqual(await times(1130,d1),['16:00']);
await api('masa_import',{items:[{official_booking_id:'M-1',status:'cancelled'}]});
await q('alter table public.customer_bookings disable trigger user');
await q("insert into public.customer_bookings(id,booking_request_id,official_booking_id,doctor_id,masa_doctor_id,appointment_date,appointment_time,status) values(gen_random_uuid(),'AG-1','M-2','doc_m1130',1130,$1,'16:00','confirmed')",[d1]);
assert.deepEqual(await times(1130,d1),['16:40'],'agent booking blocks only 16:00');
// validation; days without interval keep the old behaviour
assert.equal((await api('masa_schedule',{date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'16:00',end:'17:00',interval_minutes:2}]})).error,'invalid_day');
assert.equal((await api('masa_schedule',{date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'16:00',end:'17:00',interval_minutes:'x'}]})).error,'invalid_day');
await api('masa_schedule',{date_from:d1,date_to:d2,days:[{masa_doctor_id:1130,date:d1,start:'16:00',end:'17:00'}]});
r=await api('slots',{masa_doctor_id:1130,date_from:d1,days:1});assert.notEqual(r.step,'masa_interval','no interval → old stepping');
assert.equal(+(await q("select count(*) n from clinic_reception.masa_schedule_days where interval_min is not null"))[0].n,0,'interval cleared by the new schedule');
const def=(await q("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d"))[0].d;
assert.equal(def.split('provider_gap(p_provider)').length-1,8,'provider gap kept on all four sources');
assert.equal((await q("select current_setting('swnw.fallback_masa_id', true) s"))[0].s||'','', 'no leaked setting');
await assert.rejects(()=>db.query("select clinic_reception.fallback_api('health','{}')"),/permission|denied/);
}
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261118190000_reception_fallback_masa_interval.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*) n from information_schema.columns where table_name='masa_schedule_days' and column_name='interval_min'")).rows[0].n,0);
assert((await db.query("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d")).rows[0].d.includes('and m.ends_at + clinic_reception.provider_gap'),'rollback restores the 180000 slot_busy');
await db.close();console.log('PASS fallback Masa interval: slots per Masa id (Dalia derm/ortho apart), Masa grid 20/35 with 15-minute visits, book refuses off-grid, imports/agent bookings block one Masa step, validation, old behaviour without interval, gap kept ×8, rollback.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'fallback-interval-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
