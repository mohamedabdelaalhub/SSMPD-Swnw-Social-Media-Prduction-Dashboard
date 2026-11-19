// Owner 2026-11-19 «موافق»: queue phase 4a, «اعرف دورك» by check-in token + agent ops queue_board/my_turn; numbers and status only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));

 await b.db.exec((m=>m.slice(m.indexOf('create table if not exists clinic_reception.display_sessions'),m.indexOf(');')+2))(require('fs').readFileSync('supabase/migrations/20261030_reception_rotating_display_qr.sql','utf8')));
 await b.db.exec((m=>m.slice(m.indexOf('CREATE TABLE clinic_reception.checkin_tokens'),m.indexOf('CREATE INDEX checkin_tokens_appt_idx')))(require('fs').readFileSync('supabase/live-capture/20261107_tables_clinic_reception_a.sql','utf8')));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')},${mig('reception_queue_my_turn')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const Q=(a,p)=>call('clinic_reception_queue',[live,a,p||{}]);
const J=(a,p)=>call('clinic_reception_journey_command',[live,a,p,key()]);
const doc=(await cmd(live,'provider',{name:'د. دوري',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const c1=(await Q('room_save',{label:'عيادة 1'})).id;await Q('assign',{room_id:c1,provider_id:doc});
await q("insert into clinic_reception.masa_doctor_links(masa_doctor_id,workspace_id,provider_id,masa_name,status) values(777,$1,$2,'دوري','linked') on conflict (masa_doctor_id) do update set provider_id=excluded.provider_id,status='linked'",[live,doc]);
const ids=[];for(let i=0;i<3;i++)ids.push((await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15})).id);
const tokenOf=async a=>(await J('checkin_token',{appointment_id:a})).token;
const T=await Promise.all(ids.map(tokenOf));
const turn=async t=>(await db.query('select public.clinic_reception_my_turn($1) v',[t])).rows[0].v;
await owner('reset role');await db.exec('set role anon');
let r=await turn(T[0]);assert.equal(r.ok,true);assert.equal(r.state,'not_arrived');assert.equal(r.doctor_name,'د. دوري');
await db.exec('reset role');await as(1);
for(const a of ids)await J('arrive',{appointment_id:a});
await owner('reset role');await db.exec('set role anon');
r=await turn(T[2]);assert.equal(r.state,'waiting');assert.equal(r.order_no,3);assert.equal(r.ahead_count,2);assert.equal(r.current_no,null);
r=await turn(T[0]);assert.equal(r.order_no,1);assert.equal(r.ahead_count,0);
await db.exec('reset role');await as(1);await Q('call_next',{provider_id:doc});
await owner('reset role');await db.exec('set role anon');
r=await turn(T[0]);assert.equal(r.state,'called');assert.equal(r.room_label,'عيادة 1');
r=await turn(T[2]);assert.equal(r.ahead_count,1,'ticket 2 is still waiting ahead of ticket 3');assert.equal(r.current_no,1);
// no patient data in the answer
assert(!/مريض|01000000000|patient|appointment_id|provider_id/i.test(JSON.stringify(r)),JSON.stringify(r));
// bad token
assert.equal((await turn('00000000-0000-4000-8000-0000000000aa')).ok,false);
// expired token
await db.exec('reset role');await db.exec("update clinic_reception.checkin_tokens set expires_at=now()-interval '1 minute' where token='"+T[1]+"'");await db.exec('set role anon');
assert.equal((await turn(T[1])).error,'invalid_or_expired');
// agent ops: service role only
await db.exec('reset role');await db.exec('create role agentcaller');await db.exec('grant usage on schema public to agentcaller');
await assert.rejects(async()=>{await db.exec('set role anon');await db.query("select public.clinic_reception_fallback_api('queue_board','{}')");},/permission|denied/i);
await db.exec('reset role');await db.exec('set role service_role');
const bd=(await db.query("select public.clinic_reception_fallback_api('queue_board','{}'::jsonb) v")).rows[0].v;
assert.equal(bd.ok,true);const d1=bd.doctors.find(x=>x.name==='د. دوري');assert.equal(d1.doctor_id,777);assert.equal(d1.room_label,'عيادة 1');assert.equal(d1.current_no,1);assert.deepEqual(d1.waiting_nos,[2,3]);
assert(bd.calls.some(c=>c.ticket_no==='1'&&c.room_label==='عيادة 1'&&c.doctor_id===777&&c.call_id));assert.equal(bd.stale,false);assert(bd.snapshot_at);
assert(!/مريض|patient|01000000000|appointment/i.test(JSON.stringify(bd)),'board for the agent has no patient data');
const mt=(await db.query("select public.clinic_reception_fallback_api('my_turn',jsonb_build_object('token',$1::text)) v",[T[2]])).rows[0].v;assert.equal(mt.state,'waiting');assert.equal(mt.ahead_count,1);
assert.equal((await db.query("select public.clinic_reception_fallback_api('my_turn',jsonb_build_object('token',$1::text)) v",['nope'])).rows[0].v.error,'invalid_or_expired');
assert.equal((await db.query("select public.clinic_reception_fallback_api('my_turn','{}') v")).rows[0].v.error,'token_required');
assert.equal((await db.query("select public.clinic_reception_fallback_api('health','{}') v")).rows[0].v.ok,true,'old ops still pass through');
await db.exec('reset role');await db.close();console.log('PASS queue my-turn: anon turn by check-in token (not arrived / waiting+ahead / called+room), no patient data, bad/expired token, agent ops queue_board + my_turn service-role only, old ops pass through.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'queue-myturn-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
