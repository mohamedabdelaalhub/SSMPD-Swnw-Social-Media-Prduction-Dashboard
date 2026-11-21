// Job catalog: salary visibility, assignment, band warning, my-job without pay (owner approved 2026-11-21).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261116100000_hr_leave_rules','20261116160000_hr_exit_autoclose','20261121160000_hr_job_catalog'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(4)]);
const today=(await owner("select ((now() at time zone 'Africa/Cairo')::date)::text d"))[0].d;
const seeded=(await owner("select count(*)::int n from clinic_people.jobs"))[0].n;assert.equal(seeded,14,'14 jobs seeded');
assert.equal((await owner("select count(*)::int n from clinic_people.jobs where salary_min is not null or salary_max is not null or salary_approved is not null"))[0].n,0,'no salary figures live in git');
const nurse=(await owner("select id from clinic_people.jobs where code='nurse'"))[0].id,recep=(await owner("select id from clinic_people.jobs where code='receptionist'"))[0].id;
// owner enters the nurse band
const cat=await call('hr_jobs',[]);const nj=cat.jobs.find(j=>j.id===nurse);
await call('hr_job_save',[{id:nurse,revision:nj.revision,title_ar:nj.title_ar,kpis:nj.kpis,salary_min:7000,salary_max:8000,salary_approved:7500}]);
// employee + linked approved contract below the band
const p=await call('hr_command',['person',{full_name:'ممرضة اختبار',kind:'employee',admin_id:id(4)}]);
await call('hr_job_assign',[p,nurse]);
assert.equal((await owner("select job_id from clinic_people.people where id=$1",[p]))[0].job_id,nurse);
// salary visibility: reception (HR access, no finance) sees the job but NOT the salary
await as(4);const rc=await call('hr_jobs',[]);const rn=rc.jobs.find(j=>j.id===nurse);
assert.equal(rc.salary_visible,false);assert.ok(!('salary_min' in rn)&&!('salary_max' in rn)&&!('salary_approved' in rn),'HR-only user never gets salary');
assert.equal(rc.can_edit,false);await assert.rejects(()=>call('hr_job_save',[{id:nurse,revision:rn.revision,title_ar:'x y z'}]),/تعديل دليل الوظائف/);
assert.equal((await call('hr_job_band',[p])).visible,false);
// accountant sees the salary
await as(2);const ac=await call('hr_jobs',[]).catch(e=>String(e));
// accountant has no HR manage rights -> catalog list is refused, band check still works
assert.match(String(ac),/الموارد البشرية/);
const band=await call('hr_job_band',[p]);assert.equal(band.visible,true);assert.equal(band.status,'no_salary');assert.equal(Number(band.salary_min),7000);
// approved employment contract below the band → warning only
await as(1);await owner("update clinic_people.people set finance_subject='emp:t1' where id=$1",[p]);
await owner("insert into clinic_finance.business_requests(kind,subject,status,amount,reference,payload,created_by,token) values('employment','emp:t1','approved',0,'job-band-t1',$1::jsonb,$2,gen_random_uuid())",[JSON.stringify({base:'6500',from:today.slice(0,4)+'-01-01',to:today.slice(0,4)+'-12-31',employee_name:'x'}),id(1)]).catch(e=>{throw e});
await as(2);const b2=await call('hr_job_band',[p]);assert.equal(b2.status,'below');assert.equal(Number(b2.diff),500);
// my job: employee (admin 4) sees tasks/kpis, never pay
await as(4);const mine=await call('hr_my_job',[]);assert.equal(mine.job.title_ar,'ممرض / ممرضة');assert.ok(mine.job.tasks.length>0);
assert.ok(!JSON.stringify(mine).includes('salary')&&!('incentive' in mine.job)&&mine.job.kpis.every(k=>!('target' in k)),'my job has no pay or targets');
// doctors are out of the catalog
await as(1);const d=await call('hr_command',['person',{full_name:'د. اختبار طبيب',kind:'doctor'}]);
await assert.rejects(()=>call('hr_job_assign',[d,nurse]),/الأطباء خارج/);
// annex + unclassified
await as(4);const an=await call('hr_job_annex',[p]);assert.equal(an.title_ar,'ممرض / ممرضة');
const cat2=await call('hr_jobs',[]);assert.ok(cat2.jobs.find(j=>j.id===nurse).people.some(x=>x.id===p));
// clear link
await call('hr_job_assign',[p,null]);assert.equal((await owner("select job_id from clinic_people.people where id=$1",[p]))[0].job_id,null);
console.log('PASS job catalog: 14 seeded without salaries, salary hidden from HR-only, owner saves bands, assign/clear link, band warning, my-job without pay, doctors excluded.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
