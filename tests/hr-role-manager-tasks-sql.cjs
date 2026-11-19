// Employees without a dashboard account are followed by a ROLE: their recurring duties go to whoever holds the role now,
// and move to the next holder when the person in the role changes (owner decision 2026-11-15).
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(root+'/'+p,'utf8'),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();try{await db.exec(`
create role authenticated;create role anon;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table admins(id uuid primary key,user_id uuid unique,email text,name text,role text,active boolean default true,created_at timestamptz default now());
create table admin_extra_roles(admin_id uuid references admins(id),role text,primary key(admin_id,role));
create function my_admin_id() returns uuid language sql stable security definer as $$ select id from admins where user_id=auth.uid() and active $$;
create function has_role_for(p uuid,r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=p and role=r) or exists(select 1 from admin_extra_roles where admin_id=p and role=r)$$;
create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins a where a.user_id=auth.uid() and a.active and has_role_for(a.id,r))$$;
create function can_manage_all_content() returns boolean language sql stable security definer as $$select has_role('super_admin') or has_role('general_manager')$$;
grant usage on schema public,auth to authenticated;grant execute on all functions in schema auth to authenticated;
create schema clinic_people;
create table clinic_people.people(id uuid primary key default gen_random_uuid(),code text unique,admin_id uuid unique references admins(id),full_name text not null,status text not null default 'active',revision integer not null default 1,updated_at timestamptz not null default now());
create table clinic_people.audit(id bigint generated always as identity primary key,actor_id uuid not null,action text not null,record_id uuid not null,before_data jsonb,after_data jsonb,created_at timestamptz default now());
create function clinic_people.manage() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select has_role('super_admin') or has_role('general_manager')$$;`);
await db.exec(read('supabase/migrations/202610120001_tasks_module.sql').replace('create extension if not exists pgcrypto;',''));
await db.exec(read('supabase/migrations/202610130001_task_edit_recurrence.sql').split('create extension if not exists pg_cron')[0]);
await db.exec(read('supabase/migrations/20261025200000_task_recurrence_single_open_copy.sql'));
await db.exec(read('supabase/migrations/20261115110000_hr_role_manager_tasks.sql'));
await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
const admins=[[1,'super_admin','محمد','2026-01-01'],[2,'general_manager','مديرة أولى','2026-02-01'],[3,'nursing','ممرضة','2026-03-01'],[4,'general_manager','مديرة جديدة','2026-04-01']];
for(const [n,role,name,at] of admins)await db.query('insert into admins(id,user_id,email,name,role,created_at) values($1,$1,$2,$3,$4,$5)',[id(n),'user'+n+'@x',name,role,at]);
await db.query("update admins set active=false where id=$1",[id(4)]); // the new manager has not joined yet
const owner=async(sql,args)=>{await db.exec('reset role');return (await db.query(sql,args||[])).rows;};
const call=async(n,fn,args)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated');
  const ph=args.map((_,i)=>'$'+(i+1)).join(',');const r=(await db.query(`select public.${fn}(${ph}) v`,args)).rows[0].v;await db.exec('reset role');return r;};
const cleaner=(await owner("insert into clinic_people.people(code,full_name) values('EMP-T60','عاملة اختبار') returning id"))[0].id;
const nurse=(await owner("insert into clinic_people.people(code,full_name,admin_id) values('EMP-T03','ممرضة اختبار',$1) returning id",[id(3)]))[0].id;
const project=await call(1,'task_create_project',['المهام الوظيفية المتكررة','',id(1),JSON.stringify([{admin_id:id(2),role_name:'manager'}])]);
// Guards: only HR, only people without an account, and the role must be set first and must have an active holder.
await assert.rejects(()=>call(3,'hr_set_manager_role',[cleaner,'general_manager']),/الموارد البشرية/);
await assert.rejects(()=>call(1,'hr_set_manager_role',[nurse,'general_manager']),/حساب دخول/);
await assert.rejects(()=>call(1,'task_create_recurring_for_person',[project,cleaner,'نظافة العيادة','','',null,'normal',1,'day',null]),/الدور المسؤول/);
await assert.rejects(()=>call(1,'hr_set_manager_role',[cleaner,'head_nursing']),/لا يوجد حساب نشط/);
let set=await call(1,'hr_set_manager_role',[cleaner,'general_manager']);assert.equal(set.holder_id,id(2));assert.equal(set.holder_name,'مديرة أولى');
await assert.rejects(()=>call(1,'task_create_recurring_for_person',[project,nurse,'x','','',null,'normal',1,'day',null]),/حساب دخول/);
// The duty goes to the current general manager and is marked with the employee.
const t1=await call(1,'task_create_recurring_for_person',[project,cleaner,'نظافة العيادة والحمامات','نظافة يومية','تأكيد التنفيذ',null,'normal',1,'day',null]);
let task=(await owner('select * from tasks where id=$1',[t1]))[0];assert.equal(task.assignee_id,id(2));assert.equal(task.for_person_id,cleaner);assert.match(task.description,/عاملة اختبار \(EMP-T60\)/);
const series=task.recurrence_id;assert.equal((await owner('select for_person_id from task_recurrences where id=$1',[series]))[0].for_person_id,cleaner);
let duties=await call(2,'hr_person_duties',[cleaner]);assert.equal(duties.holder_name,'مديرة أولى');assert.equal(duties.duties.length,1);assert.equal(duties.duties[0].interval_unit,'day');
// المديرة الأولى leaves; the new general manager joins. The finished copy keeps its history, the next copy goes to the new holder.
await owner("update tasks set status='done' where id=$1",[t1]);
await owner("update task_recurrences set next_run_at=now()-interval '1 minute' where id=$1",[series]);
await owner("update admins set active=false where id=$1",[id(2)]);await owner("update admins set active=true where id=$1",[id(4)]);
assert.equal(await owner('select public.task_generate_due_recurrences() n').then(r=>r[0].n),1);
assert.equal((await owner('select assignee_id from tasks where id=$1',[t1]))[0].assignee_id,id(2));
let copy=(await owner("select * from tasks where recurrence_id=$1 and status<>'done'",[series]))[0];assert.equal(copy.assignee_id,id(4));assert.equal(copy.for_person_id,cleaner);
assert.equal((await owner('select assignee_id from task_recurrences where id=$1',[series]))[0].assignee_id,id(4));
assert.ok((await owner("select 1 from task_project_members where project_id=$1 and admin_id=$2",[project,id(4)])).length);
// المديرة الأولى comes back: the open copy moves to her (oldest active holder) and she is notified.
await owner("update admins set active=true where id=$1",[id(2)]);await owner('select public.task_sync_role_owners()');
assert.equal((await owner('select assignee_id from tasks where id=$1',[copy.id]))[0].assignee_id,id(2));
assert.ok((await owner("select 1 from task_notifications where recipient_id=$1 and task_id=$2 and message like 'انتقلت إليك%'",[id(2),copy.id])).length);
// Clearing the role stops the follow-up moves; the audit keeps both decisions.
await call(1,'hr_set_manager_role',[cleaner,'']);assert.equal((await owner('select manager_role from clinic_people.people where id=$1',[cleaner]))[0].manager_role,null);
assert.equal((await owner("select count(*)::int n from clinic_people.audit where record_id=$1 and action='manager_role'",[cleaner]))[0].n,2);
console.log('PASS role-followed duties: HR-only, account-less only, assigned to the current role holder, history kept, moves to the next holder with a notice, audited.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
