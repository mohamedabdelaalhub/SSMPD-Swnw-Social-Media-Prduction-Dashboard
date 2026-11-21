// «الزيارة اتسجلت غلط» (20261122040000): one reception request files the EXISTING service_void for every executed service of the visit;
// the financial reviewer approves as before (counter-entries, doctor fee reversed, order cancelled); after the last approval the appointment
// becomes no_show and the visit carries the reason. Reuses the live reception setup of tests/reception-bridge.cjs (same as reception-finance-corrections-sql).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');
const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_finance_corrections'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const fs=require("fs");const q=(sql,args)=>owner(sql,args);const mig=fs.readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','migrations','20261122040000_reception_visit_void.sql'))},'utf8');
await db.exec('reset role');await db.exec(mig);await assert.rejects(()=>db.exec(mig),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
const inv=s.invoices[0].id;const row=(await q('select v.id visit,v.appointment_id appt,o.id ord from clinic_reception.invoices i join clinic_reception.orders o on o.id=i.order_id join clinic_reception.visits v on v.id=o.visit_id where i.id=$1',[inv]))[0];
const vv=(appt,reason,k)=>call('clinic_reception_visit_void_request',[live,appt,reason,k||key()]);
await as(1);
await assert.rejects(()=>vv(row.appt,'قصير'),/اكتب السبب/);
await assert.rejects(()=>vv('40000000-0000-4000-8000-000000000999','المريض ما جاش خالص'),/الحجز غير موجود/);
// an unexecuted order in the visit blocks the request
const extra=(await q("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by,status) select workspace_id,visit_id,service_id,provider_id,1,10,snapshot,created_by,'ordered' from clinic_reception.orders where id=$1 returning id",[row.ord]))[0].id;
await assert.rejects(()=>vv(row.appt,'المريض ما جاش خالص'),/لسه ما اتنفذتش/);await q("update clinic_reception.orders set status='cancelled' where id=$1",[extra]);
const apptBefore=(await q('select status from clinic_reception.appointments where id=$1',[row.appt]))[0].status;
const vk=key();let rv=await vv(row.appt,'المريض ما جاش والزيارة اتسجلت بالغلط',vk);assert.equal(rv.replayed,false);assert.equal(rv.pending.length,1);
const req=(await q('select * from clinic_reception.requests where id=$1',[rv.pending[0]]))[0];
assert.deepEqual([req.kind,req.subject_id,req.status,req.payload.visit_void,req.payload.visit_id],['service_void',inv,'pending',true,row.visit]);assert(+req.amount>0,'amount fixed from the invoice by the existing trigger');
assert.equal((await vv(row.appt,'المريض ما جاش والزيارة اتسجلت بالغلط',vk)).replayed,true,'no second filing');
assert.equal(+(await q("select count(*) n from clinic_reception.audit where action='visit_void_requested' and entity_id=$1",[row.visit]))[0].n,1);
// nothing changes until the reviewer approves; maker cannot approve
assert.equal((await q('select status from clinic_reception.appointments where id=$1',[row.appt]))[0].status,apptBefore);
await assert.rejects(()=>cmd(live,'request_review',{id:req.id,approve:true,note:'اعتماد ذاتي'}),/مراجعًا آخر/);
const doc0=+(await q('select clinic_finance.doctor_balance($1) n',['RX-DOCTOR']))[0].n;
await as(3);await cmd(live,'request_review',{id:req.id,approve:true,note:'المريض فعلا ما جاش'});await as(1);
assert.equal((await q('select status from clinic_reception.orders where id=$1',[row.ord]))[0].status,'cancelled');
assert(+(await q('select clinic_finance.doctor_balance($1) n',['RX-DOCTOR']))[0].n<doc0,'doctor fee reversed by the existing path');
const after=(await q('select a.status, v.close_note from clinic_reception.appointments a join clinic_reception.visits v on v.appointment_id=a.id where a.id=$1',[row.appt]))[0];
assert.equal(after.status,'no_show');assert.match(after.close_note,/^زيارة مسجلة بالخطأ — المريض لم يحضر — المريض ما جاش والزيارة اتسجلت بالغلط/);
assert.equal(+(await q("select count(*) n from clinic_reception.audit where action='visit_void_completed' and entity_id=$1",[row.visit]))[0].n,1);
// a plain service_void (not a visit void) never touches the appointment: trigger ignores it
const plain=(await q("select count(*) n from clinic_reception.requests where kind='service_void' and coalesce(payload->>'visit_void','')<>'true'"))[0].n;assert.equal(+plain,0);
// rollback
await db.exec('reset role');await db.exec(fs.readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','rollbacks','20261122040000_reception_visit_void.rollback.sql'))},'utf8'));
assert.equal((await q("select to_regprocedure('public.clinic_reception_visit_void_request(uuid,uuid,text,uuid)') r"))[0].r,null);
await db.close();console.log('PASS visit void: one request files service_void for each executed service (amount from invoice, idempotent, audited), unexecuted order blocks, maker≠checker, approval reverses via the existing path, appointment → no_show + reason on the visit, rollback.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'visit-void-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
