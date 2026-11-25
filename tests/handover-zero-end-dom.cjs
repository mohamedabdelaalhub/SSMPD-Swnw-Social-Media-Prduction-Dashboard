// «التسليم بصفر» (owner «اعمل تعديل التسليم بصفر» 2026-11-25): an EMPTY drawer ends its shift to the MAIN treasury with 0 + a written reason
// through the existing end_shift (server: 0 → submitted + cash case, no transfer). Refused to a colleague and refused without a reason. Role: reception.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<body></body>',{url:'https://x.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
const calls=[],tcalls=[],toasts=[];
w.SSMPDToast={show:m=>toasts.push(m)};w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};
w.SSMPDDb={financeTreasuryCommand:async(a,p,k)=>{tcalls.push([a,p,k]);return {shift_id:'s1',counted:0,expected:1500,status:'submitted'};},client:{rpc:async(fn,a)=>{calls.push([a.p_action,a.p_payload]);
 if(a.p_action==='inbox')return {data:{incoming:[],outgoing:[]}};
 if(a.p_action==='options')return {data:{shift:{id:'s1',register:'خزينة منار',cash:1500,available:1500},colleagues:[{shift_id:'s2',name:'مازن',register:'خزينة مازن'}],main:{shift_id:'m1',register_id:'R-main',register:'الخزينة الرئيسية',name:'محمود'}}};
 return {data:{id:'h1',to_name:'x',amount:1}};}}};
w.eval(fs.readFileSync('assets/js/peer-handover.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
const st=()=>q('[data-peer-send] .peer-status').textContent,submit=f=>f.dispatchEvent(new w.Event('submit',{cancelable:true}));
// opened from the «اطلب منه يسلّم» nudge → the main treasury is preselected
await w.SSMPDPeerHandover.openSend({to:'main'});await wait(()=>q('[data-peer-form]'));let f=q('[data-peer-form]');
assert.equal(f.elements.to.value,'main');
f.querySelector('input[value=end]').checked=true;f.dispatchEvent(new w.Event('change'));
// 1. all 0 → the hint shows; no reason → refused in the modal, nothing sent
assert.equal(f.querySelector('[data-peer-zero]').hidden,false,'zero hint visible for main + end + 0');
submit(f);await wait(()=>/اكتب السبب/.test(st()));assert.equal(tcalls.length,0);
// 2. a colleague can't receive an empty end → refused, the peer request is never called
f.elements.to.value='s2';f.dispatchEvent(new w.Event('change'));assert.equal(f.querySelector('[data-peer-zero]').hidden,true);
f.elements.note.value='الفلوس اتسلمت قبل كده';submit(f);await wait(()=>/اختار «الخزينة الرئيسية»/.test(st()));
assert.equal(tcalls.length,0);assert(!calls.some(c=>c[0]==='request'),'no peer request with 0');
// 3. main + reason → existing end_shift with every denomination 0 and the note
f.elements.to.value='main';f.dispatchEvent(new w.Event('change'));f.elements.note.value='فلوس وردية 22-11 اتسلمت مع وردية 24-11 — الدرج فاضي';
submit(f);await wait(()=>tcalls.length===1);
assert.equal(tcalls[0][0],'end_shift');assert.equal(tcalls[0][1].shift_id,'s1');
assert(Object.values(tcalls[0][1].counts).every(v=>v===0),'all denominations 0');assert.match(tcalls[0][1].note,/الدرج فاضي/);
await wait(()=>!q('[data-peer-send]'));{const m=toasts.pop();assert.match(m,/اتقفلت بصفر/);assert.match(m,/فروق الخزينة/);}
// 4. a normal count still works as before (hint hidden once there is cash)
await w.SSMPDPeerHandover.openSend({to:'main'});await wait(()=>q('[data-peer-form]'));f=q('[data-peer-form]');
f.querySelector('input[value=end]').checked=true;f.elements.c100.value='3';f.dispatchEvent(new w.Event('input'));
assert.equal(f.querySelector('[data-peer-zero]').hidden,true);submit(f);await wait(()=>tcalls.length===2);
assert.equal(tcalls[1][1].counts['100'],3);{const m=toasts.length?toasts.pop():'';await wait(()=>!q('[data-peer-send]'));}
assert.deepEqual(errors,[]);console.log('PASS handover zero end (reception): hint, reason required, never to a colleague, end_shift with 0 + note, normal count unchanged');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
