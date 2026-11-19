// Payroll: a «يوم كامل» (scheduled > 12 h) counts as two shifts (owner decision 2026-11-15).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261115230000_center_closures','20261116120000_hr_double_shift_payroll'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-D',employee_name:'ممرض يوم كامل',base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-D',note:'عقد اختبار'},key()]);
await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
await as(1);const p=await call('hr_command',['person',{full_name:'ممرض يوم كامل',finance_subject:'EMP-D'}]);
const rule=await call('hr_payroll_command',['rule',{person_id:p,valid_from:'2026-01-01',valid_to:'2026-12-31',late_grace:15,late_minute:2,absence_day:200,overtime_hour:50,note:'قواعد اختبار'}]);
await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);
const row=(day,ss,se,as_,ae)=>owner("insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,status,created_by,reviewed_by) values($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6::timestamptz,'اختبار','approved',$7,$8)",[p,day,ss,se,as_,ae,id(1),id(3)]);
const full=d=>[d+'T08:00+02:00',(d.slice(0,8)+String(+d.slice(8)+1).padStart(2,'0'))+'T00:00+02:00'];
let [s,e]=full('2026-10-05');await row('2026-10-05',s,e,null,null);                                  // absent whole day → 2
[s,e]=full('2026-10-06');await row('2026-10-06',s,e,'2026-10-06T08:00+02:00','2026-10-06T16:00+02:00'); // morning only → 1
[s,e]=full('2026-10-07');await row('2026-10-07',s,e,'2026-10-07T16:30+02:00',e);                      // evening only, 30 min late from 16:00 → 1, 15 late min
[s,e]=full('2026-10-08');await row('2026-10-08',s,e,'2026-10-08T08:00+02:00',e);                      // whole day → 0
await row('2026-10-09','2026-10-09T08:00+02:00','2026-10-09T16:00+02:00',null,null);                  // ordinary shift absent → 1
await as(1);const calc=await call('hr_payroll_calculate',[p,'2026-10-01']);
assert.equal(Number(calc.approved_shifts),9,'4 full days count 8 shifts + 1 ordinary');
assert.equal(Number(calc.absent_shifts),5,'2 + 1 + 1 + 0 + 1');
assert.equal(Number(calc.late_minutes),15,'evening-only lateness measured from the midpoint, minus grace');
assert.equal(Number(calc.pre_tax_net),6000-5*200-15*2);
// Applying twice is refused; the rollback restores the original body.
await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261116120000_hr_double_shift_payroll.sql','utf8')),/من قبل/);
await db.exec('rollback').catch(()=>{});
await db.exec(fs.readFileSync('supabase/rollbacks/20261116120000_hr_double_shift_payroll.rollback.sql','utf8'));
await as(1);const old=await call('hr_payroll_calculate',[p,'2026-10-01']);assert.equal(Number(old.absent_shifts),2,'original: one per absent row');assert.equal(Number(old.approved_shifts),5);
console.log('PASS double-shift payroll: a full day counts two shifts, whole-day absence deducts 2, a half day deducts 1, evening-only lateness from the midpoint; guarded patch and rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
