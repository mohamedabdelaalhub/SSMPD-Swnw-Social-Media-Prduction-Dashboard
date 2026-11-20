// Owner 2026-11-19 «موافق»: clinical drafts: nurse draft → case-doctor approval/return, locked after approval, official report only after approval, audit, notices.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));

 await b.db.exec((m=>m.slice(m.indexOf('create table if not exists clinic_reception.display_sessions'),m.indexOf(');')+2))(require('fs').readFileSync('supabase/migrations/20261030_reception_rotating_display_qr.sql','utf8')));
 await b.db.exec("alter table public.customer_bookings add column if not exists masa_doctor_id int,add column if not exists official_booking_id text,add column if not exists updated_at timestamptz default now()");
 await b.db.exec("create schema if not exists clinic_people;create table if not exists clinic_people.people(code text unique default 'EMP-'||substr(md5(random()::text),1,6),admin_id uuid primary key,department text default '',job_title text default '',doctor_key text);create table if not exists public.admin_extra_roles(admin_id uuid,role text);create table if not exists public.patient_dental_reports(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id) on delete cascade,report_date date not null default current_date,doctor_name text not null default '',treatment_plan text not null default '',sessions jsonb not null default '[]',created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create table if not exists public.patient_physio_reports(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id) on delete cascade,visit_date date not null default current_date,doctor_name text not null default '',sessions jsonb not null default '[]',created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create table if not exists public.patient_medical_profile(patient_id uuid primary key references public.patients(id) on delete cascade,chronic_conditions jsonb not null default '[]',surgeries jsonb not null default '[]',updated_by uuid,updated_at timestamptz default now());");
 await b.db.exec((m=>m.slice(m.indexOf('CREATE TABLE clinic_reception.checkin_tokens'),m.indexOf('CREATE INDEX checkin_tokens_appt_idx')))(require('fs').readFileSync('supabase/live-capture/20261107_tables_clinic_reception_a.sql','utf8')));
 await b.db.exec("alter table public.admins drop constraint if exists admins_role_check;alter table public.admins add constraint admins_role_check check (role in ('nursing','head_nursing','sono_doctor','reception','super_admin','general_manager','page_manager','designer','approver','customer_service','accountant','financial_manager'));alter table public.admin_extra_roles add constraint admin_extra_roles_role_check check (role in ('nursing','head_nursing','sono_doctor','super_admin','general_manager'))");
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')},${mig('reception_queue_my_turn')},${mig('reception_nursing_day_ops')},${mig('clinical_drafts_approval')},${mig('doctor_assistant_role')},${mig('doctor_assistant_nursing_screen')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
const N=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_nursing',[live,a,p||{}]);}finally{await as(1);}};
const R=async(n,a,p)=>{await as(n);try{return await call('clinical_drafts',[a,p||{}]);}finally{await as(1);}};
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const dental=(await cmd(live,'provider',{name:'د. أسنان أ',department:'الاسنان',branch:'حدائق الأهرام'})).id;
const dental2=(await cmd(live,'provider',{name:'د. أسنان مساعد',department:'الاسنان',branch:'حدائق الأهرام'})).id;
const derm=(await cmd(live,'provider',{name:'د. جلدية أ',department:'جلدية',branch:'حدائق الأهرام'})).id;
await q("update clinic_reception.providers set doctor_key='DK-A' where id=$1",[dental]);
await q("update clinic_reception.providers set doctor_key='EMP-000031' where id=$1",[dental2]);
for(const [k,ro,nn] of [[31,'doctor_assistant','مساعد أسنان'],[32,'nursing','ممرضة'],[33,'sono_doctor','د. أسنان حساب']])await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,$4,true) on conflict (id) do update set role=$4,active=true,name=$3",[id(k),'u'+k+'@test',nn,ro]);
for(const k of [31,32,33])await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','execute']) on conflict do nothing",[live,id(k)]).catch(()=>{});
await q("insert into clinic_people.people(code,admin_id,department,job_title,doctor_key) values('EMP-000031',$1,'الأسنان','مساعد طبيب',null),('EMP-000032',$2,'التمريض','ممرضة',null),('EMP-000033',$3,'الأطباء','طبيب','DK-A')",[id(31),id(32),id(33)]);
const mk=async(prov,m)=>(await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+($5||' minutes')::interval,now()+($5||' minutes')::interval+interval '20 minutes','booked',$6) returning id",[live,pat,prov,svc,String(m),id(1)]))[0].id;
await as(31);const mine=await call('clinic_reception_my_departments',[live]);await as(1);
assert.deepEqual(mine,['الاسنان'],'assistant departments come from his provider record (doctor_key)');
const ad=await mk(dental,5),ag=await mk(derm,10);
const nt=async n=>(await N(n,'notifications')).items;
assert.equal((await nt(31)).length,1,'assistant: notice for the dental booking only');assert.match((await nt(31))[0].title,/أسنان/);
assert.equal((await nt(32)).length>=1,true,'nurses still get theirs');
const day=await N(31,'day');const ids=day.appointments.map(a=>a.id);
assert(ids.includes(ad)&&!ids.includes(ag),'day list is filtered to his departments');
await assert.rejects(()=>N(31,'settings_get'),/للسوبر أدمن/);
await assert.rejects(()=>N(31,'settings_save',{admin_id:id(31),section_override:'dental'}),/للسوبر أدمن/);
const nl=await N(1,'settings_get');assert(!nl.nurses.some(x=>x.admin_id===id(31)),'assistant is not in the nurse list');
await N(31,'prep_set',{appointment_id:ad,item:'شاش',done:true});
const archive=(await q('select patient_id from clinic_reception.patients where id=$1',[pat]))[0].patient_id;
await N(31,'open_file',{patient_id:archive,appointment_id:ad});
assert.equal(+(await q('select count(*) n from public.patient_file_opens where admin_id=$1',[id(31)]))[0].n,1,'his file-open is logged with his id');
const dr=await R(31,'save',{kind:'dental',patient_id:archive,appointment_id:ad,content:{chief_complaint:'ألم'},submit:true});
assert.equal(dr.status,'pending_review');
assert.equal((await R(31,'list_mine')).drafts.length,1);
const rv=await R(33,'list_review');assert(rv.drafts.some(x=>x.id===dr.id),'case doctor sees the assistant draft');
const ok=await R(33,'approve',{id:dr.id});assert(ok.ok,'case doctor approves');
await assert.rejects(()=>R(31,'list_review'),/للدكاترة/);
await db.close();console.log('PASS doctor assistant: departments helper, notices + day list for his departments only, not a nurse, file-open log, drafts with case-doctor approval.');}})().catch(e=>{console.error(e);process.exit(1);});`;

const file=path.join(require('os').tmpdir(),'doctor-assistant-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
