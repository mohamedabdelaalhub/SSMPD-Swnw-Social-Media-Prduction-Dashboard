// Applies 20261115150000_patient_portal_anon_hardening.sql to a throwaway Postgres
// (Supabase-like default grants), checks anon is locked out while authenticated/service_role
// keep access, then applies the rollback and checks defaults return.
// Needs a local Postgres (initdb/pg_ctl on PATH or /usr/lib/postgresql/*/bin). Skips otherwise.
const {execFileSync}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const bins=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/17/bin'].filter(d=>fs.existsSync(d+'/initdb'));
if(!bins.length){console.log('SKIP: no local postgres');process.exit(0);}
const bin=bins[0],dir=fs.mkdtempSync(path.join(os.tmpdir(),'pp-hard-')),port=String(54000+Math.floor(Math.random()*900));
const asPg=process.getuid&&process.getuid()===0?['runuser','-u','postgres','--']:[];
if(asPg.length)execFileSync('chown',['postgres',dir]);
const run=(cmd,args)=>execFileSync(asPg.length?asPg[0]:cmd,asPg.length?[...asPg.slice(1),cmd,...args]:args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const psql=(sql,file)=>run('psql',['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',...(file?['-f',file]:['-c',sql])]);
const tables=['patient_accounts','patient_account_access','patient_identity_verifications','patient_verification_documents','patient_system_links','patient_portal_visibility','patient_portal_audit_log','patient_activation_codes','patient_nutrition_meal_completions','patient_visits'];
const fns=['public.approve_patient_identity_verification(uuid)','public.reject_patient_identity_verification(uuid, text)','public.revoke_patient_account_access(uuid, text, text)','public.patient_portal_service_reports()'];
const copy=f=>{const d=path.join(dir,path.basename(f));fs.copyFileSync(f,d);if(asPg.length)execFileSync('chown',['postgres',d]);return d;};
try{
  run(bin+'/initdb',['-D',dir+'/data','-U','postgres','-A','trust']);
  run(bin+'/pg_ctl',['-D',dir+'/data','-l',dir+'/pg.log','-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-w','start']);
  psql(`create role anon; create role authenticated; create role service_role;
    ${tables.map(t=>`create table public.${t}(id int); grant all on public.${t} to anon, authenticated, service_role;`).join('\n')}
    create function public.approve_patient_identity_verification(uuid) returns void language sql security definer as 'select';
    create function public.reject_patient_identity_verification(uuid, text default null) returns void language sql security definer as 'select';
    create function public.revoke_patient_account_access(uuid, text default null, text default 'revoked') returns void language sql security definer as 'select';
    create function public.patient_portal_service_reports() returns void language sql security definer as 'select';`);
  const fnPriv=(role,fn)=>psql(`select has_function_privilege('${role}','${fn}','EXECUTE')`).trim();
  const tPriv=(role,t,p)=>psql(`select has_table_privilege('${role}','public.${t}','${p}')`).trim();
  for(const f of fns)assert.equal(fnPriv('anon',f),'t','precondition: anon executes '+f);
  psql(null,copy(path.join(root,'supabase/migrations/20261115150000_patient_portal_anon_hardening.sql')));
  for(const f of fns){assert.equal(fnPriv('anon',f),'f',f);assert.equal(fnPriv('authenticated',f),'t',f);assert.equal(fnPriv('service_role',f),'t',f);}
  for(const t of tables){for(const p of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(tPriv('anon',t,p),'f',t+' '+p);
    assert.equal(tPriv('authenticated',t,'SELECT'),'t',t);assert.equal(tPriv('service_role',t,'SELECT'),'t',t);}
  // idempotent
  psql(null,copy(path.join(root,'supabase/migrations/20261115150000_patient_portal_anon_hardening.sql')));
  // fails loudly (and changes nothing) when an object is missing
  psql('drop function public.patient_portal_service_reports(); grant all on public.patient_visits to anon;');
  assert.throws(()=>psql(null,copy(path.join(root,'supabase/migrations/20261115150000_patient_portal_anon_hardening.sql'))),/missing/);
  assert.equal(tPriv('anon','patient_visits','SELECT'),'t','failed run must not partially apply');
  psql(`revoke all on public.patient_visits from anon; create function public.patient_portal_service_reports() returns void language sql security definer as 'select'; revoke execute on function public.patient_portal_service_reports() from public;`);
  psql(null,copy(path.join(root,'supabase/rollbacks/20261115150000_patient_portal_anon_hardening.rollback.sql')));
  for(const f of fns)assert.equal(fnPriv('anon',f),'t','rollback '+f);
  for(const t of tables)assert.equal(tPriv('anon',t,'SELECT'),'t','rollback '+t);
  // Phase 1b
  const fns1b=['kpi_hub_aggregates(integer)','refresh_overdue_followups()','insurance_billable_visits(text)','entity_billing_visits(text, uuid)','insurance_visit_billing_context(uuid)','entity_billing_context(uuid)','digital_chat_aggregate_snapshot(text)','digital_agent_metric_detail(text, text)','staff_comprehensive_performance(timestamptz, timestamptz, uuid)','digital_agent_run_review(text)','delete_contracting_entity(uuid)','insurance_bill_visit(uuid, uuid, text, text, text, uuid, uuid)','entity_service_bill(jsonb, uuid)'];
  psql(fns1b.map(f=>`create function public.${f.replace(/\(.*\)/,'')}(${f.match(/\((.*)\)/)[1]}) returns void language sql security definer as 'select';`).join('\n')+`\ncreate function public.clinic_reception_checkin_public(uuid) returns void language sql security definer as 'select';`);
  const lock=path.join(root,'supabase/migrations/20261115151000_anon_definer_function_lockdown.sql');
  psql(null,copy(lock));psql(null,copy(lock));
  for(const f of fns1b){assert.equal(fnPriv('anon','public.'+f),'f',f);assert.equal(fnPriv('service_role','public.'+f),'t',f);
    assert.equal(fnPriv('authenticated','public.'+f),f.startsWith('kpi_hub')?'f':'t',f);}
  assert.equal(fnPriv('anon','public.clinic_reception_checkin_public(uuid)'),'t','public check-in must stay open');
  psql(null,copy(path.join(root,'supabase/rollbacks/20261115151000_anon_definer_function_lockdown.rollback.sql')));
  for(const f of fns1b)assert.equal(fnPriv('anon','public.'+f),'t','rollback '+f);
  console.log('patient portal anon hardening SQL: OK');
}finally{
  try{run(bin+'/pg_ctl',['-D',dir+'/data','-m','immediate','stop']);}catch(e){}
  fs.rmSync(dir,{recursive:true,force:true});
}
