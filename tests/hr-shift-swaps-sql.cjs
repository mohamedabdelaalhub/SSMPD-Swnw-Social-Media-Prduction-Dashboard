// «تبديل وردية»: request → colleague accepts → a different HR manager approves → per-day overrides drive attendance.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
await db.exec("create table if not exists public.task_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid not null,task_id uuid,kind text not null,message text not null,reference_date date default current_date,created_at timestamptz default now(),read_at timestamptz)");for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261115200000_hr_shift_swaps'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
for(const n of [5,6])await owner("insert into admins(id,name,role) values($1,$2,'reception')",[id(n),'Employee '+n]);
await as(1);
const A=await call('hr_command',['person',{full_name:'موظف أول',admin_id:id(5)}]),B=await call('hr_command',['person',{full_name:'موظفة ثانية',admin_id:id(6)}]);
const tpl=async(name,a,b)=>(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values($1,$2,$3,15,$4) returning id",[name,a,b,id(1)]))[0].id;
const AM=await tpl('صباحي','08:00','16:00'),PM=await tpl('مسائي','16:00','00:00');
// A: morning Sat–Thu, off Friday. B: evening Sun–Fri, off Saturday. (2026-11-21 is a Saturday, 2026-11-23 a Monday.)
const week=async(p,t,off)=>{for(let d=0;d<7;d++)await owner("insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,created_by) values($1,$2,$3,'2026-11-01',$4)",[p,d,d===off?null:t,id(1)]);};
await week(A,AM,5);await week(B,PM,6);
for(const [p,u] of [[A,11],[B,12]])await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',$1,$2)",[u,p]);
const ev=async(day,p)=>(await owner("select status,template_name,to_char(exp_start at time zone 'Africa/Cairo','HH24:MI') st from clinic_people.attendance_eval($1::date,'2026-12-31T00:00Z') where person_id=$2",[day,p]))[0];
const swap=async(n,action,payload)=>{await as(n);return call('hr_shift_swap_command',[action,payload]);};
const st=async v=>(await owner('select status from clinic_people.shift_swaps where id=$1',[v]))[0].status;

// --- same-day swap on Monday 23 Nov: A takes the evening, B the morning.
await assert.rejects(()=>swap(5,'request',{kind:'same_day',requester_id:B,partner_id:A,day_a:'2026-11-23'}),/لنفسك فقط/);
const s1=await swap(5,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:'2026-11-23',note:'ظرف عائلي'});
assert.ok((await owner("select 1 from task_notifications where recipient_id=$1 and message like 'طلب تبديل وردية%'",[id(6)])).length,'colleague notified');
await assert.rejects(()=>swap(5,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:'2026-11-23'}),/تبديل آخر/);
await assert.rejects(()=>swap(5,'respond',{id:s1,accept:true}),/للزميل نفسه/);
await assert.rejects(()=>swap(1,'approve',{id:s1,note:'موافق'}),/في انتظار الاعتماد/);
await swap(6,'respond',{id:s1,accept:true});assert.equal(await st(s1),'pending_manager');
await assert.rejects(()=>swap(4,'approve',{id:s1,note:'موافق'}),/للموارد البشرية/);
assert.equal((await ev('2026-11-23',A)).st,'08:00','nothing changes before approval');
await swap(3,'approve',{id:s1,note:'تمام'});assert.equal(await st(s1),'approved');
assert.equal((await ev('2026-11-23',A)).st,'16:00');assert.equal((await ev('2026-11-23',B)).st,'08:00');
assert.equal((await ev('2026-11-24',A)).st,'08:00','only that date changes');

