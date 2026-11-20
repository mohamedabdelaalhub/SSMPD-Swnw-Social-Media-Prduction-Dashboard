// Owner 2026-11-20/21: Masa archive copied to separate tables; the live bookings/payments paths are untouched.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const api=(op,p)=>one("select clinic_reception_fallback_api($1,$2) r",[op,p]).then(x=>x.r);
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema clinic_finance;create schema clinic_reception;
  create table public.patients(id uuid primary key default gen_random_uuid());
  create table clinic_reception.masa_bookings(official_booking_id text primary key);
  create function clinic_finance.masa_int(v jsonb) returns int language sql immutable as $$select case when coalesce(v #>> '{}','') ~ '^-?[0-9]{1,9}$' then (v #>> '{}')::int end$$;
  create function clinic_finance.masa_local_ts(v text) returns timestamptz language sql stable as $$select case when coalesce(v,'') ~ '^\\d{4}-\\d{2}-\\d{2}' then (replace(v,'T',' ')::timestamp at time zone 'Africa/Cairo') end$$;
  create function public.clinic_reception_fallback_api(p_op text,p_payload jsonb) returns jsonb language sql as $$select jsonb_build_object('ok',true,'passthrough',p_op)$$;`);
 const M=fs.readFileSync('supabase/migrations/20261120310000_masa_archive_import.sql','utf8');
 await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 assert.deepEqual(await api('health',{}),{ok:true,passthrough:'health'});
 assert.deepEqual(await api('masa_import',{items:[]}),{ok:true,passthrough:'masa_import'});
 assert.equal((await api('masa_patients_import',{source:'x',items:[]})).error,'source_required');
 assert.equal((await api('masa_archive_import',{source:'old'})).error,'items_required');
 const hash='a'.repeat(64);
 const pts={source:'old',items:[
  {masa_patient_id:'1',name:'مريض أ',phone:'+20 100 000 0001',birth_date:'2054-09-11',birth_date_flag:true,national_id_hash:hash,insurance_name:'تأمين',discount_percent:5,is_blocked:false},
  {masa_patient_id:'2',name:'مريض ب',phone:'01000000002',birth_date:'1990-03-04',national_id_hash:'29001010101010',gender:'1'},
  {name:'بدون رقم'}]};
 const r=await api('masa_patients_import',pts);assert.deepEqual(r,{ok:true,upserted:2,skipped:1});
 await api('masa_patients_import',{...pts,source:'current'});
 assert.equal((await one("select count(*)::int n from clinic_reception.masa_patients")).n,4,'same id in two sources does not collide');
 const a=await one("select * from clinic_reception.masa_patients where source='old' and masa_patient_id='1'");
 assert.equal(a.birth_date,null);assert.equal(a.birth_date_flag,true);assert.equal(a.phone_normalized,'01000000001');assert.equal(a.national_id_hash,hash);
 const b=await one("select * from clinic_reception.masa_patients where source='old' and masa_patient_id='2'");
 assert.equal(b.national_id_hash,null,'a raw national id is never stored');
 assert.ok(!Object.keys(b).includes('gender'),'no gender column');
 await api('masa_patients_import',{source:'old',items:[{masa_patient_id:'1',name:'مريض أ معدل',phone:'01000000001'}]});
 const a2=await one("select name,national_id_hash from clinic_reception.masa_patients where source='old' and masa_patient_id='1'");
 assert.equal(a2.name,'مريض أ معدل');assert.equal(a2.national_id_hash,hash,'hash kept when a later row omits it');
 const bk={source:'old',items:[{official_booking_id:'old:7',masa_doctor_id:5,appointment_date:'2025-01-02',appointment_time:'00:00',status:'cancelled',booking_state_id:4,patient_name:'س',phone:'0100',patient_birth_date:'2001-01-01'},{official_booking_id:'8',appointment_date:'not a date'}]};
 assert.deepEqual(await api('masa_archive_import',bk),{ok:true,upserted:1,skipped:1});
 await api('masa_archive_import',bk);
 assert.equal((await one("select count(*)::int n from clinic_reception.masa_archive_bookings")).n,1);
 const ab=await one("select status,booking_state_id from clinic_reception.masa_archive_bookings");assert.equal(ab.status,'cancelled');assert.equal(ab.booking_state_id,4);
 assert.equal((await one("select count(*)::int n from clinic_reception.masa_bookings")).n,0,'live masa_bookings untouched');
 await assert.rejects(()=>db.exec("set role authenticated;select * from clinic_reception.masa_patients"),/permission denied/);
 console.log('masa archive import ok');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
