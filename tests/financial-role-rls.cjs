const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(root+'/'+p,'utf8'),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();await db.exec(`
create role authenticated;create role anon;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table admins(id uuid primary key,user_id uuid unique,email text,name text,role text,active boolean default true);
create table admin_extra_roles(admin_id uuid references admins(id),role text,primary key(admin_id,role));
create function my_admin_id() returns uuid language sql stable security definer as $$ select id from admins where user_id=auth.uid() and active $$;
create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins a where a.user_id=auth.uid() and a.active and(a.role=r or exists(select 1 from admin_extra_roles e where e.admin_id=a.id and e.role=r)))$$;
create function can_manage_all_content() returns boolean language sql stable security definer as $$select has_role('super_admin') or has_role('general_manager')$$;
create function has_archive_access() returns boolean language sql as $$select false$$;
create function has_archive_review_access() returns boolean language sql as $$select false$$;
create function can_access_leads() returns boolean language sql as $$select false$$;
create table patients(id uuid primary key,full_name text,phone text,patient_code text);
create table leads(id uuid primary key,patient_id uuid references patients);
create table lead_invoices(id uuid primary key,lead_id uuid references leads,amount numeric,uploaded_at timestamptz);
create table patient_visits(id uuid primary key,contract_id uuid);
grant usage on schema public,auth to authenticated;grant execute on all functions in schema auth to authenticated;
`);
await db.exec(read('supabase/contracting_entities.sql'));await db.exec(read('supabase/contracting_entities_delete.sql'));
await db.exec(read('supabase/migrations/202610120001_tasks_module.sql').replace('create extension if not exists pgcrypto;',''));
for(const table of ['pricing_supplies','pricing_services','pricing_packages'])await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),name text);alter table ${table} enable row level security;create policy legacy_finance on ${table} for all to authenticated using(can_manage_all_content()) with check(can_manage_all_content());`);
const recurrenceSql=read('supabase/migrations/202610130001_task_edit_recurrence.sql').split('create extension if not exists pg_cron')[0];
if(process.env.FINANCE_RECURRENCE_ORDER==='before')await db.exec(recurrenceSql);
await db.exec('grant select,insert,update,delete on all tables in schema public to authenticated');
for(const [n,role]of [[1,'super_admin'],[2,'page_manager'],[3,'page_manager'],[4,'designer'],[5,'general_manager']])await db.query('insert into admins(id,user_id,email,name,role) values($1,$1,$2,$2,$3)',[id(n),'user'+n,role]);
await db.exec(read('supabase/migrations/202610130002_financial_roles_permissions.sql'));
if(process.env.FINANCE_RECURRENCE_ORDER==='after')await db.exec(recurrenceSql);
await db.query("update admins set role='accountant' where id=$1",[id(2)]);await db.query("update admins set role='financial_manager' where id=$1",[id(3)]);
await db.query('insert into pricing_supplies(id,name) values($1,$2)',[id(100),'supply']);
await db.query("insert into contracting_entities(id,name,entity_type) values($1,'Contract','school')",[id(101)]);
await db.query("insert into task_projects(id,title,created_by,manager_id) values($1,'Project',$2,$2)",[id(200),id(1)]);
await db.query("insert into task_project_members(project_id,admin_id) values($1,$2)",[id(200),id(2)]);
for(const [n,assignee]of [[201,2],[202,4]])await db.query("insert into tasks(id,project_id,title,assignee_id,created_by) values($1,$2,'Task',$3,$4)",[id(n),id(200),id(assignee),id(1)]);
async function as(n){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);await db.exec('set role authenticated');}
async function denied(sql,params=[]){let failed=false;try{await db.query(sql,params);}catch(e){failed=true;}assert(failed,'expected denial: '+sql);}
const grant=(module_key,can_view=false,can_create=false,can_update=false,can_delete=false)=>({module_key,can_view,can_create,can_update,can_delete});
async function set(n,rows){await as(1);await db.query('select set_admin_module_permissions($1,$2::jsonb)',[id(n),JSON.stringify(rows)]);}
await as(2);assert.equal((await db.query('select * from pricing_supplies')).rows.length,0);assert.equal((await db.query('select * from contracting_entities_overview()')).rows.length,0);assert.equal((await db.query('select * from task_list_visible()')).rows.length,0);await denied('select task_people()');await denied('insert into pricing_supplies(name) values(\'denied\')');await denied('select set_admin_module_permissions($1,$2::jsonb)',[id(2),JSON.stringify([grant('accounting',true),grant('contracting_entities'),grant('tasks')])]);
await set(2,[grant('accounting',true),grant('contracting_entities',true),grant('tasks',true)]);await as(2);assert.equal((await db.query('select * from pricing_supplies')).rows.length,1);assert.equal((await db.query('select * from contracting_entities')).rows.length,1);assert.equal((await db.query('select * from contracting_entities_overview()')).rows.length,1);assert.deepEqual((await db.query('select id from task_list_visible()')).rows.map(x=>x.id),[id(201)]);await denied("select task_set_status($1,'in_progress','note')",[id(201)]);await denied("select task_create_project('New project','',$1,'[]'::jsonb)",[id(2)]);await denied('insert into pricing_supplies(name) values(\'denied\')');assert.equal((await db.query("update pricing_supplies set name='denied' returning id")).rows.length,0);await denied('select delete_contracting_entity($1)',[id(101)]);await denied("select search_patients_basic('any')");assert.equal((await db.query("update contracting_entities set name='denied' returning id")).rows.length,0);
await set(2,[grant('accounting',true,true,false,false),grant('contracting_entities',true,true,false,false),grant('tasks',true,false,true)]);await as(2);await db.query("insert into pricing_supplies(name) values('added')");await db.query("insert into contracting_entities(name,entity_type) values('New entity','clinic')");await db.query("select task_set_status($1,'in_progress','work')",[id(201)]);await denied("select task_set_status($1,'in_progress','other')",[id(202)]);assert.equal((await db.query('select * from task_updates')).rows.length,1);
await set(2,[grant('accounting',true,false,true,true),grant('contracting_entities',true,false,true,true),grant('tasks',true,true,true)]);await as(2);assert.equal((await db.query("update pricing_supplies set name='edited' returning id")).rows.length,2);assert.equal((await db.query('delete from pricing_supplies returning id')).rows.length,2);await db.query('select delete_contracting_entity($1)',[id(101)]);const created=(await db.query("select task_create_project('Finance project','',$1,'[]'::jsonb) as id",[id(2)])).rows[0].id;await db.query("select task_create($1,null,'New task','','',$2,null,'normal')",[created,id(2)]);await denied("select task_create($1,null,'Other project','','',$2,null,'normal')",[id(200),id(2)]);
await as(3);assert.equal((await db.query('select * from admin_module_permissions')).rows.length,0);await denied('insert into admin_module_permissions(admin_id,module_key,can_view) values($1,\'accounting\',true)',[id(3)]);
await as(5);assert.equal((await db.query('select * from task_list_visible()')).rows.length,3);await as(4);assert.deepEqual((await db.query('select id from task_list_visible()')).rows.map(x=>x.id),[id(202)]);
await as(1);await denied('select set_admin_module_permissions($1,$2::jsonb)',[id(2),JSON.stringify([grant('accounting',true),grant('contracting_entities',true),grant('tasks',true,true,true,true)])]);
// Re-running activation retains saved grants. Revocation blocks both RPC and direct reads.
await db.exec('reset role');await db.exec(read('supabase/migrations/202610130002_financial_roles_permissions.sql'));await as(2);assert.equal((await db.query('select * from task_list_visible()')).rows.length,2);await set(2,[grant('accounting'),grant('contracting_entities'),grant('tasks')]);await as(2);assert.equal((await db.query('select * from task_list_visible()')).rows.length,0);assert.equal((await db.query('select * from tasks')).rows.length,0);
if(process.env.FINANCE_RECURRENCE_ORDER){
 await set(2,[grant('accounting'),grant('contracting_entities'),grant('tasks',true,true,true)]);await as(2);
 const recurring=(await db.query("select task_create_recurring($1,null,'Recurring task','','',$2,null,'normal',1,'week',null) as id",[created,id(2)])).rows[0].id;
 assert((await db.query('select * from task_list_visible()')).rows.some(t=>t.id===recurring&&t.recurrence_active));
 await set(2,[grant('accounting'),grant('contracting_entities'),grant('tasks',true)]);await as(2);
 await denied("select task_update_details($1,'Changed','','',$2,null,'normal',true,1,'week',null,false)",[recurring,id(2)]);
 assert.equal((await db.query("update task_recurrences set title='denied' returning id")).rows.length,0);
 await set(2,[grant('accounting'),grant('contracting_entities'),grant('tasks',true,false,true)]);await as(2);
 await db.query("select task_update_details($1,'Edited existing recurrence','','',$2,null,'normal',true,1,'week',null,false)",[recurring,id(2)]);
 await denied("select task_create_recurring($1,null,'Denied recurrence','','',$2,null,'normal',1,'week',null)",[created,id(2)]);
 await set(2,[grant('accounting'),grant('contracting_entities'),grant('tasks')]);await as(2);assert.equal((await db.query('select * from task_list_visible()')).rows.length,0);
}
await db.exec('reset role');await db.query('update admins set active=false where id=$1',[id(2)]);await as(2);await denied("select task_set_status($1,'blocked','inactive')",[id(201)]);
await db.close();console.log('PASS: real PostgreSQL RLS and RPC checks for default deny, view-only, separate create/update/delete grants, task assignment scope, no self-grants, legacy roles, revocation and rerunnable activation. Recurrence activation order '+(process.env.FINANCE_RECURRENCE_ORDER||'base')+'. Local PGlite only; no live Supabase changes.');})().catch(e=>{console.error(e.message);process.exit(1);});
