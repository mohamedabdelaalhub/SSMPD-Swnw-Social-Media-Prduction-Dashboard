// 20261125210000 supplies at service — PR2 (PGlite). Boots the LIVE reception chain like tests/nursing-attendance-routing-sql.cjs
// (bridge live workspace + nursing day ops + doctor assistant + HR presence) + the real shift guard (20261123100000) + PR1, then this file.
//  A) «تنفيذ وتسجيل المستلزمات» (clinic_reception_performer): a dental nurse with NO reception membership lists and executes the dental
//     orders of today from «رئيسي أسنان» (PR1 billable / included split), «بدون مستلزمات» needs a reason, other department / wrong store /
//     trial workspace / reception-only refused, doctor assistant scoped by his provider departments, head nursing sees all,
//     no cash shift needed on the performer path while the normal command stays locked.
//  B) «طقم الفيتلة»: per-vital state saved with the triage; a recorded save consumes the kit of each measured vital at cost (5123, never
//     billed), idempotent on re-save, reversed (stock + journal back) when a vital turns refused, refused / not done / draft consume
//     nothing, missing stock or a wrong store never blocks the triage (warning), kit editor gated to head nursing.
//  Second run refused, rollback restores the nursing RPC and the shift guard.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const da=fs.readFileSync(path.join(__dirname,'doctor-assistant-nursing-sql.cjs'),'utf8');
const head=da.slice(0,da.indexOf('const body=`'));
const PEOPLE="create table if not exists clinic_people.people(code text unique default 'EMP-'||substr(md5(random()::text),1,6),admin_id uuid primary key,department text default '',job_title text default '',doctor_key text);";
const LAST="${mig('doctor_assistant_nursing_screen')}]";
assert(head.includes(PEOPLE)&&head.includes(LAST),'doctor-assistant-nursing-sql.cjs setup markers moved; update this test');
const HR="create table if not exists clinic_people.people(id uuid primary key default gen_random_uuid(),code text unique default 'EMP-'||substr(md5(random()::text),1,6),admin_id uuid unique,department text default '',job_title text default '',doctor_key text,status text not null default 'active',kind text not null default 'staff');"+
 "create table clinic_people.device_punches(id bigint generated always as identity primary key,device_id text not null,device_user_id int not null,ts timestamptz not null,punch smallint not null);"+
 "create table clinic_people.device_user_map(device_id text not null,device_user_id int not null,person_id uuid not null,primary key(device_id,device_user_id));"+
 "create table clinic_people.t_eval(person_id uuid primary key,template_name text default 'صباحي',exp_start timestamptz,exp_end timestamptz,first_in timestamptz,status text not null,late_min int default 0,excused boolean not null default false);"+
 "create function clinic_people.attendance_eval(p_day date,p_now timestamptz default now()) returns table(person_id uuid,template_name text,exp_start timestamptz,exp_end timestamptz,first_in timestamptz,status text,late_min int,excused boolean) language sql stable as $f$ select person_id,template_name,exp_start,exp_end,first_in,status,late_min,excused from clinic_people.t_eval $f$;";
const setup=head.replace(PEOPLE,HR).replace(LAST,"${mig('doctor_assistant_nursing_screen')},${mig('nursing_attendance_routing')}]");

