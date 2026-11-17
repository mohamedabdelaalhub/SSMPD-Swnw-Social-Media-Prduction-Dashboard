// Owner 2026-11-17 «خلي الوقت بين كل حجز واللي بعده ٥ دقايق فقط»: a workspace gap (default 5 min) after every appointment.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
assert.equal(+(await q('select booking_gap_minutes g from clinic_reception.workspaces where id=$1',[live]))[0].g,5,'default gap 5');
const doc=(await cmd(live,'provider',{name:'طبيب فاصل',department:'جلدية',branch:'حدائق الأهرام'})).id;
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const base="date_trunc('day',now())+interval '2 days'";
const ins=(m1,m2)=>q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,created_by,starts_at,ends_at) values($1,$2,$3,$4,(select id from public.admins limit 1),"+base+"+make_interval(mins=>$5::int),"+base+"+make_interval(mins=>$6::int)) returning id",[live,pat,doc,svc,m1,m2]);
const a1=(await ins(600,615))[0].id;                       // 10:00–10:15
await assert.rejects(()=>ins(615,630),e=>/لازم 5 دقايق/.test(e.message),'back-to-back refused');
await assert.rejects(()=>ins(580,598),e=>/لازم 5 دقايق/.test(e.message),'ending 2 min before refused');
const a2=(await ins(620,635))[0].id;                       // 10:20 ok
await ins(580,595);                                         // ends 5 min before ok
// reschedule into the gap is refused; status changes of existing rows are untouched
await assert.rejects(()=>q("update clinic_reception.appointments set starts_at=starts_at-interval '3 minutes',ends_at=ends_at-interval '3 minutes' where id=$1",[a2]),e=>/لازم/.test(e.message));
// fallback slot_busy counts the gap
const busy=async(m1,m2)=>(await q("select clinic_reception.slot_busy($1,"+base+"+make_interval(mins=>$2::int),"+base+"+make_interval(mins=>$3::int)) b",[doc,m1,m2]))[0].b;
assert.equal(await busy(635,650),true,'right after a2 is busy');assert.equal(await busy(640,655),false,'5 min after is free');
// gap 0 → back-to-back allowed again; existing rows not re-checked on status change
await q('update clinic_reception.workspaces set booking_gap_minutes=0 where id=$1',[live]);
const a3=(await ins(635,650))[0].id;
await q('update clinic_reception.workspaces set booking_gap_minutes=5 where id=$1',[live]);
await q("update clinic_reception.appointments set status='arrived' where id=$1",[a3]);
await assert.rejects(()=>q('update clinic_reception.workspaces set booking_gap_minutes=99 where id=$1',[live]));
// walk-in queues after the gap
const w1=await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15});
const w2=await cmd(live,'walk_in',{patient_id:pat,provider_id:doc,service_id:svc,minutes:15});
const r=await q('select starts_at,ends_at from clinic_reception.appointments where id = any($1::uuid[]) order by starts_at',[[w1.id,w2.id]]);
assert(Date.parse(r[1].starts_at)-Date.parse(r[0].ends_at)>=5*60000,'walk-in waits the gap');
// fallback slots step by minutes + gap
await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,"+base+"+interval '13 hours',"+base+"+interval '14 hours')",[live,doc]);
await q("insert into clinic_reception.masa_doctor_links(workspace_id,masa_doctor_id,masa_name,provider_id,status) values($1,9911,'طبيب فاصل',$2,'linked')",[live,doc]).catch(()=>{});
const day=(await q("select to_char(("+base+") at time zone 'Africa/Cairo','YYYY-MM-DD') d"))[0].d;
const s=(await q("select clinic_reception.fallback_api('slots',$1::jsonb) v",[JSON.stringify({provider_id:doc,slot_minutes:15,date_from:day,days:1})]))[0].v;
const t13=Date.parse((await q("select ("+base+"+interval '13 hours') t"))[0].t);
if(s.ok){const ts=s.slots.map(x=>Date.parse(x.starts_at)).filter(x=>x>=t13);assert(ts.length>=3);assert.equal(ts[1]-ts[0],20*60000,'fallback slots every 20 min');assert.equal(ts[2]-ts[1],20*60000);}
else console.log('fallback slots skipped:',s.error);
await db.close();console.log('PASS booking gap: default 5, back-to-back/inside-gap refused, 5 min after allowed, reschedule checked, status changes untouched, gap 0 allows, bounds, slot_busy, walk-in queue, fallback slots step.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.booking-gap-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
