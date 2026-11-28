// «كشف منزلي (شامل الانتقال)» 1500 (owner 2026-11-26): doctor 750 (exact-code 50% contract), nurse WITH the doctor 100, center the rest.
// Migration 20261126060000_home_consult_split.sql on the reception bridge (same boot as desk-rx-fees-referral-sql.cjs).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const b=await boot(['reception_canonical_catalog']);const {db,as,owner,id}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  if(!(await db.query("select to_regprocedure('clinic_finance.group_snapshot_base(date,date,integer)') r")).rows[0].r)
   await db.exec('alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance; alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base; create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select clinic_finance.group_snapshot_base(p_from,p_to,p_offset) $$; grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;');
  for(const n of ['20261018005957','20261108130000','20261108230000','20261108231000','20261108250000','20261108260000_doctor_payout','20261108280000','20261109100000'])await db.exec(mig(n));
  await db.exec(`create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table if not exists storage.objects(bucket_id text,name text); create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;`);
  await db.exec(mig('20261117230000'));
  await db.exec(`create table if not exists clinic_reception.order_ext(order_id uuid primary key references clinic_reception.orders(id) on delete cascade,kind text not null,mode text not null default 'internal',billing_party text not null default 'center',referring_doctor_key text,performing_doctor_key text,external_provider_id uuid,status text not null default 'referred',status_at timestamptz not null default now(),report_file_ref text,priced jsonb,created_at timestamptz not null default now())`);
  await db.exec(mig('20261119010000'));
  // booking performer columns (#641, 20261120220000) + HR people as on live
  await db.exec(`create schema if not exists clinic_people; create table if not exists clinic_people.people(id uuid primary key default gen_random_uuid(),admin_id uuid unique,full_name text,code text unique,doctor_key text unique);
   create table if not exists public.admin_extra_roles(admin_id uuid,role text);`);
  await db.exec(mig('20261115100000_reception_booking_confirm_duration'));await db.exec(mig('20261120220000_reception_booking_nurse_performer'));
  // the migration applies once; a second run is refused by the guard before begin
  const M=mig('20261126060000');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  const prov=async(n,k,d)=>(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,$2,$3,$4,'حدائق الأهرام') returning id",[ws,n,k,d||'خدمات الكشف']))[0].id;
  const pD=await prov('د. منزلي','DOC-H'),pX=await prov('د. قسم فقط','DOC-X'),pN=await prov('ممرضة منزلية','EMP-000007','التمريض المنزلي');
  const N=id(40),N2=id(41);
  await owner("insert into admins(id,name,role) values($1,'ممرضة','nursing'),($2,'ممرضة جديدة','nursing')",[N,N2]);
  await owner("insert into clinic_people.people(admin_id,full_name,code) values($1,'ممرضة','EMP-000007'),($2,'ممرضة جديدة','EMP-000099')",[N,N2]);
  const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F1','مريض','0100',$2) returning id",[ws,id(1)]))[0].id;
  const svc=async(code,name,price)=>(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,$2,$3,'خدمات الكشف',$4,60) returning id",[ws,code,name,price]))[0].id;
  const sHC=await svc('SVC-0001396','كشف منزلي (شامل الانتقال)',1500),sK=await svc('K-1','كشف باطنة',400);
  await owner("insert into clinic_reception.home_visit_split(service_code,nurse_fee,note) values('SVC-0001396',100,'قرار المالك 2026-11-26')");
  // finance contracts: DOC-H exact 50% on the home consult; DOC-X only a department contract (70%)
  const contract=async(k,scope,rate)=>(await owner("insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,status,payload,created_by,token) values($1,$1,$2,current_date-1,current_date+365,$3,'performed','service','none','proportional_revenue','ref','active','{}',$4,gen_random_uuid()) returning id",[k,scope,rate,id(2)]))[0].id;
  const cH=await contract('DOC-H','SVC-0001396',50),cX=await contract('DOC-X','قسم:خدمات الكشف',70);
  const agree=async(p,code,c,rate)=>(await owner("insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,deduct_material_cost,valid_from,valid_to,reference,status,created_by,reviewed_by,finance_contract_id) values($1,$2,$3,$4,false,current_date-1,current_date+365,'ref','active',$5,$6,$7) returning id",[ws,p,code,rate,id(2),id(3),c]))[0].id;
  const gH=await agree(pD,'SVC-0001396',cH,50),gX=await agree(pX,'SVC-0001396',cX,70);
  // what 'execute' does for one order: invoice + doctor_fee, then ONE update (status completed + agreement + fee + net)
  let slot=0;
  const mk=async(p,s,mode,nurse,price,discount)=>{slot++;const net=price*(1-(discount||0)/100);
   const ap=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by,performer_mode,nurse_admin_id) values($1,$2,$3,$4,now()+make_interval(hours=>$6::int),now()+make_interval(hours=>$6::int)+interval '60 min','arrived',$5,$7,$8) returning id",[ws,pat,p,s,id(1),slot,mode,nurse]))[0].id;
   const vi=(await owner("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[ws,ap,pat,id(1)]))[0].id;
   const snap=(await owner("select jsonb_build_object('code',code,'name',name,'department',department) j from clinic_reception.services where id=$1",[s]))[0].j;
   const o=(await owner("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,discount,snapshot,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",[ws,vi,s,p,price,discount||0,snap,id(1)]))[0].id;
   const iv=(await owner("insert into clinic_reception.invoices(workspace_id,patient_id,visit_id,order_id,kind,amount,description) values($1,$2,$3,$4,'service',$5,'خدمة') returning id",[ws,pat,vi,o,net]))[0].id;
   return {o,iv,net,p};};
  const exec=async(x,agreement,rate)=>{const fee=Math.round(x.net*rate)/100;await as(1);await db.exec('reset role');
   await db.query("select clinic_reception.post($1,'doctor_fee',$2,'استحقاق طبيب لخدمة منفذة','5111','2120',$3,$4)",[ws,x.o,fee,{order_id:x.o,provider_id:x.p,invoice_id:x.iv}]);
   await owner("update clinic_reception.orders set status='completed',agreement_id=$2,doctor_fee=$3,net_revenue=$4 where id=$1",[x.o,agreement,fee,x.net]);return fee;};
  const nurseSum=async o=>Number((await owner("select coalesce(sum(l.credit-l.debit),0) s from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.account='2120' where j.source like 'home_nurse%' and j.dimensions->>'order_id'=$1::text",[o]))[0].s);
  const cost5111=async o=>Number((await owner("select coalesce(sum(l.debit-l.credit),0) s from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id and l.account='5111' where j.dimensions->>'order_id'=$1::text",[o]))[0].s);
  await as(1);await db.exec('reset role');
  // 1) doctor + nurse: invoice 1500, doctor 750, nurse 100 to her provider, center 650
  let x=await mk(pD,sHC,'nurse_with_doctor',N,1500);let fee=await exec(x,gH,50);
  assert.equal(fee,750,'doctor 50% = 750');assert.equal(await nurseSum(x.o),100,'nurse 100');assert.equal(x.net-await cost5111(x.o),650,'center 650');
  const nj=(await owner("select j.dimensions d from clinic_reception.journal j where j.source='home_nurse_fee' and j.source_id=$1",[x.o]));
  assert.equal(nj.length,1);assert.equal(nj[0].d.provider_id,pN,'posted on the nurse provider');assert.equal(nj[0].d.invoice_id,x.iv);
  // idempotent: re-completing / retrying posts nothing more
  await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);
  assert.equal((await owner("select clinic_reception.home_nurse_try($1) r",[x.o]))[0].r,'done');assert.equal(await nurseSum(x.o),100,'still 100');
  // held until paid, then payable at «صرف الحساب» for the nurse; the doctor sees his 750
  assert.equal(Number((await owner("select clinic_finance.desk_held('EMP-000007') h"))[0].h),100);
  await owner("insert into clinic_reception.allocations(workspace_id,invoice_id,source,amount) values($1,$2,'payment',1500)",[ws,x.iv]);
  const pe=await owner("select * from clinic_finance.desk_payable('EMP-000007')");assert.equal(pe.length,1);assert.equal(Number(pe[0].fee),100);
  assert.equal(Number((await owner("select sum(fee) f from clinic_finance.desk_payable('DOC-H')"))[0].f),750);
  // 2) doctor alone: no nurse fee, center 750
  x=await mk(pD,sHC,'doctor',null,1500);await exec(x,gH,50);assert.equal(await nurseSum(x.o),0);assert.equal(x.net-await cost5111(x.o),750,'center 750');
  // 3) nurse alone on the consult / nurse with doctor on another service: nothing
  x=await mk(pD,sHC,'nurse_alone',N,1500);
  await assert.rejects(()=>owner("update clinic_reception.orders set status='completed',agreement_id=$2 where id=$1",[x.o,gH]),/الكشف المنزلي لازم يكون معاه الطبيب/,'execute refuses nurse alone on the consult');
  const gK=await agree(pD,'K-1',cH,50);x=await mk(pD,sK,'nurse_with_doctor',N,400);await exec(x,gK,50);assert.equal(await nurseSum(x.o),0,'not a split service');
  // 4) exact-contract guard: a department contract (or no agreement) cannot execute the home consult
  x=await mk(pX,sHC,'doctor',null,1500);
  await assert.rejects(()=>owner("update clinic_reception.orders set status='completed',agreement_id=$2 where id=$1",[x.o,gX]),/لسه ما اتعتمدش في الحسابات/);
  await assert.rejects(()=>owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]),/لسه ما اتعتمدش في الحسابات/);
  // a trial workspace is not guarded
  const tw=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('trial','trial',$1) returning id",[id(1)]))[0].id;
  await owner("update clinic_reception.orders set workspace_id=$2 where id=$1",[x.o,tw]);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);
  // 5) discount 10%: doctor 675 (50% of net), nurse still 100, center 575
  x=await mk(pD,sHC,'nurse_with_doctor',N,1500,10);fee=await exec(x,gH,50);assert.equal(fee,675);assert.equal(await nurseSum(x.o),100);assert.equal(x.net-await cost5111(x.o),575);
  // 6) credit note on half the invoice halves the nurse fee, removing it restores; a voided order reverses it all
  x=await mk(pD,sHC,'nurse_with_doctor',N,1500);await exec(x,gH,50);
  await owner("update clinic_reception.invoices set credit_amount=750 where id=$1",[x.iv]);assert.equal(await nurseSum(x.o),50,'credit note halves');
  await owner("update clinic_reception.invoices set credit_amount=0 where id=$1",[x.iv]);assert.equal(await nurseSum(x.o),100,'restored');
  await owner("update clinic_reception.orders set status='cancelled' where id=$1",[x.o]);assert.equal(await nurseSum(x.o),0,'void reverses all');
  // 7) nurse without a reception provider: kept as an issue, posted when the provider appears; the execution itself is never blocked
  x=await mk(pD,sHC,'nurse_with_doctor',N2,1500);await exec(x,gH,50);
  assert.equal((await owner("select status from clinic_reception.orders where id=$1",[x.o]))[0].status,'completed');
  assert.equal((await owner("select reason,detail from clinic_reception.home_nurse_issues where order_id=$1 and resolved_at is null",[x.o]))[0].reason,'missing_provider');
  const pN2=await prov('ممرضة جديدة','EMP-000099','التمريض المنزلي');assert.equal(await nurseSum(x.o),100,'posted when the provider appears');
  assert.ok((await owner("select resolved_at from clinic_reception.home_nurse_issues where order_id=$1",[x.o]))[0].resolved_at);
  assert.equal((await owner("select j.dimensions->>'provider_id' p from clinic_reception.journal j where j.source='home_nurse_fee' and j.source_id=$1",[x.o]))[0].p,pN2);
  // 8a) booking (owner 00:37Z): «ممرض/ة لوحده» refused on the split service (book / walk_in / reschedule), allowed elsewhere;
  //     slot = visit (15) + travel (default 60; 30/60/90/120), overlap and the nurse are checked on the whole trip; snapshot lists the split service
  await db.exec('reset role');
  const tw2=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('trial-book','trial',$1) returning id",[id(2)]))[0].id;
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3)",[tw2,id(4),['view','book']]);
  const bp=async(n,k)=>(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,$2,$3,'خدمات الكشف','حدائق الأهرام') returning id",[tw2,n,k]))[0].id;
  const bD=await bp('د. منزلي ت','DOC-T'),bD2=await bp('د. تاني ت','DOC-T2');
  /* the day after tomorrow in CAIRO (was UTC current_date+1: after midnight Cairo that is the same Cairo day as the now()+N-hours visits above → nurse_overlap) */const day0=(await owner("select ((((now() at time zone 'Africa/Cairo')::date)+2)::timestamp at time zone 'Africa/Cairo') t"))[0].t;const at=h=>new Date(new Date(day0).getTime()+h*3600000).toISOString();
  for(const p of [bD,bD2])await owner("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,$3,$4)",[tw2,p,at(8),at(22)]);
  const bs=async(code,name)=>(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,$2,$3,'خدمات الكشف',1500,15) returning id",[tw2,code,name]))[0].id;
  const bHC=await bs('SVC-0001396','كشف منزلي (شامل الانتقال)'),bK=await bs('K-1','كشف باطنة');
  const bpat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'T1','مريض','0101',$2) returning id",[tw2,id(1)]))[0].id;
  let bk=0;const cmd=async(a,p)=>{await as(4);try{return (await db.query("select public.clinic_reception_command($1,$2,$3,$4) r",[tw2,a,p,id(500+(++bk))])).rows[0].r;}finally{await db.exec('reset role');}};
  const ap=async i=>(await owner("select starts_at,ends_at,travel_minutes,performer_mode,nurse_admin_id,service_id,extract(epoch from ends_at-starts_at)/60 m from clinic_reception.appointments where id=$1",[i]))[0];
  const NA=/الكشف المنزلي لازم يكون معاه الطبيب/;
  await assert.rejects(()=>cmd('book',{patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(10),performer_mode:'nurse_alone',nurse_admin_id:N}),NA,'book nurse alone refused');
  await assert.rejects(()=>cmd('walk_in',{patient_id:bpat,provider_id:bD,service_id:bHC,performer_mode:'nurse_alone',nurse_admin_id:N}),NA,'walk_in nurse alone refused');
  let r1=await cmd('book',{patient_id:bpat,provider_id:bD,service_id:bK,starts_at:at(9),performer_mode:'nurse_alone',nurse_admin_id:N});
  let a1=await ap(r1.id);assert.equal(a1.performer_mode,'nurse_alone','other services keep nurse alone');assert.equal(Number(a1.m),15);assert.equal(a1.travel_minutes,null);
  let r2=await cmd('book',{patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(10)});let a2=await ap(r2.id);
  assert.equal(Number(a2.m),75,'15 + default travel 60');assert.equal(a2.travel_minutes,60);
  await assert.rejects(()=>cmd('book',{patient_id:bpat,provider_id:bD,service_id:bK,starts_at:at(11)}),/يتداخل|دقايق بين كل حجز/,'the trip holds the doctor (11:00 is inside 10:00–11:15)');
  await assert.rejects(()=>cmd('book',{patient_id:bpat,provider_id:bD2,service_id:bHC,starts_at:at(13),travel_minutes:'45'}),/وقت الطريق/);
  let r3=await cmd('book',{patient_id:bpat,provider_id:bD2,service_id:bHC,starts_at:at(13),travel_minutes:'30',performer_mode:'nurse_with_doctor',nurse_admin_id:N});let a3=await ap(r3.id);
  assert.equal(Number(a3.m),45);assert.equal(a3.travel_minutes,30);assert.equal(a3.performer_mode,'nurse_with_doctor');
  // the nurse is held for the trip: another doctor's visit with her at 13:30 (inside 13:00–13:45) is refused
  await assert.rejects(()=>cmd('book',{patient_id:bpat,provider_id:bD,service_id:bK,starts_at:at(13.5),performer_mode:'nurse_with_doctor',nurse_admin_id:N}),/زيارة تانية في نفس الوقت/);
  // reschedule: keeps travel when not sent, takes a new one, refuses nurse alone (sent, or kept from the booking when the service changes)
  await cmd('reschedule',{id:r2.id,patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(15)});a2=await ap(r2.id);assert.equal(Number(a2.m),75,'travel kept');assert.equal(a2.travel_minutes,60);
  await cmd('reschedule',{id:r2.id,patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(15),travel_minutes:'120'});a2=await ap(r2.id);assert.equal(Number(a2.m),135);assert.equal(a2.travel_minutes,120);
  await assert.rejects(()=>cmd('reschedule',{id:r2.id,patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(15),performer_mode:'nurse_alone',nurse_admin_id:N}),NA);
  await assert.rejects(()=>cmd('reschedule',{id:r1.id,patient_id:bpat,provider_id:bD,service_id:bHC,starts_at:at(19)}),NA,'nurse-alone booking cannot move onto the consult');
  // nurse kept on reschedule without keys: her other visit inside the new trip is refused
  await cmd('book',{patient_id:bpat,provider_id:bD,service_id:bK,starts_at:at(20),performer_mode:'nurse_with_doctor',nurse_admin_id:N});
  await assert.rejects(()=>cmd('reschedule',{id:r3.id,patient_id:bpat,provider_id:bD2,service_id:bHC,starts_at:at(19.75)}),/زيارة تانية في نفس الوقت/,'19:45 + 15 + 30 overlaps her 20:00 visit');
  // moving off the split service clears travel
  await cmd('reschedule',{id:r2.id,patient_id:bpat,provider_id:bD,service_id:bK,starts_at:at(16)});a2=await ap(r2.id);assert.equal(Number(a2.m),15);assert.equal(a2.travel_minutes,null);
  // snapshot exposes the split service to the booking form
  await as(4);const snap=(await db.query("select public.clinic_reception_snapshot($1,(now() at time zone 'Africa/Cairo')::date,(now() at time zone 'Africa/Cairo')::date+3) s",[tw2])).rows[0].s;await db.exec('reset role');
  assert.deepEqual(snap.home_visit_split,[{service_id:bHC,code:'SVC-0001396',travel_minutes:60}]);assert.ok(Array.isArray(snap.appointments));
  assert.equal(snap.appointments.find(a=>a.id===r3.id).travel_minutes,30,'appointments carry travel_minutes');
  // 8) no grants to the app roles
  assert.deepEqual((await owner("select has_function_privilege('authenticated','clinic_reception.home_nurse_try(uuid)','execute') a, has_table_privilege('authenticated','clinic_reception.home_visit_split','select') b, has_function_privilege('authenticated','public.clinic_reception_command(uuid,text,jsonb,uuid)','execute') c, has_function_privilege('anon','public.clinic_reception_command(uuid,text,jsonb,uuid)','execute') d, has_function_privilege('authenticated','clinic_reception.command_before_home_split(uuid,text,jsonb,uuid)','execute') e, has_function_privilege('authenticated','public.clinic_reception_snapshot(uuid,date,date)','execute') f"))[0],{a:false,b:false,c:true,d:false,e:false,f:true});
  // 9) rollback: posting / guard stop, posted entries stay, re-apply works
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261126060000_home_consult_split.rollback.sql','utf8'));
  assert.equal((await owner("select to_regprocedure('clinic_reception.home_nurse_try(uuid)') f"))[0].f,null);
  assert.equal((await owner("select count(*)::int n from clinic_reception.journal where source='home_nurse_fee'"))[0].n,4,'posted entries kept');
  x=await mk(pX,sHC,'nurse_with_doctor',N,1500);await owner("update clinic_reception.orders set status='completed' where id=$1",[x.o]);assert.equal(await nurseSum(x.o),0,'no posting after rollback');
  await db.exec(M);assert.ok((await owner("select to_regclass('clinic_reception.home_visit_split') t"))[0].t,'re-apply after rollback');
  console.log('PASS home consult split: nurse alone refused on book/walk_in/reschedule/execute of the split service (allowed elsewhere); slot = 15 + travel (default 60, 30/60/90/120; kept / changed / cleared on reschedule), doctor and nurse held for the whole trip; snapshot lists it; 1500 → doctor 750 (exact 50% contract) + nurse 100 only when «ممرض/ة مع طبيب» (her provider, payable at «صرف الحساب» once paid) + center 650 / 750; idempotent; nurse alone / other services nothing; department contract refused (live only); discount = 50% of net for the doctor, nurse fixed; credit note proportional + restore, void reverses; missing provider retried; no grants; rollback keeps entries and re-applies.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
