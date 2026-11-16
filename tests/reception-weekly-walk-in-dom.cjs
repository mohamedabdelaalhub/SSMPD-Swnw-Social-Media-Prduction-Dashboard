// Owner 2026-11-16: weekly schedule modal saves the doctor's week; «حضور بدون ميعاد» books without picking a time.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[{id:'pt',file_no:'1',name:'مريض'}],services:[{id:'s1',code:'C',name:'كشف الأخصائي',department:'الجلدية',price:500,minutes:20}],
 providers:[{id:'as',name:'د. أحمد سمير',department:'الجلدية'}],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
const cmds=[],rpcs=[];
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async(ws,a,p)=>{cmds.push([a,p]);return {id:'new'};},
 client:{rpc:async(n,a)=>{rpcs.push([n,JSON.parse(JSON.stringify(a))]);if(a.p_action==='list')return {data:{slots:[{provider_id:'as',dow:5,starts:'14:00',ends:'16:00'},{provider_id:'as',dow:6,starts:'22:00',ends:'23:30'}]},error:null};if(a.p_action==='save')return {data:{generated:24},error:null};return {data:{created:3},error:null};}}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));const q=s=>w.document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();
// walk-in
q('[data-rx-section="appointments"]').click();await sleep(60);q('[data-rx-action="book"]').click();await sleep(30);
const set=(n,v)=>{const e=q('.rx-modal [name="'+n+'"]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('patient_id','pt');set('service_id','s1');set('provider_id','as');

const cb=q('.rx-modal [name=walk_in]');assert(cb,'walk-in option');cb.checked=true;cb.dispatchEvent(new w.Event('change'));
assert(q('.rx-modal [name=starts_at]').closest('label').hidden&&!q('.rx-modal [name=starts_at]').required);
q('.rx-modal form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(40);
const wk=cmds.find(c=>c[0]==='walk_in');assert(wk,'walk_in command sent');assert(!('starts_at' in wk[1])&&!('day' in wk[1])&&!('walk_in' in wk[1]));assert.equal(wk[1].provider_id,'as');
// weekly schedule
const close=q('.rx-modal [data-rx-cancel]');if(close)close.click();q('[data-rx-action="back"]')&&q('[data-rx-action="back"]').click();q('[data-rx-section="settings"]').click();await sleep(30);
q('[data-rx-action="weekly-schedule"]').click();await sleep(40);
const sel=q('.rx-modal [name=provider_id]');sel.value='as';sel.dispatchEvent(new w.Event('change'));
const fri=q('.rx-week-day[data-dow="5"]'),sat=q('.rx-week-day[data-dow="6"]');assert.equal(fri.querySelector('[data-from="1"]').value,'14:00');assert.equal(sat.querySelector('[data-to="1"]').value,'23:30');
assert.equal(q('.rx-week-day').querySelector('legend').textContent,'السبت','Saturday first');
q('.rx-week-day[data-dow="0"] [data-from="1"]').value='10:00';q('.rx-week-day[data-dow="0"] [data-to="1"]').value='12:00';
q('.rx-modal form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await sleep(40);
const save=rpcs.find(r=>r[1].p_action==='save');assert(save);assert.equal(save[1].p_payload.provider_id,'as');
assert.deepEqual(save[1].p_payload.slots.map(x=>x.dow+' '+x.starts+'-'+x.ends).sort(),['0 10:00-12:00','5 14:00-16:00','6 22:00-23:30']);
assert.deepEqual(errors,[]);console.log('PASS weekly schedule + walk-in UI: walk-in hides day/time and sends walk_in without a time; weekly modal (Saturday first) loads the doctor week, saves all days.');
})().catch(e=>{console.error(e);process.exit(1);});
