// Owner 2026-11-18: «رقم الإيصال أو مرجع العملية» — cash gets an automatic unique receipt number; other methods ask for the transaction number.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const d=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=d.window;w.SSMPDFinanceControls=w.SSMPDFinanceControls||undefined;
try{w.eval(fs.readFileSync('assets/js/finance-cash.js','utf8'));}catch(e){}
const h=w.SSMPDFinanceCash&&w.SSMPDFinanceCash.helpers;assert(h&&h.paymentFields,'helpers exported');
const f=w.document.createElement('form');f.innerHTML=h.paymentFields({shifts:[['s1','dina']]});w.document.body.appendChild(f);
const ref=f.elements.reference,m=f.elements.method;assert.match(ref.value,/^RC-\d{6}-\d{6}-\d{3}$/,'cash: automatic receipt number '+ref.value);assert(ref.required);
const set=v=>{m.value=v;m.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('pos');assert.equal(ref.value,'','card: the automatic number is cleared');assert.match(ref.placeholder,/رقم العملية/);
ref.value='123456';ref.dispatchEvent(new w.Event('input',{bubbles:true}));set('cash');assert.equal(ref.value,'123456','typed value kept');
ref.value='';set('cash');assert.match(ref.value,/^RC-/,'empty cash gets a new number');
assert.match(f.textContent,/بيتكتب لوحده/);
console.log('PASS payment reference: automatic receipt number for cash, transaction number asked for card/instapay/bank, typed values kept.');
