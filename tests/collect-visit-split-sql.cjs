// Owner 2026-11-28 «موافق على تصليح التحصيل» (collect-visit.js): «حصّل» on a visit with FIVE open invoices saves through the REAL
// collect_multi as a reception member: one payment, five allocations in order, no credit; and 2 of 3 ticked + more money → the extra
// becomes patient credit while the 3rd invoice stays open (the case the screen now warns about). PGlite, real server functions.
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
  const V=[];for(const a of [400,600,400,250,150])V.push(await inv(A,a));
  await as(4);await proof('V-5');
  const r=await cmd('collect_multi',{patient_id:A,method:'wallet',reference:'V-5',amount:'1800',invoice_ids:V,note:''});
  assert.equal(r.lines.length,5,'five allocations');assert.equal(+r.credit,0);assert.match(r.receipt_no,/^RC-/);
  for(const i of V)assert.equal(await due(i),0,'every visit invoice settled');
  const pay=(await owner("select * from clinic_reception.payments where workspace_id=$1 and reference='V-5'",[ws]))[0];assert.equal(+pay.amount,1800);
  assert.equal((await owner("select count(*)::int n from clinic_reception.allocations where payment_id=$1",[pay.id]))[0].n,5);
  // 2 of 3 + extra → credit
  const W=[];for(let n=0;n<3;n++)W.push(await inv(B,350));await as(4);await proof('V-6');
  const r2=await cmd('collect_multi',{patient_id:B,method:'wallet',reference:'V-6',amount:'1000',invoice_ids:W.slice(0,2),note:''});
  assert.equal(+r2.credit,300,'extra → patient credit');assert.equal(await due(W[2]),350,'the unticked invoice stays open');
  const unb=await owner('select entry_id from clinic_reception.journal_lines group by entry_id having sum(debit-credit)<>0');assert.equal(unb.length,0);
  console.log('PASS collect_multi for «حصّل»: five invoices of one visit = one receipt, five allocations, no credit; 2 of 3 + extra → credit, 3rd stays open.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
