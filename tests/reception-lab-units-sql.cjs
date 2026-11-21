// Owner 2026-11-21: «المعمل» bookable without a doctor. Generic pieces on the real reception functions: provider capacity
// (overlap allowed up to capacity, no gap rule above 1), extra departments (lab in «التحاليل» also serves «باقي التحاليل»
// without a doctor contract), snapshot scopes, doctors unchanged, rollback.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_manual_overbook','reception_lab_units'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const lab=(await cmd(live,'provider',{name:'المعمل',department:'التحاليل',branch:'حدائق الأهرام'})).id;
const doc=(await cmd(live,'provider',{name:'طبيب جلدية',department:'جلدية',branch:'حدائق الأهرام'})).id;
for(const [c,n,d] of [['LAB1','صورة دم كاملة','التحاليل'],['LAB2','فيتامين د','باقي التحاليل']])await cmd(live,'service',{code:c,name:n,department:d,price:100,minutes:15,bom:[]});
const sv=(await snap(live)).services,cbc=sv.find(x=>x.code==='LAB1').id,vitd=sv.find(x=>x.code==='LAB2').id,derm=sv.find(x=>x.code==='DERM').id;
const base="date_trunc('day',now())+interval '2 days'";
for(const p of [lab,doc])await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,"+base+"+interval '6 hours',"+base+"+interval '12 hours')",[live,p]);
const at=async m=>(await q("select ("+base+"+make_interval(mins=>$1::int)) t",[m]))[0].t;
const book=async(p,s,m)=>(await cmd(live,'book',{patient_id:pat,provider_id:p,service_id:s,starts_at:new Date(await at(m)).toISOString(),same_day_ok:true})).id;
await assert.rejects(()=>book(lab,vitd,420),/خارج|تخصص|الطبيب/,'second department refused before it is linked');
await q("insert into clinic_reception.provider_departments(provider_id,department) values($1,'باقي التحاليل')",[lab]);
await book(lab,vitd,420);
await assert.rejects(()=>book(lab,cbc,420),/يتداخل|لازم/,'capacity 1 still one at a time');
await q('update clinic_reception.providers set capacity=3 where id=$1',[lab]);
await book(lab,cbc,420);await book(lab,cbc,425);
await assert.rejects(()=>book(lab,cbc,425),/يتداخل/,'4th overlapping lab booking refused');
await book(lab,cbc,435);                                     // back-to-back: no gap rule above capacity 1
await q('update clinic_reception.providers set capacity=1,booking_gap=false where id=$1',[lab]);
await book(lab,cbc,450);                                     // capacity 1 + booking_gap off: right after the previous one
await assert.rejects(()=>book(lab,cbc,455),/يتداخل/,'capacity 1 → no overlap');
await q('update clinic_reception.providers set booking_gap=true where id=$1',[lab]);
await assert.rejects(()=>book(lab,cbc,465),/لازم/,'gap back on');
await book(doc,derm,420);await assert.rejects(()=>book(doc,derm,425),/يتداخل|لازم/,'doctor unchanged');
await assert.rejects(()=>q('update clinic_reception.providers set capacity=0 where id=$1',[lab]));
// unit provider (no doctor_key): scope rows alone, no contract; doctor services of the same department stay out
const nur=(await cmd(live,'provider',{name:'التمريض',department:'التمريض',branch:'حدائق الأهرام'})).id;
for(const [c,n] of [['ER1','حقنة عضل'],['ER2','خياطة جرح']])await cmd(live,'service',{code:c,name:n,department:'الطوارئ',price:50,minutes:10,bom:[]});
await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,"+base+"+interval '6 hours',"+base+"+interval '12 hours')",[live,nur]);
const sv2=(await snap(live)).services,inj=sv2.find(x=>x.code==='ER1').id,sut=sv2.find(x=>x.code==='ER2').id;
await assert.rejects(()=>book(nur,inj,420),/خارج|تخصص|الطبيب/,'not before its scope row');
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'ER1')",[nur]);
await book(nur,inj,420);
await assert.rejects(()=>book(nur,sut,440),/خارج|تخصص|الطبيب/,'doctor service of الطوارئ not offered to the nurse unit');
await q("update clinic_reception.providers set doctor_key='EMP-X' where id=$1",[nur]);
await assert.rejects(()=>book(nur,inj,460),/خارج|تخصص|الطبيب/,'a doctor (doctor_key) still needs a contract for a scope');
await q("update clinic_reception.providers set doctor_key=null where id=$1",[nur]);
const s=await snap(live);assert.deepEqual(JSON.parse(JSON.stringify(s.provider_service_scopes[nur])),['ER1'],'snapshot lists the unit scope');assert(s.provider_service_scopes[lab].includes('LAB2'),'snapshot scope lists extra-department codes');
assert.deepEqual(JSON.parse(JSON.stringify(s.provider_departments[lab])),['باقي التحاليل']);assert.equal(s.providers.find(x=>x.id===lab).capacity,1);assert.equal(s.providers.find(x=>x.id===lab).booking_gap,true);
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261121170000_reception_lab_units.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('snapshot_before_lab_units','has_provider_service_scope_base')")).rows[0].n,0,'rollback');
assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='providers' and column_name='capacity'")).rows[0].n,0);
await db.close();console.log('PASS lab units: extra department without contract, unit scope rows without contract, capacity overlap, no gap above 1 or with booking_gap off, doctors unchanged, snapshot, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.lab-units-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
