// 20261125150000 (PGlite): leads archive grant holders + the leads activity trail.
//   RLS: the leads / lead_attempts policies are the ones in supabase/setup.sql; the migration adds separate permissive policies,
//   so a grant holder (customer_service + grant) reads and updates ALL leads and reads their attempts, while plain
//   customer_service still sees only assigned leads.
//   Activity (owner «اي حركة بيعملها عندنا تقرير منها»): status / booking / attempt / assignment / field edit / invoice are
//   counted from the existing logs, export via log_leads_export, delete kept by a trigger; report + feed are managers only.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;
  create table public.admins(id uuid primary key,role text,active boolean default true,has_leads_archive_access boolean default false);
  create table public.admin_extra_roles(admin_id uuid,role text);
  create function public.my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
  create function public.my_role() returns text language sql stable security definer as $$select role from public.admins where id=public.my_admin_id()$$;
  create function public.is_super() returns boolean language sql stable security definer as $$select coalesce((select role='super_admin' from public.admins where id=public.my_admin_id()),false)$$;
  create function public.effective_admin_id() returns uuid language plpgsql stable as $$declare v text:=nullif(current_setting('app.caller_admin_id',true),'');begin if v is not null then return v::uuid;end if;return public.my_admin_id();end$$;
  create table public.leads(id uuid primary key,assigned_to uuid,current_status text default 'new',customer_name text,phone_raw text,source text,created_at timestamptz default now());
  create table public.lead_attempts(id serial primary key,lead_id uuid references public.leads(id) on delete cascade,employee_id uuid,attempt_date timestamptz default now(),result text,notes text);
  create table public.lead_status_log(id serial,lead_id uuid,changed_by uuid,old_status text,new_status text,changed_at timestamptz default now());
  create table public.lead_field_changes(id serial,lead_id uuid,changed_by uuid,field_name text,old_value text,new_value text,changed_at timestamptz default now());
  create table public.lead_invoices(id serial,lead_id uuid,amount numeric,service_name text,uploaded_by uuid,uploaded_at timestamptz default now());
  grant select,insert,update,delete on public.leads,public.lead_attempts to authenticated;`);
 const setup=fs.readFileSync('supabase/setup.sql','utf8');
 const pol=(name)=>{const i=setup.indexOf('create policy "'+name+'"');assert(i>0,name);return setup.slice(i,setup.indexOf(';',i)+1);};
 await db.exec('alter table public.leads enable row level security;alter table public.lead_attempts enable row level security;'+pol('leads select')+pol('leads update')+pol('lead_attempts select')+
  'create policy "leads delete test" on public.leads for delete using (public.is_super());');
 const L=n=>'10000000-0000-0000-0000-00000000000'+n;const Z='00000000-0000-0000-0000-00000000000a',C='00000000-0000-0000-0000-00000000000c',O='00000000-0000-0000-0000-00000000000f',S='00000000-0000-0000-0000-000000000005';
 await db.exec(`insert into public.admins values('${Z}','customer_service',true,true),('${C}','customer_service',true,false),('${O}','customer_service',true,false),('${S}','super_admin',true,false);
  insert into public.leads(id,assigned_to,customer_name) values('${L(1)}','${O}','عميل 1'),('${L(2)}','${O}','عميل 2'),('${L(3)}',null,'عميل 3'),('${L(4)}','${C}','عميل 4');
  insert into public.lead_attempts(lead_id,employee_id,result) values('${L(1)}','${O}','no_answer'),('${L(4)}','${C}','answered');`);
 const as=async(who,sql)=>{await db.exec(`reset role;select set_config('test.admin','${who}',false);set role authenticated;`);try{return (await db.query(sql)).rows;}finally{await db.exec('reset role');}};
 const count=async(who,t)=>(await as(who,'select count(*)::int n from public.'+t))[0].n;
 assert.equal(await count(Z,'leads'),0,'before: Zeina (no assigned leads) sees nothing');
 const M=fs.readFileSync('supabase/migrations/20261125150000_leads_archive_grant_all.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);
 // 1) RLS scope
 assert.equal(await count(Z,'leads'),4,'grant: all leads');assert.equal(await count(Z,'lead_attempts'),2,'grant: all attempts');
 assert.equal(await count(C,'leads'),1,'plain CS: assigned only');assert.equal(await count(C,'lead_attempts'),1);
 assert.equal((await as(Z,`update public.leads set current_status='in_progress' where id='${L(1)}' returning id`)).length,1,'grant: update a lead assigned to someone else');
 assert.equal((await as(C,`update public.leads set current_status='in_progress' where id='${L(2)}' returning id`)).length,0,'plain CS cannot');
 // 2) activity trail: Zeina's actions in the existing logs + an export; a super admin deletes a lead
 await db.exec(`insert into public.lead_status_log(lead_id,changed_by,old_status,new_status) values('${L(1)}','${Z}','new','in_progress'),('${L(2)}','${Z}','new','booked');
  insert into public.lead_attempts(lead_id,employee_id,result) values('${L(3)}','${Z}','no_answer');
  insert into public.lead_field_changes(lead_id,changed_by,field_name,old_value,new_value) values('${L(3)}','${Z}','assigned_to',null,'${Z}'),('${L(3)}','${Z}','priority','normal','high');
  insert into public.lead_invoices(lead_id,amount,service_name,uploaded_by) values('${L(2)}',500,'كشف','${Z}');`);
 await as(Z,"select public.log_leads_export('archive',4,'{}')");
 await assert.rejects(()=>as(Z,'select public.leads_activity_report(null,null)'),/للمدير العام والسوبر أدمن/,'report not for the grant holder');
 await assert.rejects(()=>as(Z,`select public.leads_activity_feed('${Z}',null,null,10)`),/للمدير العام والسوبر أدمن/);
 assert.equal(await count(Z,'lead_activity_log'),0,'activity rows hidden from staff');
 assert.equal((await as(S,`delete from public.leads where id='${L(4)}' returning id`)).length,1);
 const rep=(await as(S,'select public.leads_activity_report(null,null) r'))[0].r;const zr=rep.rows.find(r=>r.admin_id===Z),sr=rep.rows.find(r=>r.admin_id===S);
 assert.deepEqual([zr.status,zr.booking,zr.attempt,zr.assignment,zr.field_edit,zr.invoice,zr.export,zr.total],[1,1,1,1,1,1,1,7]);assert.equal(zr.has_grant,true);
 assert.equal(sr.delete,1,'delete kept with who');
 const feed=(await as(S,`select public.leads_activity_feed('${Z}',null,null,50) f`))[0].f;assert.equal(feed.length,7);
 assert(feed.some(x=>x.action==='export'&&/archive — 4 صف/.test(x.detail)));assert(feed.some(x=>x.action==='booking'&&x.customer_name==='عميل 2'));
 assert.equal((await as(S,"select detail from public.lead_activity_log where action='delete'"))[0].detail.customer_name,'عميل 4');
 // 3) grant removed / inactive → back to nothing; rollback
 await db.exec(`update public.admins set active=false where id='${Z}'`);assert.equal(await count(Z,'leads'),0,'inactive: nothing');
 await db.exec(`update public.admins set active=true,has_leads_archive_access=false where id='${Z}'`);assert.equal(await count(Z,'leads'),0,'grant removed: nothing');
 await db.exec(`update public.admins set has_leads_archive_access=true where id='${Z}'`);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125150000_leads_archive_grant_all.rollback.sql','utf8'));assert.equal(await count(Z,'leads'),0,'rollback');
 assert.equal((await db.query("select to_regclass('public.lead_activity_log') t")).rows[0].t,null);
 console.log('PASS leads archive grant RLS + activity: grant holder reads all leads + attempts and updates any lead; plain customer_service still assigned-only; activity report (managers only) counts her status / booking / attempt / assignment / field edit / invoice / export; a delete is kept with who; feed lists her actions; inactive / grant removed → nothing; second run refused; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
