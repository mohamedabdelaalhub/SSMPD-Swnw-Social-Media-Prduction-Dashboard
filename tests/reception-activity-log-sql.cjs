// 20261123010000 «سجل نشاط الاستقبال» (public.clinic_reception_activity): read-only, super admin / GM / FM only; one row per reception
// action (audit), resolved to patient / doctor / visit / payment; collect_multi rows carry the note + visits covered + «لأكتر من مريض»
// (20261122380000 collect_multi_cross); auto-booking account shown apart; per-employee summary; filters; paging; rollback. Sample data.
// (base: tests/reception-collect-multi-sql.cjs) «دفعة واحدة لأكتر من زيارة» + «ملاحظة» (20261122160000): ONE payment (one reference, one proof, one receipt number) pays several
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
  // ---- 20261122380000 (one payer) so a cross-patient collect_multi exists, then 20261123010000 ----
  await db.exec('reset role');
  await db.exec(mig('20261122380000'));
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3) on conflict (workspace_id,admin_id) do update set capabilities=excluded.capabilities",[ws,id(4),['book','collect','view']]);
  const Y=await pat('يحيى تجريبي','01022223333'),Mh=await pat('محمود تجريبي','01044445555');
  const iY=await inv(Y,500),iM=await inv(Mh,500);await as(4);await proof('IP-900');
  const rc=await cmd('collect_multi',{patient_id:Y,method:'instapay',reference:'IP-900',amount:'1000',invoice_ids:[iY,iM],one_payer:true,note:'يحيى دفع عن محمود'});
  await db.exec('reset role');
  // a booking + arrival + service by reception (4), a booking by the auto-booking account (2)
  const prov=(await owner("insert into clinic_reception.providers(workspace_id,name,department,branch) values($1,'د. جلدية تجريبية','الجلدية','الأهرام') returning id",[ws]))[0].id;
  const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'K-1','كشف جلدية','الجلدية',350,15) returning id",[ws]))[0].id;
  const apt=async(p,h)=>(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,created_by) values($1,$2,$3,$4,now()+make_interval(hours=>$5),now()+make_interval(hours=>$5,mins=>15),$6) returning id",[ws,p,prov,svc,h,id(4)]).catch(e=>owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at) values($1,$2,$3,$4,now()+make_interval(hours=>$5),now()+make_interval(hours=>$5,mins=>15)) returning id",[ws,p,prov,svc,h])))[0].id;
  const ap1=await apt(A,2),ap2=await apt(C,3);
  const audit=(who,action,entity,detail={})=>owner("insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail) values($1,$2,$3,$4,$5)",[ws,id(who),action,entity,detail]);
  await audit(4,'book',ap1);await audit(2,'book',ap2);await audit(4,'reschedule',ap1);await audit(4,'patient_attach',A);
  await db.exec("create table if not exists clinic_reception.auto_book_settings(id boolean primary key default true,system_admin_id uuid)");
  await owner("insert into clinic_reception.auto_book_settings(id,system_admin_id) values(true,$1) on conflict (id) do update set system_admin_id=excluded.system_admin_id",[id(2)]);
  const M35=mig('20261123010000');await db.exec(M35);await assert.rejects(()=>db.exec(M35),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const act=async(who,f={})=>{await as(who);try{return await call('clinic_reception_activity',[ws,f]);}finally{await db.exec('reset role');}};
  // access: reception / accountant refused; super admin + FM allowed
  await assert.rejects(()=>act(4),/للمدير العام والمدير المالي/);await assert.rejects(()=>act(2),/للمدير العام والمدير المالي/);
  const all=await act(1);const fm=await act(3);assert.equal(fm.total,all.total);
  const kinds=all.rows.map(r=>r.kind);
  assert(!all.rows.some(r=>r.action==='patient_attach'),'noise actions left out');
  assert(!all.rows.some(r=>r.action==='collect_multi_cross'),'the cross audit row folds into its payment row');
  const pay=all.rows.find(r=>r.action==='collect_multi');assert(pay,'collect_multi listed');
  assert.deepEqual([pay.kind,+pay.amount,+pay.visits,pay.cross_patient,pay.note,pay.patient,pay.actor],['pay',1000,2,true,'يحيى دفع عن محمود','يحيى تجريبي','Test 4']);
  const fam=all.rows.find(r=>r.action==='collect_multi'&&r.id!==pay.id);assert(fam&&+fam.visits===2&&fam.cross_patient===false,'family collect_multi: 2 visits, not cross');
  const b1=all.rows.find(r=>r.action==='book'&&!r.auto);assert.deepEqual([b1.kind,b1.patient,b1.provider],['book','منار','د. جلدية تجريبية']);
  const b2=all.rows.find(r=>r.action==='book'&&r.auto);assert.equal(b2.actor,'الحجز التلقائي');
  assert(kinds.includes('reschedule'));
  // newest first
  for(let i=1;i<all.rows.length;i++)assert(all.rows[i-1].at>=all.rows[i].at,'newest first');
  // summary per employee: reception (4) vs auto
  const s4=all.summary.find(s=>s.id===id(4)&&!s.auto),sa=all.summary.find(s=>s.auto);
  assert.equal(s4.bookings,1);assert.equal(s4.changes,1);assert(s4.collections>=2);assert(+s4.visits_paid>s4.collections,'visits paid > collections explains the difference');
  assert.equal(sa.bookings,1);assert.equal(sa.name,'الحجز التلقائي');
  // filters
  assert(( await act(1,{actor:'auto'})).rows.every(r=>r.auto));assert.equal((await act(1,{actor:'auto'})).total,1);
  assert((await act(1,{kind:'pay'})).rows.every(r=>r.kind==='pay'));
  assert.equal((await act(1,{q:'يحيى'})).rows.filter(r=>r.action==='collect_multi').length,1);
  assert((await act(1,{provider:prov})).rows.every(r=>r.provider==='د. جلدية تجريبية'));
  const p1=await act(1,{limit:2}),p2=await act(1,{limit:2,offset:2});assert.equal(p1.rows.length,2);assert.notEqual(p1.rows[0].id,p2.rows[0].id);assert.equal(p1.total,all.total);
  await assert.rejects(()=>act(1,{from:'2026-01-01',to:'2026-12-31'}),/92 يوم/);
  assert.equal((await act(1,{from:'2020-01-01',to:'2020-01-02'})).total,0,'outside the period');
  // read-only: no writes
  assert.equal(all.providers[0].name,'د. جلدية تجريبية');
  // rollback
  await db.exec(fs.readFileSync('supabase/rollbacks/20261123010000_reception_activity_log.rollback.sql','utf8'));
  assert.equal((await owner("select to_regprocedure('public.clinic_reception_activity(uuid,jsonb)') r"))[0].r,null);
  console.log('PASS reception activity log: GM/super admin/FM only, one row per action with patient/doctor, collect_multi note + visits + cross flag, auto-booking apart, summary (visits paid vs collections), filters, paging, period cap, rollback.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
