// «خزن التحصيل المفتوحة» (20261122010000, owner «طبقه» 2026-11-21): the finance reviewer sees every open collection drawer with cash and its state;
// «استلم النقدية / رفض» only on a pending handover he did not create and only with his main shift open; guidance lines otherwise; empty and error states.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const d=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=d.window;
let data;w.SSMPDAuth={currentAdmin:{id:'acc'}};const nudges=[];w.SSMPDToast={show:()=>{}};w.SSMPDDb={client:{rpc:async (fn,args)=>{if(fn==='clinic_finance_handover_nudge'){nudges.push(args);return {data:{id:'n1',replayed:false}};}assert.equal(fn,'clinic_finance_open_drawers');return data instanceof Error?{error:data}:{data};}}};
try{w.eval(fs.readFileSync('assets/js/finance-cash.js','utf8'));}catch(e){}
const h=w.SSMPDFinanceCash.helpers;assert(h.fillDrawers,'exported');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function show(v){data=v;const body=w.document.createElement('div');body.innerHTML='<div data-fc-drawers></div>';w.document.body.appendChild(body);h.fillDrawers(body);await tick();return body;}
const base={main_register:{id:'M',name:'الخزينة الرئيسية'},my_main_shift:'m1',drawers:[
 {shift_id:'s1',register:'خزينة منار',cashier:'منار',opened_at:'2026-11-21T09:00:00Z',ended_at:'2026-11-21T20:00:00Z',end_counted:1800,cash:1800,pending:{id:'t1',amount:1800,created_by:'manar'},rejected:false},
 {shift_id:'s2',register:'خزينة مازن',cashier:'مازن',opened_at:'2026-11-21T14:00:00Z',ended_at:null,end_counted:null,cash:1200,pending:null,rejected:false},
 {shift_id:'s3',register:'خزينة الحجوزات',cashier:'سارة',opened_at:'2026-11-21T10:00:00Z',ended_at:'2026-11-21T19:00:00Z',end_counted:800,cash:800,pending:null,rejected:true}]};
let b=await show(base);const t=b.textContent;
assert.match(t,/خزن التحصيل المفتوحة/);assert.match(t,/باسمك: مفتوحة ✓/);
const rows=[...b.querySelectorAll('.fc-drawer')];assert.equal(rows.length,3);
assert.match(rows[0].textContent,/خزينة منار.*منار.*مستني استلامك.*1,800\.00 ج\.م.*المعدود عند الجرد/s);
assert.equal(rows[0].querySelector('[data-fin-action]').dataset.finAction,'treasury-review');assert.equal(rows[0].querySelector('[data-fin-action]').dataset.id,'t1');
assert.match(rows[1].textContent,/لسه ماجردش.*1,200\.00 ج\.م.*النقدي المسجل في العهدة.*اطلب منه يسلّم/s);assert.equal(rows[1].querySelector('[data-fc-nudge]').dataset.fcNudge,'s2');
rows[1].querySelector('[data-fc-nudge]').click();await tick();assert.equal(JSON.stringify(nudges),JSON.stringify([{p_shift:'s2',p_note:''}]));assert.match(rows[1].textContent,/اتبعتله التنبيه/);
assert.match(rows[2].textContent,/التسليم اترفض.*إعادة الجرد/s);assert(!rows[2].querySelector('button'));
// main shift not open: no receive button, an «افتح وردية» action instead
b=await show(Object.assign({},base,{my_main_shift:null}));assert.match(b.textContent,/مش مفتوحة باسمك/);assert.equal(b.querySelector('.fc-drawers-main [data-fin-action]').dataset.finAction,'open');
assert(!b.querySelector('[data-fin-action="treasury-review"]'));assert.match(b.querySelector('.fc-drawer').textContent,/افتح وردية الرئيسية الأول/);
// he created the request himself: no receive button
b=await show(Object.assign({},base,{drawers:[Object.assign({},base.drawers[0],{pending:{id:'t1',amount:1800,created_by:'acc'}})]}));assert(!b.querySelector('[data-fin-action="treasury-review"]'));assert.match(b.textContent,/لازم حد تاني يستلم/);
// empty + error (migration not applied): empty message / box removed
b=await show(Object.assign({},base,{drawers:[]}));assert.match(b.textContent,/مفيش خزن تحصيل مفتوحة/);
b=await show(new Error('function does not exist'));assert.equal(b.querySelector('[data-fc-drawers]'),null);
// html is escaped
b=await show(Object.assign({},base,{drawers:[Object.assign({},base.drawers[1],{register:'<img src=x onerror=alert(1)>'})]}));assert.equal(b.querySelector('img'),null);
console.log('PASS open drawers: list with states and amounts, receive only on a pending handover by another person with the main shift open, open-shift action, empty / error / escaping.');
})().catch(e=>{console.error(e);process.exit(1);});
