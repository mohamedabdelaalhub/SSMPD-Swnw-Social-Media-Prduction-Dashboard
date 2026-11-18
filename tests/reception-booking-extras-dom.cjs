// Owner 2026-11-18 reception notes: free time typed by reception, «+ إضافة خدمة» (same doctor back-to-back / another doctor),
// «تعديل الحجز» can change service and doctor, and basic patient edit without archive access.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.alert=m=>errors.push('alert:'+m);
w.SSMPDAuth={currentAdmin:{id:'me',role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true};
let avail=[],apps=[],calls=[],basic=[];
const base={workspace:{id:'w',mode:'live',booking_gap_minutes:5},patients:[{id:'pt',file_no:'1',name:'مريضة تجربة'}],services:[{id:'s1',code:'L1',name:'ليزر إبط',department:'الجلدية والتجميل',price:300,minutes:15},{id:'s2',code:'L2',name:'ليزر رجل',department:'الجلدية والتجميل',price:500,minutes:30},{id:'s3',code:'N1',name:'كشف تغذية',department:'التغذية والتخسيس',price:200,minutes:20}],providers:[{id:'p1',name:'د. جلدية',department:'الجلدية والتجميل'},{id:'p2',name:'د. تغذية',department:'التغذية والتخسيس'}],visits:[],orders:[],packages:[],catalog_unavailable:[],can_manage:true};
const h0=()=>w.SSMPDReception.helpers,inRange=(iso,f,t)=>{const dd=h0().day(iso);return dd>=f&&dd<=t;};
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async(ws,f,t)=>({...base,availability:avail.filter(a=>inRange(a.starts_at,f,t)),appointments:apps.filter(a=>inRange(a.starts_at,f,t))}),
 receptionCommand:async(ws,a,p,k)=>{calls.push([a,p]);return {id:'x'+calls.length};},receptionExternalEnabled:async()=>false,
 receptionPatientBasic:async(ws,a,p)=>{basic.push([a,p]);if(a==='get')return {id:p.id,name:'مريضة تجربة',phone:'01000000000',gender:'female',age:30,linked:true};return {id:p.id};}};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],wait=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed')};
