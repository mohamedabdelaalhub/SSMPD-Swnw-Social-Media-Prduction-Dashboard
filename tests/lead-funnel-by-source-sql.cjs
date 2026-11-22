// Owner 2026-11-22: lead funnel by source / campaign. Booked leads keep the source / campaign frozen at booking (later
// lead edits don't move them); unbooked leads use the lead's current values; agent grouping matches the old funnel.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['lead_booking','lead_funnel_by_source'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};
await q("alter table leads add column if not exists created_at timestamptz not null default now()");
await q("create or replace function public.can_access_leads() returns boolean language sql stable as $f$select true$f$");
await q("insert into leads(source) values('whatsapp')");
const by=async g=>{await as(1);const r=(await db.query('select public.lead_booking_funnel_by($1::date,$2::date,$3) r',[date,date,g])).rows[0].r;return Object.fromEntries(r.map(x=>[x.label,[x.leads,x.booked,x.attended,x.paid].map(Number)]));};
let s1=await by('source');assert.deepEqual(s1,{facebook:[1,1,1,1],whatsapp:[1,0,0,0]});
let c1=await by('campaign');assert.deepEqual(c1,{'campaign-test':[1,1,1,1],'بدون حملة':[1,0,0,0]});
// later edit of the booked lead does not move it
await q("update leads set source='messenger', meta_campaign_id='other' where meta_campaign_id='campaign-test'");
assert.deepEqual(await by('source'),s1,'source frozen at booking');assert.deepEqual(await by('campaign'),c1,'campaign frozen at booking');
const a=await by('agent');assert.deepEqual(a['Test 1'],[1,1,1,1]);
const old=(await db.query('select public.lead_booking_funnel($1::date,$2::date) r',[date,date])).rows[0].r;assert.equal(old.reduce((n,x)=>n+Number(x.leads),0),2,'same totals as the agent funnel');assert.deepEqual(a['—'],[1,0,0,0],'unassigned lead');
await assert.rejects(()=>db.query('select public.lead_booking_funnel_by($1::date,$2::date,$3)',[date,date,'x']),/التقسيم/);
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261122131000_lead_funnel_by_source.rollback.sql'))},'utf8'));
assert.equal((await db.query("select count(*)::int n from pg_proc where proname='lead_booking_funnel_by'")).rows[0].n,0);
await db.close();console.log('PASS lead funnel by source/campaign: frozen at booking, unbooked by current lead, agent grouping, validation, rollback');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.lead-funnel-src-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
