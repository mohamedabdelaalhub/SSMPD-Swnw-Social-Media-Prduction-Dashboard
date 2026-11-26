// Ops supabase/ops/20261126_home_consult_split.sql on PGlite (after migration 20261126060000): PREVIEW, APPLY 1+2 (nursing fee 150 + home consult 1500), APPLY 3 (pending 50% contracts), CHECK.
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
  await db.exec(`alter table clinic_reception.appointments add column if not exists performer_mode text not null default 'doctor', add column if not exists nurse_admin_id uuid references public.admins(id);
   create schema if not exists clinic_people; create table if not exists clinic_people.people(id uuid primary key default gen_random_uuid(),admin_id uuid unique,full_name text,code text unique,doctor_key text unique);`);

  await db.exec(mig('20261126060000'));
  // live shapes the ops reads (not in this boot): canonical_code (20261024183344), fee_kind (20261108290000), is_home (20261120020000),
  // is_nurse (20261120220000), is_basic_service (20261121130000, simplified), login → admin (claims), catalog_issues
  await db.exec(`alter table public.pricing_services add column if not exists canonical_code text unique;
   alter table clinic_finance.doctor_contracts add column if not exists fee_kind text not null default 'percent', add column if not exists fixed_amount numeric;
   alter table clinic_reception.services add column if not exists is_home boolean not null default false;
   alter table public.admins add column if not exists user_id uuid, add column if not exists email text;
   create table if not exists clinic_reception.catalog_issues(workspace_id uuid,kind text,source_id uuid,name text,detail text);
   create or replace function clinic_reception.is_nurse(p uuid) returns boolean language sql stable as $$select exists(select 1 from public.admins where id=p and active and role in ('nursing','head_nursing'))$$;
   create or replace function clinic_reception.is_basic_service(d text,n text) returns boolean language sql immutable as $$select coalesce(d,'')='خدمات الكشف'$$;
   create or replace function public.my_admin_id() returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
     select coalesce(nullif(current_setting('test.admin',true),'')::uuid,(select id from public.admins where user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid))$$;`);
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  const prov=async(n,k,d)=>(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,$2,$3,$4,'حدائق الأهرام') returning id",[ws,n,k,d]))[0].id;
  const pA=await prov('د. أحمد','DOC-A','الباطنة'),pB=await prov('د. بسمة','DOC-B','الأطفال'),pB2=await prov('د. بسمة (كشف)','DOC-B','خدمات الكشف');
  await prov('ممرضة منزلية','EMP-000007','التمريض المنزلي');await prov('وحدة تمريض','EMP-000005','الطوارئ');await prov('المعمل',null,'التحاليل');
  await owner("update clinic_reception.providers set active=false where name='د. بسمة (كشف)'");await prov('د. قديم','DOC-OLD','الباطنة');await owner("update clinic_reception.providers set active=false where doctor_key='DOC-OLD'");
  const N=id(40),N5=id(45),MK='3e1f9a1f-7789-4cf0-a756-93caa6d9cc73',MKU=id(90);
  await owner("insert into admins(id,name,role) values($1,'ممرضة','nursing'),($2,'ممرض طوارئ','nursing'),($3,'المحاسب','accountant')",[N,N5,MK]);
  await owner("update admins set user_id=$2 where id=$1",[MK,MKU]);await owner("insert into admin_module_permissions values($1,'accounting',true,true,true)",[MK]);
  await owner("insert into clinic_people.people(admin_id,full_name,code) values($1,'ممرضة','EMP-000007'),($2,'ممرض','EMP-000005')",[N,N5]);
  // DOC-A already has a department contract (consult 60%) — must NOT apply to the home consult
  await owner("insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,status,payload,created_by,token) values('DOC-A','د. أحمد','قسم:خدمات الكشف',current_date-30,current_date+365,60,'performed','service','none','proportional_revenue','r','active','{}',$1,gen_random_uuid())",[id(2)]);
  // pricing as on live: nursing fee 150 (no code) + 200 (NUR-F61284, booked), home doctor fee SVC-0001396 (booking off)
  const ps=async(code,name,price,cat,extra)=>(await owner("insert into public.pricing_services(name,category,base_price,supplies_used,profit_margin_percent,active,canonical_code) values($1,$2,$3,'[]',0,true,$4) returning id",[name,cat,price,code]))[0].id;
  const p150=await ps('SVC-0000150','خدمة تمريض منزلي - رسوم الزيارة',150,'الخدمات المنزلية'),p200=await ps('SVC-0000200','خدمة تمريض منزلي - رسوم الزيارة',200,'الخدمات المنزلية');
  const pHC=await ps('SVC-0001396','خدمة طبيب منزلي - رسوم الزيارة (يضاف لها سعر الكشف العادي حسب التخصص)',1500,'الخدمات المنزلية');
  await owner("update public.pricing_services set booking_enabled=true,booking_code='NUR-F61284',booking_department='التمريض المنزلي',booking_minutes=30 where id=$1",[p200]);
  await owner("select clinic_reception.sync_catalog($1)",[ws]);await owner("update clinic_reception.services set is_home=true where code='NUR-F61284'");
  const old200=(await owner("select id from clinic_reception.services where code='NUR-F61284' and active"))[0].id;
  // the nurse's per-service contract on NUR-F61284 (20%) must keep working after the move
  await owner("insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,status,payload,created_by,token) values('EMP-000007','ممرضة','NUR-F61284',current_date-30,current_date+365,20,'performed','service','none','proportional_revenue','r','active','{}',$1,gen_random_uuid())",[id(2)]);
  const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F9','مريض','0100',$2) returning id",[ws,id(1)]))[0].id;
  const futureAp=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,created_by) values($1,$2,$3,$4,now()+interval '2 days',now()+interval '2 days 30 min',$5) returning id",[ws,pat,pA,old200,id(1)]))[0].id;
  // --- run the ops file section by section ---
  const OPS=fs.readFileSync('supabase/ops/20261126_home_consult_split.sql','utf8');
  const sec=h=>{const i=OPS.indexOf('-- ===================== '+h);assert.ok(i>=0,h);const j=OPS.indexOf('-- ===================== ',i+10);return OPS.slice(i,j<0?undefined:j);};
  const preview=sec('PREVIEW');
  const res=await db.exec(preview);const P5=res[res.length-2].rows,P3=res[2].rows;
  assert.deepEqual(P5.map(r=>r.doctor_key),['DOC-A','DOC-B'],'doctor list: active doctor providers, nurses / units / inactive excluded, one row per key');
  assert.equal(P5.find(r=>r.doctor_key==='DOC-A').current,'department contract قسم:خدمات الكشف 60.0000%','before the batch the department contract would apply — the migration guard refuses that');
  assert.equal(P3.length,1,'P3 lists the future booking on the 200 fee');assert.equal(P3[0].id,futureAp);
  const A12=sec('APPLY 1+2');await db.exec(A12);
  let s=await owner("select code,price::numeric p,is_home,active,pricing_service_id from clinic_reception.services where active and pricing_service_id in ($1,$2,$3) order by code",[p150,p200,pHC]);
  assert.deepEqual(s.map(r=>[r.code,Number(r.p),r.is_home,r.pricing_service_id]),[['NUR-F61284',150,true,p150],['SVC-0001396',1500,true,pHC]],'one 150 nursing fee on the SAME code + the home consult');
  const pr=(await owner("select id,name,active,booking_enabled,booking_code,booking_department,booking_minutes from public.pricing_services where id in ($1,$2,$3) order by base_price",[p150,pHC,p200]));
  assert.deepEqual(pr.map(r=>[r.active,r.booking_enabled,r.booking_code]),[[true,true,'NUR-F61284'],[false,false,null],[true,true,'SVC-0001396']]);
  assert.equal(pr[2].name,'كشف منزلي (شامل الانتقال)');assert.equal(pr[2].booking_department,'خدمات الكشف');assert.equal(pr[0].booking_department,'التمريض المنزلي');
  assert.equal((await owner("select service_id from clinic_reception.appointments where id=$1",[futureAp]))[0].service_id,old200,'existing booking untouched');
  assert.deepEqual((await owner("select service_code,nurse_fee::numeric f from clinic_reception.home_visit_split")).map(r=>[r.service_code,Number(r.f)]),[['SVC-0001396',100]]);
  // the nurse contract still resolves for the 150 fee
  assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contract_for_service('EMP-000007','NUR-F61284',null,'التمريض المنزلي',current_date)"))[0].n,1);
  // idempotent re-run
  await db.exec(A12);assert.equal((await owner("select count(*)::int n from clinic_reception.services where active and pricing_service_id in ($1,$2,$3)",[p150,p200,pHC]))[0].n,2);
  // guard rails: a second 150 row stops the apply
  const bad=await ps('SVC-0000151','خدمة تمريض منزلي - رسوم الزيارة',150,'الخدمات المنزلية');await assert.rejects(()=>db.exec(A12),/expected exactly 1 active/);await db.exec('rollback');
  await owner("delete from public.pricing_services where id=$1",[bad]);
  // APPLY 3: pending contracts as the maker, through contract_batch
  const A3=sec('APPLY 3');await db.exec(A3);
  let k=await owner("select doctor_key,rate::numeric r,status,basis,base_scope,deduction,created_by from clinic_finance.doctor_contracts where service_scope='SVC-0001396' order by doctor_key");
  assert.deepEqual(k.map(r=>[r.doctor_key,Number(r.r),r.status,r.basis,r.base_scope,r.deduction,r.created_by]),[['DOC-A',50,'pending','performed','service','none',MK],['DOC-B',50,'pending','performed','service','none',MK]]);
  await db.exec(A3);assert.equal((await owner("select count(*)::int n from clinic_finance.doctor_contracts where service_scope='SVC-0001396'"))[0].n,2,'re-run skips');
  // the maker cannot approve; the financial manager approves all (as on screen)
  const ids=(await owner("select array_agg(id) a from clinic_finance.doctor_contracts where service_scope='SVC-0001396'"))[0].a;
  await owner("select set_config('test.admin','',false)");
  await assert.rejects(()=>owner("select set_config('request.jwt.claim.sub',$1,false); ",[MKU]).then(()=>owner("select public.clinic_finance_doctor_command('contract_review_batch',$1,gen_random_uuid())",[{ids,approve:true,note:'اعتماد'}])));
  await owner("select set_config('request.jwt.claim.sub','',false)");
  await as(3);await db.query("select public.clinic_finance_doctor_command('contract_review_batch',$1,gen_random_uuid())",[{ids,approve:true,note:'اعتماد المدير المالي'}]);await db.exec('reset role');
  const chk=(await db.exec(sec('CHECK')))[0].rows;
  assert.deepEqual(chk.filter(r=>/^DOC-/.test(r.doctor_key)).map(r=>[r.doctor_key,r.resolves_to]),[['DOC-A','50.0000% exact'],['DOC-B','50.0000% exact']],'exact 50% wins over the department contract');
  console.log('PASS home consult split ops: PREVIEW doctor list (nurses/units/inactive excluded) + future 200 bookings listed; APPLY 1+2 retires 200, 150 takes NUR-F61284 (nurse contract kept, booking untouched), «كشف منزلي (شامل الانتقال)» 1500 basic + is_home + split row; idempotent; duplicate 150 refused; APPLY 3 pending 50% contracts via contract_batch as the maker, re-run skips, maker cannot approve, FM approves → exact 50% resolves.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1);});
