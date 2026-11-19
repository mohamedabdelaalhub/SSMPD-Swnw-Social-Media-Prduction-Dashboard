// Owner 2026-11-19: reception / customer service archive scope (20261120900000).
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),rec=id(),full=id(),sup=id(),p=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true,has_archive_access boolean default false);
 create table patients(id uuid primary key,patient_code text,full_name text,phone text,phone_normalized text,email text,age int,gender text,medical_record_no text,last_visit_date date,sent_to_nursing_at timestamptz,national_id_hash text,status text default 'active');
 create table patient_files(id uuid primary key);
 create table archive_access_log(id uuid primary key default gen_random_uuid(),file_id uuid,patient_id uuid,employee_id uuid,action text not null,created_at timestamptz default now());
 alter table archive_access_log add constraint archive_access_log_action_check check (action in ('view','download','upload','delete','review_approve','review_reject'));
 create function has_archive_access() returns boolean language sql stable security definer as $$select coalesce((select has_archive_access from admins where user_id=auth.uid() and active),false)$$;
 create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where user_id=auth.uid() and active and role=r)$$;
 create function can_access_leads() returns boolean language sql stable security definer as $$select has_role('reception') or has_role('customer_service') or has_role('super_admin')$$;
 create function can_manage_all_content() returns boolean language sql stable security definer as $$select has_role('super_admin')$$;
 create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid() and active$$;
 alter table patients enable row level security;create policy r on patients for select to authenticated using(has_archive_access() or can_access_leads());
 create policy u on patients for update to authenticated using(has_archive_access() or can_access_leads()) with check(has_archive_access() or can_access_leads());
 grant usage on schema public,auth to authenticated;grant select,update on patients to authenticated;grant select on archive_access_log to authenticated;
 -- a server-side SECURITY DEFINER path (like clinic_reception_patient_basic) that touches any column
 create function srv_touch(p uuid) returns void language sql security definer as $$update patients set status='archived' where id=p$$;grant execute on function srv_touch(uuid) to authenticated;`);
 await db.query("insert into admins(id,user_id,name,role) values($1,$1,'استقبال','reception'),($2,$2,'أرشيف','nursing'),($3,$3,'سوبر','super_admin')",[rec,full,sup]);
 await db.query("update admins set has_archive_access=true where id=$1",[full]);
 await db.query("insert into patients(id,full_name,phone,age,gender,status) values($1,'مريض تجريبي','0100',30,'male','active')",[p]);
 const M=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_archive_reception_scope')),'utf8');
 await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 assert.match((await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conname='archive_access_log_action_check'")).rows[0].d,/'edit'.*|review_reject.*edit/s,'edit allowed, old values kept');
 const as=async u=>{await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[u]);await db.exec('set role authenticated');};
 const logs=async()=>{await db.exec('reset role');return (await db.query("select action,employee_id from archive_access_log where patient_id=$1",[p])).rows;};
 // flag function
 await db.query("update admins set has_archive_reception_access=true where id=$1",[rec]);
 await as(rec);assert.equal((await db.query('select has_archive_reception_access() v')).rows[0].v,true);
 // reception: basic columns OK + logged
 await db.query("update patients set full_name='مريض معدل',phone='0111',age=31,gender='male' where id=$1",[p]);
 let l=await logs();assert.equal(l.length,1);assert.equal(l[0].action,'edit');assert.equal(l[0].employee_id,rec);
 // reception: non-basic columns refused
 await as(rec);await assert.rejects(()=>db.query("update patients set status='archived' where id=$1",[p]),/البيانات الأساسية بس.*status/);
 await assert.rejects(()=>db.query("update patients set national_id_hash='x' where id=$1",[p]),/national_id_hash/);
 // sending to nursing is reception work
 await db.query("update patients set sent_to_nursing_at=now() where id=$1",[p]);
 // forging a log row directly is refused
 await assert.rejects(()=>db.query("select archive_log_patient_edit($1)",[p]),/التريجر بس/);
 // full archive + content managers are not limited and not logged as 'edit'
 await as(full);await db.query("update patients set status='archived' where id=$1",[p]);
 await as(sup);await db.query("update patients set status='active' where id=$1",[p]);
 assert.equal((await logs()).length,2,'only the two reception edits are logged');
 // server-side definer paths are not limited
 await as(rec);await db.query("select srv_touch($1)",[p]);await db.exec('reset role');assert.equal((await db.query("select status from patients where id=$1",[p])).rows[0].status,'archived');
 // rollback applies
 await db.exec(fs.readFileSync('supabase/rollbacks/20261120900000_archive_reception_scope.rollback.sql','utf8'));
 await as(rec);await db.query("update patients set status='active' where id=$1",[p]);
 console.log('archive reception scope: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}
})();
