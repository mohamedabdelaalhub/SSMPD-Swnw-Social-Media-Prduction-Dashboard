const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
let today=null,tomorrow=null,calls=[],avail=[],apps=[];
const base={workspace:{id:'w',mode:'trial'},patients:[{id:'pt',file_no:'1',name:'مريض'}],services:[{id:'s1',code:'C',name:'كشف جراحة',department:'الجراحة',price:300,minutes:30}],providers:[{id:'p1',name:'د. جراح',department:'الجراحة'}],visits:[],orders:[],packages:[],catalog_unavailable:[],can_manage:true};
const inRange=(iso,f,t)=>{const dd=w.SSMPDReception.helpers.day(iso);return dd>=f&&dd<=t;};
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async(ws,f,t)=>{calls.push([f,t]);return {...base,availability:avail.filter(a=>inRange(a.starts_at,f,t)),appointments:apps.filter(a=>inRange(a.starts_at,f,t))};},receptionCommand:async()=>({id:'x'})};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
const q=s=>w.document.querySelector(s),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
const h=w.SSMPDReception.helpers;today=h.day();tomorrow=h.day(Date.now()+36*3600*1000);if(tomorrow===today)tomorrow=h.day(Date.now()+60*3600*1000);
avail=[{id:'a1',provider_id:'p1',starts_at:h.cairoISO(tomorrow+'T21:00'),ends_at:h.cairoISO(tomorrow+'T23:00')}];
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));q('[data-guide-skip]').click();
q('[data-rx-section="appointments"]').click();q('[data-rx-action="book"]').click();
assert.deepEqual(calls[0],[today,today]);
const set=(n,v)=>{const e=q('.rx-modal [name="'+n+'"]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('service_id','s1');set('provider_id','p1');
const slots=()=>[...q('.rx-modal [name=starts_at]').options].filter(o=>o.value).length;
assert.equal(slots(),0); // today: no availability
set('day',tomorrow); // outside the loaded period -> must fetch that day
await wait(()=>slots()>0);
assert.equal(slots(),4); // 21:00-23:00 / 30 min
assert.deepEqual(calls[calls.length-1],[tomorrow,tomorrow]);
const n=calls.length;set('day',today);set('day',tomorrow);await new Promise(r=>setTimeout(r,40));assert.equal(calls.length,n); // fetched once per day
assert.equal(slots(),4);
// a booking already made that evening is excluded after the fetch
apps=[{id:'x1',provider_id:'p1',status:'booked',starts_at:h.cairoISO(tomorrow+'T21:00'),ends_at:h.cairoISO(tomorrow+'T21:30')}];
const d2=h.day(Date.now()+84*3600*1000);avail.push({id:'a2',provider_id:'p1',starts_at:h.cairoISO(d2+'T21:00'),ends_at:h.cairoISO(d2+'T22:00')});apps.push({id:'x2',provider_id:'p1',status:'booked',starts_at:h.cairoISO(d2+'T21:00'),ends_at:h.cairoISO(d2+'T21:30')});
set('day',d2);await wait(()=>slots()>0);assert.equal(slots(),1);
assert.equal(errors.length,0,errors.join('|'));
console.log('PASS booking modal loads availability and bookings for a day outside the loaded period');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