const h=h0(),D=h.day(Date.now()+2*24*3600*1000);
avail=[{id:'a1',provider_id:'p1',starts_at:h.cairoISO(D+'T18:00'),ends_at:h.cairoISO(D+'T21:00')},{id:'a2',provider_id:'p2',starts_at:h.cairoISO(D+'T18:00'),ends_at:h.cairoISO(D+'T21:00')}];
apps=[{id:'b1',provider_id:'p2',status:'booked',starts_at:h.cairoISO(D+'T18:30'),ends_at:h.cairoISO(D+'T19:00')}];
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));const skip=q('[data-guide-skip]');if(skip)skip.click();
q('[data-rx-section="appointments"]').click();q('[data-rx-action="book"]').click();await wait(()=>q('.rx-modal'));
const set=(n,v)=>{const e=q('.rx-modal [name="'+n+'"]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('patient_id','pt');set('service_id','s1');set('provider_id','p1');set('day',D);
await wait(()=>[...q('.rx-modal [name=starts_at]').options].some(o=>o.value&&o.value!=='__custom__'));
// 1) free time: «وقت تاني» reveals a time input; typed 18:47 is sent as that exact time
const st=q('.rx-modal [name=starts_at]');assert([...st.options].some(o=>o.value==='__custom__'),'custom time option');
set('starts_at','__custom__');assert.equal(q('[data-rx-custom-time]').hidden,false);set('custom_time','18:47');
// 2) extras: same doctor right after (18:47+15 = 19:02 + 5 gap → 19:07), another doctor at his first free time after the chain
q('[data-rx-add-extra]').click();let rows=qa('[data-rx-extra]');assert.equal(rows.length,1);
const xs=(r,v)=>{const e=r.querySelector('[data-x-service]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
xs(rows[0],'s2');assert.match(rows[0].querySelector('[data-x-note]').textContent,/07:07/,'same doctor after main + gap: '+rows[0].querySelector('[data-x-note]').textContent);
q('[data-rx-add-extra]').click();rows=qa('[data-rx-extra]');xs(rows[1],'s3');
const ps=rows[1].querySelector('[data-x-provider]');assert([...ps.options].some(o=>o.value==='p2'),'other doctor offered');ps.value='p2';ps.dispatchEvent(new w.Event('change',{bubbles:true}));
const tsel=rows[1].querySelector('[data-x-time]');await wait(()=>tsel.value&&tsel.value!=='__custom__');assert.equal(rows[1].querySelector('[data-x-time-box]').hidden,false);
const first=+tsel.value;assert(first>=Date.parse(h.cairoISO(D+'T19:37')),'other doctor time after the chain end (19:37)');
q('.rx-modal form').requestSubmit();await wait(()=>calls.length>=3);
assert.equal(calls[0][0],'book');assert.equal(Date.parse(calls[0][1].starts_at),Date.parse(h.cairoISO(D+'T18:47')),'typed time booked');assert.equal(calls[0][1].custom_time,undefined);
assert.equal(calls[1][1].service_id,'s2');assert.equal(calls[1][1].provider_id,'p1');assert.equal(Date.parse(calls[1][1].starts_at),Date.parse(h.cairoISO(D+'T19:07')));
assert.equal(calls[2][1].service_id,'s3');assert.equal(calls[2][1].provider_id,'p2');assert.equal(calls[2][1].patient_id,'pt');
await wait(()=>!q('.rx-modal'));
// 3) reschedule is «تعديل الحجز» and can change service + doctor
const T=h.day();avail.push({id:'t1',provider_id:'p1',starts_at:h.cairoISO(T+'T00:05'),ends_at:h.cairoISO(T+'T23:55')},{id:'t2',provider_id:'p2',starts_at:h.cairoISO(T+'T00:05'),ends_at:h.cairoISO(T+'T23:55')});
apps.push({id:'b2',patient_id:'pt',provider_id:'p1',service_id:'s1',status:'booked',starts_at:h.cairoISO(T+'T12:00'),ends_at:h.cairoISO(T+'T12:15'),source:'unknown',source_evidence:'unknown'});
calls=[];q('[data-rx-action="reload"]').click();
await wait(()=>q('[data-rx-action="reschedule"][data-id="b2"]'));const rb=q('[data-rx-action="reschedule"][data-id="b2"]');assert.equal(rb.textContent.trim(),'تعديل الحجز');rb.click();await wait(()=>q('.rx-modal'));
assert.match(q('#rx-title').textContent,/تعديل الحجز/);assert.equal(q('[data-rx-extras]'),null,'no extras while editing');
set('service_id','s3');set('provider_id','p2');await wait(()=>[...q('.rx-modal [name=starts_at]').options].some(o=>o.value&&o.value!=='__custom__'));
{const o=[...q('.rx-modal [name=starts_at]').options].find(o=>o.value&&o.value!=='__custom__');set('starts_at',o.value);}
q('.rx-modal form').requestSubmit();await wait(()=>calls.length>=1);assert.equal(calls[0][0],'reschedule');assert.equal(calls[0][1].service_id,'s3');assert.equal(calls[0][1].provider_id,'p2');assert.equal(calls[0][1].id,'b2');
await wait(()=>!q('.rx-modal'));
// 4) basic patient edit (no archive access → archive_patient_id hidden) opens the reception editor
const ep=q('[data-rx-action="edit-patient"][data-id="pt"]');assert(ep);ep.click();await wait(()=>q('.rx-modal [name=name]'));
assert.equal(q('.rx-modal [name=name]').value,'مريضة تجربة');set('phone','01011112222');q('.rx-modal form').requestSubmit();
await wait(()=>basic.some(b=>b[0]==='update'));const up=basic.find(b=>b[0]==='update')[1];assert.equal(up.id,'pt');assert.equal(up.phone,'01011112222');assert.equal(up.gender,'female');
assert.deepEqual(errors,[],errors.join('|'));
console.log('PASS reception booking extras: typed free time, + extra service same doctor (after + gap) and another doctor, «تعديل الحجز» changes service/doctor, basic patient edit without archive access.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
