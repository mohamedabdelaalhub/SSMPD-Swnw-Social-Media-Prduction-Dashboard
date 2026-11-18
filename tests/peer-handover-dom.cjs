// Owner 2026-11-18 «تسليم تحصيل لزميل» UI: send (part / end of shift with counts), cancel pending, incoming popup accept / reject.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<body></body>',{url:'https://x.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
const calls=[];let inbox={incoming:[],outgoing:[]};const toasts=[];w.SSMPDToast={show:m=>toasts.push(m)};w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};
w.SSMPDDb={client:{rpc:async(fn,a)=>{assert.equal(fn,'clinic_finance_peer_handover');calls.push([a.p_action,a.p_payload,a.p_token]);
 if(a.p_action==='inbox')return {data:inbox};
 if(a.p_action==='options')return {data:{shift:{id:'s1',register:'dina',cash:3000,available:2500},colleagues:[{shift_id:'s2',name:'محمود',register:'mahmoud'}]}};
 if(a.p_action==='request')return {data:{id:'h1',to_name:'محمود',amount:a.p_payload.amount||1950}};
 return {data:{id:a.p_payload.id,status:a.p_action}};}}};
w.eval(fs.readFileSync('assets/js/peer-handover.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
// send part
inbox.outgoing=[{id:'old',to_name:'محمود',amount:100}];
await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));
assert.match(q('[data-peer-send]').textContent,/2,500|2500/);assert(q('[data-peer-cancel="old"]'),'pending shown with cancel');
const f=q('[data-peer-form]');f.elements.to.value='s2';f.elements.amount.value='1000';f.elements.note.value='ماشي بدري';
f.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>calls.some(c=>c[0]==='request'));
let r=calls.find(c=>c[0]==='request');assert.deepEqual([r[1].from_shift,r[1].to_shift,r[1].amount,r[1].end_shift],['s1','s2',1000,undefined]);assert(r[2],'token');
await wait(()=>!q('[data-peer-send]'));assert.match(toasts.pop(),/مستني يأكد/);
// send end of shift with counts
calls.length=0;inbox.outgoing=[];await w.SSMPDPeerHandover.openSend();await wait(()=>q('[data-peer-form]'));
const g=q('[data-peer-form]');g.elements.to.value='s2';g.querySelector('input[value=end]').checked=true;g.dispatchEvent(new w.Event('change'));
assert.equal(g.querySelector('[data-peer-counts]').hidden,false);assert.equal(g.querySelector('[data-peer-amount]').hidden,true);
g.elements.c100.value='19';g.elements.c50.value='1';g.dispatchEvent(new w.Event('input'));assert.match(g.querySelector('[data-peer-total]').textContent,/1,950|1950/);
g.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>calls.some(c=>c[0]==='request'));r=calls.find(c=>c[0]==='request');
assert.equal(r[1].end_shift,true);assert.equal(r[1].counts['100'],19);assert.equal(r[1].counts['50'],1);await wait(()=>!q('[data-peer-send]'));
// incoming: reject needs a reason, accept sends counted
calls.length=0;inbox={incoming:[{id:'h9',from_name:'دينا',amount:700,note:''}],outgoing:[]};w.SSMPDPeerHandover.poll();await wait(()=>q('[data-peer-in]'));
assert.match(q('[data-peer-in]').textContent,/دينا/);q('[data-peer-reject]').click();assert.match(q('[data-peer-in] .peer-status').textContent,/سبب الرفض/);
const h=q('[data-peer-in] form');h.elements.counted.value='700';h.dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>calls.some(c=>c[0]==='accept'));
r=calls.find(c=>c[0]==='accept');assert.deepEqual([r[1].id,r[1].counted],['h9',700]);await wait(()=>!q('[data-peer-in]'));
assert.deepEqual(errors,[]);console.log('PASS peer handover UI: send part / end of shift with counts, pending cancel shown, incoming accept with counted amount, reject needs a reason.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