/* eslint-disable no-undef */
async function bodyFn(){
const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const MIG='supabase/migrations/20261125200000_supplies_billable_at_service.sql',ME='supabase/migrations/20261125210000_supplies_performer_vitals.sql',RB='supabase/rollbacks/20261125210000_supplies_performer_vitals.rollback.sql';
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
// live semantics: extra roles count in has_role; cash shift lock = a reception account (not super admin / GM) with no open shift
await q(`create or replace function public.has_role(r text) returns boolean language sql stable as $f$select exists(select 1 from admins where id=my_admin_id() and role=r and active) or exists(select 1 from admin_extra_roles x join admins a on a.id=x.admin_id where a.id=my_admin_id() and a.active and x.role=r)$f$`);
await q(`create or replace function clinic_reception.shift_guard_state() returns jsonb language sql stable as $f$select case when public.has_role('reception') and not public.has_role('super_admin') and not public.has_role('general_manager') then '{"locked":true,"reason":"need_open"}'::jsonb else '{"locked":false}'::jsonb end$f$`);
{const sg=require('fs').readFileSync(require('fs').readdirSync('supabase/migrations').map(f=>'supabase/migrations/'+f).find(f=>f.endsWith('_reception_shift_guard.sql')),'utf8');   // the real check + the real command wrapper
 await db.exec('reset role;'+sg.slice(sg.indexOf('create function clinic_reception.shift_guard_check'),sg.indexOf('-- today-board journey command')));await as(1);}
// live access layers: the bridge chain here only has the member-based access; live has
// access → … → access_before_management_pilot (20261103 journey permissions: execute for reception / nursing / head nursing / doctor,
// + doctor_assistant patched by 20261120290000 in this chain, + super admin / GM by 20261117180000 applied here) → workspace_access (members).
assert.equal((await q(`select to_regprocedure('clinic_reception.workspace_access(uuid,text)') f`))[0].f,null);
assert.match((await q(`select pg_get_functiondef('clinic_reception.access_before_management_pilot(uuid,text)'::regprocedure) d`))[0].d,/doctor_assistant/);
await db.exec(`reset role;alter function clinic_reception.access(uuid,text) rename to workspace_access;
 create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $f$begin return clinic_reception.access_before_management_pilot(p_workspace,p_action);end$f$;`);
await db.exec('reset role;'+require('fs').readFileSync(require('fs').readdirSync('supabase/migrations').map(f=>'supabase/migrations/'+f).find(f=>f.endsWith('_reception_super_admin_access.sql')),'utf8'));await as(1);
// stores of the owner rule (PR1 seeds the map from them)
await q(`alter table public.inventory_locations add column if not exists is_main boolean not null default false`);
await q(`insert into public.inventory_locations(id,name,kind,active,is_main,branch_id) select x.id,x.n,'substore',true,x.m,(select branch_id from public.inventory_locations where branch_id is not null limit 1) from (values('0a000000-0000-4000-8000-000000000001'::uuid,'فرعي مستلزمات تمريض',false),('0a000000-0000-4000-8000-000000000002'::uuid,'رئيسي أدوية',true),('552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7'::uuid,'رئيسي أسنان',true)) x(id,n,m)`);
await db.exec('reset role;'+require('fs').readFileSync(MIG,'utf8'));
await db.exec('reset role;'+require('fs').readFileSync(ME,'utf8'));
await assert.rejects(()=>db.exec('reset role;'+require('fs').readFileSync(ME,'utf8')),/تم تطبيق هذا الملف من قبل/);await as(1);
const L=async n=>(await q(`select l.id from clinic_reception.locations l join public.inventory_locations i on i.id=l.inventory_location_id where l.workspace_id=$1 and i.name=$2`,[live,n]))[0].id;
const NURSE=await L('فرعي مستلزمات تمريض'),MEDS=await L('رئيسي أدوية'),DENT=await L('رئيسي أسنان');
// items linked to the real inventory, stock in the dental + nursing stores
const mkItem=async(code,name,cost,qty,billable)=>{const inv=(await q(`insert into public.inventory_items(name,base_unit) values($1,'قطعة') returning id`,[name]))[0].id;
 if(billable)await q(`update public.inventory_items set patient_billable=true where id=$1`,[inv]);
 const r=(await cmd(live,'item',{code,name,unit:'قطعة',markup:50})).id;await cmd(live,'master_link',{kind:'item',id:r,external_id:inv});
 for(const st of ['552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7','0a000000-0000-4000-8000-000000000001'])if(qty){const lot=(await q(`insert into public.inventory_lots(item_id,lot_number,expiry_date,received_quantity,unit_cost,created_by) values($1,$2,'2031-01-01',$3,$4,$5) returning id`,[inv,code+'-'+st.slice(0,4),qty,cost,id(1)]))[0].id;
  await q(`insert into public.inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,created_by) values($1,$2,$3,'opening_balance',$4,$5,'opening',$6)`,[inv,st,lot,qty,cost,id(1)]);}
 return r;};
const GLV=await mkItem('GLV','جلافز',1,100),ANS=await mkItem('ANS','كارتريدج بنج',10,50,true),LNC=await mkItem('LNC','شكاكة سكر',2,20),STR=await mkItem('STR','شريحة سكر',4,20),CTN=await mkItem('CTN','قطن',0.5,50),ALC=await mkItem('ALC','كحول',1.5,50),TCV=await mkItem('TCV','غطا ترمومتر',1,20),SCL=await mkItem('SCL','ورق ميزان',1,0);
assert.equal((await q('select patient_billable from clinic_reception.items where id=$1',[ANS]))[0].patient_billable,true,'billable flag mirrored');
// dental doctor + service + agreement
const dentist=(await cmd(live,'provider',{name:'د. أسنان',department:'الاسنان',branch:'حدائق الأهرام'})).id;await q("update clinic_reception.providers set doctor_key='DK-DENT' where id=$1",[dentist]);
const dsvc=(await cmd(live,'service',{code:'DENT',name:'أسنان — حشو عصب',department:'الاسنان',price:300,minutes:30,bom:[{item_id:GLV,quantity:2,included:true},{item_id:ANS,quantity:1,included:true}]})).id;
const ag=(await cmd(live,'agreement',{provider_id:dentist,service_code:'DENT',rate:0,from:date,to:'2030-01-01',reference:'PF-AG'})).id;await as(3);await cmd(live,'agreement_review',{id:ag,approve:true});await as(1);
await cmd(live,'availability',{provider_id:dentist,starts_at:date+'T05:00Z',ends_at:date+'T20:00Z'});await cmd(live,'availability',{provider_id:provider,starts_at:date+'T05:00Z',ends_at:date+'T20:00Z'});
let hr=5,pn=0;const newPatient=async()=>{const ap=(await q("insert into patients(patient_code,full_name,phone) values($1,$2,$3) returning id",['PF-'+(++pn),'مريض تجريبي '+pn,'0101000000'+pn]))[0].id;return (await cmd(live,'patient_attach',{patient_id:ap})).id;};
const visit=async(prov,svc)=>{const pt=await newPatient();const a=(await cmd(live,'book',{patient_id:pt,provider_id:prov,service_id:svc,starts_at:date+'T'+String(++hr).padStart(2,'0')+':10Z'})).id;const v=(await cmd(live,'arrive',{id:a,encounter_type:'session'})).id;
 const o=(await q('select id from clinic_reception.orders where visit_id=$1',[v]))[0].id;return {a,v,o};};
// people: Hoda (dental nurse, NOT a reception member), a general nurse, Mazen (reception), a dental doctor assistant, head nursing, nurse+reception
const ppl=[[51,'nursing','هدى حمدى ابراهيم','التمريض','ممرضة أسنان',null],[52,'nursing','ممرضة عام','التمريض','تمريض',null],[53,'reception','مازن','الاستقبال','استقبال',null],
 [54,'doctor_assistant','مساعد أسنان','الاسنان','مساعد طبيب','DK-DENT'],[55,'head_nursing','رئيسة التمريض','التمريض','رئيسة التمريض',null],[56,'reception','استقبال وتمريض','التمريض','ممرضة أسنان',null]];
for(const [k,ro,nm,dp,jt,code] of ppl){await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,$4,true) on conflict (id) do update set role=$4,active=true,name=$3",[id(k),'p'+k+'@test',nm,ro]);
 await q("insert into clinic_people.people(admin_id,department,job_title,code) values($1,$2,$3,coalesce($4,'EMP-P'||$5::text))",[id(k),dp,jt,code,String(k)]);}
