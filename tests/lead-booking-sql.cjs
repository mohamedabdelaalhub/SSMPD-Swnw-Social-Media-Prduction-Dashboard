// Owner 2026-11-22 «طبق الحجز من الليدز»: a booking from a lead logs a lead attempt «حجز: …» once, the snapshot tags the
// appointment with the lead + booking employee, and lead_booking_funnel counts leads → booked → attended → paid per agent
// (managers see all, others their own row). Real reception chain (bridge prefix: the lead there is booked, arrives and pays).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['lead_booking'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};
await q("alter table leads add column if not exists created_at timestamptz not null default now()");
await q("create table if not exists public.lead_attempts(id uuid primary key default gen_random_uuid(),lead_id uuid not null references leads(id),employee_id uuid,attempt_date timestamptz not null default now(),result text,next_follow_up_date date,notes text)");
await q("create or replace function public.can_access_leads() returns boolean language sql stable as $f$select true$f$");
await as(1);
// funnel: the prefix lead was booked, arrived and paid
let f=await call('clinic_reception_finance_overview',[date,date]);
let fun=(await q('select public.lead_booking_funnel($1::date,$2::date) r',[date,date]))[0].r;
// owner() runs as owner; the funnel reads my_admin_id: run it as admin 1 instead
await as(1);fun=(await db.query('select public.lead_booking_funnel($1::date,$2::date) r',[date,date])).rows[0].r;
const row=fun.find(x=>x.agent_id===id(1));assert(row,'agent row');assert.deepEqual([row.leads,row.booked,row.attended,row.paid].map(Number),[1,1,1,1]);
// a new lead booked: attempt logged once (retry with the same key does not duplicate), snapshot tags it
const lead2=(await q("insert into leads(source,patient_id) values('whatsapp',$1) returning id",[actualPatient]))[0].id;await as(1);
const k=key(),p={patient_id:pat,provider_id:provider,service_id:service,starts_at:date+'T12:00Z',lead_id:lead2,same_day_ok:true};
const ap=(await cmd(live,'book',p,k)).id;await cmd(live,'book',p,k);
const att=await q('select employee_id,result,notes from public.lead_attempts where lead_id=$1',[lead2]);
assert.equal(att.length,1);assert.equal(att[0].employee_id,id(1));assert.equal(att[0].result,'answered');assert.match(att[0].notes,/^حجز: .+ — \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$/,'English digits');
const s2=await snap(live);assert(s2.lead_bookings[ap]);assert.equal(s2.lead_bookings[ap].lead_id,lead2);assert(s2.lead_bookings[ap].agent);
assert(!s2.lead_bookings[s2.appointments.find(a=>a.id!==ap&&!s2.lead_bookings[a.id])?.id||'x'],'non-lead bookings untagged');
await as(1);fun=(await db.query('select public.lead_booking_funnel($1::date,$2::date) r',[date,date])).rows[0].r;
const r2=fun.find(x=>x.agent_id===id(1));assert.deepEqual([r2.leads,r2.booked,r2.attended,r2.paid].map(Number),[2,2,1,1]);
// a non-manager sees only their own row (reception admin 4 has none)
await as(4);fun=(await db.query('select public.lead_booking_funnel($1::date,$2::date) r',[date,date])).rows[0].r;assert.equal(fun.length,0);
await assert.rejects(()=>db.query('select public.lead_booking_funnel($1::date,$2::date)',[date,'2020-01-01']),/فترة/);
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261122130000_lead_booking.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('command_before_lead_booking','snapshot_before_lead_booking','lead_booking_funnel')")).rows[0].n,0,'rollback');
await db.close();console.log('PASS lead booking: attempt «حجز» logged once with English digits, snapshot lead tag + agent, funnel leads→booked→attended→paid per agent, own-row only for non-managers, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.lead-booking-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
