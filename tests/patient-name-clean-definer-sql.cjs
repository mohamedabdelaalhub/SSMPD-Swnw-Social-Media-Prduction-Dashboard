// 20261120360000: a staff user (authenticated, no USAGE on schema psychcare) can create a patient and edit full_name again;
// the name is still cleaned. Reproduces the live «permission denied for schema psychcare».
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const mig=fs.readFileSync('supabase/migrations/20261017224904_psychology_specialist.sql','utf8');
 try{await db.exec(`create role authenticated;create role anon;create schema psychcare;
   create table public.patients(id uuid primary key default gen_random_uuid(),full_name text,phone text,age int,patient_code text);
   grant select,insert,update on public.patients to authenticated;`+
   mig.slice(mig.indexOf('create function psychcare.phone'),mig.indexOf('create trigger patient_basics_guard'))+
   ';alter function psychcare.patient_basics_guard() security definer;create trigger patient_basics_guard before insert or update on public.patients for each row execute function psychcare.patient_basics_guard();');
  await db.exec(fs.readFileSync('supabase/migrations/20261120240000_patient_name_clean_db.sql','utf8'));
  await db.exec('revoke all on schema psychcare from public');
  const asStaff=async(sql,p)=>{await db.exec('set role authenticated');try{return (await q(sql,p)).rows[0];}finally{await db.exec('reset role');}};
  await assert.rejects(()=>asStaff("insert into public.patients(full_name,phone,age) values('سارة تجريبية','01000000000',30) returning full_name"),/permission denied for schema psychcare/,'reproduces the live bug');
  const M=fs.readFileSync('supabase/migrations/20261120360000_patient_name_clean_definer.sql','utf8');
  await db.exec(M);await db.exec(M);   // idempotent
  const r=await asStaff("insert into public.patients(full_name,phone,age) values('سارة‏ تجريبية','01000000000',30) returning id,full_name");
  assert.equal(r.full_name,'سارة تجريبية','inserted + cleaned');
  assert.equal((await asStaff("update public.patients set full_name='مُنى تجريبية' where id=$1 returning full_name",[r.id])).full_name,'منى تجريبية','edit works + cleaned');
  assert.equal((await asStaff("update public.patients set age=31 where id=$1 returning age",[r.id])).age,31,'edit other fields');
  console.log('patient name clean definer: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
