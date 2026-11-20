// Owner 2026-11-19 («١ ب» + bridge approval): masa_import carries patient_age; it reaches the Masa booking and the automatic-booking row,
// and a booking waiting only for the age goes back to the queue. Other ops and the import itself are unchanged.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 try{await db.exec(`create role authenticated;create role anon;create role service_role;create schema clinic_reception;
  create table clinic_reception.masa_bookings(official_booking_id text primary key,patient_name text,status text default 'active');
  create table clinic_reception.external_bookings(id serial,source text,external_id text,age int,state text,review_kind text,reason text,public_patient_id uuid,updated_at timestamptz);
  -- stand-in for the import as it is today: inserts the Masa booking and queues it for automatic booking (age unknown)
  create function clinic_reception_fallback_api(p_op text,p_payload jsonb) returns jsonb language plpgsql security definer as $$
  declare it jsonb;begin
   if p_op='masa_import' then for it in select value from jsonb_array_elements(p_payload->'items') loop
     insert into clinic_reception.masa_bookings(official_booking_id,patient_name) values(it->>'official_booking_id',it->>'patient_name') on conflict do nothing;
     insert into clinic_reception.external_bookings(source,external_id,state,review_kind,reason) select 'masa',it->>'official_booking_id','review','age','مريض جديد — اكتب سنه'
       where not exists(select 1 from clinic_reception.external_bookings where external_id=it->>'official_booking_id');
    end loop;return jsonb_build_object('ok',true,'inserted',jsonb_array_length(p_payload->'items'));end if;
   if p_op='bad' then return jsonb_build_object('ok',false,'error','x');end if;
   return jsonb_build_object('ok',true,'op',p_op);end $$;`);
  const M=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_masa_import_patient_age.sql')),'utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const api=(op,p)=>one("select clinic_reception_fallback_api($1,$2) r",[op,p]);
  let r=(await api('masa_import',{items:[{official_booking_id:'M1',patient_name:'مريض جديد تجريبي',patient_age:34},{official_booking_id:'M2',patient_name:'من غير سن',patient_age:null},{official_booking_id:'M3',patient_name:'سن غلط',patient_age:'999'}]})).r;
  assert.equal(r.inserted,3,'import result returned unchanged');
  assert.equal((await one("select patient_age from clinic_reception.masa_bookings where official_booking_id='M1'")).patient_age,34);
  let e=await one("select * from clinic_reception.external_bookings where external_id='M1'");assert.equal(e.age,34);assert.equal(e.state,'pending');assert.equal(e.review_kind,null);assert.equal(e.reason,null);
  e=await one("select * from clinic_reception.external_bookings where external_id='M2'");assert.equal(e.age,null);assert.equal(e.review_kind,'age','no age: still waiting');
  e=await one("select * from clinic_reception.external_bookings where external_id='M3'");assert.equal(e.age,null,'invalid age ignored');
  assert.equal((await one("select patient_age from clinic_reception.masa_bookings where official_booking_id='M3'")).patient_age,null);
  // a booking already linked to a file keeps its state; other review kinds are untouched
  await q("insert into clinic_reception.external_bookings(source,external_id,state,review_kind) values('masa','M4','review','patient')");
  await q("insert into clinic_reception.masa_bookings(official_booking_id) values('M4')");
  await api('masa_import',{items:[{official_booking_id:'M4',patient_age:20}]});
  e=await one("select * from clinic_reception.external_bookings where external_id='M4'");assert.equal(e.state,'review');assert.equal(e.review_kind,'patient');assert.equal(e.age,20);
  // other ops and failures pass through
  assert.deepEqual((await api('slots',{})).r,{ok:true,op:'slots'});assert.equal((await api('bad',{items:[{official_booking_id:'M1',patient_age:50}]})).r.ok,false);
  assert.equal((await one("select age from clinic_reception.external_bookings where external_id='M1'")).age,34,'nothing applied after a failed op');
  assert.equal((await one("select has_function_privilege('service_role','clinic_reception_fallback_api(text,jsonb)','execute') x")).x,true);
  assert.equal((await one("select has_function_privilege('authenticated','clinic_reception_fallback_api(text,jsonb)','execute') x")).x,false);
  // rollback restores the import
  await db.exec(fs.readFileSync('supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_masa_import_patient_age.')),'utf8'));
  assert.equal((await api('slots',{})).r.op,'slots');assert.equal((await one("select count(*)::int n from information_schema.columns where column_name='patient_age'")).n,0);
  console.log('masa import patient age: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
