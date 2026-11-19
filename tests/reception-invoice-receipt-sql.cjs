// Receipt number on every reception payment, mandatory proof photo + transaction number for non-cash on live,
// ONE invoice number per visit assigned at first print (20261119030000).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const b=await boot([]);const {db,as,owner,call,id}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table if not exists storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;`);
  const M=mig('20261119030000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const year=new Date().getFullYear();
  const mk=async mode=>{const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values($1,$1,$2) returning id",[mode,id(mode==='live'?1:2)]))[0].id;
   await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)",[ws,id(4),['book','collect','view']]);return ws;};
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  const live=await mk('live'),trial=await mk('trial');
  const pat=async ws=>(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F-'||substr(md5(random()::text),1,6),'مريض تجربة','0100',$2) returning id",[ws,id(1)]))[0].id;
  const pL=await pat(live),pT=await pat(trial);
  const pay=(ws,p,method,amount,ref)=>owner("insert into clinic_reception.payments(workspace_id,patient_id,method,amount,reference,created_by) values($1,$2,$3,$4,$5,$6) returning id,receipt_no,proof_path",[ws,p,method,amount,ref,id(4)]).then(r=>r[0]);
  // cash: numbered, no proof needed
  let r1=await pay(live,pL,'cash',100,'RC-x');assert.equal(r1.receipt_no,`RC-${year}-000001`);assert.equal(r1.proof_path,null);
  let r2=await pay(live,pL,'cash',50,'RC-y');assert.equal(r2.receipt_no,`RC-${year}-000002`,'sequential');
  // trial has its own series
  let t1=await pay(trial,pT,'pos',70,'TX1');assert.equal(t1.receipt_no,`T-RC-${year}-000001`);assert.equal(t1.proof_path,null,'trial does not force the photo');
  // live card without photo → refused
  await assert.rejects(()=>pay(live,pL,'pos',300,'778899'),/ارفع صورة إيصال الماكينة/);
  // register the photo (own folder only) then the same payment passes and is linked
  await as(4);
  await assert.rejects(()=>call('clinic_reception_payment_proof',[live,'778899',`${live}/${id(1)}/a.jpg`]),/مسار الصورة غير صحيح/);
  await assert.rejects(()=>call('clinic_reception_payment_proof',[live,'7',`${live}/${id(4)}/a.jpg`]),/اكتب رقم العملية/);
  const path=`${live}/${id(4)}/slip-1.jpg`;await call('clinic_reception_payment_proof',[live,'778899',path]);
  assert.equal(await call('payment_proof_allowed',[path,true]),true);assert.equal(await call('payment_proof_allowed',[`${live}/${id(1)}/z.jpg`,true]),false,'cannot upload into another cashier folder');
  let r3=await pay(live,pL,'pos',300,' 778899 ');assert.equal(r3.receipt_no,`RC-${year}-000003`);assert.equal(r3.proof_path,path);
  assert.equal((await owner("select payment_id from clinic_reception.payment_proofs where path=$1",[path]))[0].payment_id,r3.id,'proof consumed');
  await assert.rejects(()=>pay(live,pL,'pos',300,'778899'),/ارفع صورة/,'one photo serves one payment only');
  // InstaPay too
  await as(4);await call('clinic_reception_payment_proof',[live,'IP-5566',`${live}/${id(4)}/ip.png`]);let r4=await pay(live,pL,'instapay',200,'IP-5566');assert.equal(r4.proof_path,`${live}/${id(4)}/ip.png`);
  // invoice print: one number per visit, assigned once
  const prov=(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. إلهام','DOC-E','الأطفال','حدائق الأهرام') returning id",[live]))[0].id;
  const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'PED','كشف أطفال','الأطفال',600,15) returning id",[live]))[0].id;
  const app=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now(),now()+interval '15 min','arrived',$5) returning id",[live,pL,prov,svc,id(1)]))[0].id;
  const visit=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[live,app,pL,id(1)]))[0].id;
  await as(4);await assert.rejects(()=>call('clinic_reception_invoice_print',[live,visit]),/مفيش خدمات متنفذة/);
  const order=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,600,10,'{\"department\":\"الأطفال\"}',$5) returning id",[live,visit,svc,prov,id(1)]))[0].id;
  const inv=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',540,'كشف أطفال') returning id",[live,pL,visit,order]))[0].id;
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,payment_id,source,amount) values($1,$2,$3,'payment',300),($1,$2,$4,'payment',100)",[live,inv,r3.id,r1.id]);
  await as(4);let p=await call('clinic_reception_invoice_print',[live,visit]);
  assert.equal(p.invoice_no,`INV-${year}-000001`);assert.equal(p.patient.name,'مريض تجربة');
  assert.equal(p.lines.length,1);assert.equal(Number(p.lines[0].price),600);assert.equal(Number(p.lines[0].discount),60);assert.equal(Number(p.lines[0].net),540);assert.equal(p.lines[0].doctor,'د. إلهام');
  assert.equal(p.payments.length,2);assert.equal(p.payments[0].receipt_no,`RC-${year}-000001`);assert.equal(p.payments[0].reference,null,'cash reference hidden');
  assert.equal(p.payments[1].reference,'778899');assert.equal(p.payments[1].proof,true);
  assert.equal(Number(p.totals.paid),400);assert.equal(Number(p.totals.net),540);
  p=await call('clinic_reception_invoice_print',[live,visit]);assert.equal(p.invoice_no,`INV-${year}-000001`,'same number on reprint');
  // shared records (patient file / finance) carry the receipt number and the visit link
  await as(1);let sh=await call('clinic_reception_shared_records',['finance',null,null,null,0]);
  const sp=sh.payments.find(x=>x.id===r3.id);assert.equal(sp.receipt_no,`RC-${year}-000003`);assert.equal(sp.has_proof,true);
  const si=sh.invoices.find(x=>x.id===inv);assert.equal(si.visit_id,visit);assert.equal(si.visit_invoice_no,`INV-${year}-000001`);
  // rollback file applies cleanly
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261119030000_reception_invoice_receipt_numbers.rollback.sql','utf8'));
  await pay(live,pL,'pos',10,'zz');await as(1);sh=await call('clinic_reception_shared_records',['finance',null,null,null,0]);assert(Array.isArray(sh.payments));
  console.log('reception invoice/receipt numbering: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}
})();
