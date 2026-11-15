// Portal booking requests: max 2 open per patient, one open request per slot, lifecycle updates.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
const root=path.join(__dirname,'..');
const bins=['/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin','/usr/lib/postgresql/17/bin'].filter(d=>fs.existsSync(d+'/initdb'));
if(!bins.length){console.log('SKIP: no local postgres');process.exit(0);}
const bin=bins[0],dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppbr-')),port=String(58000+Math.floor(Math.random()*900));
const asPg=process.getuid&&process.getuid()===0;if(asPg)execFileSync('chown',['postgres',dir]);
const run=(c,a)=>execFileSync(asPg?'runuser':c,asPg?['-u','postgres','--',c,...a]:a,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const psql=(sql,file)=>run('psql',['-h',dir,'-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt',...(file?['-f',file]:['-c',sql])]).trim();
const copy=f=>{const d=path.join(dir,path.basename(f));fs.copyFileSync(f,d);if(asPg)execFileSync('chown',['postgres',d]);return d;};
const A='00000000-0000-4000-8000-0000000000a1',P='00000000-0000-4000-8000-0000000000b1',P2='00000000-0000-4000-8000-0000000000b2';
const ins=(p,date,time,doc='doc_x',status='pending')=>psql(`insert into patient_portal_booking_requests(account_id,patient_id,doctor_id,requested_date,requested_time,status) values ('${A}','${p}','${doc}',${date},'${time}','${status}') returning id`).split('\n')[0];
try{
  run(bin+'/initdb',['-D',dir+'/data','-U','postgres','-A','trust']);
  run(bin+'/pg_ctl',['-D',dir+'/data','-l',dir+'/pg.log','-o',`-p ${port} -k ${dir} -c listen_addresses=''`,'-w','start']);
  psql(`create role anon; create role authenticated; create role service_role;
    create table admins(id uuid primary key); create table patients(id uuid primary key);
    create table patient_accounts(id uuid primary key);
    insert into patient_accounts values ('${A}'); insert into patients values ('${P}'),('${P2}');`);
  const mig=copy(path.join(root,'supabase/migrations/20261115190000_portal_booking_requests.sql'));psql(null,mig);psql(null,mig);
  const T="(now() at time zone 'Africa/Cairo')::date + 3";
  const r1=ins(P,T,'10:00');const r2=ins(P,T,'11:00');
  assert.throws(()=>ins(P,T,'12:00'),/PORTAL_BOOKING_LIMIT/,'third open request refused');
  ins(P2,T,'12:00'); // other patient unaffected
  assert.throws(()=>ins(P2,T,'12:00'),/duplicate key|ppbr_one_open_per_slot/,'same slot twice refused');
  // lifecycle: pending -> confirming -> confirmed does not trip the limit
  psql(`update patient_portal_booking_requests set status='confirming' where id='${r1}'`);
  psql(`update patient_portal_booking_requests set status='confirmed', official_booking_id='123' where id='${r1}'`);
  assert.throws(()=>ins(P,T,'12:00'),/PORTAL_BOOKING_LIMIT/,'future confirmed still counts');
  psql(`update patient_portal_booking_requests set status='cancelled_by_patient' where id='${r2}'`);
  const r3=ins(P,T,'12:00');assert.ok(r3,'cancelling frees a place');
  // past confirmed bookings no longer count
  psql(`update patient_portal_booking_requests set requested_date=(now() at time zone 'Africa/Cairo')::date - 1 where id='${r1}'`);
  ins(P,T,'13:00');
  // re-opening a cancelled request is checked too
  assert.throws(()=>psql(`update patient_portal_booking_requests set status='pending' where id='${r2}'`),/PORTAL_BOOKING_LIMIT/);
  for(const r of ['anon','authenticated'])assert.equal(psql(`select has_table_privilege('${r}','patient_portal_booking_requests','SELECT')`),'f');
  psql(null,copy(path.join(root,'supabase/rollbacks/20261115190000_portal_booking_requests.rollback.sql')));
  assert.equal(psql(`select to_regclass('public.patient_portal_booking_requests') is null`),'t');
  console.log('portal booking requests SQL: OK');
}finally{try{run(bin+'/pg_ctl',['-D',dir+'/data','-m','immediate','stop']);}catch(e){}fs.rmSync(dir,{recursive:true,force:true});}
