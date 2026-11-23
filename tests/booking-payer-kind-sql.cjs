// 20261123070000 «طريقة الدفع / نوع الكشف» (owner 2026-11-23 «طبقه»): cash / contract (insurance) / union — as a reception user, live.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const yday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(3);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('service',{code:'KSF',name:'كشف تجريبي',department:dept,price:500,minutes:15,bom:[]});await cmd('service',{code:'XR',name:'أشعة تجريبية',department:dept,price:800,minutes:15,bom:[]});
 s=await snap();const svc=s.services.find(x=>x.code==='KSF').id,xr=s.services.find(x=>x.code==='XR').id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:yday,to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 // stubs of the live contracts / price lists / links / storage (shapes from supabase/live-capture)
 await db.exec('reset role');await db.exec(`
  create table public.contracting_entities(id uuid primary key default gen_random_uuid(),name text not null,category text not null);
  create table public.contracting_entity_contracts(id uuid primary key default gen_random_uuid(),entity_id uuid not null references public.contracting_entities(id),status text not null,start_date date,end_date date);
  create table public.pricing_services(id uuid primary key default gen_random_uuid(),name text);
  alter table clinic_reception.services add column pricing_service_id uuid;
  create schema clinic_prices;
  create table clinic_prices.lists(id uuid primary key default gen_random_uuid(),name text not null,version int not null default 1,contract_id uuid,mode text,fallback text not null,discount_percent numeric,discount_amount numeric,valid_from date not null,valid_to date not null,status text not null);
  create table clinic_prices.items(id uuid primary key default gen_random_uuid(),list_id uuid not null,service_id uuid not null,fixed_price numeric,discount_percent numeric,discount_amount numeric);
  create table public.contract_patient_links(id uuid primary key default gen_random_uuid(),contract_id uuid not null,patient_id uuid not null,member_reference text,insurance_plan_id uuid,linked_from date not null,linked_until date,linked_by uuid);
  create schema storage;create table storage.objects(bucket_id text,name text);`);
 const one=async(sql,a)=>(await db.query(sql,a)).rows[0];
 const ins=await one("insert into public.contracting_entities(name,category) values('ميد نت','insurance') returning id"),
       uni=await one("insert into public.contracting_entities(name,category) values('نقابة المهندسين','unions') returning id"),
       nur=await one("insert into public.contracting_entities(name,category) values('حضانة تجريبية','cash') returning id"),
       neg=await one("insert into public.contracting_entities(name,category) values('مصر هيلث كير','insurance') returning id");
 const cIns=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'active',$2) returning id",[ins.id,yday])).id;
 const cNeg=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'negotiating',$2) returning id",[neg.id,yday])).id;
 const cNur=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'active',$2) returning id",[nur.id,yday])).id;
 const ps=(await one("insert into public.pricing_services(name) values('كشف') returning id")).id,psx=(await one("insert into public.pricing_services(name) values('أشعة') returning id")).id;
 await db.query("update clinic_reception.services set pricing_service_id=$1 where id=$2",[ps,svc]);await db.query("update clinic_reception.services set pricing_service_id=$1 where id=$2",[psx,xr]);
 for(const c of [cIns,cNeg,cNur]){const l=(await one("insert into clinic_prices.lists(name,contract_id,fallback,valid_from,valid_to,status) values('لائحة 2026',$1,'block',$2,'2030-01-01',$3) returning id",[c,yday,c===cNeg?'draft':'active'])).id;
   await db.query("insert into clinic_prices.items(list_id,service_id,fixed_price) values($1,$2,400)",[l,ps]);}
 const pat=async n=>{const arch=(await one("insert into public.patients(id) values(gen_random_uuid()) returning id")).id;
   return (await one("insert into clinic_reception.patients(workspace_id,patient_id,file_no,name,phone,created_by) values($1,$2,$3,$4,'01000000000',$5) returning id",[w,arch,'F'+n,'مريض '+n,id(1)])).id;};
 const A=await pat(1),B=await pat(2),C=await pat(3),D=await pat(4);
 const proof='u/'+w+'/auth1.jpg';await db.query("insert into storage.objects values('booking-discount-cards',$1),('booking-discount-cards',$2)",[proof,'u/'+w+'/card1.jpg']);
 await db.exec('update clinic_reception.settings set live_enabled=true,cutover_at=now()').catch(()=>{});
 // apply (twice refused)
 const M=fs.readFileSync('supabase/migrations/20261123070000_booking_payer_kind.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');await as(3);
 let slot=4*60;const next=()=>{slot+=20;const h=String(Math.floor(slot/60)).padStart(2,'0'),m=String(slot%60).padStart(2,'0');return date+'T'+h+':'+m+':00Z';};
 const ap=async i=>(await snap()).appointments.find(x=>x.id===i);
 const orderOf=async a=>{const s2=await snap();return s2.orders.find(o=>s2.visits.find(v=>v.id===o.visit_id).appointment_id===a);};
 // options: only the ACTIVE insurance contract with an ACTIVE list (not the negotiating one, not the nursery); unions listed
 const opt=await rpc('clinic_reception_payer_options',{p_workspace:w,p_service:svc,p_day:date});
 assert.deepEqual(opt.contracts.map(c=>c.entity_name),['ميد نت']);assert.equal(+opt.contracts[0].price,400);assert.equal(opt.contracts[0].blocked,false);
 assert.deepEqual(opt.unions.map(u=>u.name),['نقابة المهندسين']);
 const optX=await rpc('clinic_reception_payer_options',{p_workspace:w,p_service:xr,p_day:date});assert.equal(optX.contracts[0].blocked,true,'service not in the list → blocked');
 const ct={payer_kind:'contract',payer_contract_id:cIns,payer_coupon_no:'MN-77',payer_auth_ref:'AP-1',payer_coverage_percent:'80',payer_proof_path:proof};
 const book=(p,extra,service=svc)=>cmd('book',{patient_id:p,provider_id:provider,service_id:service,starts_at:next(),same_day_ok:true,...extra});
 // contract validation
 await assert.rejects(()=>book(A,{...ct,payer_contract_id:cNeg}),/مش متفعّل/);
 await assert.rejects(()=>book(A,{...ct,payer_contract_id:cNur}),/مش متفعّل/,'nurseries never');
 await assert.rejects(()=>book(A,ct,xr),/مش في قايمة أسعار الجهة/);
 await assert.rejects(()=>book(A,{...ct,payer_coverage_percent:''}),/نسبة تحمّل الجهة/);
 await assert.rejects(()=>book(A,{...ct,payer_coverage_percent:'120'}),/نسبة تحمّل الجهة/);
 await assert.rejects(()=>book(A,{...ct,payer_auth_ref:''}),/موافقة التغطية/);
 await assert.rejects(()=>book(A,{...ct,payer_proof_path:'u/'+w+'/missing.jpg'}),/صورة الموافقة/,'no save without the photo');
 assert.equal((await snap()).appointments.length,0,'refused bookings leave nothing');
 // contract booking → stored, patient linked → arrival quote at list price with the typed coverage → execute: claim 80% / patient 20%
 const b1=(await book(A,ct)).id;let a=await ap(b1);
 assert.equal(a.payer_kind,'contract');assert.equal(a.payer_entity_name,'ميد نت');assert.equal(+a.payer_coverage_percent,80);assert.equal(+a.payer_price,400);
 const links=await q("select member_reference from public.contract_patient_links where contract_id=$1",[cIns]);assert.equal(links.length,1);assert.equal(links[0].member_reference,'MN-77');
 await cmd('arrive',{id:b1});let o=await orderOf(b1);assert.equal(+o.price,400,'list price');assert.equal(+o.discount,0);
 const qt=await q("select authorization_ref,snapshot from clinic_reception.order_quotes where order_id=$1",[o.id]);
 assert.equal(qt.length,1);assert.equal(qt[0].authorization_ref,'AP-1');assert.equal(+qt[0].snapshot.coverage,80);assert.equal(qt[0].snapshot.entity_name,'ميد نت');
 await cmd('execute',{id:o.id});s=await snap();const cl=(await q("select c.amount from clinic_reception.claims c join clinic_reception.invoices i on i.id=c.invoice_id where i.order_id=$1",[o.id]))[0];assert.equal(+cl.amount,320,'entity share 400×80%');
 const inv=s.invoices.find(i=>i.order_id===o.id);assert.equal(+inv.due,80,'patient share 400×20%');
 // second booking of the same patient on the same contract: no duplicate link
 const b2=(await book(A,{...ct,payer_auth_ref:'AP-2'})).id;assert.equal((await q("select count(*)::int n from public.contract_patient_links"))[0].n,1);
 // set_payer on a booked appointment: contract → cash (+vezeeta) → union
 await cmd('set_payer',{id:b2,payer_kind:'cash',discount_kind:'vezeeta',discount_card_no:'VZ1',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/card1.jpg'});
 a=await ap(b2);assert.equal(a.payer_kind,'cash');assert.equal(a.payer_contract_id,null);assert.equal(a.discount_kind,'vezeeta');
 const un={payer_kind:'union',payer_union:'نقابة المهندسين',payer_card_no:'EN-5',payer_card_expiry:'2030-01-01',payer_card_path:'u/'+w+'/card1.jpg'};
 await assert.rejects(()=>cmd('set_payer',{id:b2,...un,payer_union:''}),/النقابة \/ النادي/);
 await cmd('set_payer',{id:b2,...un});a=await ap(b2);
 assert.equal(a.payer_kind,'union');assert.equal(a.discount_kind,'syndicate');assert.equal(+a.discount_percent,30);assert.equal(a.discount_org_name,'نقابة المهندسين');
 await cmd('set_payer',{id:b2,payer_kind:'cash'});a=await ap(b2);assert.equal(a.discount_kind,null,'leaving union clears its 30%');
 await cmd('set_payer',{id:b2,payer_kind:'union',payer_union:'',payer_union_other:'نادي الصيد',payer_card_no:'C-1',payer_card_expiry:'2030-01-01',payer_card_path:'u/'+w+'/card1.jpg'});
 a=await ap(b2);assert.equal(a.discount_org_type,'club');assert.equal(a.discount_org_name,'نادي الصيد');
 await cmd('arrive',{id:b2});o=await orderOf(b2);assert.equal(+o.discount,30,'union 30% at arrival');
 // walk-in with a payer kind; reschedule changes it
 const wk=(await cmd('walk_in',{patient_id:B,provider_id:provider,service_id:svc,...ct,payer_auth_ref:'AP-3'})).id;assert.equal((await ap(wk)).payer_kind,'contract');
 const r1=(await book(C,{payer_kind:'cash'})).id;a=await ap(r1);assert.equal(a.payer_kind,'cash');
 const r1b=(await cmd('reschedule',{id:r1,patient_id:C,provider_id:provider,service_id:svc,starts_at:a.starts_at,same_day_ok:true,...ct,payer_auth_ref:'AP-4'})).id||r1;
 assert.equal((await ap(r1b)).payer_kind,'contract');
 // book cash + vezeeta: the discount is applied once (not doubled by set_payer); reschedule union → cash without discount clears the 30%
 const vz={discount_kind:'vezeeta',discount_card_no:'VZ2',discount_card_expiry:'2030-01-01',discount_card_path:'u/'+w+'/card1.jpg'};
 const r3=(await book(B,{payer_kind:'cash',...vz})).id;a=await ap(r3);assert.equal(a.payer_kind,'cash');assert.equal(a.discount_kind,'vezeeta');
 const r4=(await book(C,un)).id;a=await ap(r4);assert.equal(a.discount_kind,'syndicate');
 await cmd('reschedule',{id:r4,patient_id:C,provider_id:provider,service_id:svc,starts_at:a.starts_at,same_day_ok:true,payer_kind:'cash'});a=await ap(r4);
 assert.equal(a.payer_kind,'cash');assert.equal(a.discount_kind,null,'union 30% cleared when switching to cash');
 // after arrival (service still «ordered»): cash → contract via order_payer
 const r2=(await book(D,{payer_kind:'cash'})).id;await cmd('arrive',{id:r2});o=await orderOf(r2);assert.equal(+o.price,500);
 const op=await cmd('order_payer',{order_id:o.id,...ct,payer_auth_ref:'AP-5',payer_coverage_percent:'70'});assert.equal(+op.patient_share,120);
 o=await orderOf(r2);assert.equal(+o.price,400);
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='order_payer' and entity_id=$1",[o.id]))[0].n,1);
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where detail ? 'payer_proof_path'"))[0].n,0,'photo paths not in the audit');
 // after arrival: a visit that already has a discount cannot become contract
 o=await orderOf(b2);await assert.rejects(()=>cmd('order_payer',{order_id:o.id,...ct}),/عليها خصم/);
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261123070000_booking_payer_kind.rollback.sql','utf8'));
 assert.equal((await q("select to_regprocedure('clinic_reception.set_payer(uuid,uuid,jsonb,uuid)') r"))[0].r,null);
 await assert.rejects(()=>cmd('set_payer',{id:r1b,payer_kind:'cash'}));
 console.log('PASS booking payer kind: options (active contracts + active lists only, blocked services, unions), contract validation (coverage, approval no, photo in storage), patient auto-link, arrival quote at list price with typed coverage → claim/patient share, set_payer cash/union (30%)/club, walk-in + reschedule carry it, order_payer after arrival, audit without photo paths, rollback — as a reception user');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
