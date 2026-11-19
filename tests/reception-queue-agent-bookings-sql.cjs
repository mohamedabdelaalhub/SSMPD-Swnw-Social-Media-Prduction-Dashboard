// Owner 2026-11-19 «موافق»: queue phase 4b, agent (WhatsApp) bookings registered by reception on arrival; checkin_link op.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));

 await b.db.exec((m=>m.slice(m.indexOf('create table if not exists clinic_reception.display_sessions'),m.indexOf(');')+2))(require('fs').readFileSync('supabase/migrations/20261030_reception_rotating_display_qr.sql','utf8')));
 await b.db.exec("alter table public.customer_bookings add column if not exists masa_doctor_id int,add column if not exists official_booking_id text,add column if not exists updated_at timestamptz default now()");
 await b.db.exec((m=>m.slice(m.indexOf('CREATE TABLE clinic_reception.checkin_tokens'),m.indexOf('CREATE INDEX checkin_tokens_appt_idx')))(require('fs').readFileSync('supabase/live-capture/20261107_tables_clinic_reception_a.sql','utf8')));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')},${mig('reception_queue_my_turn')},${mig('reception_queue_agent_bookings')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const Q=(a,p)=>call('clinic_reception_queue',[live,a,p||{}]);
const doc=(await cmd(live,'provider',{name:'د. حجز وكيل',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const c1=(await Q('room_save',{label:'عيادة 1'})).id;await Q('assign',{room_id:c1,provider_id:doc});
await q("insert into clinic_reception.masa_doctor_links(masa_doctor_id,workspace_id,provider_id,masa_name,status) values(888,$1,$2,'وكيل','linked') on conflict (masa_doctor_id) do update set provider_id=excluded.provider_id,status='linked'",[live,doc]);
await q("insert into clinic_reception.masa_doctor_links(masa_doctor_id,workspace_id,provider_id,masa_name,status) values(889,$1,null,'غير مربوط','pending') on conflict (masa_doctor_id) do nothing",[live]);
await q('alter table customer_bookings disable trigger user');
const archive=(await q("insert into patients(patient_code,full_name,phone) values('AG-1','مريض وكيل تجريبي','01099999999') returning id"))[0].id;
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
const ins=async(ref,off,status,masa)=>(await q("insert into customer_bookings(id,booking_request_id,booking_reference,official_booking_id,customer_name,phone,doctor_name,appointment_date,appointment_time,status,masa_doctor_id) values(gen_random_uuid(),$1,$1,'OFF-'||$1,'عميل واتساب','01099999999','د. حجز وكيل',$2::date,'18:30',$3,$4) returning id",[ref,off,status,masa]))[0].id;
const b1=await ins('BR-A',today,'confirmed',888),b2=await ins('BR-B',today,'confirmed',889),b3=await ins('BR-C',today,'cancelled',888);
await q("insert into customer_bookings(id,booking_request_id,customer_name,phone,appointment_date,appointment_time,status,masa_doctor_id) values(gen_random_uuid(),'BR-OLD','قديم','010','2020-01-01','10:00','confirmed',888)");
let L=(await Q('agent_bookings')).bookings;
assert.equal(L.length,2,'today only, no cancelled: '+L.length);const r1=L.find(x=>x.id===b1);assert.equal(r1.doctor_name,'د. حجز وكيل');assert.equal(r1.registered,false);assert.equal(r1.provider_id,doc);
// unlinked Masa doctor cannot be registered
await assert.rejects(()=>Q('agent_booking_register',{booking_id:b2,patient_id:archive,service_id:svc}),/مش مربوط/);
await assert.rejects(()=>Q('agent_booking_register',{booking_id:b3,patient_id:archive,service_id:svc}),/مش ساري/);
await assert.rejects(()=>Q('agent_booking_register',{booking_id:b1,patient_id:archive,service_id:null}),/اختر الخدمة|invalid/);
// agent link before registration
await owner('reset role');await db.exec('set role service_role');
const api=async(op,p)=>(await db.query('select public.clinic_reception_fallback_api($1,$2::jsonb) v',[op,JSON.stringify(p)])).rows[0].v;
assert.equal((await api('checkin_link',{official_booking_id:'OFF-BR-A'})).error,'not_registered');
assert.equal((await api('checkin_link',{official_booking_id:'nope'})).error,'unknown_booking');
assert.equal((await api('checkin_link',{})).error,'booking_required');
await db.exec('reset role');await as(1);
// register
const reg=await Q('agent_booking_register',{booking_id:b1,patient_id:archive,service_id:svc});
assert.equal(reg.ok,true);assert.equal(reg.ticket_no,1);assert(reg.token);
const again=await Q('agent_booking_register',{booking_id:b1,patient_id:archive,service_id:svc});assert.equal(again.already,true);assert.equal(again.token,reg.token);
assert.equal(+(await q('select count(*) n from clinic_reception.appointments where source=$1',['whatsapp']))[0].n,1,'one appointment only');
L=(await Q('agent_bookings')).bookings;assert.equal(L.find(x=>x.id===b1).registered,true);
// the same flow works for a reception-only user (not just super admin)
const rec=id(8);await q("insert into public.admins(id,email,name,role,active) values($1,'rec@test','موظف استقبال','reception',true) on conflict (id) do update set role='reception',active=true",[rec]);
await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','book','execute']) on conflict do nothing",[live,rec]).catch(()=>{});
const archive2=(await q("insert into patients(patient_code,full_name,phone) values('AG-2','مريض وكيل ثاني','01088888888') returning id"))[0].id;
const b4=await ins('BR-D',today,'confirmed',888);
await as(8);const reg2=await call('clinic_reception_queue',[live,'agent_booking_register',{booking_id:b4,patient_id:archive2,service_id:svc}]);assert.equal(reg2.ok,true);assert.equal(reg2.ticket_no,2);await as(1);
// board has the ticket; call it; the patient link follows
let bd=(await Q('state')).doctors.find(d=>d.provider_id===doc);assert.deepEqual(bd.waiting_nos,[1,2]);
await Q('call_next',{provider_id:doc});
await owner('reset role');await db.exec('set role service_role');
const link=await api('checkin_link',{official_booking_id:'OFF-BR-A'});assert.equal(link.ok,true);assert.equal(link.token,reg.token);assert.equal(link.path,'my-turn.html?t='+reg.token);
assert.equal((await api('checkin_link',{booking_request_id:'BR-A'})).token,reg.token,'by request id too');
const mt=await api('my_turn',{token:reg.token});assert.equal(mt.state,'called');assert.equal(mt.order_no,1);assert.equal(mt.room_label,'عيادة 1');
assert(!/مريض|عميل|01099999999/.test(JSON.stringify([link,mt])),'agent answers carry no patient data');
// anon cannot use the staff actions or the link op
await db.exec('reset role');await db.exec('set role anon');
await assert.rejects(()=>db.query("select public.clinic_reception_queue($1,'agent_bookings','{}')",[live]),/permission|denied/i);
await assert.rejects(()=>db.query("select public.clinic_reception_fallback_api('checkin_link','{}')"),/permission|denied/i);
await db.exec('reset role');await db.close();console.log('PASS agent bookings: today list (no cancelled/old), unlinked doctor and cancelled refused, register = attach + walk-in + arrive + token + ticket once, link op before/after, anon denied.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'queue-agent-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