await q("insert into public.admin_extra_roles(admin_id,role) values($1,'nursing')",[id(56)]);
await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','book','execute']) on conflict do nothing",[live,id(53)]);
assert.equal((await q('select count(*)::int n from clinic_reception.members where workspace_id=$1 and admin_id=$2',[live,id(51)]))[0].n,0,'Hoda is not a reception member');
// Hoda present → dental covered (general nursing does not see it)
for(const k of [51,52]){const pid=(await q('select id from clinic_people.people where admin_id=$1',[id(k)]))[0].id;await q("insert into clinic_people.t_eval(person_id,status,exp_start,exp_end,first_in) values($1,'on_time',now()-interval '1 hour',now()+interval '6 hours',now()-interval '50 minutes')",[pid]);}
const P=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_performer',[live,a,p||{}]);}finally{await as(1);}};
const N=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_nursing',[live,a,p||{}]);}finally{await as(1);}};
const moves=async src=>(await q(`select i.code,m.kind,sum(-m.quantity)::numeric q from clinic_reception.movements m join clinic_reception.items i on i.id=m.item_id where m.source_id=$1 group by 1,2 order by 1,2`,[src])).map(r=>r.code+':'+r.kind+':'+Number(r.q));
const inv=async o=>Number(((await q('select amount from clinic_reception.invoices where order_id=$1',[o]))[0]||{}).amount||0);
const stockAt=async(it,locId)=>Number((await q('select coalesce(sum(quantity),0) n from clinic_reception.movements where item_id=$1 and location_id=$2',[it,locId]))[0].n);

