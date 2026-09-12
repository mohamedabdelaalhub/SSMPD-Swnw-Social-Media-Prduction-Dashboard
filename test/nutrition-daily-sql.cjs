// Run with @electric-sql/pglite installed (NODE_PATH may point to an external test install).
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();
await db.exec(`
create schema auth;
create role authenticated;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create function public.has_archive_access() returns boolean language sql as $$ select coalesce(current_setting('test.staff',true),'')='yes' $$;
create function public.can_manage_all_content() returns boolean language sql as $$ select false $$;
create function public.has_archive_review_access() returns boolean language sql as $$ select false $$;
create function public.can_access_leads() returns boolean language sql as $$ select false $$;
create function public.is_assigned_doctor_for_patient(uuid) returns boolean language sql as $$ select false $$;
create function public.my_admin_id() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
create table admins(id uuid primary key);
insert into admins values ('00000000-0000-4000-8000-000000000001');
create table patient_accounts(id uuid primary key,status text,activation_completed_at timestamptz);
insert into patient_accounts values ('00000000-0000-4000-8000-000000000002','active',now());
create table patient_account_access(account_id uuid,patient_id uuid,verification_status text,revoked_at timestamptz,expires_at timestamptz);
insert into patient_account_access values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','approved',null,null);
create table patient_nutrition_visits(id uuid primary key,patient_id uuid,visit_date date,meals jsonb);
insert into patient_nutrition_visits values ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','2020-01-01','[{"id":"m","name":"Meal"}]');
create table patient_portal_audit_log(id uuid default gen_random_uuid(),account_id uuid,patient_id uuid,actor_admin_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
`);
const sql=fs.readFileSync('supabase/migrations/20260912_nutrition_daily_tracking.sql','utf8');await db.exec(sql);await db.exec(sql);
const table='patient_nutrition_daily_completions';
const write=async(day,meal='m',completed=true)=>db.query(`insert into ${table}(visit_id,meal_id,tracking_date,completed,recorded_by_account_id,recorded_by_admin_id) values ('00000000-0000-4000-8000-000000000004',$1,$2,$3,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001') on conflict(visit_id,meal_id,tracking_date) do update set completed=excluded.completed returning *`,[meal,day,completed]);
await db.exec("set test.role='service_role'");
const first=(await write('2026-01-01')).rows[0];assert.equal(first.recorded_by_admin_id,null);assert.equal(first.meal_name_snapshot,'Meal');
const repeat=(await write('2026-01-01')).rows[0];assert.equal(repeat.completed_at.getTime(),first.completed_at.getTime());
await write('2026-01-02');assert.equal((await db.query(`select * from ${table}`)).rows.length,2);
await write('2026-01-01','m',false);assert.equal((await db.query(`select completed_at from ${table} where tracking_date='2026-01-01'`)).rows[0].completed_at,null);
for(const [date,meal] of [['2019-01-01','m'],['2099-01-01','m'],['2026-01-01','unknown']])await assert.rejects(write(date,meal));
await db.exec("update patient_account_access set revoked_at=now()");await assert.rejects(write('2026-01-03'));await db.exec("update patient_account_access set revoked_at=null, expires_at=now()-interval '1 day'");await assert.rejects(write('2026-01-03'));await db.exec("update patient_account_access set expires_at=null");
// Direct patient writes fail RLS and cannot read daily medical data.
await db.exec(`grant usage on schema public to authenticated; grant select,insert,update on ${table} to authenticated; grant select on patient_nutrition_visits to authenticated; set test.role='authenticated'; set test.staff='no'; set role authenticated;`);
assert.equal((await db.query(`select * from ${table}`)).rows.length,0);await assert.rejects(write('2026-01-03'));
await db.exec("reset role;set test.staff='yes';set role authenticated");const staff=(await write('2026-01-03')).rows[0];assert.equal(staff.recorded_by_account_id,null);assert.equal(staff.recorded_by_admin_id,'00000000-0000-4000-8000-000000000001');
await db.exec(`reset role;set test.role='service_role';create function block_test_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end; $$;create trigger block_test before insert on patient_portal_audit_log for each row execute function block_test_audit();`);
await assert.rejects(write('2026-01-04'));assert.equal((await db.query(`select * from ${table} where tracking_date='2026-01-04'`)).rows.length,0);
await db.close();console.log('PASS SQL: rerunnable migration, independent dates, idempotent timestamp, strict meal/date, revoked/expired access, RLS denial, staff actor, atomic audit rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
