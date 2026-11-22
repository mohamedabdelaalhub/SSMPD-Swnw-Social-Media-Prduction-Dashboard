// «جرد الخزينة الرئيسية» box + «شغلي النهارده» task (20261122200000): custodian sees the big button, counts by denomination (live total),
// submit sends clinic_finance_main_count with the counts and a token, result message; «افتح الخزينة الرئيسية» when closed; reviewer sees the
// waiting counts (24h highlighted) and reviews with clinic_finance_review_shift; nothing shown to staff without the right.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<div id="b"></div><div id="ft"></div>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,doc=w.document;
let calls=[],answer={};w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,a]);const v=answer[n];return Promise.resolve(v instanceof Error?{error:v}:{data:typeof v==='function'?v(a):v});}}};
w.eval(fs.readFileSync('assets/js/main-treasury-count.js','utf8'));const M=w.SSMPDMainCount;
const tick=()=>new Promise(r=>setTimeout(r,5));
const old=new Date(Date.now()-26*3600e3).toISOString(),now=new Date().toISOString();
const base={configured:true,register_id:'R',register:'الخزينة الرئيسية',is_custodian:true,can_review:true,open_shift:{id:'S',opened_at:now,custodian:'محمود',mine:true},
 last_count:{at:now,by:'محمود',counted:2400,expected:2400,difference:0,status:'submitted'},pending_reviews:1,overdue_reviews:0,pending:[{id:'P1',closed_at:now,counted:2400,expected:2400,mine:true,by:'محمود'}],can_count:true,can_open:false};
