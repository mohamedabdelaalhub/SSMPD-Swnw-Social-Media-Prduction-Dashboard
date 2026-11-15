// patient_visits RLS rewrite: identical allow/deny outcomes to the live policies, fewer helper calls.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const root=path.join(__dirname,'..');
const bins=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/17/bin'].filter(d=>fs.existsSync(d+'/initdb'));
if(!bins.length){console.log('SKIP: no local postgres');process.exit(0);}
const bin=bins[0],dir=fs.mkdtempSync(path.join(os.tmpdir(),'pv-rls-')),port=String(57000+Math.floor(Math.random()*900));
const asPg=process.getuid&&process.getuid()===0;if(asPg)execFileSync('chown',['postgres',dir]);
const run=(c,a)=>execFileSync(asPg?'runuser':c,asPg?['-u','postgres','--',c,...a]:a,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const psql=(sql,file)=>run('psql',['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',...(file?['-f',file]:['-c',sql])]).trim();
const copy=f=>{const d=path.join(dir,path.basename(f));fs.copyFileSync(f,d);if(asPg)execFileSync('chown',['postgres',d]);return d;};
try{
  run(bin+'/initdb',['-D',dir+'/data','-U','postgres','-A','trust']);
  run(bin+'/pg_ctl',['-D',dir+'/data','-l',dir+'/pg.log','-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-w','start']);
  const flag=n=>`create function public.${n}() returns boolean language plpgsql stable security definer as $$ begin perform nextval('calls'); return coalesce(current_setting('t.${n}',true),'')='1'; end $$;`;
  psql(`create role authenticated; create sequence public.calls; grant usage on sequence public.calls to authenticated;
    ${['has_archive_access','has_archive_review_access','can_access_leads','can_manage_all_content'].map(flag).join('\n')}
    create function public.is_assigned_doctor_for_patient(uuid) returns boolean language sql stable as $$ select $1::text = current_setting('t.doc',true) $$;
    create table public.patient_visits(id serial primary key, patient_id uuid not null, created_at timestamptz default now());
    insert into public.patient_visits(patient_id) select (case when g%2=0 then '00000000-0000-4000-8000-000000000001' else '00000000-0000-4000-8000-000000000002' end)::uuid from generate_series(1,200) g;
    grant select, insert, update, delete on public.patient_visits to authenticated; grant usage on sequence public.patient_visits_id_seq to authenticated;
    alter table public.patient_visits enable row level security;`);
  psql(null,copy(path.join(root,'supabase/rollbacks/20261115181000_patient_visits_rls_initplan.rollback.sql'))); // = live policies
  const D1='00000000-0000-4000-8000-000000000001';
  const combos=[{},{has_archive_access:1},{has_archive_review_access:1},{can_access_leads:1},{can_manage_all_content:1},{doc:D1}];
  const probe=c=>{const set=Object.entries(c).map(([k,v])=>`set local t.${k}='${k==='doc'?v:'1'}';`).join(' ');
    const q=s=>psql(`begin; ${set} set local role authenticated; ${s}; rollback;`);
    return [q('select count(*) from patient_visits'),
      q(`update patient_visits set created_at=created_at where true returning 1`).split('\n').filter(Boolean).length,
      q(`delete from patient_visits where true returning 1`).split('\n').filter(Boolean).length,
      (()=>{try{q(`insert into patient_visits(patient_id) values ('${D1}')`);return 'ins-ok';}catch(e){return 'ins-denied';}})()].join('|');};
  const before=combos.map(probe);
  psql('select setval(\'calls\',1,false)');psql(`begin; set local t.has_archive_access='1'; set local role authenticated; select count(*) from patient_visits; rollback;`);
  const callsBefore=Number(psql(`select last_value from calls`));
  const mig=copy(path.join(root,'supabase/migrations/20261115181000_patient_visits_rls_initplan.sql'));psql(null,mig);psql(null,mig);
  const after=combos.map(probe);
  assert.deepEqual(after,before,'same permissions for every role combination');
  psql('select setval(\'calls\',1,false)');psql(`begin; set local t.has_archive_access='1'; set local role authenticated; select count(*) from patient_visits; rollback;`);
  const callsAfter=Number(psql(`select last_value from calls`));
  assert.ok(callsAfter<=5&&callsBefore>=200,`helpers run once per query (before ${callsBefore}, after ${callsAfter})`);
  assert.equal(psql(`select count(*) from pg_indexes where indexname='patient_visits_created_idx'`),'1');
  console.log(`patient_visits RLS initplan: OK (helper calls ${callsBefore} -> ${callsAfter}; outcomes ${before.join(' / ')})`);
}finally{try{run(bin+'/pg_ctl',['-D',dir+'/data','-m','immediate','stop']);}catch(e){}fs.rmSync(dir,{recursive:true,force:true});}
