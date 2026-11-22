// Owner 2026-11-22: «المتابعة والتواصل» is its own reception section (not a sub-tab of «التحصيل والمستلزمات»), with Arabic kinds/statuses.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<body><div id="view-container"></div></body>',{runScripts:'outside-only'}).window;
w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false};
w.eval(fs.readFileSync('assets/js/reception-controls.js','utf8'));
w.eval(fs.readFileSync('assets/js/reception-services.js','utf8'));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const c={esc,money:v=>String(v),btn:(a,id,l)=>'<button data-rx-action="'+a+'" data-id="'+id+'">'+l+'</button>',stamp:v=>v,lookup:()=>'—',load(){},data:{workspace:{mode:'live'},visits:[],patients:[],invoices:[],payments:[],
 tasks:[{id:'t1',subject:'اتصل بالمريض',due_at:'2026-11-23',status:'open'},{id:'t2',subject:'x',due_at:'2026-11-23',status:'submitted'}],
 outbox:[{id:'o1',kind:'confirmation',body:'مرحبا',status:'draft'},{id:'o2',kind:'reminder',body:'تذكير',status:'approved'},{id:'o3',kind:'cancellation',body:'x',status:'sent'}]}};
const secs=w.SSMPDReceptionModules.sections().map(x=>x[0]);assert(secs.includes('followup')&&secs.includes('operations'),'followup is a section');
assert.equal(w.SSMPDReceptionModules.sections().find(x=>x[0]==='followup')[1],'المتابعة والتواصل');
const html=w.SSMPDReceptionModules.panel('followup',c);
for(const b of ['مهمة متابعة','مسودة تواصل','تثبيت مصدر الحجز'])assert(html.includes(b),'button '+b);
for(const t of ['تأكيد حجز','تذكير بالموعد','إلغاء حجز','مسودة / بانتظار الاعتماد','معتمدة','اتبعتت','مفتوحة','اتسلّمت للمراجعة'])assert(html.includes(t),'Arabic label '+t);
assert(!/>confirmation<|>draft<|>approved<|>open<|>submitted</.test(html),'no raw English kinds/statuses');
const ops=w.SSMPDReceptionModules.panel('operations',c);assert(!ops.includes('المتابعة والتواصل'),'removed from «التحصيل والمستلزمات» sub-tabs');
console.log('PASS follow-up section: own reception section, Arabic kinds/statuses, removed from operations sub-tabs.');process.exit(0);
