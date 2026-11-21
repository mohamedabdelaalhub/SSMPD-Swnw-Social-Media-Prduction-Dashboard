// «الخزينة الرئيسية — <الاسم>» in «تسليم تحصيل لزميل» (20261122010000, owner «طبقه» 2026-11-21): listed first when a main shift is open, routed to the
// EXISTING treasury handover (end_shift with the count / transfer_request for a part), never to the peer path; a clear line when no main shift is open.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<body></body>',{url:'https://x.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
const calls=[],tcalls=[],toasts=[];let main={shift_id:'m1',register_id:'R-main',register:'الخزينة الرئيسية',name:'محمود'},cols=[{shift_id:'s2',name:'مازن',register:'خزينة مازن'}];
w.SSMPDToast={show:m=>toasts.push(m)};w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};
w.SSMPDDb={financeTreasuryCommand:async(a,p,k)=>{tcalls.push([a,p,k]);return {id:'t1'};},client:{rpc:async(fn,a)=>{calls.push([a.p_action,a.p_payload]);
 if(a.p_action==='inbox')return {data:{incoming:[],outgoing:[]}};
 if(a.p_action==='options')return {data:{shift:{id:'s1',register:'خزينة منار',cash:1800,available:1800},colleagues:cols,main:main}};
 return {data:{id:'h1',to_name:'x',amount:1}};}}};
w.eval(fs.readFileSync('assets/js/peer-handover.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
// 1. listed FIRST, with the custodian's name; hint only when chosen
await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));
let f=q('[data-peer-form]');const opts=[...f.elements.to.options].map(o=>[o.value,o.textContent]);
assert.deepEqual(opts.slice(1),[['main','الخزينة الرئيسية — محمود'],['s2','مازن — خزينة مازن']]);
assert.equal(f.querySelector('[data-peer-main-hint]').hidden,true);f.elements.to.value='main';f.dispatchEvent(new w.Event('change'));
assert.equal(f.querySelector('[data-peer-main-hint]').hidden,false);assert.match(f.querySelector('[data-peer-main-hint]').textContent,/محمود/);
// 2. end of shift with the count -> existing end_shift, NOT the peer request
f.querySelector('input[value=end]').checked=true;f.dispatchEvent(new w.Event('change'));
f.elements.c200.value='5';f.elements.c100.value='5';f.elements.c50.value='6';f.dispatchEvent(new w.Event('input'));
f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>tcalls.length===1);
assert.equal(tcalls[0][0],'end_shift');assert.equal(tcalls[0][1].shift_id,'s1');assert.deepEqual([tcalls[0][1].counts['200'],tcalls[0][1].counts['100'],tcalls[0][1].counts['50']],[5,5,6]);assert(tcalls[0][2],'token');
assert(!calls.some(c=>c[0]==='request'),'the peer path is not used');await wait(()=>!q('[data-peer-send]'));{const m=toasts.pop();assert(m.includes('للخزينة الرئيسية')&&m.includes('محمود')&&/800/.test(m),m);}
// 3. a part -> existing transfer_request to the main register, with a reference and a reason
await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));f=q('[data-peer-form]');f.elements.to.value='main';f.elements.amount.value='500';
f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>tcalls.length===2);
const t=tcalls[1];assert.equal(t[0],'transfer_request');assert.deepEqual([t[1].from_shift,t[1].to_register,t[1].amount],['s1','R-main',500]);
assert(t[1].reference.length>=2&&t[1].reason.length>=3,'reference + reason filled');await wait(()=>!q('[data-peer-send]'));
// 4. a server refusal stays in the modal
w.SSMPDDb.financeTreasuryCommand=async()=>{throw Error('المبلغ يتجاوز النقد المتاح بعد حجوزات التسليم');};
await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));f=q('[data-peer-form]');f.elements.to.value='main';f.elements.amount.value='9000';
f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>/يتجاوز/.test(q('[data-peer-send] .peer-status').textContent));q('[data-peer-close]').click();
// 5. no main shift open: not listed, a clear line; with no colleagues either, still no form
main=null;await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-send]'));
assert.match(q('[data-peer-send]').textContent,/وردية الخزينة الرئيسية مش مفتوحة دلوقتي/);assert(![...q('[data-peer-form]').elements.to.options].some(o=>o.value==='main'));q('[data-peer-close]').click();
cols=[];main={shift_id:'m1',register_id:'R-main',register:'الخزينة الرئيسية',name:'محمود'};await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));
assert.equal(q('[data-peer-form]').elements.to.options.length,2,'only the main treasury when no colleague is open');
assert.deepEqual(errors,[]);console.log('PASS peer handover main treasury: listed first with custodian, hint, end_shift with count, transfer_request for a part, server error shown, hidden + explained when no main shift.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
