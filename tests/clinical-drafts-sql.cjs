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
 await b.db.exec("create schema if not exists clinic_people;create table if not exists clinic_people.people(admin_id uuid primary key,department text default '',job_title text default '',doctor_key text);create table if not exists public.admin_extra_roles(admin_id uuid,role text);create table if not exists public.patient_dental_reports(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id) on delete cascade,report_date date not null default current_date,doctor_name text not null default '',treatment_plan text not null default '',sessions jsonb not null default '[]',created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create table if not exists public.patient_physio_reports(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id) on delete cascade,visit_date date not null default current_date,doctor_name text not null default '',sessions jsonb not null default '[]',created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());create table if not exists public.patient_medical_profile(patient_id uuid primary key references public.patients(id) on delete cascade,chronic_conditions jsonb not null default '[]',surgeries jsonb not null default '[]',updated_by uuid,updated_at timestamptz default now());");
 await b.db.exec((m=>m.slice(m.indexOf('CREATE TABLE clinic_reception.checkin_tokens'),m.indexOf('CREATE INDEX checkin_tokens_appt_idx')))(require('fs').readFileSync('supabase/live-capture/20261107_tables_clinic_reception_a.sql','utf8')));
 for(const f of [${mig('reception_journey_action_permissions')},${mig('reception_queue_rooms_tickets')},${mig('reception_queue_display')},${mig('reception_queue_my_turn')},${mig('reception_nursing_day_ops')},${mig('clinical_drafts_approval')}])await b.db.exec(require('fs').readFileSync(f,'utf8'));
 return b;})()`;
const prefix=src.slice(0,cut).replace('await boot()',bootExpr).replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
const D=async(n,a,p)=>{await as(n);try{return await call('clinic_drafts_placeholder',[a,p||{}]);}finally{await as(1);}};
const R=async(n,a,p)=>{await as(n);try{return await call('clinical_drafts',[a,p||{}]);}finally{await as(1);}};
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const dental=(await cmd(live,'provider',{name:'د. أسنان ٢',department:'الاسنان',branch:'حدائق الأهرام'})).id;
await q("update clinic_reception.providers set doctor_key='DK-D2' where id=$1",[dental]);
for(const [k,ro,nn] of [[22,'nursing','ممرضة أسنان'],[9,'sono_doctor','د. صاحب الحجز'],[10,'sono_doctor','د. تاني']])await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,$4,true) on conflict (id) do update set role=$4,active=true,name=$3",[id(k),'u'+k+'@test',nn,ro]);
await q("insert into clinic_people.people(admin_id,department,job_title,doctor_key) values($1,'الأطباء','طبيب','DK-D2'),($2,'العلاج الطبيعي','طبيب علاج طبيعي',null)",[id(9),id(10)]);
const arch=(await q("insert into patients(patient_code,full_name,phone) values('DR-1','مريض مسودة','01077777777') returning id"))[0].id;
const ap=(await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+interval '5 minutes',now()+interval '25 minutes','booked',$5) returning id",[live,pat,dental,svc,id(1)]))[0].id;
const content={tooth:'36 — سفلي أيمن',procedure:'root_canal',procedure_label:'حشو عصب',material:'MTA',pediatric:false,radiograph_needed:true,notes:'تم فتح القناة',plan:'جلسة تانية بعد أسبوع'};
// nurse saves a draft (not sent): the official report is untouched, nobody is notified
let r=await R(22,'save',{kind:'dental',patient_id:arch,appointment_id:ap,content});assert.equal(r.status,'draft');const draft=r.id;
assert.equal(+(await q('select count(*) n from public.patient_dental_reports'))[0].n,0,'no official report from a draft');
assert.equal(+(await q("select count(*) n from public.staff_notifications where kind='draft_submitted'"))[0].n,0);
r=await R(22,'save',{id:draft,content:{...content,notes:'تم فتح القناة وتنظيفها'}});assert.equal(r.revision,2);
let g=await R(22,'get',{id:draft});assert.deepEqual(g.log.map(x=>x.action),['create','edit']);assert.deepEqual(g.log[1].changed_fields,['notes']);
await assert.rejects(()=>R(10,'get',{id:draft}),/مش مسموح/,'another doctor cannot open it');
await assert.rejects(()=>R(22,'approve',{id:draft}),/الدكتور صاحب الحجز|مش مستنية/,'a nurse cannot approve');
// submit → only the case doctor is told, with fixed text
r=await R(22,'save',{id:draft,content:{...content,notes:'تم فتح القناة وتنظيفها'},submit:true});assert.equal(r.status,'pending_review');
const nt=await q("select recipient_admin_id,title from public.staff_notifications where kind='draft_submitted'");assert.equal(nt.length,1);assert.equal(nt[0].recipient_admin_id,id(9));assert.match(nt[0].title,/أسنان/);assert(!/مريض مسودة|01077777777/.test(nt[0].title));
await assert.rejects(()=>R(22,'save',{id:draft,content}),/اتبعتت|مينفعش/,'locked while with the doctor');
assert.equal((await R(9,'list_review')).drafts.length,1);assert.equal((await R(10,'list_review')).drafts.length,0,'other doctors do not see it');
assert.equal((await R(1,'list_review')).drafts.length,1,'managers see all');
// doctor returns without a reason → refused; with a reason → back to the nurse (notified), editable again
await assert.rejects(()=>R(9,'return',{id:draft}),/سبب/);
await assert.rejects(()=>R(10,'return',{id:draft,reason:'x'}),/صاحب الحجز/,'only the case doctor');
r=await R(9,'return',{id:draft,reason:'اكتب مكان السن'});assert.equal(r.status,'returned');
assert.equal((await q("select count(*) n from public.staff_notifications where kind='draft_returned' and recipient_admin_id=$1",[id(22)]))[0].n,1);
assert.equal((await R(22,'list_mine')).drafts[0].return_reason,'اكتب مكان السن');
r=await R(22,'save',{id:draft,content:{...content,notes:'تم فتح القناة وتنظيفها',extraction_site:'سفلي أيمن'},submit:true});assert.equal(r.status,'pending_review');
// doctor edits and approves: the official report now gets one session, in the doctor's flow, with every step logged
r=await R(9,'approve',{id:draft,content:{...content,notes:'تم فتح القناة وتنظيفها',extraction_site:'سفلي أيمن',plan:'جلسة تانية بعد أسبوع مع أشعة'}});assert.equal(r.status,'approved');
const rep=(await q('select sessions,treatment_plan from public.patient_dental_reports where patient_id=$1',[arch]));assert.equal(rep.length,1);assert.equal(rep[0].sessions.length,1);
assert.equal(rep[0].sessions[0].service,'حشو عصب');assert.match(rep[0].sessions[0].notes,/الخامة: MTA/);assert.match(rep[0].sessions[0].notes,/أشعة مطلوبة/);assert.match(rep[0].treatment_plan,/مع أشعة/);
g=await R(9,'get',{id:draft});assert.deepEqual(g.log.map(x=>x.action),['create','edit','submit','return','edit','submit','edit_by_doctor','approve']);
assert.deepEqual(g.log.find(x=>x.action==='edit_by_doctor').changed_fields,['plan']);assert.equal(g.draft.status,'approved');
await assert.rejects(()=>R(22,'save',{id:draft,content}),/اتعتمدت|مينفعش/,'approved text is locked');
await assert.rejects(()=>R(9,'approve',{id:draft}),/مش مستنية/,'approve is once');
// a second approved draft appends to the same report (no duplicate report rows)
r=await R(22,'save',{kind:'dental',patient_id:arch,appointment_id:ap,content:{...content,procedure_label:'خلع جراحي',tooth:'18'},submit:true});await R(9,'approve',{id:r.id});
const rep2=await q('select jsonb_array_length(sessions) n from public.patient_dental_reports where patient_id=$1',[arch]);assert.equal(rep2.length,1);assert.equal(rep2[0].n,2);
// physio draft with no appointment (no linked case doctor): only a doctor of the same section (or a manager) may approve; creates the physio report
r=await R(22,'save',{kind:'physio',patient_id:arch,content:{treatments:['Laser','Manual'],duration:'30',area:'أسفل الظهر',notes:'تحسن'},submit:true});
assert.equal((await R(10,'list_review')).drafts.length,1,'the physio-section doctor sees it');assert.equal((await R(9,'list_review')).drafts.length,0,'a doctor of another department does not');
assert.equal((await R(10,'get',{id:r.id})).draft.no_case_doctor,true);await assert.rejects(()=>R(9,'approve',{id:r.id}),/صاحب الحجز/,'another department cannot approve');await R(10,'approve',{id:r.id});
// a dental draft with no linked case doctor and no dental doctor account: managers only, and they are the ones told
const nd=await R(22,'save',{kind:'dental',patient_id:arch,content:{procedure_label:'كشف عادي',notes:'x'},submit:true});
assert.equal((await R(9,'list_review')).drafts.length,0);assert.equal((await R(10,'list_review')).drafts.length,0);assert.equal((await R(1,'list_review')).drafts.length,1);
assert.equal(+(await q("select count(*) n from public.staff_notifications where kind='draft_submitted' and recipient_admin_id=$1 and created_at>now()-interval '1 minute'",[id(1)]))[0].n>=1,true,'managers are notified');
await assert.rejects(()=>R(9,'approve',{id:nd.id}),/صاحب الحجز/);await R(1,'approve',{id:nd.id});
const ph=await q('select sessions from public.patient_physio_reports where patient_id=$1',[arch]);assert.equal(ph.length,1);assert.deepEqual(ph[0].sessions[0].treatments,['Laser','Manual']);
// a non-nurse, non-manager cannot write drafts; no direct table access
await assert.rejects(()=>R(10,'save',{kind:'dental',patient_id:arch,content}),/للتمريض/);
await as(22);await assert.rejects(()=>db.query('select * from public.patient_clinical_drafts'),/permission|denied/i);await as(1);
await db.close();console.log('PASS clinical drafts: nurse draft (official report untouched), submit notifies only the case doctor, locked while pending, return needs a reason and notifies the nurse, doctor edit+approve appends one session, approved text locked, audit trail, no-case-doctor fallback, access gates.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'clinical-drafts-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
