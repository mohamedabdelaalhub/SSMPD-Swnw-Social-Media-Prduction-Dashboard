// The fingerprint is the basis of payroll: punches + shift schedule -> pending attendance -> reviewed -> salary.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-P',employee_name:'موظف بصمة',base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-P',note:'عقد اختبار'},key()]);
await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
await as(1);const p=await call('hr_command',['person',{full_name:'موظف بصمة',finance_subject:'EMP-P'}]);const q=await call('hr_command',['person',{full_name:'موظف بلا بصمة'}]);
const rule=await call('hr_payroll_command',['rule',{person_id:p,valid_from:'2026-01-01',valid_to:'2026-12-31',late_grace:15,late_minute:2,absence_day:200,overtime_hour:50,note:'قواعد اختبار'}]);
await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);
// Morning shift 08:00–16:00 every day from 1 to 4 October; P has fingerprint number 7, Q has none.
const t=(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values('صباحي','08:00','16:00',15,$1) returning id",[id(1)]))[0].id;
for(const who of [p,q])for(let dow=0;dow<7;dow++)await owner("insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,valid_to,created_by) values($1,$2,$3,'2026-10-01','2026-10-04',$4)",[who,dow,t,id(1)]);
await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',7,$1)",[p]);
const punch=(ts,k)=>owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('DEV1',7,$1::timestamptz,$2)",[ts+'+03:00',k]);
await punch('2026-10-01T07:55',0);await punch('2026-10-01T16:00',1);    // on time
await punch('2026-10-02T08:40',0);await punch('2026-10-02T17:30',1);    // 40 min late, 1.5 h overtime
                                                                          // 3 Oct: no punch → absent
await punch('2026-10-04T08:00',0);                                        // no exit punch
// Only HR managers.
await as(4);await assert.rejects(()=>call('hr_attendance_from_punches',['2026-10-01']),/الموارد البشرية/);
await as(1);let r=await call('hr_attendance_from_punches',['2026-10-01']);
assert.equal(r.created,4);assert.equal(r.absent,1);assert.equal(r.late,1);assert.equal(r.missing_exit,1);assert.equal(r.through,'2026-10-31');
assert.equal(JSON.stringify(r.unmapped),JSON.stringify(['موظف بلا بصمة']),'people without a fingerprint code are listed, never marked absent');
const rows=await owner("select day::text d,status,actual_start is null absent,to_char(actual_end at time zone 'Africa/Cairo','HH24:MI') out_at,note,source_import_id from clinic_people.attendance where person_id=$1 order by day",[p]);
assert.equal(rows.length,4);assert.ok(rows.every(x=>x.status==='pending'&&x.source_import_id===r.import_id),'pending, one reviewable batch');
assert.equal(rows[2].absent,true);assert.match(rows[2].note,/غياب/);assert.equal(rows[3].out_at,'16:00');assert.match(rows[3].note,/خروج غير مسجل/);
// Running again never duplicates or touches recorded days.
r=await call('hr_attendance_from_punches',['2026-10-01']);assert.equal(r.created,0);assert.equal(r.already_recorded,4);assert.equal(r.import_id,null);
// The creator cannot approve the batch; a different HR reviewer approves the month at once.
await assert.rejects(()=>call('hr_payroll_command',['attendance_import_review',{id:rows[0].source_import_id,decision:'approved',review_note:'نفسي'}]),/مراجع/);
await assert.rejects(()=>call('hr_payroll_calculate',[p,'2026-10-01']),/معلق/);
await as(3);await call('hr_payroll_command',['attendance_import_review',{id:rows[0].source_import_id,decision:'approved',review_note:'راجعت بصمات الشهر'}]);
// Salary from the fingerprint: 6000 + 1.5 h × 50 − (40−15) min × 2 − 1 absence × 200 = 5825.
await as(1);const calc=await call('hr_payroll_calculate',[p,'2026-10-01']);
assert.equal(calc.approved_shifts,4);assert.equal(Number(calc.late_minutes),25);assert.equal(calc.absent_shifts,1);assert.equal(Number(calc.overtime_hours),1.5);assert.equal(Number(calc.pre_tax_net),5825);
// A month with no completed day yet is refused.
await assert.rejects(()=>call('hr_attendance_from_punches',['2099-01-01']),/لا توجد أيام مكتملة/);
console.log('PASS fingerprint → payroll: shift + punches become one pending batch (on time, late, absent, missing exit), unmapped staff listed, no duplicates, four-eyes approval, salary computed from it.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
