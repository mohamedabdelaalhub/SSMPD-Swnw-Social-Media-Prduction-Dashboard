// 20261120250000: a Masa age stored after the automatic-booking row exists (or by any path) reaches that row; a booking waiting only
// for the age goes back to the queue. Backfill applies the same rule once. Other rows are untouched.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_reception;
  create table clinic_reception.masa_bookings(official_booking_id text primary key,patient_age int);
  create table clinic_reception.external_bookings(id serial,source text,external_id text,age int,state text,review_kind text,reason text,public_patient_id uuid,updated_at timestamptz);
  insert into clinic_reception.masa_bookings values('B1',40),('B2',null),('B3',22),('B4',30),('B5',50);
  insert into clinic_reception.external_bookings(source,external_id,state,review_kind,reason,public_patient_id) values
   ('masa','B1','review','age','مريض جديد — اكتب سنه',null),
   ('masa','B2','review','age','مريض جديد — اكتب سنه',null),
   ('masa','B3','review','patient','اختار المريض',null),
   ('masa','B4','review','age','x','00000000-0000-0000-0000-000000000001'),
   ('whatsapp','B5','review','age','مريض جديد من الواتساب',null);`);
  const f=n=>fs.readFileSync(n,'utf8'),M=f('supabase/migrations/20261120250000_auto_book_masa_age_requeue.sql');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const row=id=>one("select * from clinic_reception.external_bookings where external_id=$1",[id]);
  let e=await row('B1');assert.equal(e.age,40);assert.equal(e.state,'pending');assert.equal(e.review_kind,null);assert.equal(e.reason,null);
  e=await row('B2');assert.equal(e.state,'review','no age in Masa: still waiting');
  e=await row('B3');assert.equal(e.age,22);assert.equal(e.review_kind,'patient','other review kinds keep waiting');
  e=await row('B4');assert.equal(e.age,null,'linked to a file: untouched');
  e=await row('B5');assert.equal(e.state,'review','agent bookings untouched');assert.equal(e.age,null);
  // trigger: age stored later
  await q("update clinic_reception.masa_bookings set patient_age=7 where official_booking_id='B2'");
  e=await row('B2');assert.equal(e.age,7);assert.equal(e.state,'pending');
  // insert order: Masa row first, auto-book row created by the earlier trigger in production — here simulate a later row + update
  await q("insert into clinic_reception.external_bookings(source,external_id,state,review_kind) values('masa','B6','review','age')");
  await q("insert into clinic_reception.masa_bookings values('B6',12)");
  e=await row('B6');assert.equal(e.age,12);assert.equal(e.state,'pending');
  // null age does nothing
  await q("insert into clinic_reception.external_bookings(source,external_id,state,review_kind) values('masa','B7','review','age')");
  await q("insert into clinic_reception.masa_bookings values('B7',null)");assert.equal((await row('B7')).state,'review');
  assert.equal((await one("select has_function_privilege('authenticated','clinic_reception.auto_book_masa_age()','execute') x")).x,false);
  await db.exec(f('supabase/rollbacks/20261120250000_auto_book_masa_age_requeue.rollback.sql'));
  await q("update clinic_reception.masa_bookings set patient_age=8 where official_booking_id='B7'");assert.equal((await row('B7')).age,null,'rolled back');
  console.log('auto-book masa age requeue: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
