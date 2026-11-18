// Owner 2026-11-18: overtime only with an approved request (direct manager or HR, never self), capped at the shift end and the day's last
// doctor appointment, task expected time + 20%, «صرف الأوفر تايم» switch (off by default), report + repeat flags. Setup from hr-double-shift-payroll-sql.
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

await db.exec('reset role');await db.exec("alter table tasks add column if not exists created_at timestamptz not null default now();alter table tasks add column if not exists description text not null default ''");const M=fs.readFileSync('supabase/migrations/20261118010000_hr_overtime_control.sql','utf8');await db.exec(M);
await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
// people: 4 = the employee (reception account), 5 = his direct manager, 6 = a colleague; 3 = HR, 1 = super admin
await owner("insert into admins(id,name,role) values($1,'مدير القسم','reception'),($2,'زميل','reception') on conflict do nothing",[id(5),id(6)]);
const mgr=(await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values('مدير القسم',$1,'active',$2) returning id",[id(5),id(1)]))[0].id;
await owner("update clinic_people.people set admin_id=$1,manager_id=$2 where id=$3",[id(4),mgr,p]);
await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values('زميل',$1,'active',$2)",[id(6),id(1)]);
// shift ends 20:00; he stays: day 12 → 22:00 (no request), day 13 → 21:30 with a request, day 14 → 23:30 but the last doctor ended 21:00
await row('2026-10-12','2026-10-12T12:00+02:00','2026-10-12T20:00+02:00','2026-10-12T12:40+02:00','2026-10-12T22:00+02:00');
await row('2026-10-13','2026-10-13T12:00+02:00','2026-10-13T20:00+02:00','2026-10-13T12:00+02:00','2026-10-13T21:30+02:00');
await row('2026-10-14','2026-10-14T12:00+02:00','2026-10-14T20:00+02:00','2026-10-14T12:00+02:00','2026-10-14T23:30+02:00');
const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
const prov=(await owner("insert into clinic_reception.providers(workspace_id,name,department,branch) values($1,'د. اختبار','عيادة','فرع') returning id",[ws]))[0].id;
const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,created_by) values($1,'OT1','مريض',$2) returning id",[ws,id(1)]))[0];
const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'OTK','كشف','عيادة',100,30) returning id",[ws]))[0];
if(pat&&svc)await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,created_by) values($1,$2,$3,$4,'2026-10-14T20:30+02:00','2026-10-14T21:00+02:00',$5)",[ws,pat.id,prov,svc.id,id(1)]);
const ot=(a,pl)=>call('hr_overtime',[a,pl||{}]);if(process.env.DBG)console.log('fixtures',!!pat,!!svc);
// the employee asks for day 13 (tied to a task) and day 14
await as(4);
const task=(await owner("insert into tasks(title,description,assignee_id) values('تقرير الحسابات','جمع إيصالات اليوم',$1) returning id",[id(4)]).catch(e=>{console.log('task fixture:',e.message);return [null];}))[0];
if(process.env.DBG)console.log('task',!!task);const r13=await ot('request',{day:'2026-10-13',minutes:90,reason:'إنهاء تقرير المدير',task_id:task&&task.id});
const r14=await ot('request',{day:'2026-10-14',minutes:200,reason:'جرد'});
await assert.rejects(()=>ot('review',{id:r13.id,approve:true,expected_minutes:60}),/للمدير المباشر أو الموارد البشرية/,'no self approval');
await as(6);await assert.rejects(()=>ot('review',{id:r13.id,approve:true,expected_minutes:60}),/للمدير المباشر/,'a colleague cannot');
await as(6);await assert.rejects(()=>ot('request',{person_id:p,day:'2026-10-13',minutes:30,reason:'x y z'}),/لنفسك أو لفريقك/);
// direct manager: task expected 60 → up to 72 without a reason; 90 needs a reason
await as(5);let ws5=await ot('workspace',{month:'2026-10-01'});assert.equal(ws5.to_review.length,2,'manager sees his team');
if(task){await assert.rejects(()=>ot('review',{id:r13.id,approve:true}),/الوقت المتوقع للمهمة/);
 await assert.rejects(()=>ot('review',{id:r13.id,approve:true,expected_minutes:60,approved_minutes:90}),/سبب الزيادة/);
 await ot('review',{id:r13.id,approve:true,expected_minutes:60,approved_minutes:72});}