// --- cross-day: A is off Saturday 21 Nov (B works it in A's morning shift); A works B's... B is off Saturday, so pick Friday 27 (A off, B works).
await assert.rejects(()=>swap(1,'request',{kind:'cross_day',requester_id:A,partner_id:B,day_a:'2026-11-24',day_b:'2026-11-25'}),/الزميل يعمل أصلًا/);
const s2=await swap(1,'request',{kind:'cross_day',requester_id:A,partner_id:B,day_a:'2026-11-28',day_b:'2026-11-27'}); // HR on A's behalf: A off Sat 28, works Fri 27
await assert.rejects(()=>swap(1,'respond',{id:s2,accept:true}),/للزميل نفسه/,'the HR who filed it cannot also accept');
await swap(3,'respond',{id:s2,accept:true});                         // a second HR person accepts on the colleague's behalf
await assert.rejects(()=>swap(3,'approve',{id:s2,note:'تمام'}),/مسؤول آخر/,'who accepted cannot approve');
await assert.rejects(()=>swap(1,'approve',{id:s2,note:'تمام'}),/مسؤول آخر/,'who requested cannot approve');
await as(1);await owner("insert into admins(id,name,role) values($1,'HR 7','general_manager')",[id(7)]);
await swap(7,'approve',{id:s2,note:'موافق'});
let a28=await ev('2026-11-28',A),b28=await ev('2026-11-28',B),a27=await ev('2026-11-27',A),b27=await ev('2026-11-27',B);
assert.equal(a28.status,'leave');assert.equal(a28.template_name,'إجازة بتبديل');assert.equal(b28.st,'08:00');
assert.equal(a27.st,'16:00');assert.equal(b27.status,'leave');

// --- the swapped-off day is never an absence and never an attendance row; the extra day is scheduled.
await owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('DEV1',12,'2026-11-28T08:02+02:00',0),('DEV1',12,'2026-11-28T16:00+02:00',1)");
const rng=(await owner("select jsonb_path_query_array(clinic_people_rows, '$[*] ? (@.day == \"2026-11-28\")') r from (select (select jsonb_agg(jsonb_build_object('day',g.d::date,'person_id',e.person_id,'status',e.status)) from generate_series('2026-11-28'::date,'2026-11-28'::date,interval '1 day') g(d), lateral clinic_people.attendance_eval(g.d::date,'2026-12-31T00:00Z') e) clinic_people_rows) x"))[0].r;
assert.equal(rng.find(r=>r.person_id===A).status,'leave');assert.equal(rng.find(r=>r.person_id===B).status,'on_time');

// --- reverse after approval (reason required) restores the weekly pattern; cancel only before approval.
await assert.rejects(()=>swap(7,'reverse',{id:s2,note:''}),/سبب/);
await swap(7,'reverse',{id:s2,note:'تغير الظرف'});assert.equal(await st(s2),'reversed');assert.equal((await ev('2026-11-28',A)).st,'08:00');
await assert.rejects(()=>swap(5,'cancel',{id:s1}),/قبل الاعتماد/);
const s3=await swap(5,'request',{kind:'same_day',requester_id:A,partner_id:B,day_a:'2026-11-30'});await swap(5,'cancel',{id:s3});assert.equal(await st(s3),'cancelled');
const list=await (async()=>{await as(6);return call('hr_shift_swaps_list',[]);})();
assert.equal(list.can_manage,false);assert.ok(list.swaps.length>=3&&list.swaps.every(x=>x.partner_id===B||x.requester_id===B),'an employee sees only his own swaps');
assert.ok((await owner("select count(*)::int n from clinic_people.audit where action like 'shift_swap_%'"))[0].n>=8,'audited');
// The rollback restores the original evaluation and removes the swap objects.
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261115200000_hr_shift_swaps.rollback.sql','utf8'));
assert.equal((await owner("select to_regclass('clinic_people.shift_swaps') t"))[0].t,null);assert.equal((await ev('2026-11-23',A)).st,'08:00');
console.log('PASS shift swaps: own requests only, colleague accepts, four-eyes approval, same-day and cross-day overrides, swapped-off day is leave not absence, reverse/cancel, notifications, audit and a working rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
