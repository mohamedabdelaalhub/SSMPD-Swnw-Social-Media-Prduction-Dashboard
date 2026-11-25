// 20261125160000 SECURITY: rpc_update_lead / rpc_update_lead_details (SECURITY DEFINER, caller passed as a parameter) were
// executable by anon + authenticated on live. After the migration: anon and authenticated get «permission denied», the
// service role (edge functions leads-update-status / leads-update-details / lead-invoice-upload) still works; rollback
// restores the old grants. Also: no browser code calls them (only those edge functions).
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{execSync}=require('child_process');
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  create table public.leads(id uuid primary key,current_status text,booking_reference text,booking_date date,priority text,do_not_contact boolean,closed_at timestamptz,
   customer_name text,phone_raw text,phone_normalized text,source text,message_text text,interested_service text,requested_department text,acquisition_type text,patient_id uuid,patient_type text,updated_at timestamptz);
  create table public.lead_field_changes(lead_id uuid,changed_by uuid,field_name text,old_value text,new_value text);
  grant select on public.leads to anon,authenticated,service_role;
  insert into public.leads(id,current_status,customer_name) values('10000000-0000-0000-0000-000000000001','new','عميل');`);
 const setup=fs.readFileSync('supabase/setup.sql','utf8');const i=setup.indexOf('create or replace function public.rpc_update_lead(');
 await db.exec(setup.slice(i,setup.indexOf('$$;',setup.indexOf('$$',i)+2)+3));
 const d=fs.readFileSync('supabase/migrations/20261021_lead_details_edit.sql','utf8');await db.exec(d.slice(d.indexOf('create or replace function public.rpc_update_lead_details('),d.indexOf('revoke all on function')));
 // live state: both executable by anon + authenticated
 await db.exec('grant execute on function public.rpc_update_lead(uuid,uuid,text,text,boolean,date,text,boolean,timestamptz,boolean) to anon,authenticated,service_role;grant execute on function public.rpc_update_lead_details(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text) to anon,authenticated,service_role;');
 const L="'10000000-0000-0000-0000-000000000001'",ME="'20000000-0000-0000-0000-000000000002'";
 const st=`select public.rpc_update_lead(${L},${ME},'rejected')`,dt=`select public.rpc_update_lead_details(${L},${ME},'اسم متغيّر','0100','0100','whatsapp')`;
 const as=async(role,sql)=>{await db.exec('set role '+role);try{await db.query(sql);return 'ok';}catch(e){return e.message;}finally{await db.exec('reset role');}};
 assert.equal(await as('anon',st),'ok','before: anon could change a lead (the hole)');
 await db.exec("update public.leads set current_status='new',customer_name='عميل'");
 const M=fs.readFileSync('supabase/migrations/20261125160000_revoke_lead_update_rpcs.sql','utf8');await db.exec(M);
 for(const r of ['anon','authenticated'])for(const q of [st,dt])assert.match(await as(r,q),/permission denied/,r+' refused');
 assert.equal((await db.query('select current_status,customer_name from public.leads')).rows[0].current_status,'new','nothing changed');
 assert.equal(await as('service_role',st),'ok','edge (service role) still works');assert.equal(await as('service_role',dt),'ok');
 assert.deepEqual((await db.query('select current_status,customer_name from public.leads')).rows[0],{current_status:'rejected',customer_name:'اسم متغيّر'});
 await db.exec(M);   // idempotent
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125160000_revoke_lead_update_rpcs.rollback.sql','utf8'));assert.equal(await as('anon',st),'ok','rollback restores');
 // the only callers are the three edge functions
 const callers=execSync("grep -rl \"rpc_update_lead\" assets config.js index.html supabase/functions || true").toString().trim().split('\n').filter(Boolean).sort();
 assert.deepEqual(callers,['supabase/functions/lead-invoice-upload/index.ts','supabase/functions/leads-update-details/index.ts','supabase/functions/leads-update-status/index.ts']);
 assert.match(setup,/grant execute on function public\.rpc_update_lead to service_role;/);assert.doesNotMatch(setup,/grant execute on function public\.rpc_update_lead to authenticated/);
 console.log('PASS lead update RPCs locked: anon + authenticated get «permission denied» on rpc_update_lead / rpc_update_lead_details (nothing changes); the service role (edge functions) still updates; idempotent; rollback restores; only the 3 edge functions call them; setup.sql matches.');
})().catch(e=>{console.error(e);process.exit(1);});
