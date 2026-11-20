// 20261120240000: names are cleaned in the database for every path (invisible marks, tatweel, harakat, NBSP).
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const mig=fs.readFileSync('supabase/migrations/20261017224904_psychology_specialist.sql','utf8');
 const M=fs.readFileSync('supabase/migrations/20261120240000_patient_name_clean_db.sql','utf8'),R=fs.readFileSync('supabase/rollbacks/20261120240000_patient_name_clean_db.rollback.sql','utf8');
 try{await db.exec(`create schema psychcare;create table public.patients(id uuid primary key default gen_random_uuid(),full_name text,phone text,age int,patient_code text);`+
   mig.slice(mig.indexOf('create function psychcare.phone'),mig.indexOf('create trigger patient_basics_guard'))+
   ';create trigger patient_basics_guard before insert or update on public.patients for each row execute function psychcare.patient_basics_guard();');
  const ins=(n)=>one("insert into public.patients(full_name,phone,age) values($1,'01000000000',30) returning full_name",[n]);
  await assert.rejects(()=>ins('سارة‏ تجريبية'),/كلمتين/,'before: refused');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  assert.equal((await ins('سارة‏ تجريبية‏')).full_name,'سارة تجريبية');
  assert.equal((await one("insert into public.patients(full_name,phone,age) values('مُحَمَّد علي','01000000001',30) returning full_name")).full_name,'محمد علي');
  assert.equal((await one("insert into public.patients(full_name,phone,age) values('‫نـور أحمد‬','01000000002',30) returning full_name")).full_name,'نور أحمد');
  await assert.rejects(()=>ins('سارة‏'),/كلمتين/,'one word still refused');
  // direct check_basics callers (auto-book, employee booking) get the cleaned name too
  await one("select psychcare.check_basics($1,'01000000003',30)",['هدى‌‏ عادل']);
  // duplicate detection still works on the cleaned name
  await assert.rejects(()=>one("insert into public.patients(full_name,phone,age) values('سارة تجريبية','01000000000',30)"),/مسجل بالفعل/);
  // rollback
  await db.exec(R);await assert.rejects(()=>ins('ليلى‏ تجريبية'),/كلمتين/);assert.equal((await one("select to_regprocedure('psychcare.clean_name(text)') f")).f,null);
  console.log('PASS patient name cleaning in the database');
 }catch(e){console.error('FAIL',e);process.exit(1);}})();
