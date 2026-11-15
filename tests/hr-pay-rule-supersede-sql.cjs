// A reviewed replacement supersedes an approved pay rule (e.g. to turn on «حد أدنى مضمون» after approval).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261115100000_hr_pay_guaranteed_minimum.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261115120000_hr_pay_rule_supersede.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
const mk=async(code)=>{await as(1);const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-'+code,employee_name:'أخصائية '+code,base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-'+code,note:'عقد اختبار'},key()]);
  await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);await as(1);return call('hr_command',['person',{full_name:'أخصائية '+code,finance_subject:'EMP-'+code}]);};
const rule=async(person,extra)=>{await as(1);return call('hr_payroll_command',['rule',Object.assign({person_id:person,valid_from:'2026-11-01',valid_to:'2026-12-31',late_grace:15,late_minute:1,absence_day:250,overtime_hour:30,note:'قواعد اختبار'},extra||{})]);};
const review=async(id,decision)=>{await as(3);return call('hr_payroll_command',['rule_review',{id,decision:decision||'approved',review_note:'مراجعة القاعدة'}]);};
const st=async id=>(await owner('select status,valid_from::text vf,valid_to::text vt,guaranteed_minimum g from clinic_people.pay_rules where id=$1',[id]))[0];
const a=await mk('A'),b=await mk('B');
const oldA=await rule(a);await review(oldA);
// Without naming the old rule, an overlapping rule is still refused at review.
const plain=await rule(a,{guaranteed_minimum:'true'});await assert.rejects(()=>review(plain),/متداخلة/);
// Only an approved rule of the SAME person can be superseded.
await assert.rejects(()=>rule(b,{supersedes:oldA}),/لنفس الموظف/);
// Same start date → the old rule is fully replaced once a different reviewer approves the new one.
const newA=await rule(a,{supersedes:oldA,guaranteed_minimum:'true'});
assert.equal((await st(oldA)).status,'approved','nothing changes before review');
await as(1);await assert.rejects(()=>call('hr_payroll_command',['rule_review',{id:newA,decision:'approved',review_note:'نفسي'}]),/مراجع/);
await review(newA);assert.equal((await st(oldA)).status,'superseded');let n=await st(newA);assert.equal(n.status,'approved');assert.equal(n.g,true);
assert.ok((await owner("select 1 from clinic_people.audit where action='rule_superseded' and record_id=$1",[oldA])).length);
// A later start → the old rule is shortened to the day before; a rejected replacement leaves it untouched.
const oldB=await rule(b);await review(oldB);
const rej=await rule(b,{supersedes:oldB,valid_from:'2026-12-01'});await review(rej,'rejected');assert.equal((await st(oldB)).vt,'2026-12-31');
const newB=await rule(b,{supersedes:oldB,valid_from:'2026-12-01',guaranteed_minimum:'true'});await review(newB);
const ob=await st(oldB);assert.equal(ob.status,'approved');assert.equal(ob.vt,'2026-11-30');
// A superseded/ended rule cannot be superseded twice.
await assert.rejects(()=>rule(a,{supersedes:oldA}),/لنفس الموظف/);
console.log('PASS rule supersede: overlap still refused without it, same person only, applied only on a different reviewer\'s approval, full replace or shorten, rejection leaves the old rule, audited.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
