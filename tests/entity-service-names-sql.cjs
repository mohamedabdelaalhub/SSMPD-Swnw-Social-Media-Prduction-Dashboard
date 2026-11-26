// 20261126090000 «اسم سونو واسم الجهة» (owner 2026-11-26 «طبقه»): the entity services RPC + the quote snapshot keys — as a reception user, live.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere','booking_payer_kind']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const yday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department||s.providers[0].specialty;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 for(const [code,name,price] of [['KSF','كشف تجريبي',500],['XR','أشعة صدر',800],['LAB','صورة دم كاملة',150]])await cmd('service',{code,name,department:dept,price,minutes:15,bom:[]});
 s=await snap();const sv=c=>s.services.find(x=>x.code===c).id,KSF=sv('KSF'),XR=sv('XR'),LAB=sv('LAB');
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'KSF',rate:20,deduct_material_cost:false,from:yday,to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 for(const c of ['XR','LAB']){const g=(await cmd('agreement',{provider_id:provider,service_code:c,rate:20,deduct_material_cost:false,from:yday,to:'2030-01-01',reference:'AG-'+c})).id;await as(2);await cmd('agreement_review',{id:g,approve:true});await as(1);}
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 // live-shaped stubs (supabase/live-capture + 20261024183344: items.external_code / external_name, aliases.scope_key)
 await db.exec('reset role');await db.exec(`
  create table public.contracting_entities(id uuid primary key default gen_random_uuid(),name text not null,category text not null);
  create table public.contracting_entity_contracts(id uuid primary key default gen_random_uuid(),entity_id uuid not null references public.contracting_entities(id),status text not null,start_date date,end_date date);
  create table public.pricing_services(id uuid primary key default gen_random_uuid(),name text);
  alter table clinic_reception.services add column pricing_service_id uuid;
  create schema clinic_prices;
  create table clinic_prices.lists(id uuid primary key default gen_random_uuid(),name text not null,version int not null default 1,contract_id uuid,mode text,fallback text not null,discount_percent numeric,discount_amount numeric,valid_from date not null,valid_to date not null,status text not null);
  create table clinic_prices.items(id uuid primary key default gen_random_uuid(),list_id uuid not null,service_id uuid not null,fixed_price numeric,discount_percent numeric,discount_amount numeric,external_code text not null default '',external_name text not null default '',unique(list_id,service_id));
  create table clinic_prices.aliases(id uuid primary key default gen_random_uuid(),scope_key text not null,external_code text not null default '',external_name text not null,unit text not null default '',service_id uuid not null,list_id uuid not null);
  create table public.contract_patient_links(id uuid primary key default gen_random_uuid(),contract_id uuid not null,patient_id uuid not null,member_reference text,insurance_plan_id uuid,linked_from date not null,linked_until date,linked_by uuid);
  create schema storage;create table storage.objects(bucket_id text,name text);`);
 const one=async(sql,a)=>(await db.query(sql,a)).rows[0];
 const ins=(await one("insert into public.contracting_entities(name,category) values('ميد نت','insurance') returning id")).id,neg=(await one("insert into public.contracting_entities(name,category) values('مصر هيلث كير','insurance') returning id")).id;
 const cIns=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'active',$2) returning id",[ins,yday])).id;
 const cNeg=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'negotiating',$2) returning id",[neg,yday])).id;
 const ps={};for(const c of ['KSF','XR','LAB']){ps[c]=(await one("insert into public.pricing_services(name) values($1) returning id",[c])).id;await db.query("update clinic_reception.services set pricing_service_id=$1 where id=$2",[ps[c],sv(c)]);}
 const lid=(await one("insert into clinic_prices.lists(name,contract_id,fallback,valid_from,valid_to,status) values('لائحة 2026',$1,'block',$2,'2030-01-01','active') returning id",[cIns,yday])).id;
 const old=(await one("insert into clinic_prices.lists(name,contract_id,fallback,valid_from,valid_to,status) values('لائحة 2025',$1,'block','2025-01-01','2025-12-31','retired') returning id",[cIns])).id;
 await db.query("insert into clinic_prices.items(list_id,service_id,fixed_price,external_name,external_code) values($1,$2,400,'Consultation GP','C-01'),($1,$3,null,'',''),($4,$2,300,'OLD NAME','OLD-1')",[lid,ps.KSF,ps.XR,old]);
 await db.query("update clinic_prices.items set discount_percent=25 where list_id=$1 and service_id=$2",[lid,ps.XR]);
 await db.query("insert into clinic_prices.aliases(scope_key,external_code,external_name,service_id,list_id) values($1,'XR-9','Chest X-Ray PA',$2,$3),('center','ZZ-1','Center only alias',$2,$3),($4,'OLD-9','Old list alias',$2,$5)",['list:'+lid,ps.XR,lid,'list:'+old,old]);
 const proof='u/'+w+'/auth1.jpg';await db.query("insert into storage.objects values('booking-discount-cards',$1)",[proof]);
 await db.exec('update clinic_reception.settings set live_enabled=true,cutover_at=now()').catch(()=>{});
 // bookings made BEFORE the migration: their quote has no entity keys («اسم الجهة مش متسجل» in PART B)
 let slot=4*60;const nowMin=(()=>{const d=new Date();return d.getUTCHours()*60+d.getUTCMinutes();})();
 const next=()=>{do slot+=20;while(Math.abs(slot-nowMin)<75);const h=String(Math.floor(slot/60)).padStart(2,'0'),m=String(slot%60).padStart(2,'0');return date+'T'+h+':'+m+':00Z';};
 const pat=async n=>{const arch=(await one("insert into public.patients(id) values(gen_random_uuid()) returning id")).id;
   return (await one("insert into clinic_reception.patients(workspace_id,patient_id,file_no,name,phone,created_by) values($1,$2,$3,$4,'01000000000',$5) returning id",[w,arch,'F'+n,'مريض '+n,id(1)])).id;};
 const A=await pat(1),B=await pat(2),C=await pat(3),D=await pat(4);
 await as(3);
 const ct={payer_kind:'contract',payer_contract_id:cIns,payer_coupon_no:'MN-77',payer_auth_ref:'AP-1',payer_coverage_percent:'80',payer_proof_path:proof};
 const book=(p,extra,service=KSF)=>cmd('book',{patient_id:p,provider_id:provider,service_id:service,starts_at:next(),same_day_ok:true,...extra});
 const orderOf=async a=>{const s2=await snap();return s2.orders.find(o=>s2.visits.find(v=>v.id===o.visit_id).appointment_id===a);};
 const quote=async a=>{const o=await orderOf(a);return (await q("select snapshot from clinic_reception.order_quotes where order_id=$1",[o.id]))[0];};
 const pre=(await book(A,ct)).id;await cmd('arrive',{id:pre});assert.equal('entity_service_name' in (await quote(pre)).snapshot,false,'old quotes: no keys');
 // apply (twice refused)
 await db.exec('reset role');const M=fs.readFileSync('supabase/migrations/20261126090000_entity_service_names.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback').catch(()=>{});
 const priv=(await db.query("select has_function_privilege('anon','public.clinic_reception_entity_services(uuid,uuid,date)','execute') a,has_function_privilege('authenticated','public.clinic_reception_entity_services(uuid,uuid,date)','execute') u,has_function_privilege('authenticated','clinic_reception.entity_service_name(uuid,uuid,date)','execute') h,has_function_privilege('authenticated','clinic_reception.payer_quote_before_entity_names(uuid,uuid)','execute') b")).rows[0];
 assert.deepEqual(priv,{a:false,u:true,h:false,b:false},'grant to authenticated only; helpers private');
 const cfg=(await db.query("select p.prosecdef d,p.proconfig c from pg_proc p where p.proname='clinic_reception_entity_services'")).rows[0];assert.equal(cfg.d,true);assert.match(String(cfg.c),/search_path=pg_catalog, public/);
 await as(3);
 // the entity list (as reception): every active service; price = payer_price; blocked rows; names / codes / aliases of THIS list only
 const L=await rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:cIns,p_day:date}),row=c=>L.find(x=>x.code===c);
 assert.equal(L.length,(await snap()).services.length,'one row per active service');
 const k=row('KSF'),x=row('XR'),l=row('LAB');
 assert.deepEqual([k.name,k.entity_name,k.entity_code,+k.price,k.blocked],['كشف تجريبي','Consultation GP','C-01',400,false]);
 assert.deepEqual([x.entity_name,x.entity_code,+x.price,x.blocked],[null,null,600,false],'no own name → null (UI «نفس اسم سونو»); 800 −25%');
 assert.deepEqual(x.aliases,[{name:'Chest X-Ray PA',code:'XR-9'}],'aliases of list:<this list> only');
 assert.deepEqual(k.aliases,[]);assert.deepEqual([l.blocked,l.price,l.entity_name],[true,null,null],'not in the list → blocked');
 for(const r of L.filter(r=>!['KSF','XR','LAB'].includes(r.code)))assert.equal(r.blocked,true,'no pricing mapping → blocked (save refuses it too)');
 for(const r of L.filter(r=>['KSF','XR','LAB'].includes(r.code))){const pp=(await q("select clinic_reception.payer_price($1,$2,$3) v",[cIns,r.service_id,date]))[0].v;
   assert.equal(r.blocked,!!pp.blocked,'blocked = payer_price');if(!r.blocked)assert.equal(+r.price,+pp.price,'price = payer_price');}
 // matching data the search uses: Sono name, Sono code, entity name, entity code, alias name / code
 const hay=r=>[r.name,r.code,r.entity_name,r.entity_code,...r.aliases.flatMap(a=>[a.name,a.code])].filter(Boolean).join(' ').toLowerCase();
 const find=t=>L.filter(r=>t.toLowerCase().split(' ').every(w2=>hay(r).includes(w2))).map(r=>r.code);
 assert.deepEqual(find('كشف تجريبي'),['KSF']);assert.deepEqual(find('ksf'),['KSF']);assert.deepEqual(find('consultation gp'),['KSF']);assert.deepEqual(find('C-01'),['KSF']);
 assert.deepEqual(find('chest x-ray'),['XR']);assert.deepEqual(find('XR-9'),['XR']);assert.deepEqual(find('center only'),[]);assert.deepEqual(find('old'),[]);
 // refusals
 await assert.rejects(()=>rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:cNeg,p_day:date}),/مش متفعّل/);
 await assert.rejects(()=>rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:null,p_day:date}),/اختار الجهة/);
 await assert.rejects(()=>rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:cIns,p_day:'2031-01-01'}),/مفيش قايمة أسعار/);
 await db.exec('reset role');await db.query("insert into admins values('61000000-0000-4000-8000-000000000009','reception',true)");await db.query("select set_config('test.admin','61000000-0000-4000-8000-000000000009',false)");await db.exec('set role authenticated');
 await assert.rejects(()=>rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:cIns,p_day:date}),'not a workspace member');await as(3);
 // snapshot keys on save: arrival quote (book → arrive) with and without an own name
 const b1=(await book(B,ct)).id;await cmd('arrive',{id:b1});let qs=(await quote(b1)).snapshot;
 assert.equal(qs.entity_service_name,'Consultation GP');assert.equal(qs.entity_service_code,'C-01');assert.equal(qs.entity_name,'ميد نت');assert.equal(+qs.coverage,80,'old snapshot data kept');
 const b2=(await book(C,{...ct,payer_auth_ref:'AP-2'},XR)).id;await cmd('arrive',{id:b2});qs=(await quote(b2)).snapshot;
 assert.ok('entity_service_name' in qs&&'entity_service_code' in qs,'keys always present');assert.equal(qs.entity_service_name,null);assert.equal(qs.entity_service_code,null);
 assert.equal(+(await orderOf(b2)).price,600,'order at the entity price');
 // ⋯ «طريقة الدفع» after arrival (order_payer) carries them too
 const b3=(await book(D,{payer_kind:'cash'})).id;await cmd('arrive',{id:b3});let o3=await orderOf(b3);assert.equal(+o3.price,500,'cash unaffected');
 assert.equal((await q("select count(*)::int n from clinic_reception.order_quotes where order_id=$1",[o3.id]))[0].n,0,'cash: no quote');
 await cmd('order_payer',{order_id:o3.id,...ct,payer_auth_ref:'AP-3'});qs=(await quote(b3)).snapshot;assert.equal(qs.entity_service_name,'Consultation GP');assert.equal(qs.entity_service_code,'C-01');
 // blocked service still refused on save
 await assert.rejects(()=>book(A,{...ct,payer_auth_ref:'AP-4'},LAB),/مش في قايمة أسعار الجهة/);
 // rollback restores the previous payer_quote and drops the RPC
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261126090000_entity_service_names.rollback.sql','utf8'));
 const gone=(await db.query("select to_regprocedure('public.clinic_reception_entity_services(uuid,uuid,date)') r,to_regprocedure('clinic_reception.payer_quote_before_entity_names(uuid,uuid)') b,position('payer_quote_before' in pg_get_functiondef('clinic_reception.payer_quote(uuid,uuid)'::regprocedure)) p")).rows[0];
 assert.deepEqual(gone,{r:null,b:null,p:0});await as(3);
 await assert.rejects(()=>rpc('clinic_reception_entity_services',{p_workspace:w,p_contract:cIns,p_day:date}));
 const b4=(await book(D,{...ct,payer_auth_ref:'AP-5'})).id;await cmd('arrive',{id:b4});qs=(await quote(b4)).snapshot;assert.equal('entity_service_name' in qs,false);assert.equal(qs.entity_name,'ميد نت','quote still made after rollback');
 console.log('PASS entity service names SQL: RPC (reception, live) lists every active service under the chosen contract — price = payer_price, blocked rows, entity name / code from the list item + list:<id> aliases only, null = «نفس اسم سونو»; refuses inactive contract / no contract / no list / non-member; anon no grant, helpers private; quote snapshot keys entity_service_name / entity_service_code on arrival and order_payer (present-as-null without own name), old quotes untouched, cash unaffected; twice refused; rollback restores payer_quote');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
