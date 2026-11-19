// Phase 2 portal visibility: (1) the helper is identical in every portal function,
// (2) its 24h / approved / hidden rules, (3) set_patient_portal_visibility on real Postgres.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const root=path.join(__dirname,'..');
const files=['patient-portal-medical-data','patient-portal-documents','patient-portal-self-service','patient-portal-medications','patient-files-download']
  .map(f=>path.join(root,'supabase/functions',f,'index.ts'));
const block=s=>{const a=s.indexOf('// --- portal visibility'),b=s.indexOf('// --- end portal visibility ---');assert(a>=0&&b>a,'helper missing');return s.slice(a,b);};
const blocks=files.map(f=>block(fs.readFileSync(f,'utf8')));
blocks.forEach((b,i)=>assert.equal(b,blocks[0],'helper differs in '+files[i]));
// (2) run helper logic
const ts=require('typescript');
const js=ts.transpileModule(blocks[0]+'\nmodule.exports={loadPortalVisibility,isPortalVisible};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const m={exports:{}};new Function('module','exports',js)(m,m.exports);
const {isPortalVisible,loadPortalVisibility}=m.exports,H=3600e3,now=Date.parse('2026-11-15T12:00:00Z');
const map=new Map([['visit:a','approved'],['visit:h','hidden'],['visit:i','internal']]);
assert.equal(isPortalVisible(map,'visit','a',new Date(now).toISOString(),now),true,'approved shows at once');
assert.equal(isPortalVisible(map,'visit','h',new Date(now-99*H).toISOString(),now),false,'hidden never shows');
assert.equal(isPortalVisible(map,'visit','i',new Date(now-99*H).toISOString(),now),false,'internal treated as hidden');
assert.equal(isPortalVisible(map,'visit','x',new Date(now-23.9*H).toISOString(),now),false,'new record waits');
assert.equal(isPortalVisible(map,'visit','x',new Date(now-24*H).toISOString(),now),true,'24h later it shows');
assert.equal(isPortalVisible(map,'prescription','a',new Date(now).toISOString(),now),false,'status is per entity type');
assert.equal(isPortalVisible(map,'visit','x',null,now),false,'missing timestamp fails closed');
(async()=>{
  await assert.rejects(loadPortalVisibility({from:()=>({select:()=>({in:async()=>({error:{message:'x'}})})})},['p']),/PORTAL_VISIBILITY_UNAVAILABLE/);
  // edge functions filter where expected
  const src=f=>fs.readFileSync(path.join(root,'supabase/functions',f,'index.ts'),'utf8');
  assert.match(src('patient-portal-medical-data'),/isPortalVisible\(visibility, "visit", visit\.id, visit\.created_at\)/);
  assert.match(src('patient-portal-medical-data'),/isPortalVisible\(visibility, "prescription", rx\.id, rx\.created_at\)/);
  for(const t of ['medical_report','echo_report','dental_report','physio_report','prescription','lab_request','radiology_request'])
    assert.match(src('patient-portal-documents'),new RegExp('visibleRows\\(\\w+All, "'+t+'"\\)'));
  assert.match(src('patient-portal-self-service'),/isPortalVisible\(visibility, "patient_file", f\.id, f\.uploaded_at\)/);
  assert.match(src('patient-files-download'),/FILE_NOT_YET_AVAILABLE_IN_PORTAL/);
  // (3) Postgres
  const bins=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/17/bin'].filter(d=>fs.existsSync(d+'/initdb'));
  if(!bins.length){console.log('portal visibility: OK (SQL part skipped, no local postgres)');return;}
  const bin=bins[0],dir=fs.mkdtempSync(path.join(os.tmpdir(),'pp-vis-')),port=String(55000+Math.floor(Math.random()*900));
  const asPg=process.getuid&&process.getuid()===0;if(asPg)execFileSync('chown',['postgres',dir]);
  const run=(c,a)=>execFileSync(asPg?'runuser':c,asPg?['-u','postgres','--',c,...a]:a,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const psql=(sql,file)=>run('psql',['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',...(file?['-f',file]:['-c',sql])]).trim();
  const copy=f=>{const d=path.join(dir,path.basename(f));fs.copyFileSync(f,d);if(asPg)execFileSync('chown',['postgres',d]);return d;};
  try{
    run(bin+'/initdb',['-D',dir+'/data','-U','postgres','-A','trust']);
    run(bin+'/pg_ctl',['-D',dir+'/data','-l',dir+'/pg.log','-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-w','start']);
    const tables=['patient_visits','patient_medical_reports','patient_echo_reports','patient_dental_reports','patient_physio_reports','patient_prescriptions','patient_lab_requests','patient_radiology_requests','patient_files'];
    psql(`create role anon; create role authenticated; create role service_role;
      create table admins(id uuid primary key); create table patients(id uuid primary key);
      ${tables.map(t=>`create table ${t}(id uuid primary key, patient_id uuid references patients(id));`).join('\n')}
      create function my_admin_id() returns uuid language sql as $$ select nullif(current_setting('t.admin',true),'')::uuid $$;
      create function is_super() returns boolean language sql as $$ select current_setting('t.role',true)='super' $$;
      create function has_archive_access() returns boolean language sql as $$ select current_setting('t.role',true)='archive' $$;
      create function can_manage_all_content() returns boolean language sql as $$ select false $$;
      create function has_archive_review_access() returns boolean language sql as $$ select false $$;
      create function can_access_leads() returns boolean language sql as $$ select false $$;
      create function is_assigned_doctor_for_patient(uuid) returns boolean language sql as $$ select current_setting('t.role',true)='doctor' and $1::text=current_setting('t.doc_patient',true) $$;
      create table patient_portal_visibility(id uuid primary key default gen_random_uuid(), patient_id uuid not null references patients(id),
        entity_type text not null check (entity_type in ('medical_report','echo_report','dental_report','physio_report','prescription','lab_request','radiology_request','patient_file')),
        entity_id uuid not null, portal_status text not null default 'internal' check (portal_status in ('internal','approved','hidden')),
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(entity_type, entity_id));
      alter table patient_portal_visibility enable row level security;
      create policy "portal visibility write" on patient_portal_visibility for all using (has_archive_access()) with check (has_archive_access());
      create table patient_portal_audit_log(id uuid primary key default gen_random_uuid(), account_id uuid, patient_id uuid, actor_admin_id uuid, action text not null, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz default now());
      insert into admins values ('00000000-0000-4000-8000-0000000000a1');
      insert into patients values ('00000000-0000-4000-8000-0000000000b1'),('00000000-0000-4000-8000-0000000000b2');
      insert into patient_visits values ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000b1');`);
    const mig=copy(path.join(root,'supabase/migrations/20261115160000_patient_portal_visibility_24h.sql'));
    psql(null,mig);psql(null,mig);// idempotent
    const V="'00000000-0000-4000-8000-0000000000c1'::uuid",A="00000000-0000-4000-8000-0000000000a1";
    const as=(role,sql,extra='')=>psql(`begin; set local t.role='${role}'; set local t.admin='${A}'; ${extra} ${sql}; commit;`);
    assert.throws(()=>psql(`select set_patient_portal_visibility('visit',${V},'approved')`),/NOT_STAFF/,'non-staff rejected');
    assert.throws(()=>as('nurse',`select set_patient_portal_visibility('visit',${V},'approved')`),/NOT_ALLOWED/,'plain staff rejected');
    assert.throws(()=>as('doctor',`select set_patient_portal_visibility('visit',${V},'approved')`,"set local t.doc_patient='00000000-0000-4000-8000-0000000000b2';"),/NOT_ALLOWED/,'other patient doctor rejected');
    as('doctor',`select set_patient_portal_visibility('visit',${V},'approved')`,"set local t.doc_patient='00000000-0000-4000-8000-0000000000b1';");
    assert.equal(psql(`select portal_status||','||patient_id from patient_portal_visibility where entity_id=${V}`),'approved,00000000-0000-4000-8000-0000000000b1','doctor approves, patient derived');
    as('archive',`select set_patient_portal_visibility('visit',${V},'hidden')`);
    assert.equal(psql(`select portal_status from patient_portal_visibility where entity_id=${V}`),'hidden');
    as('archive',`select set_patient_portal_visibility('visit',${V},'auto')`);
    assert.equal(psql(`select count(*) from patient_portal_visibility where entity_id=${V}`),'0','auto removes the override');
    assert.equal(psql(`select count(*) from patient_portal_audit_log where entity_id=${V}`),'3','every change audited');
    assert.throws(()=>as('super',`select set_patient_portal_visibility('visit',gen_random_uuid(),'approved')`),/RECORD_NOT_FOUND/);
    assert.throws(()=>as('super',`select set_patient_portal_visibility('visit',${V},'internal')`),/INVALID_STATUS/);
    assert.throws(()=>as('super',`select set_patient_portal_visibility('bogus',${V},'approved')`),/INVALID_ENTITY_TYPE/);
    assert.equal(psql(`select has_function_privilege('anon','set_patient_portal_visibility(text,uuid,text)','EXECUTE')`),'f');
    assert.equal(psql(`select count(*) from pg_policies where tablename='patient_portal_visibility' and policyname='portal visibility write'`),'0','direct writes removed');
    psql(null,copy(path.join(root,'supabase/rollbacks/20261115160000_patient_portal_visibility_24h.rollback.sql')));
    assert.equal(psql(`select count(*) from pg_proc where proname='set_patient_portal_visibility'`),'0');
    console.log('portal visibility: OK');
  }finally{try{run(bin+'/pg_ctl',['-D',dir+'/data','-m','immediate','stop']);}catch(e){}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
