// «نبضات من غير عداد» (mig 20261127300000, owner 2026-11-27 «موافق على النبضات من غير عداد مؤقتاً»). Reuses the reception setup of
// tests/execute-all-sql.cjs (live-like workspace, Candela «shots» device, 3 laser services in one visit, reception member with execute):
//   * «تنفيذ» with no_meter + pulses → executed, stored 0 → pulses, marked no_meter (pulses, who, when) + audit; pulses > 0 / number /
//     device with a counter enforced; existing guards still run (pending discount refused);
//   * the last REAL reading ignores it; after one real reading the auto-fill returns;
//   * «تنفيذ الكل» with no_meter → each service marked; the report lists device / employee / date / pulses for managers only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'execute-all-sql.cjs'),'utf8');const cut=src.indexOf(' await as(3);\n // ---- single «تنفيذ»: clear messages');
assert(cut>0,'execute-all-sql.cjs markers moved; update this test');
const body=`
 await db.exec('reset role');const N=fs.readFileSync('supabase/migrations/20261127300000_no_meter_pulses.sql','utf8');await db.exec(N);
 await assert.rejects(()=>db.exec(N),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 const one=(o,extra)=>cmd('execute',{id:o.id,device_id:dev,minutes:15,materials:[],no_meter:true,...(extra||{})});
 await assert.rejects(()=>one(oBK,{}),/اكتب عدد النبضات/);
 await assert.rejects(()=>one(oBK,{pulses:0}),/أكبر من صفر/);
 await assert.rejects(()=>one(oBK,{pulses:'abc'}),/لازم يبقى رقم/);
 await assert.rejects(()=>cmd('execute',{id:oBK.id,minutes:15,materials:[],no_meter:true,pulses:100}),/اختار الجهاز/);
 // existing guards still run: a pending discount refuses the execution
 await q("insert into clinic_reception.discount_requests(workspace_id,order_id,percent,reason,created_by,status) values($1,$2,10,'اختبار',$3,'pending')",[w,oSH.id,id(3)]);
 await assert.rejects(()=>one(oSH,{pulses:50}),/الخصم المعلق/);
 await q("delete from clinic_reception.discount_requests where order_id=$1",[oSH.id]);
 // no reading yet on this device
 let lr=await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev});assert.equal(lr.meter_after,null);
 await one(oBK,{pulses:420});
 let u=(await q("select meter_before,meter_after,no_meter,no_meter_pulses,no_meter_by from clinic_reception.device_uses where order_id=$1",[oBK.id]))[0];
 assert.deepEqual([+u.meter_before,+u.meter_after,u.no_meter,+u.no_meter_pulses],[0,420,true,420],'stored 0 → pulses, marked');assert.equal(u.no_meter_by,id(3));
 assert.equal((await q("select count(*)::int n from clinic_reception.audit where action='execute_no_meter' and entity_id=$1",[oBK.id]))[0].n,1,'audited');
 lr=await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev});assert.equal(lr.meter_after,null,'a no-meter session is never a reading');assert.equal(lr.no_meter_sessions,1);
 // one real reading → the auto-fill returns
 await cmd('execute',{id:oSH.id,device_id:dev,minutes:5,meter_before:5000,meter_after:5080,materials:[]});
 lr=await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev});assert.equal(+lr.meter_after,5080,'real reading back');
 // «تنفيذ الكل» with no_meter on visit 2 (two services)
 await as(1);await cmd('order_add',{visit_id:visit2,service_id:sv('LZ-AX'),provider_id:provider,quantity:1});s=await snap();await as(3);
 const v2o=s.orders.filter(o=>o.visit_id===visit2&&o.status==='ordered');assert.equal(v2o.length,2);
 const r=await cmd('execute_many',{visit_id:visit2,device_id:dev,no_meter:true,orders:v2o.map((o,i)=>({id:o.id,minutes:5,pulses:i?70:30,materials:[]}))});assert.equal(r.executed,2);
 const us=await q("select no_meter,no_meter_pulses,meter_before,meter_after from clinic_reception.device_uses where order_id = any($1) order by no_meter_pulses",[v2o.map(o=>o.id)]);
 assert.deepEqual(us.map(x=>[x.no_meter,+x.no_meter_pulses,+x.meter_before,+x.meter_after]),[[true,30,0,30],[true,70,0,70]]);
 assert.equal(+(await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev})).meter_after,5080,'still the last REAL reading');
 // report: reception member → not allowed; manager (admin 1 = workspace owner / manager) → rows
 let rep=await rpc('clinic_reception_no_meter_sessions',{p_workspace:w});assert.equal(rep.allowed,false,'reception does not see the report');
 await as(1);rep=await rpc('clinic_reception_no_meter_sessions',{p_workspace:w});assert.equal(rep.allowed,true);assert.equal(rep.rows.length,3);
 const row=rep.rows.find(x=>x.order_id===oBK.id);assert(row.device&&row.by&&row.at);assert.equal(+row.pulses,420);
 await assert.rejects(()=>rpc('clinic_reception_no_meter_sessions',{p_workspace:w,p_from:'2026-01-01',p_to:'2026-11-27'}),/3 شهور/);
 // a device without a counter refuses «من غير عداد»
 const plain=(await cmd('device',{code:'PLAIN',name:'جهاز من غير عداد',meter_kind:'none'})).id;
 await as(3);await assert.rejects(()=>cmd('execute',{id:oAX.id,device_id:plain,minutes:5,materials:[],no_meter:true,pulses:10}),/مالوش عداد/);
 // rollback
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261127300000_no_meter_pulses.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.command_before_no_meter(uuid,text,jsonb,uuid)') f")).rows[0].f,null);
 assert((await db.query("select to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') f")).rows[0].f,'execute-all stays');
 await db.close();console.log('PASS no-meter pulses SQL (reception member, real functions): pulses required / > 0 / number, device with a counter, existing guards (pending discount) still refuse; stored 0 → pulses and marked (pulses, who) + audit; never a reading, the real reading auto-fill returns; «تنفيذ الكل» no-meter marks every service; report for managers only (device, employee, date, pulses), 3-month limit; rollback.');
})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'nmp-'+process.pid+'.cjs');
fs.writeFileSync(file,src.slice(0,cut).replace("require('./helpers/reception.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception.cjs'))+')')+body);
try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
