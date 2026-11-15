// «حد أدنى مضمون»: a pay rule flag that pays the HIGHER of the contract salary and the month's commission, never the sum.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261115100000_hr_pay_guaranteed_minimum.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
// Two people with the same contract (6000), same attendance and same rates; only one has the guaranteed-minimum flag.
const people={};
for(const [code,flag] of [['PLAIN',false],['GUARANTEED',true]]){
  await as(1);const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-'+code,employee_name:'أخصائية '+code,base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-'+code,note:'عقد اختبار'},key()]);
  await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
  await as(1);const person=await call('hr_command',['person',{full_name:'أخصائية '+code,finance_subject:'EMP-'+code}]);people[code]=person;
  const rule=await call('hr_payroll_command',['rule',{person_id:person,valid_from:'2026-01-01',valid_to:'2026-12-31',late_grace:5,late_minute:2,absence_day:200,overtime_hour:50,guaranteed_minimum:String(flag),note:'قواعد اختبار'}]);
  await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);
  await as(1);await call('hr_payroll_command',['import_attendance',{filename:code+'.csv',checksum:'attendance-'+code+'-checksum',rows:[{person_id:person,day:'2026-10-02',scheduled_start:'2026-10-02T06:00Z',scheduled_end:'2026-10-02T14:00Z',actual_start:'2026-10-02T06:15Z',actual_end:'2026-10-02T15:00Z'},{person_id:person,day:'2026-10-03',scheduled_start:'2026-10-03T06:00Z',scheduled_end:'2026-10-03T14:00Z'}]}]);
  const at=(await call('hr_workspace',['2026-10-01'])).attendance.filter(a=>a.person_id===person);await as(3);for(const a of at)await call('hr_command',['attendance_review',{id:a.id,decision:'approved',review_note:'راجعت الحضور'}]);
}
assert.equal((await owner('select guaranteed_minimum from clinic_people.pay_rules where person_id=$1',[people.GUARANTEED]))[0].guaranteed_minimum,true);
// Both are linked to the doctor ledger with commission earned on October invoices (the ledger pays those fees itself).
const fee=async(person,keyName,amount,day)=>{await owner('update clinic_people.people set doctor_key=$2 where id=$1',[person,keyName]);
  await db.exec("set session_replication_role=replica");const inv=(await owner("insert into clinic_finance.invoices(reference,description,amount,created_by,created_at,token) values('INV-'||gen_random_uuid(),'فاتورة اختبار',$2,$3,$1::timestamptz,gen_random_uuid()) returning id",[day+'T10:00:00+02:00',amount*5,id(1)]))[0].id;
  await owner('insert into clinic_finance.doctor_accruals(invoice_id,doctor_key,delta) values($1,$2,$3)',[inv,keyName,amount]);await db.exec("set session_replication_role=origin");};
await fee(people.PLAIN,'SPEC-PLAIN',2500,'2026-10-10');await fee(people.GUARANTEED,'SPEC-G',2500,'2026-10-10');
await fee(people.GUARANTEED,'SPEC-G',999,'2026-09-30'); // another month: ignored
await as(1);
// Without the flag nothing changes: 6000 + 50 overtime - 220 lateness/absence (doctor fees are paid separately).
let plain=await call('hr_payroll_calculate',[people.PLAIN,'2026-10-01']);assert.equal(Number(plain.pre_tax_net),5830);assert.equal(Number(plain.guarantee_offset),0);assert.equal(plain.guaranteed_minimum,false);
// Commission below the salary: payroll tops the 2500 fees up to the salary → 2500 + 3330 = 5830 (same total as the salary).
let g=await call('hr_payroll_calculate',[people.GUARANTEED,'2026-10-01']);assert.equal(Number(g.doctor_commission),2500);assert.equal(Number(g.guarantee_offset),2500);assert.equal(Number(g.salary_deduction),2720);assert.equal(Number(g.pre_tax_net),3330);
// Commission above the salary: payroll pays nothing more; the person gets the 7500 commission only (not 6000 + 7500).
await fee(people.GUARANTEED,'SPEC-G',5000,'2026-10-20');await as(1);
g=await call('hr_payroll_calculate',[people.GUARANTEED,'2026-10-01']);assert.equal(Number(g.doctor_commission),7500);assert.equal(Number(g.guarantee_offset),6000);assert.equal(Number(g.pre_tax_net),0);assert.ok(Number(g.salary_deduction)<=6050);
// The calculated request still passes the finance guard (deductions never exceed salary + allowance).
const pay=await call('hr_payroll_prepare',[people.GUARANTEED,'2026-10-01',{reference:'PAYROLL-G',note:'راجعنا اكتمال الشهر',tax:0,insurance:0,recovery:0},key()]);assert.ok(pay);
console.log('PASS guaranteed minimum: flag reviewed with the pay rule, salary topped up to the minimum, commission above it replaces the salary, other months ignored, no change without the flag.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
