// «ملغاة» task status (2026-11-12): only managers cancel (with a reason) or reopen; cancelling closes open stages;
// employees can't move a cancelled task; the generated "open/late" predicates all treat cancelled as closed.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
const mig=fs.readFileSync(__dirname+'/../supabase/migrations/20261112150000_task_cancelled_status.sql','utf8');
const id=n=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admins(id uuid primary key,name text,role text,active boolean default true);
 create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
 create function finance_module_allowed(m text,a text) returns boolean language sql stable as $$select true$$;
 create function is_super() returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role='super_admin')$$;
 create function can_manage_all_content() returns boolean language sql stable as $$select false$$;
 create table task_projects(id uuid primary key,manager_id uuid);
 create table task_project_members(project_id uuid,admin_id uuid,role_name text);
 create function task_can_manage_project(p uuid) returns boolean language sql stable as $$select exists(select 1 from task_projects where id=p and manager_id=my_admin_id()) or exists(select 1 from task_project_members where project_id=p and admin_id=my_admin_id() and role_name='manager')$$;
 create table tasks(id uuid primary key,project_id uuid,parent_task_id uuid,title text,assignee_id uuid,status text not null default 'todo',return_note text,completed_at timestamptz,updated_at timestamptz,
   constraint tasks_status_check check (status = any (array['todo','in_progress','review','revision','done','blocked'])));
 create table task_updates(id bigserial,task_id uuid,author_id uuid,body text,status_from text,status_to text,created_at timestamptz default now());
 create table task_notifications(id bigserial,recipient_id uuid,task_id uuid,kind text,message text,reference_date date default current_date,read_at timestamptz,unique(recipient_id,task_id,kind,reference_date));`);
 const start=mig.indexOf('alter table public.tasks drop constraint'),end=mig.indexOf('-- Claude: a cancelled task');
 assert(start>0&&end>start,'migration sections found');
 await db.exec(mig.slice(start,end));
 const as=n=>db.exec(`select set_config('test.admin','${id(n)}',false)`),q=async(s,p)=>(await db.query(s,p)).rows;
 await db.exec(`insert into admins values('${id(1)}','مدير','general_manager'),('${id(2)}','موظف','page_manager'),('${id(3)}','سوبر','super_admin');
   insert into task_projects values('${id(10)}','${id(1)}');
   insert into tasks(id,project_id,parent_task_id,title,assignee_id,status) values
   ('${id(20)}','${id(10)}',null,'مهمة رئيسية','${id(2)}','in_progress'),('${id(21)}','${id(10)}','${id(20)}','مرحلة مفتوحة','${id(2)}','todo'),
   ('${id(22)}','${id(10)}','${id(20)}','مرحلة خلصت','${id(2)}','done'),('${id(23)}','${id(10)}',null,'مهمة تانية','${id(2)}','todo'),('${id(24)}','${id(10)}',null,'مقفولة','${id(2)}','done');
   insert into task_notifications(recipient_id,task_id,kind,message) values('${id(2)}','${id(20)}','overdue','متأخرة');`);
 // employee can't cancel; manager needs a reason; done can't be cancelled
 await as(2);await assert.rejects(()=>q('select task_cancel($1,$2)',[id(20),'سبب']),/مدير المشروع/);
 await as(1);await assert.rejects(()=>q('select task_cancel($1,$2)',[id(20),' ']),/سبب الإلغاء/);
 await assert.rejects(()=>q('select task_cancel($1,$2)',[id(24),'سبب واضح']),/اتعتمدت/);
 // manager cancels: task + open stage → cancelled, finished stage untouched, history + notification, overdue alert read
 await q('select task_cancel($1,$2)',[id(20),'الفكرة اتلغت']);
 const st=Object.fromEntries((await q('select id,status from tasks')).map(r=>[r.id,r.status]));
 assert.equal(st[id(20)],'cancelled');assert.equal(st[id(21)],'cancelled');assert.equal(st[id(22)],'done');
 assert.equal((await q("select count(*)::int n from task_updates where status_to='cancelled' and body like 'إلغاء المهمة: الفكرة اتلغت'"))[0].n,2);
 assert.equal((await q("select count(*)::int n from task_notifications where kind='status' and recipient_id=$1 and task_id=$2",[id(2),id(20)]))[0].n,1);
 assert.equal((await q("select count(*)::int n from task_notifications where kind='overdue' and read_at is null"))[0].n,0);
 await assert.rejects(()=>q('select task_cancel($1,$2)',[id(20),'تاني']),/ملغاة بالفعل/);
 // employee can't move a cancelled task; task_set_status('cancelled') goes through the manager rule
 await as(2);await assert.rejects(()=>q('select task_set_status($1,$2,$3)',[id(20),'in_progress','شغال']),/ملغاة/);
 await assert.rejects(()=>q('select task_set_status($1,$2,$3)',[id(23),'cancelled','مش هعملها']),/مدير المشروع/);
 await as(3);await q('select task_set_status($1,$2,$3)',[id(23),'cancelled','سوبر أدمن لغاها']);
 assert.equal((await q('select status from tasks where id=$1',[id(23)]))[0].status,'cancelled');
 // reopen: managers only, back to todo
 await as(2);await assert.rejects(()=>q('select task_reopen($1,$2)',[id(20),null]),/مدير المشروع/);
 await as(1);await q('select task_reopen($1,$2)',[id(20),'رجعنا فيها']);
 assert.equal((await q('select status from tasks where id=$1',[id(20)]))[0].status,'todo');
 await assert.rejects(()=>q('select task_reopen($1,$2)',[id(20),null]),/مش ملغاة/);
 // generated block: no "open = status <> 'done'" left, and every rewritten function names 'cancelled'
 const gen=mig.slice(mig.indexOf('-- ---------- generated from live definitions'));
 assert(!/(?<![a-z_])status\s*<>\s*'done'/i.test(gen),'no bare status <> done left');
 for(const f of gen.split(/CREATE OR REPLACE FUNCTION /).slice(1))assert(/'cancelled'/.test(f),'cancelled handled in '+f.slice(0,60));
 console.log('PASS task cancelled status: manager-only cancel with reason, stages cascade, done protected, employee blocked, reopen, generated predicates');
})().catch(e=>{console.error(e);process.exit(1);});
