// «رصيد الخزينة الرئيسية الآن» (20261122120000): tile with the live book balance, shift opening / in / out, custodian and last movement;
// the main row's «يظهر بعد الجرد» becomes the book balance; collection rows keep the blind count; not configured / error → nothing shown.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;let data;
w.SSMPDDb={client:{rpc:async fn=>{assert.equal(fn,'clinic_finance_main_treasury_balance');return data instanceof Error?{error:data}:{data};}}};
try{w.eval(fs.readFileSync('assets/js/finance-cash.js','utf8'));}catch(e){}
const h=w.SSMPDFinanceCash.helpers,tick=()=>new Promise(r=>setTimeout(r,20));
async function show(v){data=v;const body=w.document.createElement('div');body.innerHTML='<section data-fc-main-balance></section><table><tr><td><span data-fc-main-exp>يظهر بعد الجرد</span></td><td>يظهر بعد الجرد</td></tr></table>';w.document.body.appendChild(body);h.fillMainBalance(body);await tick();return body;}
let b=await show({configured:true,register:'الخزينة الرئيسية',balance:24350,last_move:{at:'2026-11-22T13:32:00Z',description:'استلام خزينة SHIFT-x',amount:1800},shift:{id:'m1',opened_at:'2026-11-21T08:30:00Z',custodian:'محمود',cash_in:14150,cash_out:1800,opening:12000}});
const t=b.querySelector('[data-fc-main-balance]').textContent;
assert.match(t,/رصيد الخزينة الرئيسية الآن \(دفتري\)/);assert.match(t,/24,350\.00 ج\.م/);assert.match(t,/المسؤول: محمود/);assert.match(t,/آخر حركة/);
assert.match(t,/رصيد بداية الوردية12,000\.00/);assert.match(t,/\+ 14,150\.00/);assert.match(t,/− 1,800\.00/);
const tds=[...b.querySelectorAll('td')].map(x=>x.textContent);assert.equal(tds[0],'24,350.00 (دفتري الآن)','main row shows the book balance');assert.equal(tds[1],'يظهر بعد الجرد','collection rows stay blind');
// no open main shift: tile without the three cards
b=await show({configured:true,register:'الخزينة الرئيسية',balance:500,last_move:null,shift:null});assert.match(b.textContent,/مفيش وردية مفتوحة للخزينة الرئيسية/);assert.equal(b.querySelector('.fc-mb-row'),null);
// not configured / error: removed
b=await show({configured:false});assert.equal(b.querySelector('[data-fc-main-balance]'),null);
b=await show(new Error('function does not exist'));assert.equal(b.querySelector('[data-fc-main-balance]'),null);
// escaping
b=await show({configured:true,register:'<img src=x>',balance:1,shift:{opened_at:'2026-11-21T08:30:00Z',custodian:'<img src=y>',cash_in:0,cash_out:0,opening:1}});assert.equal(b.querySelector('img'),null);
console.log('PASS main treasury balance: tile with live book balance, opening/in/out, custodian, last movement; main row filled, collection rows stay blind; no shift / not configured / error / escaping.');
})().catch(e=>{console.error(e);process.exit(1);});