const d1=await visit(dentist,dsvc),g1=await visit(provider,service);
// A) gate + scope
let t=await P(51,'today');assert.deepEqual(t.orders.map(x=>x.id),[d1.o],'Hoda sees the dental order only');assert.equal(t.orders[0].patient_name.startsWith('مريض تجريبي'),true);
assert.deepEqual(t.locations.map(x=>x.id),[DENT,MEDS],'dental store first, medicines last, no nursing store');
const bom=t.orders[0].bom;assert.equal(bom.find(x=>x.item_id===ANS).billable,true);assert.equal(bom.find(x=>x.item_id===GLV).billable,false);
assert.equal((await P(52,'today')).orders.some(x=>x.id===d1.o),false,'general nurse: dental is covered by Hoda');
assert.equal((await P(52,'today')).orders.some(x=>x.id===g1.o),true,'general nurse sees the skin order');
assert.deepEqual((await P(54,'today')).orders.map(x=>x.id),[d1.o],'doctor assistant: his provider department');
{const all=(await P(55,'today')).orders.map(x=>x.id);assert(all.includes(d1.o)&&all.includes(g1.o),'head nursing sees all departments');}
await assert.rejects(()=>P(53,'today'),/بينفّذ الخدمة/,'reception-only refused');
await assert.rejects(()=>P(51,'execute',{order_id:g1.o,location_id:NURSE,materials:[]}),/مش من قسمك/);
await assert.rejects(()=>P(51,'execute',{order_id:d1.o,location_id:NURSE,materials:[{item_id:GLV,quantity:2},{item_id:ANS,quantity:1}]}),/مش مسموح يتصرف منه/);
await assert.rejects(()=>P(51,'execute',{order_id:d1.o,materials:[{item_id:GLV,quantity:2},{item_id:ANS,quantity:1}]}),/اختار المخزن/);
await as(51);await assert.rejects(()=>call('clinic_reception_performer',[trial,'today',{}]),/الفعلية بس/);await as(1);
// execute through PR1's split: gloves at cost, anaesthetic billed at its sale price
const tok=key();let r=await P(51,'execute',{order_id:d1.o,location_id:DENT,materials:[{item_id:GLV,quantity:2},{item_id:ANS,quantity:1}],token:tok});
const ansPrice=Number((await q('select sale_price from clinic_reception.items where id=$1',[ANS]))[0].sale_price);assert(ansPrice>0);
assert.equal(await inv(d1.o),300+ansPrice,'service + billable anaesthetic');assert.deepEqual(await moves(d1.o),['ANS:sale:1','GLV:included:2']);
assert.equal(Number(r.invoice_amount),300+ansPrice);
assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='performer_execute' and entity_id=$1 and actor_id=$2",[d1.o,id(51)]))[0].n,1);
await assert.rejects(()=>P(51,'execute',{order_id:d1.o,location_id:DENT,materials:[]}),/اتنفذت قبل كده/);
t=await P(51,'today');assert.equal(t.orders[0].status,'completed');assert.equal(t.orders[0].can_execute,false);
// «بدون مستلزمات (سبب)»
const d2=await visit(dentist,dsvc);
await assert.rejects(()=>P(51,'execute',{order_id:d2.o,no_materials:true,material_note:''}),/اكتب سبب/);
await P(51,'execute',{order_id:d2.o,no_materials:true,material_note:'المريض رفض البنج'});assert.equal(await inv(d2.o),300);assert.deepEqual(await moves(d2.o),[]);
// cash shift: a nurse who is also a reception account is locked on the desk command, not on the performer path
const d3=await visit(dentist,dsvc);
await as(56);await assert.rejects(()=>call('clinic_reception_command',[live,'execute',{id:d3.o,location_id:DENT},key()]),/افتح وردية الخزينة/);await as(1);
await P(56,'execute',{order_id:d3.o,location_id:DENT,materials:[{item_id:GLV,quantity:2},{item_id:ANS,quantity:1}]});assert.equal(await inv(d3.o),300+ansPrice);
assert.equal((await q("select current_setting('clinic_reception.performer_exec',true) s"))[0].s||'','','flag is transaction-local');
const d4=await visit(dentist,dsvc);await as(56);await assert.rejects(()=>call('clinic_reception_command',[live,'execute',{id:d4.o,location_id:DENT},key()]),/افتح وردية الخزينة/,'still locked after');await as(1);

