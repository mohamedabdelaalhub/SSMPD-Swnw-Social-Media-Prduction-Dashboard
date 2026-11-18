// Fix «صرف الحساب» for reception-collected visits (fees live only in the reception journal) + referral share → referring doctor's account.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const b=await boot(['reception_canonical_catalog']);const {db,as,fin,owner,call,id,key}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  if(!(await db.query("select to_regprocedure('clinic_finance.group_snapshot_base(date,date,integer)') r")).rows[0].r)
   await db.exec('alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance; alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base; create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select clinic_finance.group_snapshot_base(p_from,p_to,p_offset) $$; grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;');
  for(const n of ['20261018005957','20261108130000','20261108230000','20261108231000','20261108250000','20261108260000_doctor_payout','20261108280000','20261109100000'])await db.exec(mig(n));
  await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table if not exists storage.objects(bucket_id text,name text); create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;`);
  await db.exec(mig('20261117230000'));
  // live order_ext as captured from production (referral commission per order)
  await db.exec(`create table if not exists clinic_reception.order_ext(order_id uuid primary key references clinic_reception.orders(id) on delete cascade,kind text not null,mode text not null default 'internal',billing_party text not null default 'center',referring_doctor_key text,performing_doctor_key text,external_provider_id uuid,status text not null default 'referred',status_at timestamptz not null default now(),report_file_ref text,priced jsonb,created_at timestamptz not null default now())`);
  const M=mig('20261119010000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  const prov=async(n,k)=>(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,$2,$3,'الأشعة','حدائق الأهرام') returning id",[ws,n,k]))[0].id;
  const pR=await prov('د. أشعة','DOC-R'),pE=await prov('د. إلهام','DOC-E');
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)",[ws,id(4),['book']]);
  const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F1','مريض','0100',$2) returning id",[ws,id(1)]))[0].id;
  const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'XR','أشعة صدر','الأشعة',1000,15) returning id",[ws]).catch(async()=> (await owner("select id from clinic_reception.services where workspace_id=$1 limit 1",[ws]))))[0].id;
  const app=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now(),now()+interval '15 min','arrived',$5) returning id",[ws,pat,pR,svc,id(1)]))[0].id;
  const visit=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,app,pat,id(1)]))[0].id;
  const order=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,1000,10,'{}',$5) returning id",[ws,visit,svc,pR,id(1)]))[0].id;
  await owner("insert into clinic_reception.order_ext(order_id,kind,referring_doctor_key,priced) values($1,'radiology','DOC-E',$2)",[order,{net:900,referral_rate:10,referral_commission:90}]);
  // what 'execute' does: invoice + doctor_fee (executor 30% = 270), then the order is completed → referral trigger
  const inv=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',900,'أشعة صدر') returning id,invoice_no",[ws,pat,visit,order]))[0];
  await as(1);await db.exec('reset role');await db.query("select clinic_reception.post($1,'doctor_fee',$2,'استحقاق طبيب لخدمة منفذة','5111','2120',270,$3)",[ws,order,{patient_id:pat,visit_id:visit,order_id:order,provider_id:pR,invoice_id:inv.id}]);
  await db.exec('reset role');await owner("update clinic_reception.orders set status='completed' where id=$1",[order]);await owner("update clinic_reception.orders set status='completed' where id=$1",[order]);
  const rf=await owner("select count(*)::int n,sum(l.credit)::numeric c from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.account='2120' where j.source='referral_fee' and j.source_id=$1",[order]);
  assert.equal(rf[0].n,1,'posted once');assert.equal(Number(rf[0].c),90,'10% of 900 after discount');
  assert.equal(Number((await owner("select clinic_finance.doctor_balance('DOC-E') b"))[0].b),90,'referring doctor balance');
  // unpaid → held, not payable
  let held=await owner("select clinic_finance.desk_held('DOC-E') h, (select count(*)::int from clinic_finance.desk_payable('DOC-E')) n");assert.equal(Number(held[0].h),90);assert.equal(held[0].n,0);
  // patient pays in full → payable for both doctors
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values($1,$2,'payment',900)",[ws,inv.id]);
  let pe=await owner("select * from clinic_finance.desk_payable('DOC-E')");assert.equal(pe.length,1);assert.equal(Number(pe[0].fee),90);assert.equal(pe[0].src,'reception');assert.equal(pe[0].reference,'RX-'+inv.invoice_no);
  assert.equal(Number((await owner("select sum(fee) f from clinic_finance.desk_payable('DOC-R')"))[0].f),270,'executing doctor fee now payable at the desk');
  // desk request uses reception lines; approve posts; then nothing left
  const freg=(await owner("insert into clinic_finance.registers(name,petty_limit,created_by) values('خزينة الاستقبال',100000,$1) returning id",[id(1)]))[0].id;
  const fsh=(await owner("insert into clinic_finance.shifts(register_id,cashier_id,token,opening_book) values($1,$2,gen_random_uuid(),0) returning id",[freg,id(4)]))[0].id;
  await as(4);await db.exec('reset role');await db.query("select clinic_finance.post('fund',gen_random_uuid(),'تغذية',$1,'1111','1112',1000)",[fsh]);
  const rreg=(await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'r','both') returning id",[ws]))[0].id;
  await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,finance_shift_id) values($1,$2,$3,'open',$4)",[ws,rreg,id(4),fsh]);
  const c2=(a,p,k)=>call('clinic_reception_doctor_payout',[a,Object.assign({workspace_id:ws},p||{}),k===undefined?key():k]);
  await as(4);let d=await c2('detail',{provider_id:pE});assert.equal(Number(d.payable),90);assert.equal(d.state,'ready');
  let q=await c2('request',{provider_id:pE});assert.equal(Number(q.gross),90);assert.equal(q.invoices.length,1);assert.equal(q.invoices[0].reference,'RX-'+inv.invoice_no);
  assert.equal((await owner("select count(*)::int n from clinic_finance.desk_payout_rx where payout_id=$1",[q.id]))[0].n,1);
  d=await c2('detail',{provider_id:pE});assert.equal(Number(d.payable),0,'pending payout reserves the line');
  await as(3);q=await c2('approve',{id:q.id});assert.equal(q.status,'approved');
  assert.equal(Number((await owner("select clinic_finance.doctor_balance('DOC-E') b"))[0].b),0,'paid out');
  await as(4);assert.equal(Number((await c2('detail',{provider_id:pE})).payable),0);
  // ---- review fixes ----
  await db.exec('reset role');
  let slot=0;const mkOrder=async(prov,ref,perf,comm,price)=>{slot++;const ap=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()+make_interval(hours=>$6::int),now()+make_interval(hours=>$6::int)+interval '15 min','arrived',$5) returning id",[ws,pat,prov,svc,id(1),slot]))[0].id;
    const vi=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,ap,pat,id(1)]))[0].id;
    const o=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,$5,0,'{}',$6) returning id",[ws,vi,svc,prov,price,id(1)]))[0].id;
    await owner("insert into clinic_reception.order_ext(order_id,kind,referring_doctor_key,performing_doctor_key,priced) values($1,'radiology',$2,$3,$4)",[o,ref,perf,comm]);
    const iv=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',$5,'خدمة') returning id",[ws,pat,vi,o,price]))[0].id;
    return {o,iv};};
  const refSum=async o=>Number((await owner("select coalesce(sum(l.credit-l.debit),0) s from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.account='2120' where j.source like 'referral%' and j.source_id=$1",[o]))[0].s);
  // self-referral earns nothing
  let x=await mkOrder(pR,'DOC-R',null,{referral_commission:50},500);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);assert.equal(await refSum(x.o),0,'self referral skipped');
  // missing provider → kept, then posted when the provider appears
  x=await mkOrder(pR,'DOC-NEW',null,{referral_commission:40},400);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);
  assert.equal((await owner("select reason from clinic_reception.referral_issues where order_id=$1 and resolved_at is null",[x.o]))[0].reason,'missing_provider');
  await prov('د. جديد','DOC-NEW');assert.equal(await refSum(x.o),40,'posted when the provider appears');
  assert((await owner("select resolved_at from clinic_reception.referral_issues where order_id=$1",[x.o]))[0].resolved_at,'issue resolved');
  // bad data never blocks completing the order
  x=await mkOrder(pR,'DOC-E',null,{referral_commission:'abc'},300);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);
  assert.equal((await owner("select status from clinic_reception.orders where id=$1",[x.o]))[0].status,'completed');assert.equal((await owner("select reason from clinic_reception.referral_issues where order_id=$1",[x.o]))[0].reason,'error');
  // a credit note on half the invoice reverses half the referral, and comes back if the note is removed
  x=await mkOrder(pR,'DOC-E',null,{referral_commission:100},1000);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);assert.equal(await refSum(x.o),100);
  await owner("update clinic_reception.invoices set credit_amount=500 where id=$1",[x.iv]);assert.equal(await refSum(x.o),50,'credit note halves the referral');
  await owner("update clinic_reception.invoices set credit_amount=0 where id=$1",[x.iv]);assert.equal(await refSum(x.o),100,'restored');
  // accounting already paid part of the balance outside the desk → the desk offers no more than the balance
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values($1,$2,'payment',1000)",[ws,x.iv]);
  const before=Number((await owner("select coalesce(sum(fee),0) f from clinic_finance.desk_payable('DOC-E')"))[0].f);assert.equal(before,100);
  await owner("insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token,status) values('DOC-E',70,0,'cash','ACC-1',current_date,current_date,'{}',$1,gen_random_uuid(),'approved')",[id(3)]);
  assert.equal(Number((await owner("select coalesce(sum(fee),0) f from clinic_finance.desk_payable('DOC-E')"))[0].f),30,'capped by the remaining balance');
  // the approver can lower a reception-only payout (cap counts reception lines)
  await as(4);let q2=await c2('request',{provider_id:pE});assert.equal(Number(q2.gross),30);await as(3);q2=await c2('approve',{id:q2.id,gross:20,note:'متفق على 20'});assert.equal(Number(q2.gross),20);
  await db.exec('reset role');const RB=fs.readFileSync('supabase/rollbacks/20261119010000_desk_payout_reception_fees_referrals.rollback.sql','utf8');
  await assert.rejects(()=>db.exec(RB),/مينفعش الرجوع/,'rollback refuses after reception lines were paid');await db.exec('rollback');
  console.log('PASS desk + reception fees/referrals: referral posted once on execution (10% after discount), held until the invoice is paid, then payable at «صرف الحساب» for the referring and executing doctor, request/approve with reception lines, balance closes; self-referral skipped, missing provider retried, bad data logged without blocking, credit note reverses/restores, accounting payouts cap the desk, approver adjust on reception lines.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
