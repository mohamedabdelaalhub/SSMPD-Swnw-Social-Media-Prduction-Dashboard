// Owner 2026-11-19 «موافق»: queue phase 3, waiting-screen board behind the existing display token; numbers and rooms only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));

 await b.db.exec((m=>m.slice(m.indexOf('create table if not exists clinic_reception.display_sessions'),m.indexOf(');')+2))(require('fs').readFileSync('supabase/migrations/20261030_reception_rotating_display_qr.sql','utf8')));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const Q=(a,p)=>call('clinic_reception_queue',[live,a,p||{}]);
const J=(a,p)=>call('clinic_reception_journey_command',[live,a,p,key()]);
const doc=(await cmd(live,'provider',{name:'د. شاشة',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const c1=(await Q('room_save',{label:'عيادة 1'})).id;const lab=(await Q('room_save',{label:'غرفة سحب العينات',kind:'lab',ticket_prefix:'L'})).id;
await Q('assign',{room_id:c1,provider_id:doc});
const a1=(await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15})).id,a2=(await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15})).id;
await J('arrive',{appointment_id:a1});await J('arrive',{appointment_id:a2});await Q('call_next',{provider_id:doc});await Q('dept_ticket',{room_id:lab});await Q('call_next',{room_id:lab});
const tok=(await q("insert into clinic_reception.display_sessions(workspace_id,expires_at,created_by) values($1,now()+interval '1 day',$2) returning token",[live,id(1)]))[0].token;
const D=async t=>(await db.query('select public.clinic_reception_queue_display($1) v',[t])).rows[0].v;
// anon (display screen) can call it with a valid token and sees numbers and rooms only
await owner('reset role');await db.exec('set role anon');
const v=await D(tok);
const d1=v.doctors.find(x=>x.name==='د. شاشة');assert.equal(d1.room_label,'عيادة 1');assert.equal(d1.current_no,1);assert.deepEqual(d1.waiting_nos,[2]);
const dl=v.departments.find(x=>x.ticket_prefix==='L');assert.equal(dl.current_no,'L1');
assert.equal(v.calls.length,2);assert(v.calls.some(c=>c.ticket_no==='1'&&c.room_label==='عيادة 1'));assert(v.calls.some(c=>c.ticket_no==='L1'&&c.room_label==='غرفة سحب العينات'));
const txt=JSON.stringify(v);assert(!/مريض|01000000000|patient|appointment|provider_id|masa/i.test(txt),'screen payload has no patient or internal ids: '+txt);
// bad / revoked / expired tokens
await assert.rejects(()=>D('00000000-0000-4000-8000-0000000000aa'),/غير صالح/);
await db.exec('reset role');await db.exec("update clinic_reception.display_sessions set expires_at=now()-interval '1 minute' where token='"+tok+"'");await db.exec('set role anon');
await assert.rejects(()=>D(tok),/غير صالح/,'expired');
await db.exec('reset role');await db.exec("update clinic_reception.display_sessions set expires_at=now()+interval '1 day',revoked_at=now() where token='"+tok+"'");await db.exec('set role anon');
await assert.rejects(()=>D(tok),/غير صالح/,'revoked');
// the underlying board stays closed to clients
await assert.rejects(()=>db.query('select clinic_reception.queue_board($1)',[live]),/permission|denied/i);
await db.exec('reset role');await db.close();console.log('PASS queue display SQL: anon board by display token (numbers and rooms only), bad/expired/revoked token rejected, board function closed.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'queue-display-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
