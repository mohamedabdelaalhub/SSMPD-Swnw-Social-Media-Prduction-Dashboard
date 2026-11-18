// Owner 2026-11-17: 5-minute gap between bookings — reception time list steps by duration + gap.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
let today=null,tomorrow=null,calls=[],avail=[],apps=[];
const base={workspace:{id:'w',mode:'trial',booking_gap_minutes:5},patients:[{id:'pt',file_no:'1',name:'مريض'}],services:[{id:'s1',code:'C',name:'كشف جراحة',department:'الجراحة',price:300,minutes:15}],providers:[{id:'p1',name:'د. جراح',department:'الجراحة'}],visits:[],orders:[],packages:[],catalog_unavailable:[],can_manage:true};
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
const slots=()=>[...q('.rx-modal [name=starts_at]').options].filter(o=>o.value&&o.value!=='__custom__').length;
assert.equal(slots(),0); // today: no availability
set('day',tomorrow); // outside the loaded period -> must fetch that day
await wait(()=>slots()>0);
assert.equal(slots(),6); // 21:00-23:00, 15 min + 5 min gap: 21:00,21:20,…,22:40
{const labels=[...q('.rx-modal [name=starts_at]').options].filter(o=>o.value&&o.value!=='__custom__').map(o=>Date.parse(o.value));assert.equal(labels[1]-labels[0],20*60000,'every 20 min');}
const d2=h.day(Date.now()+10*24*3600*1000);avail.push({id:'a2',provider_id:'p1',starts_at:h.cairoISO(d2+'T21:00'),ends_at:h.cairoISO(d2+'T22:00')});
apps.push({id:'x2',provider_id:'p1',status:'booked',starts_at:h.cairoISO(d2+'T21:00'),ends_at:h.cairoISO(d2+'T21:18')});
set('day',d2);await wait(()=>slots()>0);
{const ts=[...q('.rx-modal [name=starts_at]').options].filter(o=>o.value&&o.value!=='__custom__').map(o=>o.textContent);assert.equal(slots(),2,'21:20 is inside the 5-min gap after 21:18 → the nearest is 21:23 (booking end + gap), then 21:40: '+ts.join(','));assert.match(ts[0],/21:23|09:23/,'nearest free time right after the booking + gap');}
// Owner 2026-11-18: a booking off the grid (21:05–21:20) must not push the next offer to a far grid step.
const d3=h.day(Date.now()+11*24*3600*1000);avail.push({id:'a3',provider_id:'p1',starts_at:h.cairoISO(d3+'T21:00'),ends_at:h.cairoISO(d3+'T22:00')});
apps.push({id:'x3',provider_id:'p1',status:'booked',starts_at:h.cairoISO(d3+'T21:05'),ends_at:h.cairoISO(d3+'T21:20')});
set('day',d3);await wait(()=>slots()>0);
{const ts=[...q('.rx-modal [name=starts_at]').options].filter(o=>o.value&&o.value!=='__custom__').map(o=>Date.parse(o.value)-Date.parse(h.cairoISO(d3+'T21:00')));assert.equal(ts[0],25*60000,'first offer 21:25 = booking end 21:20 + 5 min gap');assert(!ts.includes(0),'21:00 overlaps the booking');}
assert.equal(errors.length,0,errors.join('|'));
console.log('PASS booking gap DOM: times step by duration + gap, a time inside the gap after a booking is not offered, and the time right after a booking + gap is offered as the nearest');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
