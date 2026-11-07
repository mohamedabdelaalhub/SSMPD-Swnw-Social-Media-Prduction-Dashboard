// Staff invite must not reuse a patient-portal login email (migration 20261108200000) + rollback.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create table public.admins(id uuid primary key default gen_random_uuid(),user_id uuid,email text not null unique,name text,role text not null default 'page_manager',active boolean default true);
  create table public.patient_accounts(id uuid primary key default gen_random_uuid(),auth_user_id uuid,status text,login_email text);
  insert into public.patient_accounts(login_email,status) values('patient@example.com','active');
  insert into public.admins(email,role) values('old.staff@example.com','reception');`);
 const mig=fs.readFileSync('supabase/migrations/20261108200000_admins_block_patient_portal_email.sql','utf8');
 await db.exec(mig);await db.exec(mig); // idempotent
 const fails=async(sql,why)=>{let err=null;try{await db.exec(sql);}catch(e){err=e;}assert(err,why+' should fail');assert.match(err.message,/بوابة المرضى/,why);};
 await fails("insert into public.admins(email,role) values('patient@example.com','super_admin')",'exact email');
 await fails("insert into public.admins(email,role) values(' Patient@Example.COM ','page_manager')",'case/space variant');
 await fails("update public.admins set email='PATIENT@example.com' where email='old.staff@example.com'",'email change to patient email');
 await db.exec("insert into public.admins(email,role) values('new.staff@example.com','page_manager')");
 await db.exec("update public.admins set role='designer',name='x' where email='new.staff@example.com'");
 // an existing row that already matches is not touched by unrelated updates
 await db.exec("alter table public.admins disable trigger admins_block_patient_portal_email;insert into public.admins(email) values('patient@example.com');alter table public.admins enable trigger admins_block_patient_portal_email;");
 await db.exec("update public.admins set role='reception' where email='patient@example.com'");
 assert.equal((await db.query("select count(*)::int n from public.admins")).rows[0].n,3);
 // works when the portal table does not exist (setup.sql on a dashboard-only database)
 await db.exec("alter table public.patient_accounts rename to pa_hidden");await db.exec("insert into public.admins(email) values('free@example.com')");await db.exec("alter table public.pa_hidden rename to patient_accounts");
 await db.exec(fs.readFileSync('supabase/rollbacks/20261108200000_admins_block_patient_portal_email.rollback.sql','utf8'));
 await db.exec("insert into public.admins(email) values('PATIENT@example.com')");
 assert.equal((await db.query("select count(*)::int n from pg_proc where proname='admins_block_patient_portal_email'")).rows[0].n,0);
 const app=fs.readFileSync('assets/js/app.js','utf8');assert(/already \(been \)\?registered/.test(app)&&app.includes('بوابة المرضى'),'signup message mapped');
 await db.close();console.log('PASS staff/patient email guard: blocks patient-portal emails on insert and email change (case/space-insensitive), allows normal staff, leaves old rows, no portal table OK, idempotent, rollback clean, Arabic signup message.');
})().catch(e=>{console.error(e);process.exit(1);});
