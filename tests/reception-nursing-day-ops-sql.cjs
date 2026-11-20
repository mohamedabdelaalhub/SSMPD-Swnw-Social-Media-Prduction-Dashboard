// Owner 2026-11-19 «موافق»: nursing day ops: sections, day list, triage, doctor confirmation, notifications, file-open log, settings.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const mig=s=>JSON.stringify('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_'+s+'.sql')));
const bootExpr=`await (async()=>{const b=await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness','reception_masa_links_fallback_booking']);
 await b.db.exec("reset role;alter table clinic_reception.outbox add column if not exists payload jsonb not null default '{}';alter table leads add column if not exists do_not_contact boolean default false;");
 await b.db.exec(require('fs').readFileSync('tests/fixtures/journey-backend.sql','utf8'));

 await b.db.exec((m=>m.slice(m.indexOf('create table if not exists clinic_reception.display_sessions'),m.indexOf(');')+2))(require('fs').readFileSync('supabase/migrations/20261030_reception_rotating_display_qr.sql','utf8')));
 await b.db.exec("alter table public.customer_bookings add column if not exists masa_doctor_id int,add column if not exists official_booking_id text,add column if not exists updated_at timestamptz default now()");
 await b.db.exec("create schema if not exists clinic_people;create table if not exists clinic_people.people(admin_id uuid primary key,department text default '',job_title text default '',doctor_key text);create table if not exists public.admin_extra_roles(admin_id uuid,role text);create table if not exists public.patient_medical_profile(patient_id uuid primary key references public.patients(id) on delete cascade,chronic_conditions jsonb not null default '[]',surgeries jsonb not null default '[]',updated_by uuid,updated_at timestamptz default now());");
 await b.db.exec((m=>m.slice(m.indexOf('CREATE TABLE clinic_reception.checkin_tokens'),m.indexOf('CREATE INDEX checkin_tokens_appt_idx')))(require('fs').readFileSync('supabase/live-capture/20261107_tables_clinic_reception_a.sql','utf8')));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')},${mig('reception_queue_my_turn')},${mig('reception_nursing_day_ops')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
const N=(a,p)=>call('clinic_reception_nursing',[live,a,p||{}]);
const asN=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_nursing',[live,a,p||{}]);}finally{await as(1);}};
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const physio=(await cmd(live,'provider',{name:'د. علاج طبيعي',department:'العلاج الطبيعي',branch:'حدائق الأهرام'})).id;
const dental=(await cmd(live,'provider',{name:'د. أسنان',department:'الاسنان',branch:'حدائق الأهرام'})).id;
const derm=(await cmd(live,'provider',{name:'د. جلدية',department:'جلدية',branch:'حدائق الأهرام'})).id;
// HR: nurse 2 = physio assistant, nurse 5 = dental nurse, nurse 6 = general; doctor admin 9 linked to the dental provider by doctor_key
await q("update clinic_reception.providers set doctor_key='DK-DENT' where id=$1",[dental]);
const nm=[[2,'nursing','ممرضة علاج طبيعي'],[5,'nursing','ممرضة أسنان'],[6,'nursing','ممرضة عام']];for(const [k,ro,nn] of nm)await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,$4,true) on conflict (id) do update set role=$4,active=true,name=$3",[id(k+20),'n'+k+'@test',nn,ro]);
const doc9=id(9);await q("insert into public.admins(id,email,name,role,active) values($1,'doc9@test','د. أسنان حساب','sono_doctor',true) on conflict (id) do update set role='sono_doctor',active=true",[doc9]);
for(const k of [22,25,26,9])await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','execute']) on conflict do nothing",[live,id(k)]).catch(()=>{});
await q("insert into clinic_people.people(admin_id,department,job_title,doctor_key) values($1,'العلاج الطبيعي','مساعد قسم العلاج الطبيعي',null),($2,'التمريض','ممرضة أسنان',null),($3,'التمريض','تمريض',null),($4,'الأطباء','طبيب','DK-DENT')",[id(22),id(25),id(26),doc9]);
const mk=async(prov,minOff)=>(await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+($5||' minutes')::interval,now()+($5||' minutes')::interval+interval '20 minutes','booked',$6) returning id",[live,pat,prov,svc,String(minOff),id(1)]))[0].id;
// notices: created for bookings today, fixed text, to the right nurses only
const ap1=await mk(physio,5),ap2=await mk(dental,10),ap3=await mk(derm,15);
const notes=async n=>(await asN(n+20,'notifications')).items;
let n2=await notes(2),n5=await notes(5),n6=await notes(6);
assert.equal(n2.length,1,'physio nurse: only the physio booking');assert.match(n2[0].title,/علاج طبيعي/);
assert.equal(n5.length,1,'dental nurse: only the dental booking');assert.match(n5[0].title,/أسنان/);assert.match(n5[0].title,/د\. أسنان/);
assert.equal(n6.length,1,'general nurse: only the general booking (the other sections are covered)');assert.match(n6[0].title,/تمريض عام/);
assert(!/مريض ?[A-Za-z0-9\u0600-\u06FF]{0,3}تجريبي|01\d{9}/.test(JSON.stringify([n2,n5,n6])),'no patient data in notices');
assert.equal((await asN(25,'notifications')).unread,1);await asN(25,'notifications_read',{});assert.equal((await asN(25,'notifications')).unread,0);
const mine=d=>d.appointments.map(x=>x.id).filter(i=>[ap1,ap2,ap3].includes(i)).sort();
// day list per nurse
let d2=await asN(22,'day'),d5=await asN(25,'day'),d6=await asN(26,'day');
assert.deepEqual(d2.sections,['physio']);assert.deepEqual(mine(d2),[ap1]);
assert.deepEqual(mine(d5),[ap2]);assert.deepEqual(d6.sections,['general']);assert.deepEqual(mine(d6),[ap3]);
const a1=d2.appointments.find(x=>x.id===ap1);assert.equal(a1.triage,'none');assert.equal(a1.section,'physio');assert(a1.patient_name&&a1.archive_patient_id);
await assert.rejects(()=>asN(9,'day'),/للتمريض/,'a doctor is not on the nursing screen');
// absent dental nurse → general nurse also sees dental
await N('settings_save',{admin_id:id(25),absent_today:true});
d6=await asN(26,'day');assert(d6.sections.includes('dental')&&!d6.sections.includes('physio'));assert.deepEqual(mine(d6),[ap2,ap3].sort());
assert.deepEqual(mine(await asN(25,'day')),[ap2],'the absent nurse still sees her own section list');
await N('settings_save',{admin_id:id(25),absent_today:false});
// override: nurse 6 → dental, then general nurse has nobody
await N('settings_save',{admin_id:id(26),section_override:'dental'});assert.deepEqual((await asN(26,'day')).sections,['dental']);
await N('settings_save',{admin_id:id(26),section_override:''});assert.deepEqual((await asN(26,'day')).sections,['general']);
const st=(await N('settings_get')).nurses;assert.equal(st.find(x=>x.admin_id===id(22)).default_section,'physio');assert.equal(st.find(x=>x.admin_id===id(25)).section,'dental');
await assert.rejects(()=>asN(22,'settings_get'),/للسوبر أدمن/);await assert.rejects(()=>asN(22,'settings_save',{admin_id:id(22),section_override:'dental'}),/للسوبر أدمن/);
await assert.rejects(()=>N('settings_save',{admin_id:id(9),section_override:'dental'}),/مش من التمريض/);
// prep checklist
await asN(25,'prep_set',{appointment_id:ap2,item:'كرسي الأسنان جاهز'});assert.deepEqual((await asN(25,'day')).appointments.find(x=>x.id===ap2).prep,['كرسي الأسنان جاهز']);
await asN(25,'prep_set',{appointment_id:ap2,item:'كرسي الأسنان جاهز',done:false});assert.deepEqual((await asN(25,'day')).appointments.find(x=>x.id===ap2).prep,[]);
// triage: nurse records, validated, logged; doctor reads; reception cannot
const T={appointment_id:ap2,bp_sys:150,bp_dia:95,pulse:80,temp_c:36.8,spo2:98,weight_kg:82,sugar_mgdl:110,on_chronic_meds:true,chronic_meds:'دواء ضغط',recent_surgery:false,allergies:'بنسلين',chronic_diseases:['سكر','ضغط'],chronic_other:'غدة',chief_complaint:'ألم في الضرس',nursing_note:'أخد الدواء'};
let r=await asN(25,'triage_save',T);assert.equal(r.status,'recorded');assert.equal(r.revision,1);
await assert.rejects(()=>asN(25,'triage_save',{...T,bp_sys:999}),/check|violates/i,'range check');
assert.equal((await asN(25,'day')).appointments.find(x=>x.id===ap2).triage,'recorded');
let tg=(await asN(9,'triage_get',{appointment_id:ap2})).triage;assert.equal(tg.bp_sys,150);assert.deepEqual(tg.chronic_diseases,['سكر','ضغط']);assert(tg.nurse_name);
r=await asN(25,'triage_save',{...T,pulse:84});assert.equal(r.revision,2);
assert.equal(+(await q('select count(*) n from clinic_reception.visit_triage_log where appointment_id=$1',[ap2]))[0].n,2);
await assert.rejects(()=>asN(9,'triage_save',T),/التمريض بس/,'a doctor does not record the nurse triage');
// doctor confirmation moves chronic diseases to the permanent profile, only for the case doctor
const archive=(await q('select patient_id from clinic_reception.patients where id=$1',[pat]))[0].patient_id;
await assert.rejects(()=>asN(25,'triage_confirm_profile',{appointment_id:ap2}),/للدكتور/,'a nurse cannot confirm');
await q("update clinic_reception.visit_triage set status='recorded' where appointment_id=$1",[ap2]);
r=await asN(9,'triage_confirm_profile',{appointment_id:ap2});assert.equal(r.ok,true);assert.equal(r.added,3);
const prof=(await q('select chronic_conditions from public.patient_medical_profile where patient_id=$1',[archive]))[0].chronic_conditions;assert.deepEqual(prof.map(x=>x.name).sort(),['ضغط','سكر','غدة'].sort());
r=await asN(9,'triage_confirm_profile',{appointment_id:ap2});assert.equal(r.added,0,'idempotent');
await assert.rejects(()=>asN(9,'triage_confirm_profile',{appointment_id:ap1}),/صاحب الحجز|مفيش/,'only the case doctor');
assert.equal((await asN(25,'triage_get',{appointment_id:ap2})).triage.profile_confirmed_at===null,false);
await asN(25,'triage_save',T);assert.equal((await asN(25,'triage_get',{appointment_id:ap2})).triage.profile_confirmed_at,null,'re-recording resets the confirmation');
// file-open log: nurses only, with the opener
await asN(25,'open_file',{patient_id:archive,appointment_id:ap2});
await as(25);await call('log_patient_file_open',[archive,'archive',null]);await as(9);await call('log_patient_file_open',[archive,'archive',null]);await as(1);
const opens=await q('select admin_id,source from public.patient_file_opens order by opened_at');assert.equal(opens.length,2);assert(opens.every(o=>o.admin_id===id(25)),'only nurse opens are logged');
// clients cannot read or write the tables directly; the log is readable by managers only
await as(25);await assert.rejects(()=>db.query('select * from clinic_reception.visit_triage'),/permission|denied/i);assert.equal((await db.query('select * from public.patient_file_opens')).rows.length,0,'a nurse cannot read the open log (RLS)');await as(1);
// a booking never fails because of the notice trigger
await q('alter table public.staff_notifications rename to staff_notifications_x');const ap4=await mk(dental,20);assert(ap4,'booking survives a broken notification table');await q('alter table public.staff_notifications_x rename to staff_notifications');
await db.close();console.log('PASS nursing day ops: sections from HR + override + absence cover, day list per nurse, fixed-text notices, prep checklist, triage record/log/ranges, doctor-only profile confirmation, nurse-only file-open log, settings gated, notices never block a booking.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'nursing-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
