// Owner 2026-11-22: center hours 10:00 → 24:00. The fallback (website / agent) slot check opens at 10:00, not 08:00.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_fallback_reconcile','reception_fallback_masa_schedule','reception_fallback_stale_autoresolve'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const mig=path.join(__dirname,'..','supabase','migrations','20261122190000_center_hours_10.sql');
const rb=path.join(__dirname,'..','supabase','rollbacks','20261122190000_center_hours_10.rollback.sql');
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const nurse=(await cmd(live,'provider',{name:'تمريض تجريبي',department:'التمريض',branch:'حدائق الأهرام'})).id;
await call('clinic_reception_weekly',[live,'save',{provider_id:nurse,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'08:00',ends:'12:00'}))}]);
const d1=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+2*864e5));
const ok=async(hm)=>(await q("select clinic_reception.fallback_slot_ok($1,(($2::date+$3::time) at time zone 'Africa/Cairo'),(($2::date+$3::time) at time zone 'Africa/Cairo')+interval '20 minutes') v",[nurse,d1,hm]))[0].v;
assert.equal(await ok('09:00'),true,'before: 09:00 allowed (08:00 opening)');
await db.exec('reset role');await db.exec(require('fs').readFileSync(${JSON.stringify(mig)},'utf8'));
assert.equal(await ok('09:00'),false,'after: 09:00 refused');
assert.equal(await ok('09:59'),false,'after: 09:59 refused');
assert.equal(await ok('10:00'),true,'after: 10:00 allowed');
assert.equal(await ok('11:30'),true,'after: 11:30 allowed');
await db.exec('reset role');await assert.rejects(()=>db.exec(require('fs').readFileSync(${JSON.stringify(mig)},'utf8')),/anchor found 0 times/,'second run refuses');
await db.exec('rollback');
await db.exec(require('fs').readFileSync(${JSON.stringify(rb)},'utf8'));
assert.equal(await ok('09:00'),true,'rollback restores 08:00');
}
await db.close();console.log('PASS center hours 10: fallback slots open at 10:00 (09:00/09:59 refused, 10:00 ok), repeat run refused, rollback restores 08:00.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'center-hours-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
