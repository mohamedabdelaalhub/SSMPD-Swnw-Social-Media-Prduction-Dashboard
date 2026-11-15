// Center closures (official holidays): maker-checker approval, attendance → leave, payroll never counts an absence,
// booking refused on a closed day, reception snapshot carries the closures. PGlite with small stand-ins for the
// live functions the migration wraps (same names and signatures).
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite(),id=n=>'70000000-0000-4000-8000-'+String(n).padStart(12,'0');
await db.exec(`create role anon;create role authenticated;
create table admins(id uuid primary key,name text,role text,active boolean default true,has_hr_access boolean default false);
create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
create schema clinic_people;create schema clinic_reception;grant usage on schema public to authenticated;
create function clinic_people.manage() returns boolean language sql stable as $$select exists(select 1 from public.admins where id=public.my_admin_id() and active and (has_hr_access or public.has_role('super_admin') or public.has_role('general_manager')))$$;
create table clinic_people.audit(id bigint generated always as identity primary key,actor_id uuid not null references public.admins(id),action text not null,record_id uuid not null,before_data jsonb,after_data jsonb);
create table clinic_people.attendance(person_id uuid,day date,actual_start timestamptz,status text default 'approved');
create table clinic_people.requests(person_id uuid,status text,kind text,from_date date,to_date date);
create function clinic_people.attendance_eval(p_day date,p_now timestamptz default now()) returns table(person_id uuid,template_id uuid,template_name text,color text,grace integer,exp_start timestamptz,exp_end timestamptz,device_user_id integer,first_in timestamptz,status text,late_min integer,since_start integer,excused boolean)
 language sql stable as $$select '${id(90)}'::uuid,null::uuid,'صباحي','#0F369D',10,null::timestamptz,null::timestamptz,1,null::timestamptz,'absent',0,60,false union all select '${id(91)}'::uuid,null,'صباحي','#0F369D',10,null,null,2,now(),'late',25,60,false union all select '${id(92)}'::uuid,null,null,null,null,null,null,null,null,'unmapped',null,null,false$$;
create function public.hr_payroll_calculate(p_person uuid,p_month date) returns jsonb language plpgsql stable as $$declare absent int;begin
 select count(*) filter(where actual_start is null and not exists(select 1 from clinic_people.requests q where q.person_id=p_person and q.status='approved' and q.kind='leave' and clinic_people.attendance.day between q.from_date and q.to_date)) into absent from clinic_people.attendance where person_id=p_person and status='approved';
 return jsonb_build_object('absent_shifts',absent);end $$;
create table clinic_reception.workspaces(id uuid primary key,mode text);
create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,starts_at timestamptz,status text);
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$begin return jsonb_build_object('ok',p_action);end $$;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date) returns jsonb language plpgsql security definer as $$begin return jsonb_build_object('appointments','[]'::jsonb);end $$;`);
const people=[[1,'سوبر','super_admin',false],[2,'مدير عام','general_manager',false],[3,'موارد بشرية','hr_employee',true],[4,'استقبال','reception',false]];
for(const [n,name,role,hr] of people)await db.query('insert into admins(id,name,role,has_hr_access) values($1,$2,$3,$4)',[id(n),name,role,hr]);
await db.exec(fs.readFileSync('supabase/migrations/20261115200000_center_closures.sql','utf8'));
const as=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);await db.exec('set role authenticated');};
const q=async(sql,a=[])=>(await db.query(sql,a)).rows;
const cmd=(a,p)=>q('select public.center_closure_command($1,$2) v',[a,p]).then(r=>r[0].v);
const su=async(sql,a)=>{await db.exec('reset role');const r=await q(sql,a);return r;};
// 1) Reception cannot add; HR adds → pending, no effect yet.
await as(4);await assert.rejects(()=>cmd('add',{name:'عيد الأضحى',from_date:'2027-05-16',to_date:'2027-05-19'}),/للموارد البشرية/);
await as(3);const h=(await cmd('add',{name:'عيد الأضحى',from_date:'2027-05-16',to_date:'2027-05-19'})).id;
await assert.rejects(()=>cmd('add',{name:'مكرر',from_date:'2027-05-18',to_date:'2027-05-18'}),/بتتقاطع/);
let r=await su("select status from clinic_people.attendance_eval('2027-05-17') where person_id=$1",[id(90)]);assert.equal(r[0].status,'absent','pending has no effect');
// 2) HR cannot approve; the creator cannot approve even as GM; another reviewer approves.
await assert.rejects(()=>cmd('review',{id:h,approve:true}),/للسوبر أدمن أو المدير العام/);
await as(2);const own=(await cmd('add',{name:'شم النسيم',from_date:'2027-05-03'})).id;await assert.rejects(()=>cmd('review',{id:own,approve:true}),/شخص تاني/);
await assert.rejects(()=>cmd('review',{id:h,approve:false}),/سبب الرفض/);
assert.equal((await cmd('review',{id:h,approve:true})).status,'approved');await assert.rejects(()=>cmd('review',{id:h,approve:true}),/اتراجعت/);
await as(1);assert.equal((await cmd('review',{id:own,approve:false,note:'مش أجازة عندنا'})).status,'rejected');
// 3) Lists: managers see all; reception sees approved only.
await as(3);let L=(await q('select public.center_closures() v'))[0].v;assert.equal(L.closures.length,2);assert.equal(L.can_add,true);assert.equal(L.can_review,false);
await as(4);L=(await q('select public.center_closures() v'))[0].v;assert.deepEqual(L.closures.map(c=>c.status),['approved']);assert.equal(L.can_add,false);
// 4) Attendance: closed day → leave (excused, no lateness); unmapped stays; other days unchanged.
r=await su("select person_id,status,late_min,excused from clinic_people.attendance_eval('2027-05-17') order by person_id");
assert.deepEqual(r.map(x=>x.status),['leave','leave','unmapped']);assert.equal(r[1].late_min,0);assert.equal(r[0].excused,true);
r=await su("select status from clinic_people.attendance_eval('2027-05-20') order by person_id");assert.deepEqual(r.map(x=>x.status),['absent','late','unmapped']);
// 5) Payroll: absence rows on closed days are not counted.
await su("insert into clinic_people.attendance(person_id,day,actual_start) values($1,'2027-05-17',null),($1,'2027-05-18',null),($1,'2027-05-20',null)",[id(90)]);
r=await su("select public.hr_payroll_calculate($1,'2027-05-01') v",[id(90)]);assert.equal(r[0].v.absent_shifts,1);
// 6) Booking refused on a closed day (Cairo date, even late at night UTC), allowed otherwise; other actions untouched.
await as(4);const book=(day)=>q("select public.clinic_reception_command($1,'book',$2,gen_random_uuid()) v",[id(50),{starts_at:day}]).then(x=>x[0].v);
await assert.rejects(()=>book('2027-05-16T08:00:00Z'),/أجازة رسمية: عيد الأضحى/);await assert.rejects(()=>book('2027-05-15T22:30:00Z'),/أجازة رسمية/,'00:30 Cairo on 16 May');
assert.equal((await book('2027-05-20T08:00:00Z')).ok,'book');
assert.equal((await q("select public.clinic_reception_command($1,'arrive','{}',gen_random_uuid()) v",[id(50)]))[0].v.ok,'arrive');
// 7) Snapshot carries closures overlapping the period only.
r=(await q("select public.clinic_reception_snapshot($1,'2027-05-14','2027-05-20') v",[id(50)]))[0].v;assert.deepEqual(r.closures.map(c=>c.name),['عيد الأضحى']);assert.deepEqual(r.appointments,[]);
r=(await q("select public.clinic_reception_snapshot($1,'2027-06-01','2027-06-07') v",[id(50)]))[0].v;assert.deepEqual(r.closures,[]);
// 8) Bookings already on closed days are counted for managers.
await su("insert into clinic_reception.workspaces values($1,'live'),($2,'trial')",[id(50),id(51)]);await su("insert into clinic_reception.appointments(workspace_id,starts_at,status) values($1,'2027-05-17T09:00:00Z','booked'),($1,'2027-05-17T10:00:00Z','cancelled'),($2,'2027-05-17T09:00:00Z','booked')",[id(50),id(51)]);
await as(3);r=(await q('select public.center_closure_bookings($1) v',[h]))[0].v;assert.deepEqual(r,[{day:'2027-05-17',bookings:1}]);
await as(4);await assert.rejects(()=>q('select public.center_closure_bookings($1) v',[h]),/للموارد البشرية/);
// 9) Cancelling an approved holiday: reviewer only, with a reason; then bookings and attendance are back to normal.
await as(3);await assert.rejects(()=>cmd('cancel',{id:h,note:'غلط'}),/للسوبر أدمن أو المدير العام/);
await as(1);await assert.rejects(()=>cmd('cancel',{id:h}),/سبب/);assert.equal((await cmd('cancel',{id:h,note:'الأجازة اتأجلت'})).status,'cancelled');
await as(4);assert.equal((await book('2027-05-16T08:00:00Z')).ok,'book');r=await su("select status from clinic_people.attendance_eval('2027-05-17') where person_id=$1",[id(90)]);assert.equal(r[0].status,'absent');
// 10) Audit + no direct table access.
r=await su("select action from clinic_people.audit order by id");assert.deepEqual(r.map(x=>x.action),['center_closure_add','center_closure_add','center_closure_review','center_closure_review','center_closure_cancel']);
await as(3);await assert.rejects(()=>q('select * from clinic_people.center_closures'),/permission/);
await db.close();console.log('PASS center closures SQL: maker-checker (HR adds, other GM/super approves, creator cannot), overlap refused, attendance → leave, payroll ignores closed days, booking refused (Cairo date), snapshot closures, bookings count, reviewer-only cancel with reason, audit, no direct access.');
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
