// Owner 2026-11-19 «موافق» (queue in the dashboard), «ارقام بس», rooms per doctor per day with «إنهاء العيادة» / «إعادة الربط بطبيب آخر»,
// «الاستقبال ينادي التالي والفني كمان». Phase 1: rooms, room assignments, ticket numbers, department queues (L/R), call log, board.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const Q=(a,p)=>call('clinic_reception_queue',[live,a,p||{}]);
const J=(a,p)=>call('clinic_reception_journey_command',[live,a,p,key()]);
const doc=(await cmd(live,'provider',{name:'د. طابور أول',department:'جلدية',branch:'حدائق الأهرام'})).id;
const doc2=(await cmd(live,'provider',{name:'د. طابور تاني',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
// rooms
const c1=(await Q('room_save',{label:'عيادة 1'})).id,c2=(await Q('room_save',{label:'عيادة 2'})).id;
const lab=(await Q('room_save',{label:'غرفة سحب العينات',kind:'lab',ticket_prefix:'L'})).id;
const rad=(await Q('room_save',{label:'غرفة الأشعة',kind:'radiology',ticket_prefix:'r'})).id;
await assert.rejects(()=>Q('room_save',{label:' عيادة 1 '}),/duplicate|unique/i,'same label twice');
await assert.rejects(()=>Q('room_save',{label:'معمل تاني',kind:'lab',ticket_prefix:'L'}),/duplicate|unique/i,'prefix is unique');
await assert.rejects(()=>Q('room_save',{label:''}),/اسم الغرفة/);
let st=await Q('state');assert.equal(st.rooms.length,4);assert.equal(st.rooms.find(r=>r.id===rad).ticket_prefix,'R');
// assign doctor → room; one open per room and per doctor
await Q('assign',{room_id:c1,provider_id:doc});
await assert.rejects(()=>Q('assign',{room_id:lab,provider_id:doc}),/غرفة قسم/);
st=await Q('state');assert.equal(st.rooms.find(r=>r.id===c1).assignment.provider_id,doc);
// walk-ins arrive → tickets 1, 2 for doc; 1 for doc2 (plain numbers, per doctor)
const wi=async(p)=>(await cmd(live,'walk_in',{patient_id:pat,provider_id:p,service_id:svc,minutes:15})).id;
const a1=await wi(doc),a2=await wi(doc),b1=await wi(doc2);
for(const a of [a1,a2,b1])await J('arrive',{appointment_id:a});
const tk=async a=>(await q('select ticket_no from clinic_reception.queue_entries where appointment_id=$1',[a]))[0].ticket_no;
assert.deepEqual([await tk(a1),await tk(a2),await tk(b1)],[1,2,1]);
let bd=(await Q('state')).doctors.find(d=>d.provider_id===doc);
assert.equal(bd.room_label,'عيادة 1');assert.deepEqual(bd.waiting_nos,[1,2]);assert.equal(bd.current_no,null);
// call next → ticket 1 in عيادة 1, call logged once
let r=await Q('call_next',{provider_id:doc});assert.equal(r.label,'1');assert.equal(r.room_label,'عيادة 1');
st=await Q('state');bd=st.doctors.find(d=>d.provider_id===doc);assert.equal(bd.current_no,1);assert.deepEqual(bd.waiting_nos,[2]);
assert.equal(st.calls.length,1);assert.equal(st.calls[0].ticket_no,'1');assert.equal(st.calls[0].room_label,'عيادة 1');
// «إعادة الربط بطبيب آخر»: room 1 goes to doc2; doc is now without a room, doc2's calls name عيادة 1
await Q('assign',{room_id:c1,provider_id:doc2});
st=await Q('state');assert.equal(st.rooms.find(x=>x.id===c1).assignment.provider_id,doc2);
assert.equal(st.doctors.find(d=>d.provider_id===doc).room_label,null);
r=await Q('call_next',{provider_id:doc2});assert.equal(r.room_label,'عيادة 1');
// doc moves to عيادة 2 and calls ticket 2 there
await Q('assign',{room_id:c2,provider_id:doc});r=await Q('call_next',{provider_id:doc});assert.equal(r.label,'2');assert.equal(r.room_label,'عيادة 2');
assert.equal((await Q('call_next',{provider_id:doc})).empty,true,'nobody left');
// recall through the journey (hold → resume) logs a second call for the same ticket
await J('hold',{appointment_id:a2});await J('resume',{appointment_id:a2});
assert.equal(+(await q('select count(*) n from clinic_reception.queue_calls where queue_entry_id=(select id from clinic_reception.queue_entries where appointment_id=$1)',[a2]))[0].n,2);
// «إنهاء العيادة»
await Q('end_assignment',{room_id:c2});assert.equal((await Q('state')).rooms.find(x=>x.id===c2).assignment,null);
// department tickets L1, L2 and R1; the technician (room staff, no reception role) calls next on the lab
assert.equal((await Q('dept_ticket',{room_id:lab})).label,'L1');assert.equal((await Q('dept_ticket',{room_id:lab})).label,'L2');
assert.equal((await Q('dept_ticket',{room_id:rad})).label,'R1');
await assert.rejects(()=>Q('dept_ticket',{room_id:c1}),/غرفة قسم/);
const tech=id(7);await q("insert into public.admins(id,email,name,role,active) values($1,'tech@test','فني معمل','page_manager',true) on conflict (id) do update set role='page_manager',active=true",[tech]);
await Q('room_staff_set',{room_id:lab,admin_id:undefined,admin_ids:[tech]});
await as(7);
r=await call('clinic_reception_queue',[live,'call_next',{room_id:lab}]);assert.equal(r.label,'L1');assert.equal(r.room_label,'غرفة سحب العينات');
await assert.rejects(()=>call('clinic_reception_queue',[live,'call_next',{room_id:rad}]),/صلاحية|access|مسموح|42501/i,'not radiology staff');
await assert.rejects(()=>call('clinic_reception_queue',[live,'call_next',{provider_id:doc}]),/صلاحية|access|مسموح|42501/i,'not a doctor queue');
st=await call('clinic_reception_queue',[live,'state',{}]);
let dl=st.departments.find(x=>x.room_id===lab);assert.equal(dl.current_no,'L1');assert.deepEqual(dl.waiting_nos,['L2']);
r=await call('clinic_reception_queue',[live,'call_next',{room_id:lab}]);assert.equal(r.label,'L2');
await as(1);
const L1=(await Q('state')).dept_tickets.find(x=>x.label==='L1');assert.equal(L1.status,'called','called but not started stays called');
await Q('dept_done',{id:L1.id});await Q('dept_recall',{id:(await Q('state')).dept_tickets.find(x=>x.label==='L2').id});
st=await Q('state');dl=st.departments.find(x=>x.room_id===lab);assert.equal(dl.done_count,1);assert.equal(dl.current_no,'L2');
assert(st.calls.some(c=>c.ticket_no==='L2'&&c.room_label==='غرفة سحب العينات'));
// board carries no patient data
const txt=JSON.stringify(await q('select clinic_reception.queue_board($1) b',[live]));assert(!/مريض|01000000000|patient/.test(txt),'board has no patient data');
// not callable by anon/authenticated directly
await as(1);await assert.rejects(()=>db.query('select clinic_reception.queue_board($1)',[live]),/permission|denied/i);
// a room turned into a department room or deactivated closes its doctor assignment
await Q('assign',{room_id:c2,provider_id:doc});await Q('room_save',{id:c2,label:'عيادة 2',active:false});
assert.equal((await Q('state')).rooms.find(x=>x.id===c2).assignment,null);
await assert.rejects(()=>Q('assign',{room_id:c2,provider_id:doc}),/متوقفة/);
await db.close();console.log('PASS queue rooms + tickets: rooms, assign/reassign/end, per-doctor numbers on arrival, call next via journey with room, department L/R tickets with room staff, board without patient data.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'queue-rooms-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
