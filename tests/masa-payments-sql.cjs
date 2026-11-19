// Owner 2026-11-19: Masa collections copied for finance (never posted to shifts/balances); patient data kept; finance-only report.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0],id=()=>randomUUID();
 const fin=id(),rec=id(),dina=id(),prov=id();
 const as=async u=>db.exec(`select set_config('test.user','${u}',false)`);
 try{await db.exec(`create role authenticated;create role anon;create role service_role;create schema clinic_finance;create schema clinic_reception;
  create table admins(id uuid primary key,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
  create function clinic_finance.allowed(a text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role='accountant')$$;
  create table clinic_reception.providers(id uuid primary key,name text);
  create table clinic_reception.masa_doctor_links(masa_doctor_id int primary key,provider_id uuid,masa_name text);
  create table clinic_reception.masa_bookings(official_booking_id text primary key,masa_doctor_id int,patient_name text,phone text);
  create function clinic_reception_fallback_api(p_op text,p_payload jsonb) returns jsonb language sql as $$select jsonb_build_object('ok',true,'op',p_op)$$;`);
  await q("insert into admins values($1,'محاسب','accountant'),($2,'استقبال','reception'),($3,'دينا','reception')",[fin,rec,dina]);
  await q("insert into clinic_reception.providers values($1,'أخصائي جلدية')",[prov]);await q("insert into clinic_reception.masa_doctor_links values(1130,$1,'د.جلدية')",[prov]);
  await q("insert into clinic_reception.masa_bookings values('5001',1130,'مريض من الحجز','01000000001')");
  const M=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_masa_payments.sql')),'utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const api=(op,p)=>one("select clinic_reception_fallback_api($1,$2) r",[op,p]).then(x=>x.r);
  const day={date:'2026-11-19',generated_at:'2026-11-19T22:00:00Z',
   payment_types:[{id:147,name:'نقدي',is_cash:true},{id:148,name:'فيزا'},{id:150,name:'انستا باى'},{id:151,name:'فودافون كاش'}],
   invoices:[{masa_invoice_id:'77',invoice_no:'I-77',invoice_at:'2026-11-19T10:40:00',official_booking_id:'5001',masa_doctor_id:1130,net_amount:500,paid_amount:500,is_paid:true,is_deleted:false,is_insured:true,insurance_id:3,insurance_name:'شركة تأمين تجريبية',cashier_user_id:4,patient:{masa_patient_id:'P9',name:'مريض الفاتورة',phone:'01000000002',gender:'male',birth_date:'1990-01-01'}}],
   receipts:[
    {masa_receipt_id:'9',receipt_no:'R-9',paid_at:'2026-11-19T10:42:00',total_paid:500,official_booking_id:'5001',masa_invoice_id:'77',cashier_user_id:4,is_deleted:false,lines:[{payment_type_id:147,amount:300,safe_id:1},{payment_type_id:150,amount:200,safe_id:1}]},
    {masa_receipt_id:'10',receipt_no:'R-10',paid_at:'2026-11-19T12:00:00',total_paid:350,official_booking_id:null,cashier_user_id:12,is_deleted:false,patient:{name:'مريض مباشر',phone:'01000000003',age_at_payment:41},lines:[{payment_type_id:148,amount:350,safe_id:3}]},
    {masa_receipt_id:'11',receipt_no:'R-11',paid_at:'2026-11-19T12:31:00',total_paid:400,official_booking_id:'unknown-id',cashier_user_id:4,is_deleted:false,lines:[{payment_type_id:147,amount:400}]},
    {masa_receipt_id:'',lines:[]}]};
  let r=await api('masa_payments_import',day);assert.deepEqual(r,{ok:true,receipts_upserted:3,invoices_upserted:1,skipped:1});
  // idempotent; lines replaced as a set; void is an update; missing receipt left alone
  day.receipts[0].lines=[{payment_type_id:147,amount:500,safe_id:1}];day.receipts[2].is_deleted=true;day.receipts.splice(1,1);
  r=await api('masa_payments_import',day);assert.equal(r.receipts_upserted,2);
  assert.equal((await one("select count(*)::int n from clinic_finance.masa_receipt_lines where masa_receipt_id='9'")).n,1);
  assert.equal((await one("select is_deleted from clinic_finance.masa_receipts where masa_receipt_id='11'")).is_deleted,true);
  assert.equal((await one("select count(*)::int n from clinic_finance.masa_receipts")).n,3,'R-10 kept although missing');
  // Cairo local time → right day, patient kept, no raw national id column
  assert.equal((await one("select day::text d from clinic_finance.masa_receipts where masa_receipt_id='9'")).d,'2026-11-19');
  assert.equal((await one("select patient_name from clinic_finance.masa_invoices where masa_invoice_id='77'")).patient_name,'مريض الفاتورة');
  assert.equal((await one("select count(*)::int n from information_schema.columns where table_schema='clinic_finance' and column_name ilike '%national%'")).n,0);
  // errors
  assert.equal((await api('masa_payments_import',{})).error,'date_required');
  assert.equal((await api('masa_payments_import',{date:'2026-11-19',receipts:{}})).error,'arrays_required');
  assert.equal((await api('slots',{})).op,'slots','other ops pass through');
  // finance report
  await as(rec);await assert.rejects(()=>q("select clinic_finance_masa_payments('list','{}')"),/للمالية بس/);
  await as(fin);
  let rep=(await one("select clinic_finance_masa_payments('list',$1) r",[{from:'2026-11-19',to:'2026-11-19'}])).r;
  assert.equal(Number(rep.totals.all),850);assert.equal(Number(rep.totals.by_method.cash),500);assert.equal(Number(rep.totals.by_method.card),350);
  assert.equal(rep.receipts.length,2,'voided hidden by default');
  const r9=rep.receipts.find(x=>x.id==='9');assert.equal(r9.doctor,'أخصائي جلدية');assert.equal(r9.patient,'مريض من الحجز');assert.equal(r9.insured,true);assert.equal(r9.insurance,'شركة تأمين تجريبية');
  assert.equal(rep.receipts.find(x=>x.id==='10').patient,'مريض مباشر');assert.equal(rep.receipts.find(x=>x.id==='10').cashier,'مستخدم ماسا #12');
  assert.ok(rep.by_doctor.some(x=>x.doctor==='بدون حجز مربوط'));
  rep=(await one("select clinic_finance_masa_payments('list',$1) r",[{from:'2026-11-19',include_deleted:true}])).r;assert.equal(rep.receipts.length,3);
  rep=(await one("select clinic_finance_masa_payments('list',$1) r",[{from:'2026-11-19',method:'card'}])).r;assert.deepEqual(rep.receipts.map(x=>x.id),['10']);
  // naming
  await one("select clinic_finance_masa_payments('name_cashier',$1)",[{cashier_user_id:12,admin_id:dina}]);
  await one("select clinic_finance_masa_payments('name_safe',$1)",[{safe_id:3,label:'خزنة الاستقبال ٢'}]);
  rep=(await one("select clinic_finance_masa_payments('list',$1) r",[{from:'2026-11-19'}])).r;
  const c12=rep.by_cashier.find(x=>x.cashier_user_id===12);assert.equal(c12.name,'دينا');assert.equal(c12.safe,'خزنة الاستقبال ٢');
  await as(rec);await assert.rejects(()=>q("select clinic_finance_masa_payments('name_safe',$1)",[{safe_id:3,label:'x y'}]),/للمالية بس/);
  // never posted to finance: no table outside the masa_* set was touched (nothing else exists in this fixture to be posted to)
  assert.equal((await one("select has_table_privilege('authenticated','clinic_finance.masa_receipts','select') x")).x,false);
  await db.exec(fs.readFileSync('supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_masa_payments.')),'utf8'));
  assert.equal((await api('slots',{})).op,'slots');assert.equal((await one("select to_regclass('clinic_finance.masa_receipts') r")).r,null);
  console.log('masa payments: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
