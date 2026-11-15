// Owner 2026-11-15 (via main chat): «موافق علي ب، فقط في حالة ان الباكدج عليها عرض مشروط».
// Conditional-offer packages: on cancel, consumed sessions are re-priced at the standalone price captured at sale.
const assert=require('node:assert/strict'),fs=require('fs'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_conditional_package_cancel']);
const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t}),snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});
const owner=async(sql,args)=>{await db.exec('reset role');const r=(await db.query(sql,args)).rows;await as(1);return r;};
let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id;
await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
const location=(await cmd('location',{name:'مخزن تجربة'})).id;
const service=(await cmd('service',{code:'PT',name:'جلسة علاج طبيعي',department:s.providers[0].department,price:300,minutes:30,bom:[]})).id;
const ag=(await cmd('agreement',{provider_id:provider,service_code:'PT',rate:20,deduct_material_cost:false,from:new Date(Date.parse(date)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AGPT'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
await cmd('availability',{provider_id:provider,starts_at:date+'T05:00:00Z',ends_at:date+'T20:00:00Z'});
const lines=[1,2,3].map(visit_no=>({visit_no,service_id:service,quantity:1}));
const tplCond=(await cmd('template',{code:'COND',name:'باكج ٣ جلسات بعرض',price:600,visits:3,validity_days:90,terms:'٣ جلسات',lines})).id;
const tplPlain=(await cmd('template',{code:'PLAIN',name:'باكج ٣ جلسات عادي',price:600,visits:3,validity_days:90,terms:'٣ جلسات',lines})).id;
// (set from the pricing screen in live; the flag is copied to templates by trigger)
await owner('update clinic_reception.package_templates set conditional_offer=true where id=$1',[tplCond]);
let hour=6;
async function sellUse(tpl,ref,used){const pkg=(await cmd('package_sell',{template_id:tpl,patient_id:patient})).id;await cmd('collect',{patient_id:patient,package_id:pkg,amount:600,method:'instapay',reference:ref});
 for(let v=1;v<=used;v++){const a=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:date+'T'+String(hour++).padStart(2,'0')+':00:00Z',package_id:pkg,package_visit_no:v})).id;const visit=(await cmd('arrive',{id:a})).id;const order=(await snap()).orders.find(x=>x.visit_id===visit);await cmd('execute',{id:order.id,location_id:location,materials:[]});}
 return pkg;}
const credit=async()=>-(+(await owner("select coalesce(sum(l.debit-l.credit),0) n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=$1 and l.account='2150' and j.dimensions->>'patient_id'=$2",[w,patient]))[0].n);
const acct=async a=>+(await owner('select coalesce(sum(l.credit-l.debit),0) n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=$1 and l.account=$2',[w,a]))[0].n;
// 1) conditional package, 1 of 3 sessions used: refund 600-300=300 (not the pro-rata 400); 100 discount forfeited as revenue
const p1=await sellUse(tplCond,'IP-C1',1);
let pk=(await owner('select conditional_offer,terms from clinic_reception.packages where id=$1',[p1]))[0];assert.equal(pk.conditional_offer,true);assert(pk.terms.includes('عرض مشروط'),'terms printed for signature');
assert.deepEqual((await owner('select standalone_unit::numeric n from clinic_reception.entitlements where package_id=$1 order by visit_no',[p1])).map(r=>+r.n),[300,300,300]);
let q=await rpc('clinic_reception_package_cancel_quote',{p_workspace:w,p_package:p1});
assert.deepEqual([q.method,+q.prorata_refund,+q.consumed_at_package,+q.consumed_at_standard,+q.conditional_refund,+q.forfeited_discount,+q.shortfall,+q.refundable],['conditional',400,200,300,300,100,0,300]);
const r1=(await cmd('request',{kind:'package_cancel',subject_id:p1,amount:999,reason:'المريض مش هيكمل',evidence:'طلب كتابي'})).id;
let req=(await owner('select amount,payload from clinic_reception.requests where id=$1',[r1]))[0];assert.equal(+req.amount,300,'amount from the quote');assert.equal(req.payload.method,'conditional');
await assert.rejects(()=>cmd('request_review',{id:r1,approve:true,note:'اعتماد ذاتي'}),e=>/مراجعًا آخر/.test(e.message));
const c0=await credit(),rev0=await acct('4110');
await as(2);const res=await cmd('request_review',{id:r1,approve:true,note:'مطابق للعقد'});await as(1);
assert.equal(+res.refund,300);assert.equal(+res.forfeited_discount,100);
assert.equal(await credit(),c0+300,'patient credit = refundable');assert.equal(await acct('4110'),rev0+100,'forfeited discount recognised');
assert.equal((await owner('select status from clinic_reception.packages where id=$1',[p1]))[0].status,'frozen');
assert.equal(+(await owner("select -coalesce(sum(l.debit-l.credit),0) n from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where l.account='2151' and j.dimensions->>'package_id'=$1",[p1]))[0].n,0,'package liability cleared');
assert((await owner('select payload from clinic_reception.requests where id=$1',[r1]))[0].payload.quote_at_approval,'audit of the numbers at approval');
// 2) plain package: unchanged pro-rata path
const p2=await sellUse(tplPlain,'IP-P1',1);
q=await rpc('clinic_reception_package_cancel_quote',{p_workspace:w,p_package:p2});assert.deepEqual([q.method,+q.refundable,+q.forfeited_discount],['prorata',400,0]);
const r2=(await cmd('request',{kind:'package_cancel',subject_id:p2,amount:1,reason:'إيقاف عادي',evidence:'طلب كتابي'})).id;
assert.equal(+(await owner('select amount from clinic_reception.requests where id=$1',[r2]))[0].amount,400);
const c1=await credit();await as(2);await cmd('request_review',{id:r2,approve:true,note:'مطابق'});await as(1);assert.equal(await credit(),c1+400);
// 3) all sessions used on a conditional package: nothing left, no automatic charge
const p3=await sellUse(tplCond,'IP-C3',3);q=await rpc('clinic_reception_package_cancel_quote',{p_workspace:w,p_package:p3});
assert.deepEqual([+q.prorata_refund,+q.conditional_refund,+q.shortfall],[0,0,300],'shortfall only shown');
// 4) snapshot: a package sold from an unflagged template stays pro-rata even if the template is flagged later
const p4=(await cmd('package_sell',{template_id:tplPlain,patient_id:patient})).id;await owner('update clinic_reception.package_templates set conditional_offer=true where id=$1',[tplPlain]);
assert.equal((await rpc('clinic_reception_package_cancel_quote',{p_workspace:w,p_package:p4})).method,'prorata');
// 5) numbers changed after the request → refused at review
await owner('update clinic_reception.package_templates set conditional_offer=false where id=$1',[tplPlain]);
const p5=await sellUse(tplCond,'IP-C5',0);const r5=(await cmd('request',{kind:'package_cancel',subject_id:p5,reason:'إيقاف',evidence:'طلب'})).id;
const a5=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:date+'T'+String(hour++).padStart(2,'0')+':00:00Z',package_id:p5,package_visit_no:1})).id;const v5=(await cmd('arrive',{id:a5})).id;await cmd('execute',{id:(await snap()).orders.find(x=>x.visit_id===v5).id,location_id:location,materials:[]});
await as(2);await assert.rejects(()=>cmd('request_review',{id:r5,approve:true,note:'مراجعة'}),e=>/اتغيّرت بعد الطلب/.test(e.message));
// rejection still works through the original path
await cmd('request_review',{id:r5,approve:false,note:'يحتاج طلب جديد'});await as(1);assert.equal((await owner('select status from clinic_reception.requests where id=$1',[r5]))[0].status,'rejected');
// migration re-runs cleanly
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261116110000_reception_conditional_package_cancel.sql','utf8'));await as(1);assert.equal((await rpc('clinic_reception_package_cancel_quote',{p_workspace:w,p_package:p3})).method,'conditional');
await db.exec('reset role');assert.equal((await db.query('select j.id from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id group by j.id having sum(debit)<>sum(credit)')).rows.length,0);
await db.close();console.log('PASS conditional package cancel: flag snapshotted at sale (terms + standalone prices), conditional re-pricing (refund 300, forfeit 100 to revenue, liability cleared), pro-rata unchanged, shortfall never charged, maker≠checker, stale numbers refused, rejection path, rerunnable migration, balanced journal.');
})().catch(e=>{console.error(e);process.exit(1);});
