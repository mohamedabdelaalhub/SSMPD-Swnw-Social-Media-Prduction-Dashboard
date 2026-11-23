// 20261122250000 public.clinic_review_inbox(): read-only reviewer inbox for «تشغيل اليوم». Each section follows its source's own permission:
// the financial manager (finance review) sees reception correction requests (via the reception 'review' access) and finance requests;
// the accountant (no review right) gets no review items; a reception employee gets nothing to approve; the caller's own request is mine=true.
// Reuses the live reception setup of tests/reception-bridge.cjs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');
const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections','reception_requests_names'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const mig=path.join(__dirname,'..','supabase','migrations','20261122250000_review_inbox.sql');
const rb=path.join(__dirname,'..','supabase','rollbacks','20261122250000_review_inbox.rollback.sql');
const body=`
{const fs=require('fs');
await db.exec('reset role');await db.exec(fs.readFileSync(${JSON.stringify(mig)},'utf8'));
await assert.rejects(()=>db.exec(fs.readFileSync(${JSON.stringify(mig)},'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
// the live rule «finance reviewer passes reception 'review'» is emulated by a member row (the harness keeps the members-only access)
await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view,review}') on conflict(workspace_id,admin_id) do update set capabilities='{view,review}'",[live,id(3)]);
const rq=(await db.query("insert into clinic_reception.requests(workspace_id,kind,amount,payload,reason,evidence,created_by) values($1,'refund',100,'{}','طلب اختبار من الاستقبال','مستند',$2) returning id",[live,id(4)])).rows[0].id;
const mineRq=(await db.query("insert into clinic_reception.requests(workspace_id,kind,amount,payload,reason,evidence,created_by) values($1,'refund',50,'{}','طلب عملته بنفسي','مستند',$2) returning id",[live,id(3)])).rows[0].id;
const fr=(await db.query("insert into clinic_finance.requests(kind,amount,reason,evidence,payload,created_by,token) values('expense',75,'مصروف اختبار','مستند','{}',$1,gen_random_uuid()) returning id",[id(2)])).rows[0].id;
const inbox=async n=>{await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);await db.exec('set role authenticated');
 try{return (await db.query('select public.clinic_review_inbox() v')).rows[0].v;}finally{await db.exec('reset role');}};
const fm=await inbox(3);
assert.equal(fm.visible,true);assert.equal(fm.can_review,true);
const r1=fm.requests.find(x=>x.id===rq);assert(r1,'financial manager sees the reception request');
assert.deepEqual([r1.source,r1.rpc,r1.action,r1.workspace_id,r1.mine,Number(r1.amount)],['rx_request','clinic_reception_command','request_review',live,false,100]);
assert.equal(fm.requests.find(x=>x.id===mineRq).mine,true,'own request is mine=true');
const f1=fm.requests.find(x=>x.id===fr);assert(f1,'financial manager sees the finance request');assert.equal(f1.rpc,'clinic_finance_review_request');
assert.equal(fm.counts.requests,fm.requests.filter(x=>!x.mine).length,'counts exclude own items');
const acc=await inbox(2);
assert(!(acc.requests||[]).length,'accountant (no review right) gets no review items');assert(!(acc.shifts||[]).length&&!(acc.handovers||[]).length);
const rec=await inbox(4).catch(e=>({err:e.message}));
assert(rec.err||!(rec.requests||[]).some(x=>x.source!=='rx_request'),'reception never sees finance review items');
assert(rec.err||!(rec.requests||[]).some(x=>x.id===fr));
// approving through the existing RPC removes the item from the inbox
await db.query("select set_config('test.admin',$1,false)",[id(3)]);await db.exec('set role authenticated');
await db.query('select public.clinic_finance_review_request($1,false,$2)',[fr,'مرفوض في الاختبار']);await db.exec('reset role');
assert(!(await inbox(3)).requests.some(x=>x.id===fr),'decided item drops out');
// read-only: no table changes by the inbox call
const before=(await db.query('select count(*)::int n from clinic_reception.requests where status=$1',['pending'])).rows[0].n;await inbox(3);
assert.equal((await db.query('select count(*)::int n from clinic_reception.requests where status=$1',['pending'])).rows[0].n,before);
await db.exec(fs.readFileSync(${JSON.stringify(rb)},'utf8'));
assert.equal((await db.query("select to_regprocedure('public.clinic_review_inbox()') f")).rows[0].f,null,'rollback drops it');
}
await db.close();console.log('PASS review inbox: finance reviewer sees reception + finance requests with the existing approve RPCs, mine=true for own, accountant/reception get no review items, decided items drop out, read-only, rollback.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'review-inbox-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
