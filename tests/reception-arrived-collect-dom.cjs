// Owner 2026-11-21 «اعمل زرار «تحصيل» على كارت المريض اللي حضر»: executes the visit's pending services after a
// confirmation (invoice only exists after execution), reloads, then opens «تسجيل تحصيل» on the invoice still due.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const w=new JSDOM('',{runScripts:'outside-only'}).window;let toasts=[],acts=[];
w.SSMPDToast={show:(m,k)=>toasts.push([k,m])};w.SSMPDReceptionModules={act:(a,id)=>{acts.push([a,id]);return true;}};
w.eval(fs.readFileSync('assets/js/reception-arrived-collect.js','utf8'));
const run=w.SSMPDArrivedCollect.run;
function world(orders,invoices,failOn){let data={workspace:{mode:'live'},visits:[{id:'v1',appointment_id:'a1'}],orders,invoices};const calls=[];
 const ctx=()=>({data,command:async(a,p)=>{calls.push([a,JSON.parse(JSON.stringify(p))]);if(failOn===p.id)throw new Error('حدد الجهاز المستخدم');const o=data.orders.find(x=>x.id===p.id);o.status='completed';},
  load:async()=>{data={...data,invoices:data.orders.filter(o=>o.status==='completed').map(o=>({id:'i-'+o.id,visit_id:'v1',due:o.price}))};}});
 return {ctx,calls};}
(async()=>{
 // pending service → confirm → execute with the order's doctor → reload → collect on the new invoice
 let W=world([{id:'o1',visit_id:'v1',status:'ordered',provider_id:'d1',price:600,snapshot:{name:'جلسة ديرما بن'}}],[]);let asked='';
 assert.equal(await run('a1',W.ctx,m=>{asked=m;return true;}),'collect');assert.match(asked,/جلسة ديرما بن/);assert.match(asked,/باسمك/);
 assert.deepEqual(W.calls,[['execute',{id:'o1',provider_id:'d1'}]]);assert.deepEqual(acts.pop(),['collect-invoice','i-o1']);
 // cancelled confirmation → nothing executed
 W=world([{id:'o1',visit_id:'v1',status:'ordered',provider_id:'d1',price:600,snapshot:{name:'كشف'}}],[]);
 assert.equal(await run('a1',W.ctx,()=>false),'cancelled');assert.equal(W.calls.length,0);
 // already executed + invoice due → straight to collect, no question
 W=world([{id:'o1',visit_id:'v1',status:'completed'}],[{id:'i1',visit_id:'v1',due:300}]);
 assert.equal(await run('a1',W.ctx,()=>{throw Error('should not ask');}),'collect');assert.deepEqual(acts.pop(),['collect-invoice','i1']);
 // fully paid
 W=world([{id:'o1',visit_id:'v1',status:'completed'}],[{id:'i1',visit_id:'v1',due:0}]);assert.equal(await run('a1',W.ctx),'paid');assert.match(toasts.pop()[1],/مسدّدة بالكامل/);
 // execution needs a device → message + visit details
 W=world([{id:'o1',visit_id:'v1',status:'ordered',provider_id:'d1',price:600,snapshot:{name:'ليزر'}}],[],'o1');
 assert.equal(await run('a1',W.ctx,()=>true),'execute_failed');assert.match(toasts.pop()[1],/حدد الجهاز المستخدم/);assert.deepEqual(acts.pop(),['visit-detail','v1']);
 // no visit yet
 W=world([],[]);assert.equal(await run('zz',W.ctx),'no_visit');
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
 assert(/\(a\.status==='arrived'\|\|a\.status==='completed'\)&&window\.SSMPDArrivedCollect\?btn\('arrived-collect',a\.id,'تحصيل'\)/.test(src),'button on arrived cards');
 assert(/if\(action==='arrived-collect'\)\{if\(fx\('SSMPDArrivedCollect','run'\)\)window\.SSMPDArrivedCollect\.run\(id,context\);return;\}/.test(src),'arrived-collect handler (guarded: module + run must exist)');
 console.log('PASS «تحصيل» on the arrived card: execute after confirmation, then collect on the due invoice');
})().catch(e=>{console.error(e);process.exit(1);});
