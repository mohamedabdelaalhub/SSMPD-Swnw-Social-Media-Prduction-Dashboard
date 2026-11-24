// «تسليم» (owner 2026-11-24): the shift safe («ورديتك مفتوحة») has ONE «تسليم» button → «تسليم للخزينة الرئيسية» / «تسليم التحصيل لزميل».
// Each option is enabled only when its target has an open shift (else disabled + the reason). Both reuse the existing paths:
// main → clinic_finance_treasury_command (transfer_request / end_shift), colleague → clinic_finance_peer_handover('request').
// Reception user, real reception-shift-reminder.js + peer-handover.js, server stubbed. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<body><a data-goto="reception_services"></a></body>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
const calls=[],tcalls=[],toasts=[];let pending=null,outgoing=[],main={shift_id:'m1',register_id:'R-main',register:'الخزينة الرئيسية',name:'محمود'},cols=[{shift_id:'s2',name:'مازن',register:'خزينة مازن'}];
w.SSMPDToast={show:m=>toasts.push(m)};w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};
w.SSMPDDb={financeTreasuryCommand:async(a,p,k)=>{tcalls.push([a,p,k]);return {id:'t1'};},client:{rpc:async(fn,a)=>{
 if(fn==='clinic_reception_shift_reminder')return {data:{state:'open'}};
 calls.push([a.p_action,a.p_payload]);
 if(a.p_action==='inbox')return {data:{incoming:[],outgoing:outgoing}};
 if(a.p_action==='options')return {data:{shift:{id:'s1',register:'خزينة منار',cash:1800,available:1800},colleagues:cols,main:main,main_pending:pending}};
 if(a.p_action==='request')return {data:{id:'h1',to_name:'مازن',amount:a.p_payload.amount}};
 return {data:null};}}};
w.eval(fs.readFileSync('assets/js/peer-handover.js','utf8'));w.eval(fs.readFileSync('assets/js/reception-shift-reminder.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async(fn,what)=>{for(let n=0;n<400;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed: '+what)};
w.SSMPDShiftReminder.refresh();await wait(()=>q('[data-shift-fab]'),'green safe');
const openChoice=async()=>{q('[data-shift-fab]').click();await wait(()=>q('[data-shift-reminder] [data-shift-peer]'),'«ورديتك مفتوحة»');
 const b=q('[data-shift-reminder] [data-shift-peer]');assert.equal(b.textContent,'تسليم','one «تسليم» button');assert(!/تسليم تحصيل لزميل/.test(q('[data-shift-reminder]').textContent.replace(/«تسليم»/g,'')),'old label gone');
 b.click();await wait(()=>q('[data-peer-choice] [data-peer-choice-main]'),'choice');return q('[data-peer-choice]');};
