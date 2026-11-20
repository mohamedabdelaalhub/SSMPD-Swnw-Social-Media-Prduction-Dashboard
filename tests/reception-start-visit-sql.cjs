// Owner 2026-11-19 «موافق» (queue in the dashboard), «ارقام بس», rooms per doctor per day with «إنهاء العيادة» / «إعادة الربط بطبيب آخر»,
// «الاستقبال ينادي التالي والفني كمان». Phase 1: rooms, room assignments, ticket numbers, department queues (L/R), call log, board.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_start_visit_and_payout')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const J=(a,p)=>call('clinic_reception_journey_command',[live,a,p,key()]);
const doc=(await cmd(live,'provider',{name:'د. بداية',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const wi=async()=>(await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15})).id;
const a1=await wi();await J('arrive',{appointment_id:a1});
// a plain reception user (not super) can start and complete the visit
const rec=id(8);await q("insert into public.admins(id,email,name,role,active) values($1,'rec8@test','استقبال','reception',true) on conflict (id) do update set role='reception',active=true",[rec]);
await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','execute']) on conflict do nothing",[live,rec]).catch(()=>{});
await as(8);
await call('clinic_reception_journey_command',[live,'consultation_start',{appointment_id:a1},key()]);
assert.equal((await q("select status from clinic_reception.queue_entries where appointment_id=$1",[a1]))[0].status,'in_service');await as(8);
await assert.rejects(()=>call('clinic_reception_journey_command',[live,'hold',{appointment_id:a1},key()]),/صلاحية|42501/,'hold stays doctor/nursing');
await assert.rejects(()=>call('clinic_reception_journey_command',[live,'visit_complete',{appointment_id:a1},key()]),/نفذ الخدمات|ألغ غير المنفذ/,'reception passes the permission gate; business rule applies');
await db.close();console.log('PASS reception can start a visit and reach the complete gate; hold stays restricted.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'start-visit-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