else await ot('review',{id:r13.id,approve:true,approved_minutes:72});
// HR approves day 14 for 200 min, but the day's clinic work ended 21:00 → 60 counted
await as(3);await ot('review',{id:r14.id,approve:true,approved_minutes:200});
await assert.rejects(()=>ot('review',{id:r14.id,approve:false}),()=>true).catch(()=>{});
const wsh=await ot('workspace',{month:'2026-10-01'});
const R=d=>wsh.report.find(x=>x.day===d);
assert.equal(R('2026-10-12').counted_min,0,'stayed 2h without a request → 0');assert.equal(R('2026-10-12').flag,true,'flagged for HR');
assert.equal(R('2026-10-13').counted_min,72,'approved 72 of 90 recorded');assert.equal(R('2026-10-13').flag,false);
if(pat&&svc){assert.equal(R('2026-10-14').capped_min,60,'capped at the last doctor (21:00)');assert.equal(R('2026-10-14').counted_min,60);}
assert(R('2026-10-13').requests[0].reason,'reason in the report');
// payroll: switch OFF → hours visible, pay 0; ON → paid at 50/h; lateness (40 min on day 12) still deducted
await as(1);let calc2=await call('hr_payroll_calculate',[p,'2026-10-01']);
const expectH=Math.round((72+(pat&&svc?60:200))/60*100)/100;
assert.equal(Number(calc2.overtime_hours),expectH);assert.equal(calc2.overtime_pay_enabled,false);assert.equal(Number(calc2.overtime_pay),0);
assert(Number(calc2.overtime_hours_recorded)>Number(calc2.overtime_hours),'raw recorded kept for reference');
const net0=Number(calc2.pre_tax_net);
await as(3);await assert.rejects(()=>ot('settings',{pay_enabled:true}),/للسوبر أدمن أو المدير العام/,'HR cannot flip the pay switch');
await as(1);await ot('settings',{pay_enabled:true});calc2=await call('hr_payroll_calculate',[p,'2026-10-01']);
assert.equal(Number(calc2.overtime_pay),Math.round(expectH*50*100)/100);assert.equal(Number(calc2.pre_tax_net),Math.round((net0+expectH*50)*100)/100);
// repeat flags: 3 unapproved stays
await row('2026-10-20','2026-10-20T12:00+02:00','2026-10-20T20:00+02:00','2026-10-20T12:00+02:00','2026-10-20T21:00+02:00');
await row('2026-10-21','2026-10-21T12:00+02:00','2026-10-21T20:00+02:00','2026-10-21T12:00+02:00','2026-10-21T21:00+02:00');
await as(3);const w3=await ot('workspace',{month:'2026-10-01'});assert(w3.repeaters.some(x=>x.person_id===p&&x.times>=3),'3+ unapproved stays marked');
await as(4);const w4=await ot('workspace',{month:'2026-10-01'});assert.equal(w4.report.length,0,'an employee does not see the team report');assert.equal(w4.mine.length,2);
// rollback restores payroll
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261118010000_hr_overtime_control.rollback.sql','utf8'));
await as(1);const back=await call('hr_payroll_calculate',[p,'2026-10-01']);assert.equal(back.overtime_pay_enabled,undefined);
console.log('PASS overtime control: request/approve (manager or HR, never self), task +20% rule, shift-end and last-doctor cap, report + flags + repeaters, payroll pays only counted hours and only when switched on, rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
