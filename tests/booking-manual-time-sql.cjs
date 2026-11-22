// Owner 2026-11-22: «حجز بميعاد يدوي (متفق عليه مع الدكتور)» on the real reception chain — a time outside the doctor's
// availability books with a reason (one-off 'manual' availability for that slot), flagged + audited; overlap still
// refused and leaves nothing behind; reason required; normal booking unchanged; rollback.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_manual_overbook','reception_lab_units','reception_booking_qty_continuation_no_answer','reception_arrival_sessions','booking_service_later','booking_manual_time'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const book=(p,t)=>cmd(live,'book',{patient_id:pat,provider_id:provider,service_id:service,starts_at:date+'T'+t+':00Z',same_day_ok:true,...p});
const avail=async()=>(await q("select count(*)::int n from clinic_reception.availability where provider_id=$1 and source='manual'",[provider]))[0].n;
const base=await avail();await assert.rejects(()=>book({},'19:00'),/خارج فترة تواجد/,'outside the doctor hours refused as before');
await assert.rejects(()=>book({manual_time:true},'19:00'),/سبب الميعاد اليدوي/);
await assert.rejects(()=>book({manual_time:true,manual_reason_kind:'other',manual_reason:'x'},'19:00'),/اكتب سبب/);
const a1=(await book({manual_time:true,manual_reason_kind:'doctor_agreement',manual_reason:'الدكتورة قالت 7'},'19:00')).id;
let s=await snap(live);const ap=s.appointments.find(x=>x.id===a1);
assert.equal(ap.manual_time,true);assert.equal(ap.manual_reason,'اتفاق مع الدكتور — الدكتورة قالت 7');assert(ap.manual_by);
assert.equal((Date.parse(ap.ends_at)-Date.parse(ap.starts_at))/60000,30,'service length');
assert.equal(await avail(),base+1,'one-off manual availability for that slot');
assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='manual_time' and entity_id=$1",[a1]))[0].n,1);
await assert.rejects(()=>book({manual_time:true,manual_reason_kind:'doctor_agreement'},'19:10'),/يتداخل|لازم/,'doctor overlap still refused');
assert.equal(await avail(),base+1,'refused manual booking adds no availability');
const a2=(await book({manual_time:true,manual_reason_kind:'doctor_other_time',minutes:'45'},'21:00')).id;s=await snap(live);
const ap2=s.appointments.find(x=>x.id===a2);assert.equal((Date.parse(ap2.ends_at)-Date.parse(ap2.starts_at))/60000,45);assert.equal(ap2.manual_reason,'الدكتور جاي في ميعاد تاني');
// inside the doctor's hours: no extra availability, still flagged
const n0=await avail();const a3=(await book({manual_time:true,manual_reason_kind:'doctor_agreement'},'12:00')).id;assert.equal(await avail(),n0);
s=await snap(live);assert.equal(s.appointments.find(x=>x.id===a3).manual_time,true);
// normal booking unchanged
const a4=(await book({},'13:00')).id;s=await snap(live);assert.equal(s.appointments.find(x=>x.id===a4).manual_time,false);
// reschedule to a manual time
await cmd(live,'reschedule',{id:a4,service_id:service,provider_id:provider,patient_id:pat,starts_at:date+'T20:00:00Z',same_day_ok:true,manual_time:true,manual_reason_kind:'doctor_agreement'});s=await snap(live);
assert.equal(s.appointments.find(x=>x.id===a4).manual_time,true);assert.equal(Date.parse(s.appointments.find(x=>x.id===a4).starts_at),Date.parse(date+'T20:00:00Z'));
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261122080000_booking_manual_time.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*)::int n from pg_proc where proname='command_before_manual_time'")).rows[0].n,0,'rollback');
await db.close();console.log('PASS booking manual time: outside hours with reason, one-off availability, audit, overlap still refused (nothing left), length, inside hours, normal unchanged, reschedule, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.manual-time-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
