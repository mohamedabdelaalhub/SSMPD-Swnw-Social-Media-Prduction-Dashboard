// «دفعة واحدة لأكتر من زيارة» + «ملاحظة» (20261122160000): ONE payment (one reference, one proof, one receipt number) pays several
// visits of the payer and his family; each visit gets its own allocation and its own posting line; remainder → payer credit 2150;
// same checks as collect (family scope, no package / paid invoices, reference reuse, own shift); idempotent; rollback.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs'),{randomUUID}=require('crypto');
(async()=>{const b=await boot([]);const {db,as,owner,call,id}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table if not exists storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
   create schema if not exists auth; create or replace function auth.uid() returns uuid language sql stable as $f$select public.my_admin_id()$f$;
   create or replace function storage.foldername(n text) returns text[] language sql immutable as $f$select string_to_array(n,'/')$f$;`);
  for(const n of ['20261119030000','20261121180000','20261122110000'])await db.exec(mig(n));
  const M=mig('20261122160000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)",[ws,id(4),['book','collect','view']]);
  const pat=async(name,phone)=>(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F-'||substr(md5(random()::text),1,6),$2,$3,$4) returning id",[ws,name,phone,id(1)]))[0].id;
  const A=await pat('منار','01011112222'),B=await pat('ابن منار','01011112222'),C=await pat('مريض تاني','01099990000');
  const inv=async(p,amount,extra='')=>(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,kind,amount,description) values($1,$2,'service',$3,'كشف') returning id",[ws,p,amount]))[0].id;
  const iA=await inv(A,500),iB=await inv(B,500),iC=await inv(C,300),iA2=await inv(A,200);
  const cmd=(a,p,t=randomUUID())=>call('clinic_reception_command',[ws,a,p,t]);
  const proof=async ref=>{await as(4);await call('clinic_reception_payment_proof',[ws,ref,`${ws}/${id(4)}/${ref}.jpg`]);};
  const due=async i=>+(await owner('select clinic_reception.due($1) d',[i]))[0].d;
  await as(4);
  const base={patient_id:A,method:'wallet',reference:'W-7788',amount:'1000',invoice_ids:[iA,iB],note:'تحويل واحد لزيارتين: منار وابنها'};
  await assert.rejects(()=>cmd('collect_multi',{...base,invoice_ids:[iA]}),/من زيارتين/);
  await assert.rejects(()=>cmd('collect_multi',{...base,invoice_ids:[iA,iA]}),/متكررة/);
  await assert.rejects(()=>cmd('collect_multi',{...base,invoice_ids:[iA,iC]}),/أفراد عيلته/);
  await assert.rejects(()=>cmd('collect_multi',base),/ارفع صورة/,'live wallet still needs the proof');
  await proof('W-7788');
  const k=randomUUID();const r=await cmd('collect_multi',base,k);
  assert.equal(r.lines.length,2);assert.equal(+r.credit,0);assert.match(r.receipt_no,/^RC-/);
  assert.deepEqual(JSON.parse(JSON.stringify(await cmd('collect_multi',base,k))),JSON.parse(JSON.stringify(r)),'same token replays');
  await assert.rejects(()=>cmd('collect_multi',{...base,amount:'999'},k),/مرتبط بدفعة تانية/);
  const pays=await owner("select * from clinic_reception.payments where workspace_id=$1",[ws]);
  assert.equal(pays.length,1,'ONE payment row');assert.equal(pays[0].reference,'W-7788');assert.equal(pays[0].note,base.note);assert(pays[0].proof_path,'proof attached once');
  assert.equal(await due(iA),0);assert.equal(await due(iB),0);
  const al=await owner("select invoice_id,amount from clinic_reception.allocations where payment_id=$1 order by amount",[pays[0].id]);assert.equal(al.length,2);
  const j=await owner("select j.source,j.dimensions,l.account,l.debit,l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.dimensions->>'payment_id'=$1 order by j.dimensions->>'patient_id',l.debit desc",[pays[0].id]);
  assert.equal(j.length,4,'two posting entries, two lines each');
  for(const x of j)assert.equal(x.source,'invoice_payment_multi');
  assert.deepEqual(j.filter(x=>+x.debit>0).map(x=>x.account+':'+(+x.debit)),['1115:500','1115:500']);
  assert.deepEqual(new Set(j.map(x=>x.dimensions.patient_id)),new Set([A,B]),'each line carries its own visit patient');
  const fe=+(await owner("select count(*) n from clinic_finance.entries where source='reception_invoice_payment_multi'"))[0].n;assert.equal(fe,2,'mirrored into finance');
  // the same reference is refused again (single or multi)
  await proof('W-7788');await assert.rejects(()=>cmd('collect',{patient_id:A,method:'wallet',reference:'W-7788',amount:'200',invoice_id:iA2}),/مستخدم بالفعل/);
  // paid invoice refused; remainder → payer credit
  await assert.rejects(()=>cmd('collect_multi',{...base,reference:'W-9',invoice_ids:[iA,iA2]}),/مدفوعة بالكامل/);
  const iB2=await inv(B,100);await proof('W-10');
  const r2=await cmd('collect_multi',{patient_id:A,method:'wallet',reference:'W-10',amount:'350',invoice_ids:[iA2,iB2]});
  assert.equal(+r2.credit,50);assert.equal(await due(iA2),0);assert.equal(await due(iB2),0);
  assert.equal(+(await owner("select credit_amount from clinic_reception.payments where id=$1",[r2.id]))[0].credit_amount,50);
  // less than the total: applied in order, rest stays due
  const iA3=await inv(A,300),iB3=await inv(B,300);await proof('W-11');
  const r3=await cmd('collect_multi',{patient_id:A,method:'wallet',reference:'W-11',amount:'400',invoice_ids:[iA3,iB3]});
  assert.equal(await due(iA3),0);assert.equal(await due(iB3),200);assert.equal(+r3.credit,0);
  // package invoices refused
  await db.exec('reset role');await db.exec("set session_replication_role=replica");
  const pk=(await db.query("insert into clinic_reception.packages(workspace_id,patient_id,template_id,name,contract_price,visits,expires_on,terms,created_by) values($1,$2,gen_random_uuid(),'باكج',1000,5,'2030-01-01','-',$3) returning id",[ws,A,id(1)])).rows[0];
  await db.exec("set session_replication_role=origin");await as(4);
  assert(pk,'package fixture');if(pk){const ip=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,package_id,kind,amount,description) values($1,$2,$3,'installment',100,'قسط') returning id",[ws,A,pk.id]))[0].id;
   await assert.rejects(()=>cmd('collect_multi',{...base,reference:'W-12',invoice_ids:[iB3,ip]}),/الباكج/);}
  // cash needs the cashier's own open shift
  const iA5=await inv(A,50);await assert.rejects(()=>cmd('collect_multi',{patient_id:A,method:'cash',reference:'C-1',amount:'200',invoice_ids:[iB3,iA5]}),/وردية مفتوحة/);
  // note on a single collect
  const iA4=await inv(A,80);await proof('W-13');const s1=await cmd('collect',{patient_id:A,method:'wallet',reference:'W-13',amount:'80',invoice_id:iA4,note:'  دفع عن طريق أخوه  '});
  assert.equal((await owner("select note from clinic_reception.payments where id=$1",[s1.id]))[0].note,'دفع عن طريق أخوه');
  // a no-access user is refused
  await as(3);await assert.rejects(()=>cmd('collect_multi',{...base,reference:'W-14'}));
  // rollback
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122160000_reception_collect_multi.rollback.sql','utf8'));
  assert.equal((await owner("select to_regprocedure('clinic_reception.collect_multi(uuid,jsonb,uuid)') r"))[0].r,null);
  assert.equal((await owner("select to_regprocedure('clinic_reception.command_before_collect_multi(uuid,text,jsonb,uuid)') r"))[0].r,null);
  assert.equal(+(await owner("select count(*) n from clinic_reception.payments where workspace_id=$1",[ws]))[0].n,4,'history kept');
  console.log('PASS collect multi: one payment/reference/proof/receipt for several family visits, one posting line per visit (own patient), remainder → payer credit, partial in order, family / paid / package / reference / shift / access checks, idempotent, note on collect, rollback.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
