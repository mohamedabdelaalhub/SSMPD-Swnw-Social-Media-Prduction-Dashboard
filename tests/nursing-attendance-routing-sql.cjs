// Owner 2026-11-23 «طبقه»: nursing presence from HR attendance (no grace), automatic re-routing of physio / dental cases to general
// nursing, cases general nursing already started stay with it after the section nurse clocks in, staff_today board, manual absence gone.
// Boots like tests/doctor-assistant-nursing-sql.cjs (same chain up to the nursing screen) + stub HR attendance, then applies 20261122310000.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const da=fs.readFileSync(path.join(__dirname,'doctor-assistant-nursing-sql.cjs'),'utf8');
const head=da.slice(0,da.indexOf('const body=`'));
const PEOPLE="create table if not exists clinic_people.people(code text unique default 'EMP-'||substr(md5(random()::text),1,6),admin_id uuid primary key,department text default '',job_title text default '',doctor_key text);";
const LAST="${mig('doctor_assistant_nursing_screen')}]";
assert(head.includes(PEOPLE)&&head.includes(LAST),'doctor-assistant-nursing-sql.cjs setup markers moved; update this test');
const HR="create table if not exists clinic_people.people(id uuid primary key default gen_random_uuid(),code text unique default 'EMP-'||substr(md5(random()::text),1,6),admin_id uuid unique,department text default '',job_title text default '',doctor_key text,status text not null default 'active',kind text not null default 'staff');"+
 "create table clinic_people.device_punches(id bigint generated always as identity primary key,device_id text not null,device_user_id int not null,ts timestamptz not null,punch smallint not null);"+
 "create table clinic_people.device_user_map(device_id text not null,device_user_id int not null,person_id uuid not null,primary key(device_id,device_user_id));"+
 "create table clinic_people.t_eval(person_id uuid primary key,template_name text default 'صباحي',exp_start timestamptz,exp_end timestamptz,first_in timestamptz,status text not null,late_min int default 0);"+
 "create function clinic_people.attendance_eval(p_day date,p_now timestamptz default now()) returns table(person_id uuid,template_name text,exp_start timestamptz,exp_end timestamptz,first_in timestamptz,status text,late_min int) language sql stable as $f$ select person_id,template_name,exp_start,exp_end,first_in,status,late_min from clinic_people.t_eval $f$;";
