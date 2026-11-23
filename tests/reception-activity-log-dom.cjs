// «سجل نشاط الاستقبال» UI (reception-activity-log.js, 20261123010000): a reception section only for GM / super admin / FM; filters,
// period + operation chips, per-employee summary (click a name filters), log grouped by day, a multi-visit payment shows
// «دفعة واحدة لـ2 زيارات — لأكتر من مريض» + its note, «اعرض أكتر» paging, CSV export with a BOM; English digits. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-activity-log.js','utf8');
const tick=(ms)=>new Promise(r=>setTimeout(r,ms||20));
const now=new Date().toISOString();
const rows=[
 {id:1,at:now,action:'collect_multi',kind:'pay',actor_id:'u4',actor:'منار',auto:false,patient:'يحيى تجريبي',file_no:'P-2026-000001',provider:null,amount:1000,method:'instapay',visits:2,cross_patient:true,note:'يحيى دفع عن محمود'},
 {id:2,at:now,action:'arrive',kind:'visit',actor_id:'u4',actor:'منار',auto:false,patient:'سارة تجريبية',file_no:'P-2026-000002',provider:'د. جلدية تجريبية',visit_no:118},
 {id:3,at:now,action:'book',kind:'book',actor_id:'sys',actor:'الحجز التلقائي',auto:true,patient:'هبة تجريبية',provider:'د. جلدية تجريبية',starts_at:now},
 {id:4,at:now,action:'request',kind:'void',actor_id:'u5',actor:'مازن',auto:false,patient:'عمر تجريبي',amount:200,request_kind:'refund',reason:'اتطلبت بالغلط',request_status:'pending'}];
const summary=[{id:'u4',name:'منار',auto:false,visits:1,bookings:0,services:0,changes:0,collections:1,amount:1000,visits_paid:2},{id:'u5',name:'مازن',auto:false,visits:0,bookings:0,services:0,changes:1,collections:0,amount:0,visits_paid:0},{id:'sys',name:'الحجز التلقائي',auto:true,visits:0,bookings:1,services:0,changes:0,collections:0,amount:0,visits_paid:0}];
async function run(role){
 const dom=new JSDOM('<main id="h"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 w.SSMPDAuth={currentAdmin:{id:'a1',role}};w.SSMPDRoles={rolesOf:a=>[a.role]};const toasts=[];w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);const f=a.p_filter||{};let r=rows.filter(x=>!f.actor||(f.actor==='auto'?x.auto:x.actor_id===f.actor)).filter(x=>!f.kind||x.kind===f.kind);
  const page=r.slice(f.offset||0,(f.offset||0)+(f.limit||50));return Promise.resolve({data:{total:r.length,rows:page,summary,providers:[{id:'d1',name:'د. جلدية تجريبية'}]},error:null});}}};
 w.SSMPDReceptionModules={sections:()=>[['payments','التحصيل','']],panel:(s)=>'<p>'+s+'</p>',act:()=>false};
 w.URL.createObjectURL=()=>'blob:x';
 w.eval(src);await tick();
 return {w,d:w.document,calls,toasts};
}
(async()=>{
 // reception: no section, and the panel refuses
 const r=await run('reception');assert(!r.w.SSMPDReceptionModules.sections({}).some(x=>x[0]==='activity'),'hidden from reception');
 assert.match(r.w.SSMPDReceptionModules.panel('activity',{workspace:'ws'}),/للمدير العام والمدير المالي/);r.w.close();
 // financial manager
 const t=await run('financial_manager'),{d,w}=t;
 const sec=w.SSMPDReceptionModules.sections({}).find(x=>x[0]==='activity');assert(sec&&sec[1]==='سجل نشاط الاستقبال');
 assert.equal(w.SSMPDReceptionModules.panel('payments',{}),'<p>payments</p>','other sections untouched');
 d.querySelector('#h').innerHTML=w.SSMPDReceptionModules.panel('activity',{workspace:'ws1'});
 for(let i=0;i<50&&!d.querySelector('.ral-log');i++)await tick();
 const root=d.querySelector('[data-ral-root]');assert(root.querySelector('.ral-log'),'log rendered');
 const f0=t.calls[0][1];assert.equal(t.calls[0][0],'clinic_reception_activity');assert.equal(f0.p_workspace,'ws1');assert.equal(f0.p_filter.limit,50);
 assert.ok(f0.p_filter.from<=f0.p_filter.to,'default: last 3 days');
 // summary: names clickable, collections explain the visits
 const sum=root.querySelector('.ral-sum');assert(sum.textContent.includes('غطّت 2 زيارة'),'collections vs visits explained');
 assert(sum.querySelector('tr.auto').textContent.includes('الحجز التلقائي'));assert(sum.querySelector('tr.tot'),'total row');
 // the multi-visit payment row
 const pay=root.querySelector('[data-ral-row="1"]');
 assert.match(pay.textContent,/تحصيل/);assert.match(pay.textContent,/دفعة واحدة لـ2 زيارات — لأكتر من مريض/);
 assert.equal(pay.querySelector('.ral-note.x').textContent,'يحيى دفع عن محمود');assert.match(pay.querySelector('.amt').textContent,/1,000/);
 assert.match(root.querySelector('[data-ral-row="3"]').textContent,/حجز تلقائي/);
 assert.match(root.querySelector('[data-ral-row="4"]').textContent,/السبب: اتطلبت بالغلط · مستني المراجعة/);assert.equal(root.querySelector('[data-ral-row="4"] .amt').textContent,'-200');
 assert(root.querySelector('.ral-day').textContent.startsWith('النهارده'));
 assert(!/[٠-٩]/.test(root.textContent),'English digits only');
 // click an employee name → actor filter
 root.querySelector('[data-ral-actor="u4"]').click();for(let i=0;i<30&&t.calls.length<2;i++)await tick();await tick();
 assert.equal(t.calls[1][1].p_filter.actor,'u4');assert.equal(d.querySelectorAll('.ral-row').length,2);
 // operation chip + period chip
 d.querySelector('[data-ral-kind="pay"]').click();await tick(60);assert.equal(t.calls.at(-1)[1].p_filter.kind,'pay');
 d.querySelector('[data-ral-period="0"]').click();await tick(60);const lf=t.calls.at(-1)[1].p_filter;assert.equal(lf.from,lf.to,'today only');
 // CSV export: up to 5000 rows, BOM, the note column
 let blobText=null;const B=w.Blob;w.Blob=function(parts,o){blobText=parts.join('');return new B(parts,o);};
 d.querySelector('[data-ral-kind=""]').click();d.querySelector('[data-ral-actor]')&&0;await tick(60);
 d.querySelector('[data-ral-csv]').click();for(let i=0;i<30&&!blobText;i++)await tick();
 assert.equal(t.calls.at(-1)[1].p_filter.limit,5000);assert(blobText.startsWith('﻿اليوم,الوقت,الموظف,العملية'),'CSV header with BOM');
 assert(blobText.includes('يحيى دفع عن محمود'),'note in the CSV');
 console.log('PASS reception activity log UI: GM/FM only section, summary (collections vs visits), log by day, multi-visit payment + note, auto booking, void amount, employee/operation/period filters, CSV with BOM, English digits.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
