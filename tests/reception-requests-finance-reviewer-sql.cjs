// 20261122240000: the financial reviewer (financial_manager with accounting update) sees reception correction requests and the
// «مراجعة مستقلة» button (can_review) in controls_snapshot on the live workspace; a plain member without 'review' still sees only
// their own requests; rollback restores the old body. Reuses the live reception setup of tests/reception-bridge.cjs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');
const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','reception_requests_names'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const mig=path.join(__dirname,'..','supabase','migrations','20261122240000_reception_requests_finance_reviewer.sql');
const rb=path.join(__dirname,'..','supabase','rollbacks','20261122240000_reception_requests_finance_reviewer.rollback.sql');
const body=`
{const fs=require('fs');const q=(sql,a)=>owner(sql,a);
await db.exec('reset role');
await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}') on conflict(workspace_id,admin_id) do update set capabilities='{view}'",[live,id(3)]);
await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}') on conflict(workspace_id,admin_id) do update set capabilities='{view}'",[live,id(2)]);
await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}') on conflict(workspace_id,admin_id) do nothing",[live,id(4)]);
const rq=(await db.query("insert into clinic_reception.requests(workspace_id,kind,amount,payload,reason,evidence,created_by) values($1,'refund',100,'{}','طلب اختبار من الاستقبال','مستند',$2) returning id",[live,id(4)])).rows[0].id;
const view=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);const r=(await db.query("select clinic_reception.controls_snapshot($1,current_date,current_date) v",[live])).rows[0].v;return {can:r.can_review,ids:(r.requests||[]).map(x=>x.id)};};
let fm=await view(3),acc=await view(2);
assert.equal(fm.can,false,'before: financial manager has no review button');assert(!fm.ids.includes(rq),'before: financial manager does not see the request');
await db.exec('reset role');await db.exec(fs.readFileSync(${JSON.stringify(mig)},'utf8'));
fm=await view(3);acc=await view(2);
assert.equal(fm.can,true,'after: financial manager gets can_review');assert(fm.ids.includes(rq),'after: financial manager sees the reception request');
assert.equal(acc.can,false,'accountant (no review right) still no button');assert(!acc.ids.includes(rq),'accountant still does not see others\\' requests');
const own=await view(4);assert(own.ids.includes(rq),'creator still sees own request');
await db.exec('reset role');const trial=(await db.query("select id from clinic_reception.workspaces where mode='trial' limit 1")).rows[0];
if(trial){await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view}') on conflict(workspace_id,admin_id) do update set capabilities='{view}'",[trial.id,id(3)]);
 await db.query("select set_config('test.admin',$1,false)",[id(3)]);const t=(await db.query("select clinic_reception.controls_snapshot($1,current_date,current_date) v",[trial.id])).rows[0].v;
 assert.equal(t.can_review,false,'trial workspace: the finance role alone does not make a reviewer');}
await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync(${JSON.stringify(mig)},'utf8')),/anchor found 0 times/,'second run refused');await db.exec('rollback');
await db.exec(fs.readFileSync(${JSON.stringify(rb)},'utf8'));
fm=await view(3);assert.equal(fm.can,false,'rollback restores the old rule');
}
await db.close();console.log('PASS reception requests → financial reviewer: sees requests + «مراجعة مستقلة» on live (accountant/trial unchanged, creator keeps own), repeat run refused, rollback restores.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'req-fin-reviewer-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