// B) vitals kit
assert.equal((await N(51,'triage_get',{appointment_id:d1.a})).vitals_kit.kit.length,0,'kit starts empty');
await as(51);await assert.rejects(()=>call('clinic_reception_vitals_kit',[live,'list',{}]),/رئيسة التمريض/);await as(1);
await as(55);let kit=await call('clinic_reception_vitals_kit',[live,'save',{lines:[{vital:'sugar',item_id:LNC,quantity:1},{vital:'sugar',item_id:STR,quantity:1},{vital:'sugar',item_id:CTN,quantity:1},{vital:'sugar',item_id:ALC,quantity:1},
 {vital:'temp',item_id:TCV,quantity:1},{vital:'spo2',item_id:CTN,quantity:1},{vital:'spo2',item_id:ALC,quantity:1},{vital:'weight',item_id:SCL,quantity:1}]}]);await as(1);
assert.equal(kit.kit.length,8);await as(55);await assert.rejects(()=>call('clinic_reception_vitals_kit',[live,'save',{lines:[{vital:'eyes',item_id:CTN,quantity:1}]}]),/قياس غير معروف/);await as(1);
const before={LNC:await stockAt(LNC,DENT),STR:await stockAt(STR,DENT),CTN:await stockAt(CTN,DENT),ALC:await stockAt(ALC,DENT),TCV:await stockAt(TCV,DENT)};
const base={appointment_id:d1.a,bp_sys:120,bp_dia:80,pulse:82,temp_c:37.1,spo2:98,sugar_mgdl:110};
// draft: states stored, nothing consumed
r=await N(51,'triage_save',Object.assign({},base,{status:'draft',vital_states:{bp:'measured',pulse:'measured',temp:'measured',spo2:'refused',sugar:'measured'}}));
assert.equal(r.vitals.draft,true);assert.equal((await q('select count(*)::int n from clinic_reception.vitals_consumptions'))[0].n,0);
assert.equal((await q('select vital_states->>$2 s,spo2 from clinic_reception.visit_triage where appointment_id=$1',[d1.a,'spo2']))[0].s,'refused');
assert.equal((await q('select spo2 from clinic_reception.visit_triage where appointment_id=$1',[d1.a]))[0].spo2,null,'a refused vital keeps no value');
// recorded: sugar + temp consumed from the dental store; spo2 refused → nothing; weight not done → nothing; bp/pulse have no kit
r=await N(51,'triage_save',Object.assign({},base,{status:'recorded',vital_states:{bp:'measured',pulse:'measured',temp:'measured',spo2:'refused',sugar:'measured',weight:'not_done'}}));
assert.deepEqual(r.vitals.consumed.slice().sort(),['sugar','temp']);assert.deepEqual(r.vitals.warnings,[]);
assert.equal(await stockAt(LNC,DENT),before.LNC-1);assert.equal(await stockAt(STR,DENT),before.STR-1);assert.equal(await stockAt(CTN,DENT),before.CTN-1);assert.equal(await stockAt(TCV,DENT),before.TCV-1);
const cons=await q(`select id,vital,cost from clinic_reception.vitals_consumptions where appointment_id=$1 and reversed_at is null order by vital`,[d1.a]);assert.deepEqual(cons.map(x=>x.vital),['sugar','temp']);
assert.deepEqual(await moves(cons[0].id),['ALC:included:1','CTN:included:1','LNC:included:1','STR:included:1'],'cost only, never sale');
assert.equal(Number(cons[0].cost),2+4+0.5+1.5);
const j5123=async()=>Number((await q(`select coalesce(sum(l.debit-l.credit),0) n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=$1 and l.account='5123' and (j.dimensions->>'order_id' in (select id::text from clinic_reception.vitals_consumptions) or j.dimensions->>'vital' is not null)`,[live]))[0].n);
assert.equal(await j5123(),8+1,'5123 = sugar kit 8 + thermometer cover 1');
assert.equal(await inv(d1.o),300+ansPrice,'the patient invoice is untouched');
// re-save: idempotent
r=await N(51,'triage_save',Object.assign({},base,{status:'recorded',vital_states:{bp:'measured',pulse:'measured',temp:'measured',spo2:'refused',sugar:'measured'}}));
assert.deepEqual(r.vitals.consumed,[]);assert.equal(await stockAt(LNC,DENT),before.LNC-1);assert.equal((await q('select count(*)::int n from clinic_reception.vitals_consumptions'))[0].n,2);
// triage_get shows the kit, the stores and what was consumed
const g=await N(51,'triage_get',{appointment_id:d1.a});assert.equal(g.triage.vital_states.sugar,'measured');assert.equal(g.vitals_kit.kit.length,8);
assert.deepEqual(g.vitals_kit.locations.map(x=>x.id),[DENT,MEDS]);assert.deepEqual(g.vitals_kit.consumed.map(x=>x.vital).sort(),['sugar','temp']);
// sugar becomes «رفض» → its kit is reversed (stock and journal back), temp stays
r=await N(51,'triage_save',Object.assign({},base,{status:'recorded',vital_states:{bp:'measured',pulse:'measured',temp:'measured',spo2:'refused',sugar:'refused'}}));
assert.deepEqual(r.vitals.reversed,['sugar']);assert.equal(await stockAt(LNC,DENT),before.LNC);assert.equal(await stockAt(STR,DENT),before.STR);assert.equal(await stockAt(CTN,DENT),before.CTN);assert.equal(await stockAt(ALC,DENT),before.ALC);
assert.deepEqual(await moves(cons[0].id),['ALC:included:0','CTN:included:0','LNC:included:0','STR:included:0'],'net zero per item');
assert.equal(await j5123(),1,'5123 back to the thermometer cover only');
assert.equal(Number((await q(`select reversal_cost from clinic_reception.vitals_consumptions where id=$1`,[cons[0].id]))[0].reversal_cost),8);
assert.equal(await stockAt(TCV,DENT),before.TCV-1);
// measured again → a new consumption (not a double)
r=await N(51,'triage_save',Object.assign({},base,{status:'recorded',vital_states:{bp:'measured',pulse:'measured',temp:'measured',spo2:'refused',sugar:'measured'}}));
assert.deepEqual(r.vitals.consumed,['sugar']);assert.equal(await stockAt(LNC,DENT),before.LNC-1);
// a value without an explicit state counts as measured (old screens); no value = not done
r=await N(51,'triage_save',{appointment_id:d1.a,status:'recorded',bp_sys:120,bp_dia:80,temp_c:37,sugar_mgdl:120});
assert.equal(r.vitals.states.spo2,'not_done');assert.equal(r.vitals.states.sugar,'measured');assert.deepEqual(r.vitals.consumed,[]);
// weight kit has no stock → the triage is still saved, with a warning; wrong store → warning; nothing consumed for weight
r=await N(51,'triage_save',{appointment_id:d1.a,status:'recorded',bp_sys:120,bp_dia:80,temp_c:37,sugar_mgdl:120,weight_kg:70});
assert.equal(r.ok,true);assert.equal(r.vitals.warnings.length,1);assert.equal(r.vitals.warnings[0].vital,'weight');assert.match(r.vitals.warnings[0].message,/مفيش رصيد/);
assert.equal(Number((await q('select weight_kg from clinic_reception.visit_triage where appointment_id=$1',[d1.a]))[0].weight_kg),70,'clinical data saved');
r=await N(51,'triage_save',{appointment_id:d2.a,status:'recorded',spo2:97,kit_location_id:NURSE});
assert.equal(r.ok,true);assert.match(r.vitals.warnings[0].message,/مش مسموح/);assert.equal((await q('select count(*)::int n from clinic_reception.vitals_consumptions where appointment_id=$1',[d2.a]))[0].n,0);
r=await N(51,'triage_save',{appointment_id:d2.a,status:'recorded',spo2:97,kit_location_id:MEDS});
assert.match(r.vitals.warnings[0].message,/المخزون المتاح غير كاف|الرصيد/,'medicines store has no cotton → warning, not an error');
r=await N(51,'triage_save',{appointment_id:d2.a,status:'recorded',spo2:97});assert.deepEqual(r.vitals.consumed,['spo2'],'auto store = dental');
assert.equal((await q("select count(*)::int n from clinic_reception.visit_triage_log where appointment_id=$1 and action='vitals_kit'",[d1.a]))[0].n>=5,true);
// helpers are not callable by clients
await as(51);await assert.rejects(()=>db.query('select clinic_reception.vitals_reconcile($1,$2,$3,null)',[live,d1.a,'{}']),/permission|denied/i);await as(1);
// rollback
await db.exec('reset role;'+require('fs').readFileSync(RB,'utf8'));await as(1);
assert.equal((await q(`select to_regprocedure('public.clinic_reception_performer(uuid,text,jsonb)') f`))[0].f,null);
assert.equal((await q(`select count(*)::int n from pg_attribute where attrelid='clinic_reception.visit_triage'::regclass and attname='vital_states' and not attisdropped`))[0].n,0);
r=await N(51,'triage_save',{appointment_id:d1.a,status:'recorded',spo2:96});assert.equal(r.ok,true);assert.equal(r.vitals,undefined,'old nursing RPC');
await as(56);await assert.rejects(()=>call('clinic_reception_command',[live,'execute',{id:d4.o,location_id:DENT},key()]),/افتح وردية الخزينة/);await as(1);
await db.close();console.log('PASS supplies at service (PR2): performer screen — dental nurse without reception membership lists + executes her department\'s orders from «رئيسي أسنان» (billable billed, included at cost), «بدون مستلزمات» needs a reason, other department / wrong store / no store / trial / reception-only refused, doctor assistant by provider department, head nursing all, no cash shift on the performer path (desk command still locked, flag transaction-local); vitals kit — states saved, draft consumes nothing, recorded consumes measured vitals at cost from the dental store, idempotent, refused → reversed (stock + 5123 back), re-measured → new consumption, value-only = measured, no stock / wrong store → warning and the triage still saves, kit editor gated; helpers private; second run refused; rollback restores.');
}
/* eslint-enable no-undef */
const src=bodyFn.toString();const body='{'+src.slice(src.indexOf('{')+1,src.lastIndexOf('}'))+'}})().catch(e=>{console.error(e);process.exit(1);});';
const runner=da.slice(da.indexOf('const file=path.join')).replace(/doctor-assistant-run-/g,'supplies-performer-run-');
const file=path.join(require('os').tmpdir(),'supplies-performer-outer-'+process.pid+'.cjs');
fs.writeFileSync(file,setup.replace(/__dirname/g,JSON.stringify(__dirname))+'const body='+JSON.stringify(body)+';\n'+runner);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
