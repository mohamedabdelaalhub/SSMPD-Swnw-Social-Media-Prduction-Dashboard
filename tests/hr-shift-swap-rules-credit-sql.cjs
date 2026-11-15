// Shift swaps step 2: same department only, 24-hour rule with HR emergency path, «يوم بديل» (cover → credit, used within 30 days).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
await db.exec("create table if not exists public.task_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid not null,task_id uuid,kind text not null,message text not null,reference_date date default current_date,created_at timestamptz default now(),read_at timestamptz)");for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261115200000_hr_shift_swaps','20261115210000_hr_shift_swap_rules_credit'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
for(const n of [5,6,8])await owner("insert into admins(id,name,role) values($1,$2,'reception')",[id(n),'Employee '+n]);
await as(1);
const A=await call('hr_command',['person',{full_name:'استقبال أول',admin_id:id(5),department:'الاستقبال'}]),B=await call('hr_command',['person',{full_name:'استقبال ثانية',admin_id:id(6),department:'الاستقبال'}]),C=await call('hr_command',['person',{full_name:'ممرضة أولى',admin_id:id(8),department:'التمريض'}]);
const tpl=async(name,a,b)=>(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values($1,$2,$3,15,$4) returning id",[name,a,b,id(1)]))[0].id;
const AM=await tpl('صباحي','08:00','16:00'),PM=await tpl('مسائي','16:00','00:00');
const iso=d=>d.toISOString().slice(0,10),cairo=new Date(Date.now()+2*3600e3),today=new Date(Date.UTC(cairo.getUTCFullYear(),cairo.getUTCMonth(),cairo.getUTCDate()));
const add=(d,n)=>new Date(d.getTime()+n*864e5),nextDow=(d,dow)=>{let x=d;while(x.getUTCDay()!==dow)x=add(x,1);return x;};
const since=iso(add(today,-60));
const week=async(p,t,off)=>{for(let d=0;d<7;d++)await owner("insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,created_by) values($1,$2,$3,$4,$5)",[p,d,d===off?null:t,since,id(1)]);};
await week(A,AM,5);await week(B,PM,6);await week(C,AM,5);   // A: off Friday · B: off Saturday · C: off Friday
const ev=async(day,p)=>(await owner("select status,template_name,to_char(exp_start at time zone 'Africa/Cairo','HH24:MI') st from clinic_people.attendance_eval($1::date,now()) where person_id=$2",[day,p]))[0];
const swap=async(n,action,payload)=>{await as(n);return call('hr_shift_swap_command',[action,payload]);};
const list=async n=>{await as(n);return call('hr_shift_swaps_list',[]);};

// Same department only.
const mon=iso(nextDow(add(today,3),1));
await assert.rejects(()=>swap(5,'request',{kind:'same_day',requester_id:A,partner_id:C,day_a:mon}),/نفس القسم/);

// 24-hour rule: a shift already started/near needs the HR emergency path.
let past=add(today,-1);while([5,6].includes(past.getUTCDay()))past=add(past,-1);past=iso(past);
await assert.rejects(()=>swap(5,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:past}),/24 ساعة/);
await assert.rejects(()=>swap(5,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:past,emergency:true}),/مسؤول الموارد البشرية/);
const em=await swap(1,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:past,emergency:true,note:'طارئ'});
assert.equal((await owner('select emergency from clinic_people.shift_swaps where id=$1',[em]))[0].emergency,true);

// Cover: A is off on Saturday X, B (off that day) covers it with A's morning shift and earns a replacement day.
const X=iso(nextDow(add(today,3),6));
await assert.rejects(()=>swap(5,'request',{kind:'cover',requester_id:A,partner_id:C,day_a:X}),/نفس القسم/);
const cov=await swap(5,'request',{kind:'cover',requester_id:A,partner_id:B,day_a:X,note:'ظرف'});
await swap(6,'respond',{id:cov,accept:true});await swap(3,'approve',{id:cov,note:'موافق'});
assert.equal((await ev(X,A)).status,'leave');assert.equal((await ev(X,B)).st,'08:00');
let cr=(await list(6)).credits;assert.equal(cr.length,1);assert.equal(cr[0].state,'available');assert.equal(cr[0].expires_on,iso(add(new Date(X+'T00:00Z'),30)));
assert.ok((await owner("select 1 from task_notifications where recipient_id=$1 and message like 'لك يوم بديل%'",[id(6)])).length);

// Using it: B takes one of his working days off within 30 days; no colleague step; another HR manager approves.
const Y=iso(add(new Date(X+'T00:00Z'),2));   // Monday after X
await assert.rejects(()=>swap(6,'request',{kind:'credit_use',requester_id:B,day_a:iso(add(new Date(X+'T00:00Z'),31))}),/لا يوجد يوم بديل صالح/);
const use=await swap(6,'request',{kind:'credit_use',requester_id:B,day_a:Y});
assert.equal((await owner('select status from clinic_people.shift_swaps where id=$1',[use]))[0].status,'pending_manager');
await assert.rejects(()=>swap(6,'approve',{id:use,note:'نفسي'}),/للموارد البشرية/);
await swap(3,'approve',{id:use,note:'موافق'});assert.equal((await ev(Y,B)).status,'leave');
assert.equal((await list(6)).credits[0].state,'used');
const Y2=iso(add(new Date(Y+'T00:00Z'),1));
await assert.rejects(()=>swap(6,'request',{kind:'credit_use',requester_id:B,day_a:Y2}),/لا يوجد يوم بديل صالح/,'one credit, one day');

// A used credit blocks reversing the cover; reversing the use gives it back; then the cover can be reversed (credit void).
await assert.rejects(()=>swap(3,'reverse',{id:cov,note:'خطأ'}),/استُخدم/);
await swap(3,'reverse',{id:use,note:'رجوع'});assert.equal((await list(6)).credits[0].state,'available');assert.equal((await ev(Y,B)).st,'16:00');
await swap(3,'reverse',{id:cov,note:'خطأ'});assert.equal((await list(6)).credits[0].state,'voided');assert.equal((await ev(X,A)).st,'08:00');

// An old credit lapses: never usable after 30 days.
await owner("insert into clinic_people.shift_swaps(id,kind,requester_id,partner_id,day_a,status,created_by) values('99999999-0000-4000-8000-000000000001','cover',$1,$2,$3,'approved',$4)",[A,B,iso(add(today,-40)),id(1)]);
await owner("insert into clinic_people.shift_credits(person_id,earned_swap_id,earned_day,expires_on) values($1,'99999999-0000-4000-8000-000000000001',$2,$3)",[B,iso(add(today,-40)),iso(add(today,-10))]);
assert.ok((await list(6)).credits.some(c=>c.state==='expired'));
await assert.rejects(()=>swap(6,'request',{kind:'credit_use',requester_id:B,day_a:Y2}),/لا يوجد يوم بديل صالح/);

// No consecutive-days block (owner: not wanted): B covering a Saturday after six evenings is accepted (covered above).
// The rollback refuses while cover/credit swaps exist.
await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync('supabase/rollbacks/20261115210000_hr_shift_swap_rules_credit.rollback.sql','utf8')),/تغطية/);
console.log('PASS swap rules + «يوم بديل»: same department, 24-hour rule with HR emergency, cover earns a 30-day credit, credit_use with HR approval, used/void/expired states, reversals, guarded rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
