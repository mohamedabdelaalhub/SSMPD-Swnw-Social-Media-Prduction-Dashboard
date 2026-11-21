// Owner 2026-11-19 «موافق» (queue in the dashboard), «ارقام بس», rooms per doctor per day with «إنهاء العيادة» / «إعادة الربط بطبيب آخر»,
// «الاستقبال ينادي التالي والفني كمان». Phase 1: rooms, room assignments, ticket numbers, department queues (L/R), call log, board.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_start_visit_and_payout')},${mig('journey_mistaken_undo')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const J=(a,p)=>call('clinic_reception_journey_command',[live,a,p,key()]);
const doc=(await cmd(live,'provider',{name:'د. بداية',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const wi=async()=>(await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15})).id;
const a1=await wi();await J('arrive',{appointment_id:a1});await J('call',{appointment_id:a1});
const called0=(await q("select called_at from clinic_reception.queue_entries where appointment_id=$1",[a1]))[0].called_at;
await J('hold',{appointment_id:a1});
const r=await J('resume',{appointment_id:a1});
assert.equal(r.mistaken,true,'resume right after hold is an undo');
const qe=(await q("select status,called_at from clinic_reception.queue_entries where appointment_id=$1",[a1]))[0];
assert.equal(qe.status,'called');assert.equal(new Date(qe.called_at).getTime(),new Date(called0).getTime(),'called_at kept');
const ev=await q("select event_type,metadata from clinic_reception.journey_events where appointment_id=$1 and event_type in ('consultation.on_hold','consultation.review')",[a1]);
assert.equal(ev.length,2);assert(ev.every(e=>e.metadata.mistaken===true),'both events marked mistaken');
await J('hold',{appointment_id:a1});
await q("update clinic_reception.journey_events set event_at=event_at-interval '5 minutes' where appointment_id=$1 and event_type='consultation.on_hold' and coalesce(metadata->>'mistaken','')<>'true'",[a1]);
const r2=await J('resume',{appointment_id:a1});assert(!r2.mistaken,'a late resume is real work, not a mistake');
await db.close();console.log('PASS hold->resume within 120s is marked mistaken (status/called_at restored); a late resume is not.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'start-visit-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
