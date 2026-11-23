// 20261123110000 «باكج مدفوع قبل السيستم»: reception registers a package paid before go-live (1,000 = 3 sessions + 385 = 3 sessions,
// paid 15/11), a super admin / FM approves (never the requester), the receipt is Dr 3198 / Cr 2151 with no shift, and today's «ordered»
// session switches to the package (patient pays 0, revenue + doctor fee on the session value). Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ago=n=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t}),snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const hand=(await cmd('service',{code:'LZH',name:'جلسة ليزر نص اليدين',department:dept,price:400,minutes:20,bom:[]})).id;
 const arm=(await cmd('service',{code:'LZA',name:'جلسة ليزر الإبط',department:dept,price:200,minutes:15,bom:[]})).id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'LZH',rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 // clinic_finance stand-in (accounts / entries / lines / lock_day) — the live mirror is covered by the rolled-back live script
 await db.exec('reset role');await db.exec(`create schema if not exists clinic_finance;create table if not exists clinic_finance.accounts(code text primary key,name text not null,kind text not null);
   insert into clinic_finance.accounts values('2151','مقدمات باكجات','liability') on conflict do nothing;
   create or replace function clinic_finance.lock_day() returns void language sql as $$select$$;`);
 await db.exec("insert into admins values('61000000-0000-4000-8000-000000000009','financial_manager',true)");
 const M=fs.readFileSync('supabase/migrations/20261123110000_legacy_prepaid_package.sql','utf8');await db.exec(M);
 await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 assert.equal((await q("select name from clinic_finance.accounts where code='3198'"))[0].name,'مقبوضات قبل تشغيل الداشبورد تحت التسوية');
 await as(3);
 const req={patient_id:patient,name:'ليزر نص إيد + إبط',paid_on:ago(8),total:'1385',receipt_ref:'إيصال ورقي 1520',
   lines:[{service_id:hand,sessions:3,amount:'1000'},{service_id:arm,sessions:3,amount:'385'}]};
 await assert.rejects(()=>cmd('legacy_package_request',{...req,total:'1300'}),/لازم يساوي المدفوع/);
 await assert.rejects(()=>cmd('legacy_package_request',{...req,paid_on:date}),/قبل النهارده/);
 const r=await cmd('legacy_package_request',req);assert.equal(r.status,'pending');assert.equal(+r.lines[0].per_session,333.33);assert.equal(+r.lines[1].per_session,128.33);
 await assert.rejects(()=>cmd('legacy_package_request',req),/مستني الاعتماد/,'no duplicate pending request');
 // reception sees its pending request, cannot approve
 let lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.can_review,false);assert.equal(lp.pending.length,1);
 await assert.rejects(()=>rpc('clinic_reception_legacy_package_review',{p_id:r.id,p_approve:true}),/سوبر أدمن أو المدير المالي/);
 // a super admin who filed a request cannot approve his own
 await as(1);const own=(await cmd('legacy_package_request',{...req,total:'500',lines:[{service_id:arm,sessions:2,amount:'500'}]})).id;
 await assert.rejects(()=>rpc('clinic_reception_legacy_package_review',{p_id:own,p_approve:true}),/مايقدرش يعتمده/);
 await as(9);await assert.rejects(()=>rpc('clinic_reception_legacy_package_review',{p_id:r.id,p_approve:false,p_note:''}),/سبب الرفض/);
 assert.equal((await rpc('clinic_reception_legacy_package_review',{p_id:own,p_approve:false,p_note:'مكرر'})).status,'rejected');
 // the financial manager approves
 const ok=await rpc('clinic_reception_legacy_package_review',{p_id:r.id,p_approve:true});assert.equal(ok.status,'approved');
 const pkg=(await q('select * from clinic_reception.packages where id=$1',[ok.package_id]))[0];
 assert.equal(+pkg.funded,1385);assert.equal(+pkg.contract_price,1385);assert.equal(pkg.legacy_paid_on.toISOString?pkg.legacy_paid_on.toISOString().slice(0,10):String(pkg.legacy_paid_on).slice(0,10),ago(8));
 const ents=await q('select service_id,visit_no,allocated_value from clinic_reception.entitlements where package_id=$1 order by service_id,visit_no',[pkg.id]);
 assert.equal(ents.length,6);const sum=x=>ents.filter(e=>e.service_id===x).map(e=>+e.allocated_value);
 assert.deepEqual(sum(hand),[333.33,333.33,333.34]);assert.deepEqual(sum(arm),[128.33,128.33,128.34]);
 const jl=await q("select l.account,l.debit,l.credit,j.description,j.dimensions from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='legacy_package' and j.source_id=$1 order by l.debit desc",[pkg.id]);
 assert.deepEqual(jl.map(x=>[x.account,+x.debit,+x.credit]),[['3198',1385,0],['2151',0,1385]],'Dr 3198 / Cr 2151, no cash account');
 assert.match(jl[0].description,/مدفوع قبل التشغيل بتاريخ/);assert.equal(jl[0].dimensions.shift_id,undefined,'no shift');
 await as(9);await assert.rejects(()=>rpc('clinic_reception_legacy_package_review',{p_id:r.id,p_approve:true}),/اتراجع قبل كده/);
 // today: she arrives, the laser order is «ordered» at 400 → reception switches it to the package session
 await as(3);const ap=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:hand,starts_at:date+'T09:00:00Z',same_day_ok:true})).id;
 await cmd('arrive',{id:ap});s=await snap();const visit=s.visits.find(v=>v.appointment_id===ap);let o=s.orders.find(x=>x.visit_id===visit.id);
 assert.equal(+o.price,400);
 lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});
 const sess=lp.sessions.find(x=>x.service_id===hand);assert.equal(sess.left,3);assert.equal(sess.of,3);assert(sess.legacy_paid_on);
 await assert.rejects(()=>cmd('order_use_package',{order_id:o.id,entitlement_id:lp.sessions.find(x=>x.service_id===arm).entitlement_id}),/لخدمة تانية/);
 const use=await cmd('order_use_package',{order_id:o.id,entitlement_id:sess.entitlement_id});assert.equal(+use.value,333.33);assert.equal(use.patient_pays,0);assert.equal(use.left,2);
 await assert.rejects(()=>cmd('order_use_package',{order_id:o.id,entitlement_id:sess.entitlement_id}),/متخصومة من باكج بالفعل/);
 // execution: invoice 333.33 covered by the package (due 0), recognized 2151 → 1122, doctor fee 20% of 333.33
 await cmd('execute',{id:o.id});s=await snap();const inv=s.invoices.find(i=>i.order_id===o.id);assert.equal(+inv.amount,333.33);assert.equal(+inv.due,0,'patient pays 0');
 const use2=await q("select l.account,l.debit,l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='package_use' and j.source_id=$1 order by l.debit desc",[o.id]);
 assert.deepEqual(use2.map(x=>[x.account,+x.debit,+x.credit]),[['2151',333.33,0],['1122',0,333.33]]);
 const fee=await q("select l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source='doctor_fee' and j.source_id=$1 and l.credit>0",[o.id]);
 assert.equal(+fee[0].credit,66.67,'doctor fee on the session value');
 lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.sessions.find(x=>x.service_id===hand).left,2);
 // (owner case 2) a session ALREADY EXECUTED but unpaid (400) → the package pays it: 333.33 from 2151, 66.67 credited, doctor fee cut
 await as(1);const ap2=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:hand,starts_at:date+'T10:00:00Z',same_day_ok:true})).id;await as(3);
 await cmd('arrive',{id:ap2});s=await snap();const v2=s.visits.find(v=>v.appointment_id===ap2);let o2=s.orders.find(x=>x.visit_id===v2.id);
 await cmd('execute',{id:o2.id});s=await snap();let inv2=s.invoices.find(i=>i.order_id===o2.id);assert.equal(+inv2.amount,400);assert.equal(+inv2.due,400,'executed, unpaid');
 const sess2=(await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient})).sessions.find(x=>x.service_id===hand);
 const u2=await cmd('order_use_package',{order_id:o2.id,entitlement_id:sess2.entitlement_id});assert.equal(u2.executed,true);assert.equal(+u2.value,333.33);assert.equal(+u2.credited,66.67);
 s=await snap();inv2=s.invoices.find(i=>i.order_id===o2.id);assert.equal(+inv2.due,0,'patient pays 0 after the package');
 const lines=await q("select j.source,l.account,l.debit,l.credit from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.source_id=$1 and j.source in ('package_use','package_price_diff','package_price_diff_fee') order by j.source,l.debit desc",[o2.id]);
 assert.deepEqual(lines.map(x=>[x.source,x.account,+x.debit,+x.credit]),[['package_price_diff','4192',66.67,0],['package_price_diff','1122',0,66.67],['package_price_diff_fee','2120',13.33,0],['package_price_diff_fee','5111',0,13.33],['package_use','2151',333.33,0],['package_use','1122',0,333.33]]);
 await assert.rejects(()=>cmd('order_use_package',{order_id:o2.id,entitlement_id:sess2.entitlement_id}),/متخصومة من باكج بالفعل/);
 assert.equal((await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient})).sessions.find(x=>x.service_id===hand).left,1);
 // rollback refused once approved
 await db.exec('reset role');await assert.rejects(()=>db.exec(fs.readFileSync('supabase/rollbacks/20261123110000_legacy_prepaid_package.rollback.sql','utf8')),/اتعتمد/);await db.exec('rollback');
 console.log('PASS legacy prepaid package: request (lines = total, past date, no duplicate) by reception, approval only by super admin / FM and never the requester, reject needs a reason, package + 6 sessions (333.33/333.34, 128.33/128.34), Dr 3198 / Cr 2151 with no shift, today\'s ordered session switched to the package (wrong service refused, once only), executed with patient due 0, 2151→1122 and doctor fee on 333.33.');
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
