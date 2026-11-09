const assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto'),fs=require('fs');
(async()=>{
const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls']);
const q=async(a,b)=>{await db.exec('reset role');const r=await db.query(a,b);await as(1);return r;};
const w=await rpc('clinic_reception_bootstrap');const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const cmd=(p_action,p_payload,p_token=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action,p_payload,p_token});
let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id;
await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
await cmd('service',{code:'EXT1',name:'خدمة خارجية تجربة',department:'عيادة تجربة',price:500,minutes:30});s=await snap();const service=s.services.find(x=>x.code==='EXT1').id;
const agreement=(await cmd('agreement',{provider_id:provider,service_code:'EXT1',rate:0,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AG001'})).id;await as(2);await cmd('agreement_review',{id:agreement,approve:true});await as(1);
await cmd('availability',{provider_id:provider,starts_at:date+'T06:00:00Z',ends_at:date+'T18:00:00Z'});
const before=await q("select pg_get_functiondef('clinic_reception.command_before_external_booking(uuid,text,jsonb,uuid)'::regprocedure) d").catch(()=>null);
const pre=await q("select pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure) d, coalesce(proacl::text,'') a from pg_proc where oid='public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure");
await db.exec("reset role; do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$");const dump=await db.dumpDataDir();
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261109140000_reception_booking_external.sql','utf8'));
await assert.rejects(async()=>{await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261109140000_reception_booking_external.sql','utf8'));},/تم تطبيق هذا الملف/);await db.exec('rollback');
await as(1);
const inv=async(visit)=>(await q("select i.id,i.amount::float a from clinic_reception.invoices i where i.visit_id=$1",[visit])).rows;
const sumJ=async(src)=>(await q("select coalesce(sum(l.debit),0)::float d, coalesce(sum(l.credit),0)::float c from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source=$1",[src])).rows[0];
async function flow(hour,payload){const a=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:date+'T'+hour+':00:00Z',...payload})).id;const v=(await cmd('arrive',{id:a})).id;const o=(await snap()).orders.find(x=>x.visit_id===v);await cmd('execute',{id:o.id,location_id:null});return {a,v,o};}
// plain booking: untouched
const p=await flow('07',{});assert.deepEqual((await inv(p.v)).map(x=>x.a),[500],'booking without the option: invoice = service price');
// external: 500 + 250 = 750, posted once
const e=await flow('08',{external_service:true,external_extra:250});assert.deepEqual((await inv(e.v)).map(x=>x.a),[750],'service 500 + extra 250 = patient bill 750');
assert.deepEqual(await sumJ('external_service'),{d:250,c:250},'extra posted Dr1122/Cr4110');
const ae=(await q('select external_extra::float x, applied_invoice_id from clinic_reception.appointment_external where appointment_id=$1',[e.a])).rows[0];assert.equal(ae.x,250);assert(ae.applied_invoice_id,'applied once');
const unbal=await q('select j.id from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id group by j.id having sum(debit)<>sum(credit)');assert.equal(unbal.rows.length,0,'ledger balanced');
// replay of the same booking token returns the same appointment and keeps one row
const tk=randomUUID(),pl={patient_id:patient,provider_id:provider,service_id:service,starts_at:date+'T09:00:00Z',external_service:true,external_extra:100};const r1=await cmd('book',pl,tk),r2=await cmd('book',pl,tk);assert.equal(r1.id,r2.id);assert.equal((await q('select count(*)::int n from clinic_reception.appointment_external where appointment_id=$1',[r1.id])).rows[0].n,1);
// validation: nothing is booked
const nApp=async()=>(await q('select count(*)::int n from clinic_reception.appointments')).rows[0].n;const n0=await nApp();
const bad=(extra,re)=>assert.rejects(()=>cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:date+'T10:00:00Z',...extra}),re);
await bad({external_extra:50},/فعّل خيار/);await bad({external_service:true},/رقمًا/);await bad({external_service:true,external_extra:0},/غير صالح/);await bad({external_service:true,external_extra:-3},/غير صالح/);await bad({external_service:true,external_extra:1.234},/غير صالح/);await bad({external_service:true,external_extra:'50'},/رقمًا/);await bad({external_service:'yes',external_extra:5},/غير صالح/);
assert.equal(await nApp(),n0,'rejected bookings leave nothing');
// external=false with no extra behaves as a plain booking
const f=await flow('11',{external_service:false});assert.deepEqual((await inv(f.v)).map(x=>x.a),[500]);
// a second invoice for the same appointment would not get the extra twice
assert.equal((await q('select count(*)::int n from clinic_reception.appointment_external where applied_invoice_id is not null')).rows[0].n,1);
// privileges + capability probe
assert.equal(await rpc('clinic_reception_external_enabled'),true);
const post=await q("select coalesce(proacl::text,'') a from pg_proc where oid='public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure");assert.equal(post.rows[0].a.replace(/[{}]/g,'').split(',').sort().join(),pre.rows[0].a.replace(/[{}]/g,'').split(',').sort().join(),'wrapper keeps the privileges');assert(!post.rows[0].a.includes('anon='));
await db.exec('reset role');await assert.rejects(async()=>{await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261109140000_reception_booking_external.rollback.sql','utf8'));},/توجد حجوزات/);await db.exec('rollback');
// rollback rehearsal on a clone made before the migration
const {PGlite}=require('@electric-sql/pglite');const db2=await PGlite.create({loadDataDir:dump});
await db2.exec(fs.readFileSync('supabase/migrations/20261109140000_reception_booking_external.sql','utf8'));await db2.exec(fs.readFileSync('supabase/rollbacks/20261109140000_reception_booking_external.rollback.sql','utf8'));
const post2=(await db2.query("select pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure) d, coalesce(proacl::text,'') a from pg_proc where oid='public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure")).rows[0];
assert.equal(post2.d,pre.rows[0].d,'rollback restores the command byte-for-byte');assert.equal(post2.a,pre.rows[0].a);
assert.equal((await db2.query("select count(*)::int n from pg_class where relname='appointment_external'")).rows[0].n,0);
await db2.exec(fs.readFileSync('supabase/migrations/20261109140000_reception_booking_external.sql','utf8'));await db2.close();
console.log('PASS reception booking external service: 500+250=750 on the bill, posted once, replay, validation, plain bookings unchanged, privileges, byte-identical rollback');
})().catch(e=>{console.error(e);process.exit(1);});
