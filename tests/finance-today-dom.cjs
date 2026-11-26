// «شغلي النهارده» (owner «طبقه» 2026-11-21): role tasks from the existing clinic_finance_overview() needs; numbers under «تفاصيل أكتر»
// (rendered lazily); accountant gets shortcuts without the clinic-wide numbers; cashier band in «خزينة الاستقبال» reuses existing actions.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,d=w.document;let ov,renders=0;
w.SSMPDAuth={currentAdmin:{id:'u1'}};w.SSMPDDb={client:{rpc:async fn=>{assert.equal(fn,'clinic_finance_overview');return ov instanceof Error?{error:ov}:{data:ov};}}};
w.SSMPDAccountingOverview={render:(host)=>{renders++;host.innerHTML='<p data-ov>OVERVIEW</p>';}};
w.eval(fs.readFileSync('assets/js/finance-today.js','utf8'));const T=w.SSMPDFinanceToday,tick=()=>new Promise(r=>setTimeout(r,10));
// 1. reviewer: 5 tasks, counts from needs, hot when waiting, go() to the right section, overview lazy under «تفاصيل أكتر»
ov={can_review:true,needs:[{kind:'handover',count:2},{kind:'requests',count:4},{kind:'cash_cases',count:1}]};
let host=d.createElement('div');d.body.appendChild(host);const went=[];
let r=await T.mountAccounting(host,{go:id=>went.push(id),allowed:()=>true});assert.equal(r.can_review,true);
let tasks=[...host.querySelectorAll('.ft-task')];assert.equal(tasks.length,5);
assert.deepEqual(tasks.map(t=>[...t.querySelector('b').children].map(x=>x.textContent).join(' ')),['استلم كاش 2','اعتمادات مستنياك 4','فروق الخزينة 1','ورديات للمراجعة','ملخص اليوم']);
assert.equal(host.querySelector('.ft-group').textContent,'كل يوم','everyday tasks in their own row (help 277)');assert.equal(host.querySelectorAll('.ft-calm .ft-task').length,2);
assert.deepEqual(tasks.map(t=>t.classList.contains('is-hot')),[true,true,true,false,false]);
tasks[0].querySelector('button').click();tasks[1].querySelector('button').click();tasks[2].querySelector('button').click();assert.deepEqual(went,['shifts','requests','cases']);
const more=host.querySelector('[data-ft-more]');assert(more&&!more.open,'details closed by default');assert.equal(renders,0,'overview not drawn until opened');
w.HTMLElement.prototype.scrollIntoView=function(){};tasks[4].querySelector('button').click();await tick();assert(more.open);assert.equal(renders,1);assert(host.querySelector('[data-ov]'));
more.open=false;more.dispatchEvent(new w.Event('toggle'));more.open=true;more.dispatchEvent(new w.Event('toggle'));assert.equal(renders,1,'drawn once');
// remembered open on the next visit
host=d.createElement('div');d.body.appendChild(host);await T.mountAccounting(host,{go:()=>{}});assert(host.querySelector('[data-ft-more]').open,'remembers «تفاصيل أكتر» open');
// 2. accountant (no review): shortcuts, no numbers block; a section he cannot open is not offered
ov={can_review:false,needs:[]};host=d.createElement('div');d.body.appendChild(host);
await T.mountAccounting(host,{go:()=>{},allowed:id=>id!=='doctor-accounts'});
tasks=[...host.querySelectorAll('.ft-task')];assert.deepEqual(tasks.map(t=>t.querySelector('b').textContent),['طلبات الصرف','حساب مورد'],'help 277: no voucher/statement cards that open an empty screen; doctor and supplier are separate, filtered by allowed()');
assert.equal(tasks[1].querySelector('button').getAttribute('data-ft-go'),'suppliers');assert.equal(host.querySelector('[data-ft-more]'),null,'no clinic-wide numbers');
// 3. overview unavailable -> rejects (caller falls back to the old behaviour)
ov=new Error('function does not exist');host=d.createElement('div');d.body.appendChild(host);await assert.rejects(T.mountAccounting(host,{}));
// 4. cashier band
const data={me:'c1',shifts:[{id:'s9',cashier_id:'c1',is_main:false,status:'open',register_name:'خزينة منار'},{id:'m1',cashier_id:'x',is_main:true,status:'open'}]};
host=d.createElement('div');host.innerHTML=T.cashierHtml(data)+'<h4>إثبات الفيزا والتحويلات للمقدمات</h4>';d.body.appendChild(host);
tasks=[...host.querySelectorAll('.ft-task')];assert.deepEqual(tasks.map(t=>t.querySelector('b').textContent),['سلّم كاش لزميل أو للرئيسية','اقفل ورديتي وسلّم الكاش','مقدمات الحجز']);
assert.match(host.querySelector('.ft-head').textContent,/خزينة منار — الوردية مفتوحة/);
const end=tasks[1].querySelector('button');assert.equal(end.dataset.finAction,'treasury-end');assert.equal(end.dataset.id,'s9');
let opened=0;w.SSMPDPeerHandover={openSend:()=>{opened++;}};T.wireCashier(host);tasks[0].querySelector('button').click();assert.equal(opened,1);
let scrolled=null;w.HTMLElement.prototype.scrollIntoView=function(){scrolled=this.textContent;};tasks[2].querySelector('button').click();assert.match(scrolled,/مقدمات/);
// ended shift / no shift / escaping
host.innerHTML=T.cashierHtml({me:'c1',shifts:[{id:'s9',cashier_id:'c1',is_main:false,status:'open',ended_at:'2026-11-21T20:00:00Z',register_name:'<img src=x>'}]});
assert.match(host.textContent,/ورديتك خلصت/);assert.equal(host.querySelector('img'),null);assert(!host.querySelector('[data-fin-action="treasury-end"]'));
host.innerHTML=T.cashierHtml({me:'c1',shifts:[]});assert.match(host.textContent,/مفيش وردية مفتوحة باسمك/);
console.log('PASS finance today: reviewer tasks with counts + hot + section routing, overview lazy under «تفاصيل أكتر» (remembered), accountant shortcuts without numbers, unavailable fallback, cashier band reusing handover / end-shift actions, escaping.');
})().catch(e=>{console.error(e);process.exit(1);});
