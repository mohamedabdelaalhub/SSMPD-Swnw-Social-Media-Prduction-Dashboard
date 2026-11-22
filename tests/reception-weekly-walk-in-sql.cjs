// Owner 2026-11-16 «نعمل الاتنين»: weekly doctor schedule → availability on its own; «حضور بدون ميعاد».
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=(sql,a)=>owner(sql,a);await as(1);
const doc2=(await cmd(live,'provider',{name:'طبيب جدول تجربة',department:'جلدية',branch:'حدائق الأهرام'})).id;
const wk=(a,p)=>call('clinic_reception_weekly',[live,a,p||{}]);
// save a full week 10:00–12:00 and an over-midnight Friday 22:00–00:00
const slots=[0,1,2,3,4,6].map(d=>({dow:d,starts:'10:00',ends:'12:00'})).concat([{dow:5,starts:'22:00',ends:'00:00'}]);
let r=await wk('save',{provider_id:doc2,slots});assert(r.generated>=20,'about 4 weeks generated: '+r.generated);
let rows=await q("select starts_at,ends_at,source,extract(dow from starts_at at time zone 'Africa/Cairo') d,to_char(starts_at at time zone 'Africa/Cairo','HH24:MI') s,to_char(ends_at at time zone 'Africa/Cairo','HH24:MI') e from clinic_reception.availability where provider_id=$1 order by starts_at",[doc2]);await as(1);
assert(rows.every(x=>x.source==='weekly'));assert(rows.some(x=>+x.d===5&&x.s==='22:00'&&x.e==='00:00'),'over midnight');assert(rows.filter(x=>+x.d!==5).every(x=>x.s==='10:00'&&x.e==='12:00'));
// re-saving with new hours replaces future generated windows (no duplicates)
r=await wk('save',{provider_id:doc2,slots:[{dow:0,starts:'09:00',ends:'11:00'}]});
rows=await q("select to_char(starts_at at time zone 'Africa/Cairo','HH24:MI') s,source from clinic_reception.availability where provider_id=$1 and starts_at>now()",[doc2]);await as(1);
// 28 days ahead hold 3 or 4 future Sundays (3 when the run is on a Sunday after that day's window started)
assert(rows.length>=3&&rows.every(x=>x.s==='09:00'),'old generated windows replaced');
await assert.rejects(()=>wk('save',{provider_id:doc2,slots:[{dow:9,starts:'25:00',ends:'10:00'}]}),e=>/راجع/.test(e.message));
assert.equal((await wk('list')).slots.filter(x=>x.provider_id===doc2).length,1);
// propose: the setup doctor (manual availability, no week) gets a week from his coming availability; idempotent generation
await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) select $1,$2,g+interval '7 hours',g+interval '9 hours' from generate_series(date_trunc('day',now())+interval '1 day',date_trunc('day',now())+interval '7 days',interval '1 day') g on conflict do nothing",[live,provider]);await as(1);
r=await wk('propose');assert(r.created>=1);assert((await wk('list')).slots.some(x=>x.provider_id===provider));
const before=+(await q('select count(*) n from clinic_reception.availability where provider_id=$1',[provider]))[0].n;await as(1);
await wk('generate',{days:28});const after=+(await q('select count(*) n from clinic_reception.availability where provider_id=$1',[provider]))[0].n;await as(1);
await wk('generate',{days:28});assert.equal(+(await q('select count(*) n from clinic_reception.availability where provider_id=$1',[provider]))[0].n,after,'no duplicates on re-run');await as(1);
assert(after>=before);
// walk-in: no availability needed; first free time from now; booking checks still apply
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const w1=await cmd(live,'walk_in',{patient_id:pat,provider_id:doc2,service_id:svc,minutes:30,source:'walk_in'});
assert(w1.walk_in&&w1.id);const a1=(await q('select * from clinic_reception.appointments where id=$1',[w1.id]))[0];await as(1);
assert(Date.parse(a1.starts_at)>=Date.now()-60000&&Date.parse(a1.starts_at)-Date.now()<10*60000,'starts now (rounded)');assert.equal((Date.parse(a1.ends_at)-Date.parse(a1.starts_at))/60000,30);
const w2=await cmd(live,'walk_in',{patient_id:pat,provider_id:doc2,service_id:svc,minutes:30});
const a2=(await q('select * from clinic_reception.appointments where id=$1',[w2.id]))[0];await as(1);assert(Date.parse(a2.starts_at)>=Date.parse(a1.ends_at),'second walk-in queued after the first');
const kw=key(),p3={patient_id:pat,provider_id:doc2,service_id:svc,minutes:30};const w3=await cmd(live,'walk_in',p3,kw);assert.equal((await cmd(live,'walk_in',p3,kw)).id,w3.id,'retry with the same token returns the same booking');
await assert.rejects(()=>cmd(live,'walk_in',{patient_id:pat,provider_id:doc2,minutes:30}),e=>/الخدمة|اختر/.test(e.message));
await db.close();console.log('PASS weekly schedule + walk-in: save/replace week (incl. over-midnight), validation, propose from current availability, idempotent generation; walk-in books now without availability, queues after earlier walk-ins, idempotent, still validated.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'weekly-walkin-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
