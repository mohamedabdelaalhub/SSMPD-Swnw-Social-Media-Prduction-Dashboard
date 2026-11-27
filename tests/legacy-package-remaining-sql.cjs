// 20261127290000 «باكج مدفوع قبل السيستم» with «المدفوع قبل كده» + «الباقي» (owner 2026-11-27 «موافق على المدفوع والباقي في الباكج القديم»).
// Reuses the setup of tests/legacy-prepaid-package-sql.cjs (reception member, FM approver, clinic_finance stand-in), then the real case:
// a 3,400 package (legs 3 × 700 + arms 3 × 433.35) with 2,000 paid before and 1,400 paid today → 3198 holds 2,000 only, the 1,400 is an
// ordinary package invoice (Dr 1122 / Cr 2151) that today's credit pays through «استخدام رصيد المريض»; remaining 0 = the old behaviour.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'legacy-prepaid-package-sql.cjs'),'utf8');const cut=src.indexOf(' // rollback refused once approved');
assert(cut>0,'legacy-prepaid-package-sql.cjs markers moved; update this test');
const body=` // ---- 20261127290000
 await db.exec('reset role');const x_M2=fs.readFileSync('supabase/migrations/20261127290000_legacy_package_remaining.sql','utf8');await db.exec(x_M2);
 await assert.rejects(()=>db.exec(x_M2),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(1);const x_legs=(await cmd('service',{code:'LZL',name:'ليزر رجلين بالكامل كانديلا',department:dept,price:800,minutes:40,bom:[]})).id;
 const x_arms=(await cmd('service',{code:'LZR',name:'ليزر إيدين بالكامل كانديلا',department:dept,price:500,minutes:30,bom:[]})).id;
 await as(3);const x_base={patient_id:patient,name:'باكج ليزر رجلين وإيدين كانديلا',paid_on:ago(56),total:'3400',receipt_ref:'IHospital',
   lines:[{service_id:x_legs,sessions:3,amount:'2100'},{service_id:x_arms,sessions:3,amount:'1300'}]};
 await assert.rejects(()=>cmd('legacy_package_request',{...x_base,paid_before:'0'}),/أكبر من صفر/);
 await assert.rejects(()=>cmd('legacy_package_request',{...x_base,paid_before:'3500'}),/أكبر من قيمة الباكج/);
 await assert.rejects(()=>cmd('legacy_package_request',{...x_base,paid_before:'abc'}),/رقم/);
 const x_rq=await cmd('legacy_package_request',{...x_base,paid_before:'2000'});assert.equal(+x_rq.paid_before,2000);assert.equal(+x_rq.remaining,1400);
 lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});const x_pend=lp.pending.find(x=>x.id===x_rq.id);
 assert.equal(+x_pend.paid_before,2000);assert.equal(+x_pend.remaining,1400,'the approver sees both numbers');
 await as(9);const apv=await rpc('clinic_reception_legacy_package_review',{p_id:x_rq.id,p_approve:true});assert.equal(apv.status,'approved');
 assert.equal(+apv.paid_before,2000);assert.equal(+apv.remaining,1400);assert(apv.remaining_invoice,'remaining invoice created');
 const pkg2=(await q('select * from clinic_reception.packages where id=$1',[apv.package_id]))[0];assert.equal(+pkg2.contract_price,3400);assert.equal(+pkg2.funded,3400);
 const x_e2=await q('select service_id,allocated_value from clinic_reception.entitlements where package_id=$1 order by service_id,visit_no',[pkg2.id]);
 assert.equal(x_e2.length,6);assert.equal(+x_e2.filter(e=>e.service_id===x_legs).reduce((t,e)=>t+ +e.allocated_value,0),2100,'sessions keep their full value');
 const x_j3=await q("select l.account,l.debit,l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='legacy_package' and j.source_id=$1 order by l.debit desc",[pkg2.id]);
 assert.deepEqual(x_j3.map(x=>[x.account,+x.debit,+x.credit]),[['3198',2000,0],['2151',0,2000]],'3198 holds only what was paid before');

 const x_inv=(await q('select * from clinic_reception.invoices where id=$1',[apv.remaining_invoice]))[0];assert.equal(+x_inv.amount,1400);assert.equal(x_inv.kind,'installment');assert.equal(x_inv.package_id,pkg2.id);
 assert.match(x_inv.description,/باقي باكج مدفوع قبل السيستم/);
 const x_jr=await q("select l.account,l.debit,l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='package_installment' and j.source_id=$1 order by l.debit desc",[x_inv.id]);
 assert.deepEqual(x_jr.map(x=>[x.account,+x.debit,+x.credit]),[['1122',1400,0],['2151',0,1400]],'remaining = ordinary package invoice');
 await as(3);let x_s2=await snap();assert.equal(+x_s2.invoices.find(i=>i.id===x_inv.id).due,1400,'shows as due on the patient');
 // today's 1,400 collected earlier as the patient's credit → «استخدام رصيد المريض» pays the remaining invoice
 await db.exec('reset role');await db.query("insert into clinic_reception.journal(workspace_id,source,source_id,description,dimensions,actor_id) values($1,'patient_credit',gen_random_uuid(),'رصيد لصالح المريض (اختبار)',$2,$3)",[w,{patient_id:patient},id(3)]);
 {const je=(await db.query("select id from clinic_reception.journal where source='patient_credit' order by created_at desc limit 1")).rows[0].id;await db.query("insert into clinic_reception.journal_lines values($1,'1111',1400,0),($1,'2150',0,1400)",[je]);}
 await as(3);await cmd('credit_apply',{invoice_id:x_inv.id,amount:'1400'});x_s2=await snap();assert.equal(+x_s2.invoices.find(i=>i.id===x_inv.id).due,0,'paid from the credit');
 // the sessions are usable as before
 lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.sessions.find(x=>x.service_id===x_legs).left,3);
 // remaining 0 (paid_before empty or = total) → the old behaviour, no invoice
 const x_rq0=await cmd('legacy_package_request',{...x_base,name:'باكج تاني كامل',total:'700',lines:[{service_id:x_legs,sessions:1,amount:'700'}],paid_before:'700'});assert.equal(+x_rq0.remaining,0);
 await as(9);const x_ap0=await rpc('clinic_reception_legacy_package_review',{p_id:x_rq0.id,p_approve:true});assert.equal(x_ap0.remaining_invoice,null);
 const x_j0=await q("select l.account,l.debit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='legacy_package' and j.source_id=$1 and l.debit>0",[x_ap0.package_id]);assert.equal(+x_j0[0].debit,700);
 assert.equal((await q("select count(*)::int n from clinic_reception.invoices where package_id=$1",[x_ap0.package_id]))[0].n,0,'no invoice when nothing remains');
 // rollback refused once a request used «المدفوع قبل كده»
 await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync('supabase/rollbacks/20261127290000_legacy_package_remaining.rollback.sql','utf8')),/مينفعش الرجوع/);await db.exec('rollback');
 console.log('PASS legacy package remaining: paid_before validated (> 0, ≤ total, number), approver sees paid before / remaining, approval Dr 3198 / Cr 2151 for 2,000 only, package 3,400 funded with full session values, remaining 1,400 = ordinary package invoice (Dr 1122 / Cr 2151) due on the patient and paid by «استخدام رصيد المريض»; remaining 0 = old behaviour (no invoice); rollback refused after use.');
 await db.close();})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(require('os').tmpdir(),'lpr-'+process.pid+'.cjs');
fs.writeFileSync(file,src.slice(0,cut).replace("require('./helpers/reception.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception.cjs'))+')')+body);
try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
