// 20261123030000 (owner 2026-11-23 «موظفي الريسبشن هم اللي هيسجلوا رقم العيادة لكل دكتور يوميا»): base = tests/reception-queue-rooms-sql.cjs.
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
const doc=(await cmd(live,'provider',{name:'د. ربط أول',department:'جلدية',branch:'حدائق الأهرام'})).id;
const doc2=(await cmd(live,'provider',{name:'د. ربط تاني',department:'جلدية',branch:'حدائق الأهرام'})).id;
const c1=(await Q('room_save',{label:'عيادة 1'})).id,c2=(await Q('room_save',{label:'عيادة 2'})).id;
const lab=(await Q('room_save',{label:'غرفة سحب العينات',kind:'lab',ticket_prefix:'L'})).id;
await db.exec('reset role');
for(const [n,role] of [[7,'reception'],[8,'nurse'],[9,'accountant']])await db.query("insert into admins(id,name,role,active) values($1,$2,$3,true) on conflict(id) do update set role=excluded.role,active=true",[id(n),'تجربة '+n,role]);
await db.query("delete from clinic_reception.members where workspace_id=$1 and admin_id = any($2::uuid[])",[live,[id(7),id(8),id(9)]]);
await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view,book}')",[live,id(8)]);await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}')",[live,id(7)]);
// before: a reception account without 'execute' cannot link
await as(7);const before=await Q('assign',{room_id:c1,provider_id:doc}).then(()=>'ok',e=>e.message);
await db.exec('reset role');const M=require("fs").readFileSync(${JSON.stringify('supabase/migrations/20261123030000_reception_room_link.sql')},'utf8');
await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
// reception role links today's doctor, re-links, unlinks — each audited
await as(7);await Q('assign',{room_id:c1,provider_id:doc});
let st=await Q('state').catch(()=>null);
const open=async r=>(await q('select provider_id from clinic_reception.room_assignments where room_id=$1 and ended_at is null',[r]));
assert.deepEqual((await open(c1)).map(x=>x.provider_id),[doc]);
await as(7);await Q('assign',{room_id:c1,provider_id:doc2});assert.deepEqual((await open(c1)).map(x=>x.provider_id),[doc2]);
await as(7);await Q('end_assignment',{room_id:c1});assert.equal((await open(c1)).length,0);
const au=await q("select action,actor_id,detail from clinic_reception.audit where entity_id=$1 and action in ('room_link','room_unlink') order by created_at, action",[c1]);
assert.deepEqual(au.map(x=>x.action),['room_link','room_link','room_unlink']);assert(au.every(x=>x.actor_id===id(7)),'who');
assert.equal(au[1].detail.replaced_provider_id,doc,'re-link records the doctor it replaced');assert.equal(au[2].detail.provider_id,doc2);assert.equal(au[0].detail.room,'عيادة 1');
// rooms themselves stay manager-only
await as(7);await assert.rejects(()=>Q('room_save',{label:'عيادة 3'}));await as(7);await assert.rejects(()=>Q('room_save',{id:c2,label:'اسم جديد'}));
// a member with 'book' may link; department rooms still refused; someone with no reception role / capability may not
await as(8);await Q('assign',{room_id:c2,provider_id:doc});assert.deepEqual((await open(c2)).map(x=>x.provider_id),[doc]);
await as(8);await assert.rejects(()=>Q('assign',{room_id:lab,provider_id:doc}),/غرفة قسم/);
await as(9);await assert.rejects(()=>Q('assign',{room_id:c1,provider_id:doc2}));
// the screen is told who may link (no refusal-only buttons)
await as(7);assert.equal((await Q('state')).can_link_rooms,true,'reception');await as(8);assert.equal((await Q('state')).can_link_rooms,true,'book member');
await db.exec('reset role');await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}')",[live,id(9)]);await as(9);assert.equal((await Q('state')).can_link_rooms,false,'view-only member sees the rooms but no link buttons');
// other actions still go to the previous function
await as(1);const s2=await Q('state');assert.equal(s2.rooms.find(r=>r.id===c2).assignment.provider_id,doc);
// rollback
await db.exec('reset role');await db.exec(require("fs").readFileSync(${JSON.stringify('supabase/rollbacks/20261123030000_reception_room_link.rollback.sql')},'utf8'));
assert.equal((await db.query("select to_regprocedure('clinic_reception.queue_rpc_before_room_link(uuid,text,jsonb)') r")).rows[0].r,null);
await as(9);await assert.rejects(()=>Q('assign',{room_id:c1,provider_id:doc2}));
await db.close();console.log('PASS reception room link: reception role + book/arrive members link/re-link/end today\\'s doctor (audited with the replaced doctor), rooms CRUD stays manager-only, others refused, rollback. (before: '+before+')');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'room-link-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
