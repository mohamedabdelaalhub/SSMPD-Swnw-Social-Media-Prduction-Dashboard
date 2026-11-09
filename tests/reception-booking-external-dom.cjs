const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const services=[{id:'s1',code:'C1',name:'كشف نساء',department:'نساء',price:500,minutes:20},{id:'s2',code:'C2',name:'متابعة',department:'نساء',price:200,minutes:20}];
const providers=[{id:'p1',name:'د. منى',department:'نساء'}];
const snap={workspace:{id:'w',mode:'trial'},patients:[{id:'pt',file_no:'1',name:'مريض'}],services,providers,availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],can_manage:true};
let probe=false,submitted=null;
async function run(on){
 probe=on;submitted=null;
 const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
 w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionExternalEnabled:async()=>probe,receptionCommand:async(ws,a,p)=>{submitted={a,p};return {id:'x'};}};
 w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
 const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
 w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));q('[data-guide-skip]').click();q('[data-rx-section="appointments"]').click();q('[data-rx-action="book"]').click();
 await new Promise(r=>setTimeout(r,50));
 return {w,q,wait};
}
// probe off: no option, legacy payload
let {w,q}=await run(false);assert(!q('[data-rx-external]'),'hidden until the migration is deployed');
// probe on
({w,q}=await run(true));await new Promise(r=>setTimeout(r,50));
const box=q('[data-rx-external]');assert(box,'option shown');assert(q('[data-rx-external-box]').hidden,'amount box collapsed');
const cb=q('[name=external_service]'),amt=q('[name=external_extra]');
// choose a service to show the total
q('[name=service_id]').value='s1';q('[name=service_id]').dispatchEvent(new w.Event('change',{bubbles:true}));
cb.checked=true;cb.dispatchEvent(new w.Event('change',{bubbles:true}));assert(!q('[data-rx-external-box]').hidden&&amt.required,'toggle opens the box');
amt.value='250';amt.dispatchEvent(new w.Event('input',{bubbles:true}));const note=q('[data-rx-external-note]');assert(!note.hidden&&note.textContent.includes('750')&&note.textContent.includes('500')&&note.textContent.includes('250'),'shows 500 + 250 = 750: '+note.textContent);
cb.checked=false;cb.dispatchEvent(new w.Event('change',{bubbles:true}));assert(q('[data-rx-external-box]').hidden&&amt.value===''&&q('[data-rx-external-note]').hidden,'untick clears');
// payload shape on submit
const f=q('.rx-modal form')||q('form');
function setSel(n,v){const e=f.elements[n];if(![...e.options].some(o=>o.value===v))e.add(new w.Option(v,v));e.value=v;}
async function submitIt(){submitted=null;f.noValidate=true;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,60));return submitted;}
setSel('provider_id','p1');setSel('starts_at','2026-11-10T08:00:00Z');f.elements.patient_id.value='pt';
cb.checked=true;cb.dispatchEvent(new w.Event('change',{bubbles:true}));amt.value='250';amt.dispatchEvent(new w.Event('input',{bubbles:true}));
let sub=await submitIt();assert(sub&&sub.a==='book','book sent');assert.equal(sub.p.external_service,true);assert.strictEqual(sub.p.external_extra,250);
cb.checked=false;cb.dispatchEvent(new w.Event('change',{bubbles:true}));sub=await submitIt();assert(sub&&!('external_service' in sub.p)&&!('external_extra' in sub.p),'unticked: legacy payload');
cb.checked=true;cb.dispatchEvent(new w.Event('change',{bubbles:true}));amt.value='0';sub=await submitIt();assert.equal(sub,null,'ticked without a valid amount never reaches the server');
console.log('PASS reception booking external service UI: probe gate, toggle/amount box, running total 500+250=750, reset');
})().catch(e=>{console.error(e);process.exit(1);});
