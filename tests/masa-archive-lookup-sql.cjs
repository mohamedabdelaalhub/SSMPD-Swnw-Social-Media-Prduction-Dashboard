// Owner 2026-11-21: Masa archive lookup RPC (read only, role-gated, audited).
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0],id=()=>randomUUID();
 const rec=id(),cs=id(),fin=id(),des=id(),mgr=id();const as=async u=>db.exec(`select set_config('test.user','${u}',false)`);
 await db.exec(`create role authenticated;create role anon;create role service_role;create schema clinic_finance;create schema clinic_reception;
  create table public.admins(id uuid primary key,name text,role text,active boolean default true);
  create function public.my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
  create function public.my_role() returns text language sql stable as $$select role from public.admins where id=public.my_admin_id()$$;
  create function public.is_super() returns boolean language sql stable as $$select coalesce(public.my_role()='super_admin',false)$$;
  create function clinic_finance.allowed(a text) returns boolean language sql stable as $$select coalesce(public.my_role()='accountant',false)$$;
  create table public.patients(id uuid primary key default gen_random_uuid(),patient_code text,full_name text,phone_normalized text);
  create table clinic_reception.providers(id uuid primary key,name text);
  create table clinic_reception.masa_doctor_links(masa_doctor_id int primary key,provider_id uuid,masa_name text);
  create table clinic_reception.masa_bookings(official_booking_id text primary key,masa_doctor_id int,patient_name text,phone text);
  create function public.clinic_reception_fallback_api(p_op text,p_payload jsonb) returns jsonb language sql as $$select jsonb_build_object('ok',true,'op',p_op)$$;`);
 await q("insert into public.admins values($1,'استقبال','reception'),($2,'خدمة','customer_service'),($3,'محاسب','accountant'),($4,'مصمم','designer'),($5,'مدير','general_manager')",[rec,cs,fin,des,mgr]);
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes(n)),'utf8');
 await db.exec(mig('_masa_payments.sql'));await db.exec(mig('_masa_archive_import.sql'));
 const M=mig('_masa_archive_lookup.sql');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const api=(op,p)=>one("select public.clinic_reception_fallback_api($1,$2) r",[op,p]).then(x=>x.r);
 await api('masa_patients_import',{source:'old',items:[
  {masa_patient_id:'10',name:'أحمد محمود',phone:'0100 000 0001',birth_date:'1990-05-05',insurance_name:'تأمين'},
  {masa_patient_id:'11',name:'منى محمود',phone:'01000000001'},
  {masa_patient_id:'12',name:'سارة علي',phone:'01000000002',phone2:'01000000003'}]});
 await api('masa_patients_import',{source:'current',items:[{masa_patient_id:'10',name:'خالد حسن',phone:'01000000009'}]});
 await api('masa_archive_import',{source:'old',items:[
  {official_booking_id:'old:1',appointment_date:'2025-01-02',appointment_time:'00:00',status:'active',booking_state_id:2,patient_name:'احمد محمود',phone:'01000000001',masa_doctor_id:5},
  {official_booking_id:'old:2',appointment_date:'2025-03-02',appointment_time:'10:00',status:'cancelled',booking_state_id:4,patient_name:'منى محمود',phone:'01000000001'},
  {official_booking_id:'old:3',appointment_date:'2025-04-02',status:'active',booking_state_id:7,patient_name:'احمد محمود',phone:'+201000000001'}]});
 await api('masa_payments_import',{date:'2025-01-02',payment_types:[{id:147,name:'نقدي',is_cash:true}],
  invoices:[{masa_invoice_id:'old:77',invoice_at:'2025-01-02T10:00:00',net_amount:500,paid_amount:500,is_paid:true,patient:{masa_patient_id:'10',name:'أحمد محمود'}},
            {masa_invoice_id:'77',invoice_at:'2026-01-02T10:00:00',net_amount:900,patient:{masa_patient_id:'10',name:'خالد حسن'}}],
  receipts:[{masa_receipt_id:'old:9',paid_at:'2025-01-02T10:05:00',lines:[{payment_type_id:147,amount:500}],patient:{masa_patient_id:'10'}}]});
 await q("insert into public.patients(patient_code,full_name,phone_normalized) values('P-2026-000001','احمد محمود','01000000001')");
 const call=(p)=>one("select public.masa_archive_lookup($1) r",[p]).then(x=>x.r);
 // roles
 for(const u of [des]){await as(u);await assert.rejects(()=>call({action:'search',q:'احمد'}),/أرشيف ماسا لموظفي/);}
 for(const u of [rec,cs,fin,mgr]){await as(u);assert.equal((await call({action:'search',q:'0100 000 0001'})).ok,true);}
 await as(rec);
 // search by phone (+20 form), by name (Arabic normalisation, token order), source filter, short query refused
 let r=await call({action:'search',q:'+20 100 000 0001'});assert.deepEqual(r.results.map(x=>x.masa_patient_id).sort(),['10','11']);
 r=await call({action:'search',q:'محمود احمد'});assert.deepEqual(r.results.map(x=>x.masa_patient_id),['10'],'hamza-insensitive, any token order');
 assert.equal(r.results[0].dashboard_patient.patient_code,'P-2026-000001');assert.equal(r.results[0].age>30,true);
 r=await call({action:'search',q:'01000000003'});assert.equal(r.results[0].masa_patient_id,'12','phone2 matches');
 r=await call({action:'search',q:'01000000009',source:'old'});assert.equal(r.results.length,0);
 await assert.rejects(()=>call({action:'search',q:'ا'}),/3 حروف/);await assert.rejects(()=>call({action:'search',q:'x',source:'zzz'}),/المصدر/);
 // open: same ids in two sources stay apart; bookings by phone+name; family phone counted not mixed; invoices/receipts by source prefix
 r=await call({action:'open',source:'old',masa_patient_id:'10'});
 assert.equal(r.patient.name,'أحمد محمود');assert.equal(r.bookings.length,2);assert.deepEqual(r.bookings.map(b=>b.state).sort(),['حضور','عدم الرد'].sort());
 assert.equal(r.bookings.some(b=>b.state==='حضور'),true);assert.equal(r.bookings.find(b=>b.official_booking_id==='old:1').time,null,'00:00 = day only');
 assert.equal(r.same_phone_other_name,1,'منى on the same phone is counted, not shown');
 assert.equal(r.invoices.length,1);assert.equal(r.invoices[0].id,'old:77');assert.equal(r.receipts.length,1);assert.equal(Number(r.receipts[0].amount),500);assert.equal(r.receipts[0].methods,'نقدي');
 assert.equal(r.patient.dashboard_patient.patient_code,'P-2026-000001');assert.equal(r.booking_states['حضور'],1);
 r=await call({action:'open',source:'current',masa_patient_id:'10'});assert.equal(r.patient.name,'خالد حسن');assert.equal(r.invoices.length,1);assert.equal(r.invoices[0].id,'77');assert.equal(r.receipts.length,0);assert.equal(r.bookings.length,0);
 assert.equal((await call({action:'open',source:'old',masa_patient_id:'999'})).error,'not_found');
 await assert.rejects(()=>call({action:'nope'}),/search أو open/);
 // audit: searched text is never stored; bulk guard
 const lg=await one("select count(*)::int n, count(*) filter (where query_kind is not null)::int k from clinic_reception.masa_archive_lookup_log where admin_id=$1",[rec]);assert.equal(lg.n,7,'5 searches + 2 opens logged; refused or not-found calls are not');assert.equal(lg.k,5);
 assert.equal((await one("select count(*)::int n from information_schema.columns where table_name='masa_archive_lookup_log' and column_name in ('q','query','text')")).n,0);
 await q("insert into clinic_reception.masa_archive_lookup_log(admin_id,action) select $1,'search' from generate_series(1,120)",[rec]);
 await assert.rejects(()=>call({action:'search',q:'احمد محمود'}),/استنى شوية/);
 await assert.rejects(()=>db.exec("set role authenticated;select * from clinic_reception.masa_archive_lookup_log"),/permission denied/);
 console.log('masa archive lookup ok');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