const setup=head.replace(PEOPLE,HR).replace(LAST,"${mig('doctor_assistant_nursing_screen')},${mig('nursing_attendance_routing')}]");
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
const N=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_nursing',[live,a,p||{}]);}finally{await as(1);}};
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const physio=(await cmd(live,'provider',{name:'د. علاج طبيعي',department:'العلاج الطبيعي',branch:'حدائق الأهرام'})).id;
const dental=(await cmd(live,'provider',{name:'د. أسنان',department:'الاسنان',branch:'حدائق الأهرام'})).id;
const derm=(await cmd(live,'provider',{name:'د. جلدية',department:'جلدية',branch:'حدائق الأهرام'})).id;
// nurses: 41 physio, 42 dental, 43 general, 44 general without an HR record
for(const [k,nn] of [[41,'ممرضة علاج طبيعي'],[42,'ممرضة أسنان'],[43,'ممرضة عام'],[44,'ممرض بدون ملف']])await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,'nursing',true) on conflict (id) do update set role='nursing',active=true,name=$3",[id(k),'n'+k+'@test',nn]);
for(const k of [41,42,43,44])await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','execute']) on conflict do nothing",[live,id(k)]).catch(()=>{});
const P=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'العلاج الطبيعي','تمريض علاج طبيعي') returning id",[id(41)]))[0].id;
const D=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'التمريض','ممرضة أسنان') returning id",[id(42)]))[0].id;
const G=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'التمريض','تمريض') returning id",[id(43)]))[0].id;
const T0="((clinic_reception.today()::timestamp) at time zone 'Africa/Cairo')";
const ev=async(pid,status,firstIn,late)=>{await q("delete from clinic_people.t_eval where person_id=$1",[pid]);if(status)await q("insert into clinic_people.t_eval(person_id,status,exp_start,exp_end,first_in,late_min) values($1,$2,"+T0+","+T0+"+interval '20 hours',"+(firstIn||'null')+",$3)",[pid,status,late||0]);};
await ev(P,'absent');await ev(D,'on_time',"now()-interval '3 seconds'");await ev(G,'on_time',"now()-interval '3 seconds'");
const mk=async(prov,sec)=>(await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,"+T0+"+($5||' seconds')::interval,"+T0+"+($5||' seconds')::interval+interval '20 minutes','booked',$6) returning id",[live,pat,prov,svc,String(sec),id(1)]))[0].id;
const ap1=await mk(physio,60),ap1b=await mk(physio,70),ap2=await mk(dental,80),ap3=await mk(derm,90);
const mine=d=>d.appointments.map(x=>x.id).filter(i=>[ap1,ap1b,ap2,ap3].includes(i)).sort();
// absent physio nurse (no grace): general nursing sees physio and gets its notices; the absent nurse gets none
let dG=await N(43,'day');assert.deepEqual(dG.sections.slice().sort(),['general','physio']);assert.deepEqual(mine(dG),[ap1,ap1b,ap3].sort());
const notes=async n=>(await N(n,'notifications')).items.map(x=>x.appointment_id);
assert((await notes(43)).includes(ap1),'general nurse notified for the physio booking');assert.equal((await notes(41)).length,0,'absent nurse not notified');
assert.deepEqual(mine(await N(41,'day')),[ap1,ap1b].sort(),'the absent nurse still sees her own section');
let st=await N(1,'staff_today');assert.equal(st.covered.physio,false);assert.equal(st.covered.dental,true);
const nr=(s,k)=>s.nurses.find(x=>x.admin_id===id(k));
assert.equal(nr(st,41).state,'absent');assert.equal(nr(st,42).state,'present');assert.equal(nr(st,44).state,'no_hr');assert.equal(nr(st,41).section,'physio');
// waiting inside the HR grace window still counts as absent here
await ev(P,'waiting');assert.equal(nr(await N(1,'staff_today'),41).state,'absent');
// general nursing starts ap1 (opens the file) → it stays with general after the physio nurse clocks in
const archive=(await q('select patient_id from clinic_reception.patients where id=$1',[pat]))[0].patient_id;
await N(43,'open_file',{patient_id:archive,appointment_id:ap1});
await ev(P,'late',"now()-interval '2 seconds'",30);
dG=await N(43,'day');assert.deepEqual(dG.sections,['general'],'section covered again');assert.deepEqual(mine(dG),[ap1,ap3].sort(),'general keeps the case it started only');
assert.equal(dG.appointments.find(x=>x.id===ap1).taken_by,'ممرضة عام');
const dP=await N(41,'day');assert.deepEqual(mine(dP),[ap1,ap1b].sort());assert.equal(dP.appointments.find(x=>x.id===ap1).taken_by,'ممرضة عام');assert.equal(dP.appointments.find(x=>x.id===ap1b).taken_by,null);
st=await N(1,'staff_today');assert.equal(st.covered.physio,true);assert.equal(nr(st,41).state,'present');assert.equal(nr(st,41).late_min,30);assert.equal(nr(st,41).returned,1);assert.equal(nr(st,41).kept,1);
let sG=await N(43,'staff_today');assert.equal(nr(sG,41).late_min,null,'colleagues do not see each other\\'s late minutes');assert.equal(nr(await N(41,'staff_today'),41).late_min,30,'own late minutes visible');
assert.equal(sG.can_manage,false);assert.equal(st.can_manage,true);
// check-out punch → not covered any more
await q("insert into clinic_people.device_user_map values('D1',7,$1)",[P]);await q("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('D1',7,now()-interval '2 seconds',0),('D1',7,now()-interval '1 second',1)");
st=await N(1,'staff_today');assert.equal(nr(st,41).state,'out');assert.equal(st.covered.physio,false);assert((await N(43,'day')).sections.includes('physio'));
await q("delete from clinic_people.device_punches");
// unmapped dental nurse: still gets her notices (not absent) but dental is not covered → general sees dental
await ev(D,'unmapped');st=await N(1,'staff_today');assert.equal(nr(st,42).state,'unmapped');assert.equal(st.covered.dental,false);
assert((await N(43,'day')).sections.includes('dental'));
assert.equal((await owner('select clinic_reception.nurse_absent($1,clinic_reception.today()) a',[id(42)]))[0].a,false);
await ev(D,'leave');assert.equal(nr(await N(1,'staff_today'),42).state,'leave');await ev(D,null);assert.equal(nr(await N(1,'staff_today'),42).state,'off');
await ev(D,'upcoming');assert.equal(nr(await N(1,'staff_today'),42).state,'upcoming');assert.equal((await owner('select clinic_reception.nurse_absent($1,clinic_reception.today()) a',[id(42)]))[0].a,true);
// manual absence flag is ignored; the manager section override still works
await ev(D,'on_time',"now()-interval '3 seconds'");
await N(1,'settings_save',{admin_id:id(42),absent_today:true});assert.equal((await q('select absent_on from clinic_reception.nursing_assignments where admin_id=$1',[id(42)]))[0].absent_on,null);
assert.equal((await N(1,'staff_today')).covered.dental,true,'ticking the old box changes nothing');
await N(1,'settings_save',{admin_id:id(43),section_override:'dental'});assert.equal(nr(await N(1,'staff_today'),43).section,'dental');await N(1,'settings_save',{admin_id:id(43),section_override:''});
await assert.rejects(()=>N(41,'settings_save',{admin_id:id(41),section_override:'dental'}),/للسوبر أدمن/);
// gates: a doctor / non-nurse cannot read the board; helpers are not callable by clients
await q("insert into public.admins(id,email,name,role,active) values($1,'d@test','د. حساب','sono_doctor',true) on conflict (id) do update set role='sono_doctor'",[id(45)]);await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view']) on conflict do nothing",[live,id(45)]).catch(()=>{});
await assert.rejects(()=>N(45,'staff_today'),/للتمريض/);
await as(43);await assert.rejects(()=>db.query('select clinic_reception.nurse_presence($1,current_date)',[id(41)]),/permission|denied/i);await as(1);
// rollback restores the old behaviour
await db.exec('reset role;'+require('fs').readFileSync('supabase/rollbacks/20261122310000_nursing_attendance_routing.rollback.sql','utf8'));await as(1);
await assert.rejects(()=>N(1,'staff_today'),/غير معروف/);await N(1,'settings_save',{admin_id:id(42),absent_today:true});
assert((await N(43,'day')).sections.includes('dental'),'old manual absence works again after rollback');
await db.close();console.log('PASS nursing attendance routing: presence from HR (no grace, out, leave, off, unmapped, no_hr), auto re-route + notices, started cases stay with general, staff_today board + late visibility, manual absence ignored, override kept, gates, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const runner=da.slice(da.indexOf('const file=path.join')).replace(/doctor-assistant-run-/g,'nursing-attendance-run-');
const file=path.join(require('os').tmpdir(),'nursing-attendance-outer-'+process.pid+'.cjs');
fs.writeFileSync(file,setup.replace(/__dirname/g,JSON.stringify(__dirname))+'const body='+JSON.stringify(body)+';\n'+runner);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
