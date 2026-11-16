// Owner 2026-11-16: كشف / استشارة / متابعة open to every doctor; per-doctor booking readiness.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_basic_services_readiness'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
await as(1);
// a doctor of another department (neurology) and services in «خدمات الكشف», plus a specialty «متابعة» and a non-basic service
const neuro=(await cmd(live,'provider',{name:'طبيب مخ وأعصاب تجربة',department:'المخ والأعصاب',branch:'حدائق الأهرام'})).id;
const kashf=(await cmd(live,'service',{code:'K-NEURO',name:'كشف أخصائي أمراض المخ والأعصاب',department:'خدمات الكشف',price:800,minutes:20,bom:[]})).id;
const istishara=(await cmd(live,'service',{code:'K-FU',name:'الاستشارة (خلال أسبوعين من الكشف)',department:'خدمات الكشف',price:100,minutes:15,bom:[]})).id;
const followup=(await cmd(live,'service',{code:'FU-DERM',name:'متابعة جلدية',department:'جلدية',price:150,minutes:15,bom:[]})).id;
await cmd(live,'availability',{provider_id:neuro,starts_at:date+'T06:00Z',ends_at:date+'T18:00Z'});
let sn=await snap(live);assert(Array.isArray(sn.basic_service_ids));
for(const id of [kashf,istishara,followup])assert(sn.basic_service_ids.includes(id),'basic: '+id);assert(!sn.basic_service_ids.includes(service),'DERM session is not basic');
// booking: the neurology doctor can book كشف, الاستشارة and متابعة, but not another department's non-basic service
const book=(svc,h)=>cmd(live,'book',{patient_id:pat,provider_id:neuro,service_id:svc,starts_at:date+'T'+h+':00Z'});
await book(kashf,'09');await book(istishara,'10');await book(followup,'11');
await assert.rejects(()=>book(service,'12'),e=>/تخصص/.test(e.message),'non-basic service of another department refused');
// readiness: per doctor, with agreement / availability flags
// windows tomorrow too, so «next 14 days» holds whatever the clock time of the run
const tmr=new Date(Date.parse(date+'T00:00Z')+864e5).toISOString().slice(0,10);for(const pv of [neuro,provider])await cmd(live,'availability',{provider_id:pv,starts_at:tmr+'T06:00Z',ends_at:tmr+'T18:00Z'});
const rd=await call('clinic_reception_booking_readiness',[live]);
const n=rd.doctors.find(x=>x.id===neuro),derm=rd.doctors.find(x=>x.id===provider);
assert.equal(+rd.basic_services,3);assert.equal(n.ready,false,'no fee agreement yet');assert.equal(+n.agreements,0);assert(+n.availability_14d>=1);
assert.equal(derm.ready,true,'derm doctor has an approved agreement and availability');assert(+derm.own_services>=1);
await db.close();console.log('PASS basic services: كشف/استشارة/متابعة open to every doctor (booking), non-basic still department-gated; readiness per doctor (agreement, availability, services).');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'basic-services-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
