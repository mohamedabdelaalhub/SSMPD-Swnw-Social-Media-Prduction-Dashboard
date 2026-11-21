// «سلّم الكاش» nudge (20261122050000): the cashier's poll shows «مطلوب منك تسلّم الكاش»; «سلّم دلوقتي» marks it seen and opens the handover
// modal with the main treasury already chosen; «بعدين» hides it for 10 minutes without marking it seen; peer handovers keep priority.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<body></body>',{url:'https://x.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
const calls=[];let inbox={incoming:[],outgoing:[]},list=[{id:'n1',shift_id:'s1',register:'خزينة منار',from_name:'محمود',note:'آخر اليوم'}];
w.SSMPDToast={show:()=>{}};w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};
w.SSMPDDb={financeTreasuryCommand:async()=>({}),client:{rpc:async(fn,a)=>{calls.push([fn,a]);
 if(fn==='clinic_finance_my_handover_nudges')return {data:list};if(fn==='clinic_finance_handover_nudge_seen')return {data:null};
 if(a&&a.p_action==='inbox')return {data:inbox};
 if(a&&a.p_action==='options')return {data:{shift:{id:'s1',register:'خزينة منار',cash:1800,available:1800},colleagues:[{shift_id:'s2',name:'مازن',register:'خزينة مازن'}],main:{shift_id:'m1',register_id:'R',register:'الخزينة الرئيسية',name:'محمود'}}};
 return {data:{}};}}};
w.eval(fs.readFileSync('assets/js/peer-handover.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
// 1. popup with who asked and the note
w.SSMPDPeerHandover.poll();await wait(()=>q('[data-peer-nudge]'));
assert.match(q('[data-peer-nudge]').textContent,/محمود.*طالب منك تسلّم كاش وردية «خزينة منار».*آخر اليوم/s);
// 2. «بعدين»: hidden, not marked seen, not shown again on the next poll (within 10 min)
q('[data-nudge-later]').click();assert(!q('[data-peer-nudge]'));assert(!calls.some(c=>c[0]==='clinic_finance_handover_nudge_seen'));
w.SSMPDPeerHandover.poll();await new Promise(r=>setTimeout(r,60));assert(!q('[data-peer-nudge]'),'snoozed');
// 3. a new nudge: «سلّم دلوقتي» marks it seen and opens the handover with the main treasury selected
list=[{id:'n2',shift_id:'s1',register:'خزينة منار',from_name:'محمود',note:''}];w.SSMPDPeerHandover.poll();await wait(()=>q('[data-peer-nudge]'));
q('[data-nudge-go]').click();await wait(()=>q('[data-peer-form]'));
assert.equal(JSON.stringify(calls.find(c=>c[0]==='clinic_finance_handover_nudge_seen')[1]),JSON.stringify({p_id:'n2'}));
assert.equal(q('[data-peer-form]').elements.to.value,'main','main treasury preselected');assert.equal(q('[data-peer-main-hint]').hidden,false);
q('[data-peer-close]').click();
// 4. an incoming peer handover has priority over the nudge
inbox={incoming:[{id:'h1',from_name:'مازن',amount:100,note:''}],outgoing:[]};list=[{id:'n3',shift_id:'s1',register:'خزينة منار',from_name:'محمود',note:''}];
w.SSMPDPeerHandover.poll();await wait(()=>q('[data-peer-in]'));assert(!q('[data-peer-nudge]'));
assert.deepEqual(errors,[]);console.log('PASS cash handover nudge: popup with sender + note, «بعدين» snoozes without marking seen, «سلّم دلوقتي» marks seen and opens the handover with the main treasury chosen, peer handover first.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