(async()=>{
 const box=doc.getElementById('b');answer.clinic_finance_main_count_status=base;let done=0;
 await M.mount(box,{onDone:()=>done++});
 assert.equal(box.hidden,false);const t=box.textContent;
 assert.match(t,/جرد الخزينة الرئيسية/);assert.match(t,/المسؤول: محمود/);assert.match(t,/آخر جرد/);assert.match(t,/مطابق/);assert.match(t,/مستني مراجعة\s*1/);
 assert.ok(box.querySelector('[data-mc-count].mc-big'),'big count button');assert.equal(box.querySelector('[data-mc-review]'),null,'own count not offered for own review');
 box.querySelector('[data-mc-count]').click();const f=box.querySelector('[data-mc-count-form]');assert.ok(f);assert.equal(f.querySelectorAll('.mc-den input').length,9);
 f.elements.c_200.value='12';f.elements.c_0_5.value='2';f.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(box.querySelector('[data-mc-total]').textContent,'2,401.00');
 f.elements.note.value='جرد آخر اليوم';answer.clinic_finance_main_count={counted:2401,expected:2400,difference:1};
 f.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 const c=calls.find(x=>x[0]==='clinic_finance_main_count');assert.equal(JSON.stringify(c[1].p_counts),JSON.stringify({'200':12,'100':0,'50':0,'20':0,'10':0,'5':0,'1':0,'0.5':2,'0.25':0}));
 assert.equal(c[1].p_note,'جرد آخر اليوم');assert.match(c[1].p_token,/^[0-9a-f-]{36}$/);assert.equal(done,1,'reload after save');
 assert.match(box.querySelector('[data-mc-status]').textContent,/فرق 1.00 \(اتسجّل في فروق الخزينة\)/);
 // server error shown in Arabic, button re-enabled
 box.innerHTML='';await M.mount(box,{});box.querySelector('[data-mc-count]').click();const f2=box.querySelector('[data-mc-count-form]');answer.clinic_finance_main_count=new Error('الخزينة الرئيسية مفتوحة باسم سامي — هو اللي يعمل الجرد');
 f2.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.match(box.querySelector('[data-mc-status]').textContent,/مفتوحة باسم سامي/);assert.equal(f2.querySelector('[type=submit]').disabled,false);
 // closed main treasury → «افتح الخزينة الرئيسية»
 answer.clinic_finance_main_count_status={...base,open_shift:null,can_count:false,can_open:true};await M.mount(box,{onDone:()=>done++});
 assert.match(box.textContent,/مقفولة دلوقتي/);answer.clinic_finance_open_shift='S2';box.querySelector('[data-mc-open]').click();await tick();
 assert.equal(calls.filter(x=>x[0]==='clinic_finance_open_shift')[0][1].p_register,'R');assert.equal(done,2);
 // reviewer (owner): waiting count from >24h highlighted, review form → clinic_finance_review_shift
 answer.clinic_finance_main_count_status={...base,is_custodian:false,can_count:false,open_shift:{...base.open_shift,mine:false},overdue_reviews:1,pending:[{id:'P9',closed_at:old,counted:2400,expected:2500,mine:false,by:'محمود'}]};
 await M.mount(box,{onDone:()=>done++});assert.equal(box.querySelector('[data-mc-count]'),null,'reviewer has no count button');
 assert.ok(box.querySelector('.mc-fact.is-late'));assert.match(box.textContent,/1 من أكتر من 24 ساعة/);assert.ok(box.querySelector('.mc-p.is-late'));assert.match(box.querySelector('.mc-p').textContent,/فرق \u200e?-100.00/);
 box.querySelector('[data-mc-review="P9"]').click();const rf=box.querySelector('[data-mc-review-form]');rf.elements.note.value='مراجعة: نقص 100 اتحوّل لفروق الخزينة';answer.clinic_finance_review_shift='P9';
 rf.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();const rv=calls.filter(x=>x[0]==='clinic_finance_review_shift')[0][1];assert.equal(JSON.stringify([rv.p_shift,rv.p_note]),JSON.stringify(['P9','مراجعة: نقص 100 اتحوّل لفروق الخزينة']));assert.equal(done,3);
 // staff without the right: nothing; failure: hidden
 answer.clinic_finance_main_count_status={...base,is_custodian:false,can_review:false,can_count:false};await M.mount(box,{});assert.equal(box.hidden,true);assert.equal(box.innerHTML,'');
 answer.clinic_finance_main_count_status=new Error('x');await M.mount(box,{});assert.equal(box.hidden,true);
 // «شغلي النهارده» tasks
 let tk=M.tasks(base);assert.equal(tk.length,1);assert.equal(tk[0].title,'جرد الخزينة الرئيسية');assert.match(tk[0].sub,/1 مستني مراجعة/);assert.equal(tk[0].btn,'اعمل الجرد');
 tk=M.tasks({...base,is_custodian:false,can_count:false,overdue_reviews:1,pending:[{id:'P9',mine:false}]});assert.equal(JSON.stringify(tk.map(x=>x.title)),JSON.stringify(['جرد الرئيسية مستني مراجعتك']));assert.equal(tk[0].count,1);
 assert.equal(M.tasks({...base,can_count:false,overdue_reviews:0}).length,0);
 // finance-today wires the task first and routes to «الخزائن والورديات» with the form auto-open
 w.eval(fs.readFileSync('assets/js/finance-today.js','utf8'));answer.clinic_finance_overview={can_review:true,needs:[]};answer.clinic_finance_main_count_status=base;let went=null;
 const host=doc.getElementById('ft');await w.SSMPDFinanceToday.mountAccounting(host,{go:x=>went=x});await tick();
 const first=host.querySelector('.ft-task b');assert.match(first.textContent,/جرد الخزينة الرئيسية/);host.querySelector('[data-ft-main-count]').click();assert.equal(went,'shifts');assert.equal(M.autoOpen,true);
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert(fc.includes("window.SSMPDMainCount.mount(body.querySelector('[data-fc-main-count]'),{onDone:function(){load();}})"),'box mounted on the shifts tab');
 assert(fc.includes('<section class="mc" data-fc-main-count aria-live="polite" hidden></section><section class="fc-main-bal" data-fc-main-balance'),'box next to (before) the balance tile');
 console.log('PASS main treasury count UI: big button, denomination form with live total, count RPC payload + token + reload, Arabic errors, open when closed, reviewer waiting list (24h highlight) + review RPC, hidden without rights, «شغلي النهارده» task + routing.');
})().catch(e=>{console.error(e);process.exit(1);});
