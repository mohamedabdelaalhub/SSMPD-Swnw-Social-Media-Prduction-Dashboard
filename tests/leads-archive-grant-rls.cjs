// 20261125150000: RLS for leads archive grant holders (PGlite). The leads / lead_attempts policies are the ones in
// supabase/setup.sql; the migration adds separate permissive policies so a grant holder (customer_service + grant) reads
// and updates ALL leads and reads their attempts, while plain customer_service still sees only assigned leads. Rollback restores.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;
  create table public.admins(id uuid primary key,role text,active boolean default true,has_leads_archive_access boolean default false);
  create function public.my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
  create function public.my_role() returns text language sql stable security definer as $$select role from public.admins where id=public.my_admin_id()$$;
  create function public.is_super() returns boolean language sql stable security definer as $$select coalesce((select role='super_admin' from public.admins where id=public.my_admin_id()),false)$$;
  create table public.leads(id serial primary key,assigned_to uuid,current_status text default 'new');
  create table public.lead_attempts(id serial primary key,lead_id int references public.leads(id),result text);
  grant select,insert,update on public.leads,public.lead_attempts to authenticated;grant usage on sequence leads_id_seq to authenticated;`);
 const setup=fs.readFileSync('supabase/setup.sql','utf8');
 const pol=(name)=>{const i=setup.indexOf('create policy "'+name+'"');assert(i>0,name);return setup.slice(i,setup.indexOf(';',i)+1);};
 await db.exec('alter table public.leads enable row level security;alter table public.lead_attempts enable row level security;'+pol('leads select')+pol('leads update')+pol('lead_attempts select'));
 const Z='00000000-0000-0000-0000-00000000000a',C='00000000-0000-0000-0000-00000000000c',O='00000000-0000-0000-0000-00000000000f';
 await db.exec(`insert into public.admins values('${Z}','customer_service',true,true),('${C}','customer_service',true,false),('${O}','customer_service',true,false);
  insert into public.leads(assigned_to) values('${O}'),('${O}'),(null),('${C}');insert into public.lead_attempts(lead_id,result) values(1,'no_answer'),(4,'answered');`);
 const as=async(who,sql)=>{await db.exec(`reset role;select set_config('test.admin','${who}',false);set role authenticated;`);try{return (await db.query(sql)).rows;}finally{await db.exec('reset role');}};
 const count=async(who,t)=>(await as(who,'select count(*)::int n from public.'+t))[0].n;
 assert.equal(await count(Z,'leads'),0,'before: Zeina (no assigned leads) sees nothing');
 await db.exec(fs.readFileSync('supabase/migrations/20261125150000_leads_archive_grant_all.sql','utf8'));
 await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261125150000_leads_archive_grant_all.sql','utf8')),/تم تطبيق هذا الملف من قبل/);
 assert.equal(await count(Z,'leads'),4,'grant: all leads');assert.equal(await count(Z,'lead_attempts'),2,'grant: all attempts');
 assert.equal(await count(C,'leads'),1,'plain CS: assigned only');assert.equal(await count(C,'lead_attempts'),1);
 assert.equal((await as(Z,"update public.leads set current_status='in_progress' where id=1 returning id")).length,1,'grant: update a lead assigned to someone else');
 assert.equal((await as(C,"update public.leads set current_status='in_progress' where id=2 returning id")).length,0,'plain CS cannot');
 await db.exec(`update public.admins set active=false where id='${Z}'`);assert.equal(await count(Z,'leads'),0,'inactive: nothing');
 await db.exec(`update public.admins set active=true,has_leads_archive_access=false where id='${Z}'`);assert.equal(await count(Z,'leads'),0,'grant removed: nothing');
 await db.exec(`update public.admins set has_leads_archive_access=true where id='${Z}'`);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125150000_leads_archive_grant_all.rollback.sql','utf8'));assert.equal(await count(Z,'leads'),0,'rollback');
 console.log('PASS leads archive grant RLS: grant holder reads all leads + attempts and updates any lead; plain customer_service still assigned-only; inactive / grant removed → nothing; migration refuses a second run; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