// 1) both open → both enabled, with who is on the other side
let c=await openChoice();
assert.equal(c.querySelector('[data-peer-choice-main]').textContent,'تسليم للخزينة الرئيسية');assert.equal(c.querySelector('[data-peer-choice-peer]').textContent,'تسليم التحصيل لزميل');
assert.equal(c.querySelector('[data-peer-choice-main]').disabled,false);assert.equal(c.querySelector('[data-peer-choice-peer]').disabled,false);
assert.match(c.textContent,/محمود/);assert.match(c.textContent,/مازن فاتح وردية/);assert.match(c.textContent,/1,800/);
// 2) «تسليم للخزينة الرئيسية» → the send form with ONLY the main treasury, chosen → part → existing transfer_request
c.querySelector('[data-peer-choice-main]').click();await wait(()=>q('[data-peer-send] [data-peer-form]'),'main form');
let f=q('[data-peer-form]');assert.equal(q('[data-peer-send] h2').textContent,'تسليم للخزينة الرئيسية');
assert.deepEqual([...f.elements.to.options].map(o=>o.value),['','main']);assert.equal(f.elements.to.value,'main');
f.elements.amount.value='500';f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>tcalls.length===1,'transfer_request');
assert.equal(tcalls[0][0],'transfer_request');assert.deepEqual([tcalls[0][1].from_shift,tcalls[0][1].to_register,tcalls[0][1].amount],['s1','R-main',500]);
assert(!calls.some(x=>x[0]==='request'),'main never uses the peer path');await wait(()=>!q('[data-peer-send]'),'closed');assert.match(toasts.pop(),/للخزينة الرئيسية/);
// 3) «تسليم التحصيل لزميل» → ONLY colleagues (the one is chosen) → existing peer 'request'
c=await openChoice();c.querySelector('[data-peer-choice-peer]').click();await wait(()=>q('[data-peer-send] [data-peer-form]'),'peer form');
f=q('[data-peer-form]');assert.equal(q('[data-peer-send] h2').textContent,'تسليم التحصيل لزميل');
assert.deepEqual([...f.elements.to.options].map(o=>o.value),['','s2'],'no main option');assert.equal(f.elements.to.value,'s2');
assert(!/وردية الخزينة الرئيسية مش مفتوحة/.test(q('[data-peer-send]').textContent),'no main-closed line in the colleague form');
f.elements.amount.value='300';f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>calls.some(x=>x[0]==='request'),'request');
const r=calls.find(x=>x[0]==='request')[1];assert.deepEqual([r.from_shift,r.to_shift,r.amount],['s1','s2',300]);assert.equal(tcalls.length,1);
await wait(()=>!q('[data-peer-send]'),'closed');assert.match(toasts.pop(),/مازن/);
// 4) no colleague open → «تسليم التحصيل لزميل» disabled + the reason; no main shift → «تسليم للخزينة الرئيسية» disabled + the reason
cols=[];c=await openChoice();assert.equal(c.querySelector('[data-peer-choice-peer]').disabled,true);assert.match(c.textContent,/مفيش زميل فاتح وردية تحصيل دلوقتي/);
assert.equal(c.querySelector('[data-peer-choice-main]').disabled,false);c.querySelector('[data-peer-close]').click();
main=null;cols=[{shift_id:'s2',name:'مازن',register:'خزينة مازن'}];c=await openChoice();assert.equal(c.querySelector('[data-peer-choice-main]').disabled,true);
assert.match(c.textContent,/وردية الخزينة الرئيسية مش مفتوحة دلوقتي/);assert.equal(c.querySelector('[data-peer-choice-peer]').disabled,false);c.querySelector('[data-peer-close]').click();
// 5) a handover to the MAIN treasury pending on the shift → «تسليم التحصيل لزميل» disabled with that reason (the server refuses it then)
main={shift_id:'m1',register_id:'R-main',register:'الخزينة الرئيسية',name:'محمود'};pending={id:'tr1',amount:500,reference:'HO-1'};c=await openChoice();
assert.equal(c.querySelector('[data-peer-choice-peer]').disabled,true);assert.match(c.querySelector('[data-peer-choice-peer-why]').textContent,/فيه تسليم للخزينة الرئيسية معلّق على ورديتك \(500/);
assert.equal(c.querySelector('[data-peer-choice-main]').disabled,false,'main stays available');c.querySelector('[data-peer-close]').click();
// 6) a pending peer handover does not block main (server allows it) — it is shown as a note
pending=null;outgoing=[{id:'h9',to_name:'مازن',amount:300}];c=await openChoice();assert.equal(c.querySelector('[data-peer-choice-main]').disabled,false);
assert.match(c.querySelector('[data-peer-choice-out]').textContent,/عندك تسليم معلّق لزميل: مازن 300/);c.querySelector('[data-peer-close]').click();outgoing=[];
assert.deepEqual(errors,[]);
console.log('PASS «تسليم» choice (reception): one «تسليم» on «ورديتك مفتوحة» → «تسليم للخزينة الرئيسية» (form with only the main treasury → transfer_request) / «تسليم التحصيل لزميل» (only colleagues → peer request); each disabled with its reason when no open shift; «لزميل» disabled while a main handover is pending; a pending peer handover shown as a note.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
