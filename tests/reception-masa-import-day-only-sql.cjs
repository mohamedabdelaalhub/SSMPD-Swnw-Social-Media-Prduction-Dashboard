// 2026-11-19: Masa bookings with no time (stored 00:00) are «بدون ميعاد»: never block, listed by day.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_fallback_reconcile','reception_fallback_masa_schedule','reception_fallback_masa_interval','reception_fallback_last_slot','reception_masa_import_day_only'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const api=async(op,p)=>(await q('select clinic_reception.fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p||{})]))[0].v;
const fb=(a,p)=>call('clinic_reception_fallback',[live,a,p||{}]);
const dalia=(await cmd(live,'provider',{name:'د/ داليا سعيد',department:'جلدية',branch:'حدائق الأهرام'})).id;
await q('select clinic_reception.masa_link_seed($1)',[live]);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
const d1=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+864e5));
let r=await api('masa_import',{items:[{official_booking_id:'D-1',masa_doctor_id:1130,appointment_date:today,appointment_time:'00:00',status:'active',patient_name:'مريض يوم',phone:'01000000001'},
 {official_booking_id:'D-2',masa_doctor_id:1130,appointment_date:d1,appointment_time:'00:00',status:'active',patient_name:'مريض بكرة',phone:'01000000002'},
 {official_booking_id:'T-1',masa_doctor_id:1130,appointment_date:d1,appointment_time:'16:00',status:'active',patient_name:'مريض بميعاد',phone:'01000000003'}]});
assert.equal(r.inserted,3);
const rows=Object.fromEntries((await q('select official_booking_id o, day_only d from clinic_reception.masa_bookings')).map(x=>[x.o,x.d]));
assert.deepEqual(rows,{'D-1':true,'D-2':true,'T-1':false},'trigger sets day_only');
// never blocks: a window right after midnight is free; the timed booking still blocks
const at=(d,t)=>"(($2::date + time '"+t+"') at time zone 'Africa/Cairo')";
const busy=async(d,a,b)=>(await q('select clinic_reception.slot_busy($1,'+at(d,a).replace('$2','$2')+','+at(d,b)+') b',[dalia,d]))[0].b;
assert.equal(await busy(d1,'00:00','00:15'),false,'00:00 day-only booking does not block');
assert.equal(await busy(d1,'16:00','16:15'),true,'a timed import still blocks');
// reception list: by Cairo day, day-only shown without a time
const L=(await fb('list')).masa_imports;const by=Object.fromEntries(L.map(x=>[x.official_booking_id,x]));
assert(by['D-1']&&by['D-1'].day_only===true&&by['D-1'].appointment_time===null,'today day-only listed even after 02:00, no time');
assert(by['D-2']&&by['T-1']&&by['T-1'].appointment_time==='16:00'&&by['T-1'].day_only===false);
// a moved time updates day_only
await api('masa_import',{items:[{official_booking_id:'D-2',masa_doctor_id:1130,appointment_date:d1,appointment_time:'17:00',status:'active',patient_name:'مريض بكرة',phone:'01000000002'}]});
assert.equal((await q("select day_only d from clinic_reception.masa_bookings where official_booking_id='D-2'"))[0].d,false);
const def=(await q("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d"))[0].d;
assert.equal(def.split('provider_gap(p_provider)').length-1,8,'gap kept');
}
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261119020000_reception_masa_import_day_only.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='masa_bookings' and column_name='day_only'")).rows[0].n,0);
assert(!(await db.query("select pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure) d")).rows[0].d.includes('day_only'),'rollback restores slot_busy');
await db.close();console.log('PASS Masa day-only bookings: 00:00 = no time, never blocks a slot, listed by Cairo day as «بدون ميعاد», moving it to a time clears the flag, gap kept, rollback.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'fallback-dayonly-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
