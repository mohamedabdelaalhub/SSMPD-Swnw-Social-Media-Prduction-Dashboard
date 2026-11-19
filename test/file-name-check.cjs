// Name-mismatch warnings: SQL (queue / record / review permissions) on real Postgres + dashboard badge (jsdom).
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),{execFileSync}=require('child_process'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
(async()=>{
  // ---- UI
  const F1='11111111-1111-4111-8111-111111111111',F2='22222222-2222-4222-8222-222222222222';
  const dom=new JSDOM(`<div id="a"><button data-view-file="${F1}">عرض</button><button data-dl="${F1}">تنزيل</button></div><div id="b"><button data-view-file="${F2}">عرض</button></div>`,{runScripts:'outside-only'});
  const w=dom.window,rpc=[];let queries=0;
  w.requestAnimationFrame=f=>setTimeout(f,0);w.prompt=()=>'نفس المريض';w.alert=()=>{};
  const rows=[{file_id:F1,detected_name:'ساره محمود حسن',verdict:'mismatch',reviewed_at:null}];
  w.SSMPDDb={client:{from:()=>{queries++;const q={_ids:[],select(){return q},in(k,ids){q._ids=ids;return q},eq(){return q},is(){return q},
    then(res,rej){return Promise.resolve({data:rows.filter(r=>q._ids.includes(r.file_id)),error:null}).then(res,rej)}};return q;},
    rpc:(n,a)=>{rpc.push(n+':'+a.p_file_id);return Promise.resolve({error:null});}}};
  w.eval(fs.readFileSync(path.join(root,'assets/js/file-name-check-badges.js'),'utf8'));
  const tick=()=>new Promise(r=>setTimeout(r,20));await tick();
  const badges=()=>w.document.querySelectorAll('[data-file-name-check]');
  assert.equal(badges().length,1,'one badge, only for the mismatching file');
  assert.match(badges()[0].textContent,/ساره محمود حسن/);
  assert.equal(queries,1,'one query for all files on screen');
  // re-render: badge comes back from cache without a new query
  const html=w.document.getElementById('a').innerHTML;w.document.getElementById('a').innerHTML=html.replace(/<span[\s\S]*<\/span>/,'');
  await tick();await tick();assert.equal(badges().length,1);assert.equal(queries,1,'cached');
  badges()[0].querySelector('button').click();await tick();
  assert.deepEqual(rpc,['patient_file_name_check_review:'+F1]);assert.equal(badges().length,0,'reviewed badge removed');
  // ---- SQL
  const bins=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/17/bin'].filter(d=>fs.existsSync(d+'/initdb'));
  if(!bins.length){console.log('file name check: OK (SQL skipped)');return;}
  const bin=bins[0],dir=fs.mkdtempSync(path.join(os.tmpdir(),'pp-nc-')),port=String(56000+Math.floor(Math.random()*900));
  const asPg=process.getuid&&process.getuid()===0;if(asPg)execFileSync('chown',['postgres',dir]);
  const run=(c,a)=>execFileSync(asPg?'runuser':c,asPg?['-u','postgres','--',c,...a]:a,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const psql=(sql,file)=>run('psql',['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',...(file?['-f',file]:['-c',sql])]).trim();
  const copy=f=>{const d=path.join(dir,path.basename(f));fs.copyFileSync(f,d);if(asPg)execFileSync('chown',['postgres',d]);return d;};
  try{
    run(bin+'/initdb',['-D',dir+'/data','-U','postgres','-A','trust']);
    run(bin+'/pg_ctl',['-D',dir+'/data','-l',dir+'/pg.log','-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-w','start']);
    psql(`create role anon; create role authenticated; create role service_role;
      create table admins(id uuid primary key); create table patients(id uuid primary key, full_name text);
      create table patient_files(id uuid primary key, patient_id uuid references patients(id), category text, file_name text, mime_type text, drive_file_id text, is_encrypted boolean not null default false, uploaded_at timestamptz default now());
      create function my_admin_id() returns uuid language sql as $$ select nullif(current_setting('t.admin',true),'')::uuid $$;
      create function is_super() returns boolean language sql as $$ select false $$;
      create function has_archive_access() returns boolean language sql as $$ select current_setting('t.role',true)='archive' $$;
      create function has_archive_review_access() returns boolean language sql as $$ select false $$;
      create function is_assigned_doctor_for_patient(uuid) returns boolean language sql as $$ select false $$;
      insert into admins values ('00000000-0000-4000-8000-0000000000a1');
      insert into patients values ('00000000-0000-4000-8000-0000000000b1','Test');
      insert into patient_files values ('${F1}','00000000-0000-4000-8000-0000000000b1','lab_result','a.pdf','application/pdf','d1',false,now()),
        ('${F2}','00000000-0000-4000-8000-0000000000b1','other','b.docx','application/msword','d2',false,now()),
        ('44444444-4444-4444-8444-444444444444','00000000-0000-4000-8000-0000000000b1','other','IMG_1.JPG','application/octet-stream','d3',false,now()),
        ('55555555-5555-4555-8555-555555555555','00000000-0000-4000-8000-0000000000b1','other','p.heic','image/heic','d4',false,now()),
        ('66666666-6666-4666-8666-666666666666','00000000-0000-4000-8000-0000000000b1','invoice','inv.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','d5',false,now());`);
    const mig=copy(path.join(root,'supabase/migrations/20261115170000_patient_file_name_checks.sql'));psql(null,mig);psql(null,mig);
    assert.equal(psql(`select string_agg(file_id::text,',' order by file_id) from patient_file_name_check_queue(10,30)`),F1+',44444444-4444-4444-8444-444444444444','queue: images/PDFs by mime or extension; no HEIC, docx or system invoices');
    for(const r of ['anon','authenticated'])assert.equal(psql(`select has_function_privilege('${r}','patient_file_name_check_record(uuid,text,numeric,text,text)','EXECUTE')`),'f');
    assert.equal(psql(`select has_function_privilege('authenticated','patient_file_name_check_queue(integer,integer)','EXECUTE')`),'f');
    psql(`select patient_file_name_check_record('${F1}','mismatch',0.33,'ساره محمود','tesseract')`);
    assert.equal(psql(`select count(*) from patient_file_name_check_queue(10,30)`),'1','checked file leaves the queue');
    assert.throws(()=>psql(`select patient_file_name_check_record('${F1}','maybe',0,null,null)`),/check/i,'verdict constrained');
    assert.throws(()=>psql(`begin; set local t.role='nurse'; set local t.admin='00000000-0000-4000-8000-0000000000a1'; select patient_file_name_check_review('${F1}','x'); commit;`),/NOT_ALLOWED/);
    psql(`begin; set local t.role='archive'; set local t.admin='00000000-0000-4000-8000-0000000000a1'; select patient_file_name_check_review('${F1}','same patient'); commit;`);
    assert.equal(psql(`select review_note||','||(reviewed_at is not null) from patient_file_name_checks where file_id='${F1}'`),'same patient,true');
    psql(`select patient_file_name_check_record('${F1}','mismatch',0.33,'ساره محمود','tesseract')`);
    assert.equal(psql(`select reviewed_at is null from patient_file_name_checks where file_id='${F1}'`),'t','a re-check reopens the warning');
    assert.equal(psql(`select has_table_privilege('anon','patient_file_name_checks','SELECT')`),'f');
    psql(null,copy(path.join(root,'supabase/rollbacks/20261115170000_patient_file_name_checks.rollback.sql')));
    assert.equal(psql(`select to_regclass('public.patient_file_name_checks') is null`),'t');
    console.log('file name check: OK');
  }finally{try{run(bin+'/pg_ctl',['-D',dir+'/data','-m','immediate','stop']);}catch(e){}fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
