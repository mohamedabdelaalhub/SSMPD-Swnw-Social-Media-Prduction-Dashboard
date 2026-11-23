// (base: tests/collect-multi-one-payer-sql.cjs → 20261122390000 multi-payment note) «دفعة واحدة لأكتر من زيارة» + «ملاحظة» (20261122160000): ONE payment (one reference, one proof, one receipt number) pays several
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
  // ---- 20261122380000: one payer for other (non-family) patients' visits ----
  await db.exec('reset role');
  // the real reviewer inbox (20261122250000) with the finance side stubbed off, so the 380000 anchor is checked on the real body
  await db.exec("create schema if not exists clinic_finance; do $s$ begin if to_regprocedure('clinic_finance.allowed(text)') is null then create function clinic_finance.allowed(p_action text) returns boolean language sql as 'select false'; end if; if to_regprocedure('clinic_finance.desk_approver()') is null then create function clinic_finance.desk_approver() returns boolean language sql as 'select false'; end if; end $s$");
  await db.exec(fs.readFileSync('supabase/migrations/20261122250000_review_inbox.sql','utf8'));
  const M38=fs.readFileSync('supabase/migrations/20261122380000_collect_multi_one_payer.sql','utf8');
  await db.exec(M38);await assert.rejects(()=>db.exec(M38),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3) on conflict (workspace_id,admin_id) do update set capabilities=excluded.capabilities",[ws,id(2),['view','review','collect']]);
  const Y=await pat('يحيى تجريبي','01022223333'),Mh=await pat('محمود تجريبي','01044445555');
  const iY=await inv(Y,500),iM=await inv(Mh,500);await as(4);await proof('IP-900');
  // without one_payer: still refused (not family)
  await assert.rejects(()=>cmd('collect_multi',{patient_id:Y,method:'instapay',reference:'IP-900',amount:'1000',invoice_ids:[iY,iM],note:'تحويل واحد'}),/أفراد عيلته/);
  // one_payer needs a note of at least 5 letters
  await assert.rejects(()=>cmd('collect_multi',{patient_id:Y,method:'instapay',reference:'IP-900',amount:'1000',invoice_ids:[iY,iM],one_payer:true}),/مين دفع عن مين/);
  const rc=await cmd('collect_multi',{patient_id:Y,method:'instapay',reference:'IP-900',amount:'1000',invoice_ids:[iY,iM],one_payer:true,note:'يحيى دفع التحويل كله عن نفسه وعن صاحبه محمود'});
  assert.equal(await due(iY),0);assert.equal(await due(iM),0);assert.equal(rc.lines.length,2);
  const py=(await owner("select * from clinic_reception.payments where id=$1",[rc.id]))[0];assert.equal(py.cross_patient,true);assert.equal(py.reference,'IP-900');assert.equal(py.patient_id,Y);
  assert.equal((await owner("select count(*)::int n from clinic_reception.payments where reference='IP-900'"))[0].n,1,'one payment row');
  const ln=await owner("select dimensions->>'patient_id' p from clinic_reception.ledger_entries where source='invoice_payment_multi' and dimensions->>'payment_id'=$1 order by 1",[rc.id]).catch(()=>null);
  if(ln)assert.deepEqual(ln.map(x=>x.p).sort(),[Y,Mh].sort(),'each visit posts to its own patient');
  assert.equal((await owner("select count(*)::int n from clinic_reception.audit where action='collect_multi_cross' and entity_id=$1",[rc.id]))[0].n,1);
  // a family-only one_payer payment is NOT flagged
  const iA6=await inv(A,100),iB6=await inv(B,100);await proof('W-60');
  const rf=await cmd('collect_multi',{patient_id:A,method:'wallet',reference:'W-60',amount:'200',invoice_ids:[iA6,iB6],one_payer:true,note:'منار دفعت لابنها'});
  assert.equal((await owner("select cross_patient from clinic_reception.payments where id=$1",[rf.id]))[0].cross_patient,false);
  // reviewer inbox lists it; the collector cannot review; another reviewer can (questioned needs a note)
  await as(2);const ib=await call('clinic_review_inbox',[]);const it=(ib.requests||[]).find(x=>x.source==='rx_cross_payment'&&x.id===rc.id);
  assert(it,'in the reviewer inbox');assert.equal(+it.amount,1000);assert.match(it.reason,/صاحبه محمود/);assert.equal(it.patients.length,2);
  await as(4);await assert.rejects(()=>cmd('cross_payment_review',{id:rc.id,approve:true}),/شخص تاني|review|صلاحية|مش مسموح/);
  await as(2);await assert.rejects(()=>cmd('cross_payment_review',{id:rc.id,approve:false}),/اكتب الملاحظة/);
  assert.equal((await cmd('cross_payment_review',{id:rc.id,approve:true})).status,'ok');
  await assert.rejects(()=>cmd('cross_payment_review',{id:rc.id,approve:true}),/اتراجعت قبل كده/);
  assert(!((await call('clinic_review_inbox',[])).requests||[]).some(x=>x.id===rc.id),'gone after the review');
  await assert.rejects(()=>cmd('cross_payment_review',{id:rf.id,approve:true}),/مش دفعة لأكتر من مريض/);
  // other commands still pass through
  await as(4);const iY2=await inv(Y,70);await proof('W-61');assert((await cmd('collect',{patient_id:Y,method:'wallet',reference:'W-61',amount:'70',invoice_id:iY2})).id);
  // ---- 20261122390000: the note next to multi-visit payments everywhere ----
  await db.exec('reset role');
  try{await db.exec(mig('20261121230000'));}catch(e){if(!/already exists|مش موجودة/.test(e.message))throw e;}
  const M39=mig('20261122390000');
  const dayCairo=(await owner("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d;
  await as(4);const before=await call('clinic_reception_snapshot',[ws,dayCairo,dayCairo]);
  assert(before.allocations.length&&before.allocations.every(a=>a.payment_id===undefined),'bug before: snapshot allocations have no payment_id');
  await db.exec('reset role');await db.exec(M39);await assert.rejects(()=>db.exec(M39),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  // snapshot: allocations now carry payment_id → the receipt can list each visit
  await as(4);const snap=await call('clinic_reception_snapshot',[ws,dayCairo,dayCairo]);
  const al39=snap.allocations.filter(a=>a.payment_id===rc.id);assert.equal(al39.length,2,'two allocations for the one-payer payment');
  const sp=snap.payments.find(x=>x.id===rc.id);assert.equal(sp.note,'يحيى دفع التحويل كله عن نفسه وعن صاحبه محمود');assert.equal(sp.cross_patient,true);
  // patient file / shared records: note + cross flag; allocations already listed
  // archive ids for the two friends (patient context = public patients id)
  const ar=async(rp,code)=>{const pid=(await owner("insert into public.patients(full_name,patient_code) values($1,$2) returning id",['ملف '+code,code]).catch(()=>[{id:null}]))[0].id;if(pid)await owner("update clinic_reception.patients set patient_id=$1 where id=$2",[pid,rp]);return pid;};
  const arY=await ar(Y,'P-2026-900001'),arM=await ar(Mh,'P-2026-900002');
  await db.exec('reset role');const sharedAs=async(ctx,pid)=>{for(const n of [1,2,3]){await as(n);const r=await call('clinic_reception_shared_records',[ctx,pid,null,null,0]).catch(e=>({err:e.message}));if(!r.err)return r;}return null;};
  const shF=await sharedAs('finance',null);console.log('shared finance:',shF?'ok':'no access in harness');
  if(shF){const shp=(shF.payments||[]).find(x=>x.id===rc.id);assert(shp,'payment in finance records');assert.equal(shp.note,'يحيى دفع التحويل كله عن نفسه وعن صاحبه محمود');assert.equal(shp.cross_patient,true);
   assert.deepEqual(shp.allocations.map(a=>a.patient).sort(),['محمود تجريبي','يحيى تجريبي'],'each allocation names its patient');}
  if(arM){const shM=await sharedAs('patient',arM);console.log('shared patient:',shM?'ok':'no access in harness');if(shM)assert((shM.payments||[]).some(x=>x.id===rc.id),'Yahya\'s payment listed in Mahmoud\'s file');}
  await as(4);
  // visit invoice print: note + whole payment + visits covered
  await db.exec('reset role');
  const pR=(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'د. تغذية تجريبي','nut-t','تغذية','حدائق الأهرام') returning id",[ws]))[0].id;
  const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'NUT9','كشف تغذية','تغذية',500,15) returning id",[ws]))[0].id;
  const apM=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now(),now()+interval '15 min','arrived',$5) returning id",[ws,Mh,pR,svc,id(1)]))[0].id;
  const vM=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,apM,Mh,id(1)]))[0].id;
  await owner("update clinic_reception.invoices set visit_id=$1 where id=$2",[vM,iM]);await as(4);
  {const pr=await call('clinic_reception_invoice_print',[ws,vM]);const pp=pr.payments.find(x=>x.receipt_no===sp.receipt_no);
   assert(pp,'payment on the visit invoice');assert.equal(+pp.amount,500);assert.equal(+pp.total,1000);assert.equal(+pp.visits,2);assert.match(pp.note,/صاحبه محمود/);}
  // counts: receipts in scope, how many covered more than one visit, with the note
  const sum=await call('clinic_reception_multi_payments',[{}]);
  const all=(await owner("select count(*)::int n from clinic_reception.payments where workspace_id=$1 and (created_at at time zone 'Africa/Cairo')::date=$2::date",[ws,dayCairo]))[0].n;
  assert.equal(sum.receipts,all,'all of today');assert(sum.multi>=2,'family multi + one-payer multi');
  const row=sum.rows.find(x=>x.id===rc.id);assert(row&&row.visits===2&&row.cross_patient===true&&/صاحبه محمود/.test(row.note));
  assert.deepEqual(row.lines.map(l=>l.patient).sort(),['محمود تجريبي','يحيى تجريبي']);
  const byIds=await call('clinic_reception_multi_payments',[{ids:[rc.id]}]);assert.equal(byIds.receipts,1);assert.equal(byIds.multi,1);
  // a member without view: only own collections
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3) on conflict (workspace_id,admin_id) do update set capabilities=excluded.capabilities",[ws,id(5),['book']]).catch(()=>{});
  await as(5);const other=await call('clinic_reception_multi_payments',[{}]).catch(e=>({err:e.message}));
  if(!other.err){assert.equal(other.receipts,0,'nothing of others');assert.equal(other.rows.length,0);}
  // rollback of 390000
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261122390000_multi_payment_note.rollback.sql','utf8'));
  await as(4);const back=await call('clinic_reception_snapshot',[ws,dayCairo,dayCairo]);assert(back.allocations.every(a=>a.payment_id===undefined),'rollback restores the old snapshot');
  await assert.rejects(()=>call('clinic_reception_multi_payments',[{}]),/does not exist|function/);
  console.log('PASS multi payment note: snapshot allocations carry payment_id, shared records + invoice print carry note/total/visits, multi_payments counts + rows + own-only for others, rollback.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
