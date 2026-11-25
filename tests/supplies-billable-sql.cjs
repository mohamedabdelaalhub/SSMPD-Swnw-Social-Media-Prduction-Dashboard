// 20261125200000 supplies at service — PR1 (PGlite, reception bridge boot).
//   billable vs included split at execute, non-billable overage still needs «وافق المريض», store gate, «إنهاء» with a missing
//   billable supply (refused → confirmed with the audited note), journey «إنهاء» passes missing_ack, «تعديل قبل التحصيل»
//   (same day, nothing collected), «مستلزمات الزيارة» add with duplicate / included confirmations, item flag + mirror,
//   per-service override, editor gate, idempotent re-run refused, rollback.
const boot=require('./helpers/reception-bridge.cjs'),assert=require('node:assert/strict'),fs=require('fs');
const MIG='supabase/migrations/20261125200000_supplies_billable_at_service.sql',RB='supabase/rollbacks/20261125200000_supplies_billable_at_service.rollback.sql';
(async()=>{const {db,as,call,key,id}=await boot();
 // a stand-in journey command (the real one lives in the journey migrations): «إنهاء الزيارة» → visit_close
 await db.exec(`create function public.clinic_reception_journey_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$
   begin if p_action='visit_complete' then return public.clinic_reception_command(p_workspace,'visit_close',jsonb_build_object('id',p_payload->>'visit_id','reason',p_payload->>'reason'),p_token); end if; raise exception 'x'; end $$;
   grant execute on function public.clinic_reception_journey_command(uuid,text,jsonb,uuid) to authenticated;
   create function public.inventory_pricing_list() returns jsonb language plpgsql stable security definer as $$ begin
     return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name,
            'pricing_kind', i.pricing_kind, 'sale_price', 0)), '[]') from public.inventory_items i); end $$;`);
 if(!(await db.query(`select 1 from pg_attribute where attrelid='public.inventory_items'::regclass and attname='pricing_kind'`)).rows.length)await db.exec(`alter table public.inventory_items add column pricing_kind text default 'supply'`);
 await db.exec(fs.readFileSync(MIG,'utf8'));
 await assert.rejects(()=>db.exec(fs.readFileSync(MIG,'utf8')),/تم تطبيق هذا الملف من قبل/);
 await as(1);const w=await call('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cmd=(a,p,k=key())=>call('clinic_reception_command',[w,a,p,k]),snap=()=>call('clinic_reception_snapshot',[w,date,date]),sup=(a,p)=>call('clinic_reception_visit_supplies',[w,a,p]);
 let s=await snap();const pat=s.patients[0].id,pro=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute']});await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','execute','collect','book']});
 const gel=(await cmd('item',{code:'GEL',name:'جل تبريد',unit:'عبوة',markup:0,track_expiry:false})).id,cream=(await cmd('item',{code:'CRM',name:'كريم مهدئ',unit:'أنبوبة',markup:0,track_expiry:false})).id;
 const L1=(await cmd('location',{name:'فرعي مستلزمات تمريض'})).id,L2=(await cmd('location',{name:'فندقة'})).id;
 await db.exec('reset role');
 for(const [it,loc] of [[gel,L1],[cream,L1],[gel,L2],[cream,L2]]){const lot=(await db.query(`insert into clinic_reception.lots(workspace_id,item_id,unit_cost) values($1,$2,10) returning id`,[w,it])).rows[0].id;
  await db.query(`insert into clinic_reception.movements(workspace_id,item_id,location_id,lot_id,kind,quantity,unit_cost,actor_id) values($1,$2,$3,$4,'receipt',100,10,$5)`,[w,it,loc,lot,id(1)]);}
 await db.query(`update clinic_reception.items set sale_price=case when id=$1 then 85 else 20 end where id in ($1,$2)`,[cream,gel]);
 await db.query(`update clinic_reception.items set patient_billable=true where id=$1`,[cream]);   // trial: no inventory link → set directly
 await as(1);
 await cmd('service',{code:'LSR',name:'ليزر نص اليدين',department:dept,price:500,minutes:30,bom:[{item_id:gel,quantity:1,included:true},{item_id:cream,quantity:1,included:true}]});
 s=await snap();const service=s.services.find(x=>x.code==='LSR').id;
 const ag=(await cmd('agreement',{provider_id:pro,service_code:'LSR',rate:0,from:date,to:'2030-01-01',reference:'SUP-AG'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:pro,starts_at:date+'T05:00Z',ends_at:date+'T20:00Z'});
 let hour=5;async function visit(){const a=(await cmd('book',{patient_id:pat,provider_id:pro,service_id:service,starts_at:date+'T'+String(++hour).padStart(2,'0')+':00Z'})).id;const v=(await cmd('arrive',{id:a})).id;return {a,v,o:(await snap()).orders.find(x=>x.visit_id===v).id};}
 const inv=async o=>(await snap()).invoices.find(x=>x.order_id===o);
 const moves=async o=>{await db.exec('reset role');const r=(await db.query(`select i.code,m.kind,sum(-m.quantity)::numeric q from clinic_reception.movements m join clinic_reception.items i on i.id=m.item_id where m.source_id=$1 group by 1,2 order by 1,2`,[o])).rows.map(r=>r.code+':'+r.kind+':'+Number(r.q));await as(1);return r;};
 // 1) default materials: gel included at cost, cream billed at 85 — no «وافق المريض» needed for a billable item
 const v1=await visit();await cmd('execute',{id:v1.o,location_id:L1});
 assert.equal(Number((await inv(v1.o)).amount),585,'service 500 + cream 85');assert.deepEqual(await moves(v1.o),['CRM:sale:1','GEL:included:1']);
 // 2) non-billable overage still needs consent; with consent it is billed
 const v2=await visit();await assert.rejects(()=>cmd('execute',{id:v2.o,location_id:L1,materials:[{item_id:gel,quantity:2},{item_id:cream,quantity:1}]}),/موافقة/);
 await cmd('execute',{id:v2.o,location_id:L1,materials:[{item_id:gel,quantity:2},{item_id:cream,quantity:1}],additional_confirmed:true});
 assert.equal(Number((await inv(v2.o)).amount),605,'500 + cream 85 + extra gel 20');
 await db.exec('reset role');const au=(await db.query(`select detail from clinic_reception.audit where action='execute_supplies' and entity_id=$1`,[v2.o])).rows[0].detail;assert.equal(au.overage.length,1);assert.equal(au.billed.length,1);await as(1);
 // 3) store gate: once a section map exists, «فندقة» is refused for a skin service
 await db.exec('reset role');await db.query(`insert into clinic_reception.consume_locations values($1,'general',$2),($1,'physio',$2)`,[w,L1]);await as(1);
 const v3=await visit();await assert.rejects(()=>cmd('execute',{id:v3.o,location_id:L2}),/مش مسموح يتصرف منه/);await cmd('execute',{id:v3.o,location_id:L1});
 // 4) «إنهاء» with the billable cream missing: refused, then confirmed with the audited note
 for(const v of [v1,v2,v3])await cmd('visit_close',{id:v.v});
 const v4=await visit();await cmd('execute',{id:v4.o,location_id:L1,materials:[{item_id:gel,quantity:1}],material_note:'المريضة رفضت الكريم'});
 const chk=await call('clinic_reception_finish_check',[w,{appointment_id:v4.a}]);assert.equal(chk.missing.length,1);assert.equal(chk.missing[0].item,'كريم مهدئ');assert.equal(Number(chk.total),85);
 await assert.rejects(()=>cmd('visit_close',{id:v4.v}),/مستلزم بيتحاسب ناقص/);
 await cmd('visit_close',{id:v4.v,missing_ack:true});s=await snap();let vv=s.visits.find(x=>x.id===v4.v);assert.equal(vv.status,'completed');
 await db.exec('reset role');const note=(await db.query(`select close_note from clinic_reception.visits where id=$1`,[v4.v])).rows[0].close_note;
 assert.match(note,/تم التنبيه على .+ إن فيه مستلزم ناقص كريم مهدئ قيمته 85\.00 ج واختار الإنهاء رغم ذلك/);
 assert.equal((await db.query(`select count(*)::int n from clinic_reception.audit where action='finish_missing_supplies' and entity_id=$1`,[v4.v])).rows[0].n,1);await as(1);
 // journey «إنهاء الزيارة» carries the second confirmation
 const v5=await visit();await cmd('execute',{id:v5.o,location_id:L1,materials:[{item_id:gel,quantity:1}],material_note:'مفيش كريم'});
 await assert.rejects(()=>call('clinic_reception_journey_command',[w,'visit_complete',{visit_id:v5.v},key()]),/مستلزم بيتحاسب ناقص/);
 await call('clinic_reception_journey_command',[w,'visit_complete',{visit_id:v5.v,missing_ack:true},key()]);assert.equal((await snap()).visits.find(x=>x.id===v5.v).status,'completed');
 // 5) «تعديل قبل التحصيل» (reception, execute) → «مستلزمات الزيارة»
 await as(3);const tk=key();let r=await call('clinic_reception_visit_reopen',[w,v4.v,'نسينا الكريم',tk]);assert.equal(r.status,'open');
 assert.deepEqual(await call('clinic_reception_visit_reopen',[w,v4.v,'نسينا الكريم',tk]),r,'replay with the same token');
 let w1=await sup('check',{order_id:v4.o,item_id:cream});assert.equal(w1.duplicate,null);assert.equal(w1.included,false);assert.equal(w1.billable,true);
 await assert.rejects(()=>sup('add',{order_id:v4.o,item_id:cream,quantity:1}),/اختار المخزن/);
 await assert.rejects(()=>sup('add',{order_id:v4.o,item_id:cream,quantity:1,location_id:L2}),/مش مسموح/);
 r=await sup('add',{order_id:v4.o,item_id:cream,quantity:1,location_id:L1,token:key()});assert.equal(r.billable,true);assert.equal(Number(r.amount),85);
 await as(1);assert.equal(Number((await inv(v4.o)).amount),585,'cream added on the service invoice');await as(3);
 let l=await sup('list',{visit_id:v4.v});assert.equal(l.missing.length,0);assert(l.orders[0].lines.some(x=>x.source==='reception'&&x.item==='كريم مهدئ'));
 // gel is in the price of the service and already recorded: included + duplicate warnings must be confirmed
 w1=await sup('check',{order_id:v4.o,item_id:gel});assert.equal(w1.included,true);assert.equal(Number(w1.duplicate.quantity),1);assert(w1.duplicate.by);
 await assert.rejects(()=>sup('add',{order_id:v4.o,item_id:gel,quantity:1,location_id:L1}),/متسجّل قبل كده/);
 await assert.rejects(()=>sup('add',{order_id:v4.o,item_id:gel,quantity:1,location_id:L1,confirm_duplicate:true}),/في سعر الخدمة/);
 r=await sup('add',{order_id:v4.o,item_id:gel,quantity:1,location_id:L1,confirm_duplicate:true,confirm_included:true});assert.equal(Number(r.amount),0,'included → cost only');
 await cmd('visit_close',{id:v4.v});   // nothing missing now → no confirmation
 // collected → no more editing; another day → refused
 await as(1);await cmd('collect',{patient_id:pat,invoice_id:(await inv(v4.o)).id,amount:100,method:'instapay',reference:'IP-SUP'});
 await assert.rejects(()=>call('clinic_reception_visit_reopen',[w,v4.v,'',key()]),/اتحصّل/);
 await db.exec('reset role');await db.query(`update clinic_reception.visits set closed_at=now()-interval '2 days' where id=$1`,[v5.v]);await as(3);
 await assert.rejects(()=>call('clinic_reception_visit_reopen',[w,v5.v,'',key()]),/نفس يوم الزيارة/);
 await assert.rejects(()=>sup('add',{order_id:v5.o,item_id:cream,quantity:1,location_id:L1}),/اضغط «تعديل قبل التحصيل»/);
 // 6) classification: per-service override + editor gate; inventory flag mirrored to the reception item
 await assert.rejects(()=>call('clinic_reception_service_billing',[w,'list',{}]),/لمسؤول المخزن/);
 await as(1);let sb=await call('clinic_reception_service_billing',[w,'list',{}]);assert.equal(sb.services[0].lines.find(x=>x.item_id===cream).billable,true);
 await call('clinic_reception_service_billing',[w,'set',{service_id:service,item_id:cream,billable:false}]);
 const v6=await visit();await cmd('execute',{id:v6.o,location_id:L1});assert.equal(Number((await inv(v6.o)).amount),500,'override: cream in the price for this service');
 await call('clinic_reception_service_billing',[w,'set',{service_id:service,item_id:cream,billable:''}]);
 await db.exec('reset role');
 const invItem=(await db.query(`insert into public.inventory_items(name) values('شاش') returning id`)).rows[0].id;
 const rItem=(await db.query(`insert into clinic_reception.items(workspace_id,code,name,unit,markup,inventory_item_id) values($1,'INV-1','شاش','لفة',0,$2) returning id`,[w,invItem])).rows[0].id;
 await as(3);await assert.rejects(()=>call('inventory_set_patient_billable',[invItem,true]),/لمسؤول المخزن/);
 await as(1);await call('inventory_set_patient_billable',[invItem,true]);await db.exec('reset role');
 assert.equal((await db.query(`select patient_billable from clinic_reception.items where id=$1`,[rItem])).rows[0].patient_billable,true,'mirror');
 assert.equal((await db.query(`select public.inventory_pricing_list() l`)).rows[0].l.find(x=>x.id===invItem).patient_billable,true,'pricing sheet shows the flag');
 // 7) rollback
 await db.exec(fs.readFileSync(RB,'utf8'));
 assert.equal((await db.query(`select count(*)::int n from pg_attribute where attrelid='clinic_reception.items'::regclass and attname='patient_billable' and not attisdropped`)).rows[0].n,0);
 assert.equal((await db.query(`select to_regprocedure('public.clinic_reception_visit_supplies(uuid,text,jsonb)') f`)).rows[0].f,null);
 assert(!('patient_billable' in (await db.query(`select public.inventory_pricing_list() l`)).rows[0].l[0]),'pricing list restored');
 await as(1);const v7=await visit();await cmd('execute',{id:v7.o,location_id:L1});assert.equal(Number((await inv(v7.o)).amount),500,'old behaviour: every BOM item included at cost');
 console.log('PASS supplies at service (PR1): billable item billed at sale price without extra consent, included at cost; non-billable overage still needs consent; store gate per section; «إنهاء» with a missing billable supply refused then confirmed with the audited note (also through the journey); «تعديل قبل التحصيل» same day + uncollected only (token replay); «مستلزمات الزيارة» add with store gate + duplicate / included confirmations, billed on the service invoice; per-service override; editor gate; inventory flag mirrored; second run refused; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
