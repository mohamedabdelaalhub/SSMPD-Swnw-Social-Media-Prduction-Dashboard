// One yearly UNPAID leave balance of 30 days (owner decision 2026-11-16): every leave type uses it, payroll deducts the
// day's wage (no absence penalty), over the balance needs an owner-level reviewer, refund = absence − day's wage.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
const iso=d=>d.toISOString().slice(0,10),add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d);};
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261116100000_hr_leave_rules','20261115230000_center_closures','20261116110000_hr_holiday_comp_day','20261116120000_hr_double_shift_payroll','20261116160000_hr_exit_autoclose','20261117020000_hr_unpaid_leave_balance'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
await owner('insert into admins(id,name,role) values($1,$2,$3)',[id(5),'Test 5','general_manager']);


const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-U',employee_name:'موظف بدون مرتب',base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-U',note:'عقد اختبار'},key()]);
await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
await as(1);const p=await call('hr_command',['person',{full_name:'موظف بدون مرتب',finance_subject:'EMP-U',admin_id:id(4)}]);
const rule=await call('hr_payroll_command',['rule',{person_id:p,valid_from:'2026-01-01',valid_to:'2026-12-31',late_grace:15,late_minute:2,absence_day:300,overtime_hour:50,note:'قواعد اختبار'}]);
await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);
const req=(who,b)=>as(who).then(()=>call('hr_command',['request',Object.assign({person_id:p,kind:'leave',note:'سبب الطلب',notice_reason:'تسجيل متأخر'},b)]));
const review=(who,rid)=>as(who).then(()=>call('hr_command',['request_review',{id:rid,decision:'approved',review_note:'قرار المراجع'}]));
const bal=async()=>{await as(4);return Number((await call('hr_workspace',['2026-10-01'])).people.find(x=>x.id===p).leave_balance);};
assert.equal(await bal(),30,'30 days a year with no manual credit');
// An absence already deducted in a payroll sent to finance, then covered by a leave: refund = 300 − 200.
await owner("insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,status,created_by,reviewed_by) values($1,'2026-10-20','2026-10-20T08:00+03','2026-10-20T16:00+03',null,null,'غياب','approved',$2,$3)",[p,id(1),id(3)]);
await owner("insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token) values('payroll','EMP-U','PAY-2026-10-U',5700,'{\"month\":\"2026-10-01\"}',$1,gen_random_uuid())",[id(1)]);
const a1=await req(4,{leave_type:'annual',from_date:'2026-10-05',to_date:'2026-10-07',units:3});await review(3,a1);
const a2=await req(4,{leave_type:'annual',from_date:'2026-10-20',to_date:'2026-10-20',units:1});await review(3,a2);
const adj=(await owner("select amount from clinic_people.pay_adjustments where id=(select refund_adjustment_id from clinic_people.requests where id=$1)",[a2]))[0];
assert.equal(Number(adj.amount),100,'refund the absence penalty minus the unpaid day');
assert.equal(await bal(),26);
// Payroll: 4 unpaid leave days × 200, no absence counted.
await as(1);const calc=await call('hr_payroll_calculate',[p,'2026-10-01']);
assert.equal(calc.absent_shifts,0);assert.equal(Number(calc.unpaid_leave_days),4);assert.equal(Number(calc.unpaid_leave_deduction),800);
assert.equal(Number(calc.pre_tax_net),6000-800);
// Over the balance: HR cannot approve; the general manager can, recorded as an exception.
const big=await req(4,{leave_type:'annual',from_date:'2026-12-01',to_date:'2026-12-28',units:28});
await assert.rejects(()=>review(3,big),/أكتر من رصيد الأجازات/);
await review(5,big);const br=(await owner('select exception_by,status from clinic_people.requests where id=$1',[big]))[0];
assert.equal(br.status,'approved');assert.equal(br.exception_by,id(5));
assert.equal(await bal(),-2);
// Applying twice is refused.
await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261117020000_hr_unpaid_leave_balance.sql','utf8')),/من قبل/);
await db.exec('rollback').catch(()=>{});
await db.exec(fs.readFileSync('supabase/rollbacks/20261117020000_hr_unpaid_leave_balance.rollback.sql','utf8'));
await as(4);assert.equal(Number((await call('hr_workspace',['2026-10-01'])).people.find(x=>x.id===p).leave_balance),-32,'rollback: back to credits-only annual/casual');
console.log('PASS unpaid leave balance: 30 days a year, every leave unpaid at the day wage with no absence penalty, over-balance needs owner level, refund = absence − wage, guarded patch and rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
