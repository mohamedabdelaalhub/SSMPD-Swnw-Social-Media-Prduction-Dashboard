// 20261126050000 «طبيب مقيّد» in the booking screen (live mode, reception role): the doctor list of «حجز موعد» follows the snapshot
// provider_restricted map — a restricted doctor shows only for her scoped services of that department (+ basic services), an
// unrestricted doctor is unchanged, her other department follows its own list; the booking is sent for her laser service; the
// «تسجيل حضور» picker of a «الخدمة تتحدد عند الحضور» booking lists only her services; readiness shows «خدمات محددة بس في».
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{
const services=[{id:'lz',code:'LZ1',name:'ليزر دايود 1000 نبضة',department:'الجلدية والتجميل',price:900,minutes:20},
 {id:'peel',code:'PEEL',name:'تقشير بارد',department:'الجلدية والتجميل',price:500,minutes:20},
 {id:'kj',code:'KJ',name:'كشف جلدية',department:'الجلدية والتجميل',price:300,minutes:15},
 {id:'ort',code:'ORT1',name:'تركيب تقويم ثابت',department:'الاسنان',price:9000,minutes:30},
 {id:'fil',code:'FIL1',name:'حشو عصب',department:'الاسنان',price:700,minutes:30}];
const providers=[{id:'dalia',name:'د.داليا',department:'الجلدية والتجميل'},{id:'derm2',name:'د.جلدية تاني',department:'الجلدية والتجميل'},{id:'dent',name:'د.أسنان',department:'الاسنان'}];
const later={id:'ap-later',provider_id:'dalia',patient_id:'pt',service_id:'ph',service_later:true,status:'booked',starts_at:new Date(Date.now()+3600e3).toISOString(),ends_at:new Date(Date.now()+5400e3).toISOString()};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[{id:'pt',file_no:'1',name:'مريض'}],services,providers,
 basic_service_ids:['kj'],availability:[{provider_id:'dalia',starts_at:new Date(Date.now()+86400e3).toISOString(),ends_at:new Date(Date.now()+86400e3+8*3600e3).toISOString()}],
 appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},
 provider_departments:{dalia:['الاسنان']},provider_service_scopes:{dalia:['LZ1','ORT1']},
 provider_restricted:{dalia:{'الجلدية والتجميل':['LZ1'],'الاسنان':['ORT1']}},service_later:[{id:'ph',code:'LATER-1',name:'الخدمة تتحدد عند الحضور',department:'الجلدية والتجميل',minutes:30,price:0,placeholder:true}]};
const rd={day:'2026-11-26',basic_services:1,doctors:[{id:'dalia',name:'د.داليا',department:'الجلدية والتجميل',own_services:1,basic_services:1,agreements:1,availability_14d:3,ready:true,restricted:['الاسنان','الجلدية والتجميل']},
 {id:'derm2',name:'د.جلدية تاني',department:'الجلدية والتجميل',own_services:2,basic_services:1,agreements:1,availability_14d:3,ready:true}]};
const boot=async(role,extra)=>{const d=new JSDOM('<main id="root"></main>',{url:'https://reception.test/',runScripts:'outside-only'}),w=d.window,errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'me',role}};w.SSMPDRoles={canSeeTab:()=>true};const sent=[];
 const s=JSON.parse(JSON.stringify(snap));Object.assign(s,extra||{});
 w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(s)),receptionCommand:async(ws,a,p)=>{sent.push({a,p});return {id:'new'};},client:{rpc:async(n)=>n==='clinic_reception_booking_readiness'?{data:rd,error:null}:{data:null,error:{message:'x'}}}};
 w.eval(fs.readFileSync('assets/js/reception-service-later.js','utf8'));w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));
 const q=x=>w.document.querySelector(x),wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Wait failed');};
 w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));const skip=q('[data-guide-skip]');if(skip)skip.click();
 return {w,q,wait,errors,sent};};
// 1) reception, «حجز موعد»
{const {w,q,wait,errors,sent}=await boot('reception');
 q('[data-rx-section="appointments"]').click();await new Promise(r=>setTimeout(r,30));q('[data-rx-action="book"]').click();await wait(()=>q('.rx-modal'));
 const opts=n=>[...q('.rx-modal [name="'+n+'"]').options].filter(o=>o.value).map(o=>o.value);
 const dept=q('.rx-modal [data-rx-dept]'),svc=q('.rx-modal [name="service_id"]');
 const set=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 set(dept,'الجلدية والتجميل');
 set(svc,'peel');assert.deepEqual(opts('provider_id'),['derm2'],'non-laser derm: the restricted doctor is not offered');
 set(svc,'lz');assert.deepEqual(opts('provider_id').sort(),['dalia','derm2'],'laser: she is offered');
 set(svc,'kj');assert.deepEqual(opts('provider_id').sort(),['dalia','derm2'],'basic service stays open to her');
 set(dept,'الاسنان');
 set(svc,'fil');assert.deepEqual(opts('provider_id'),['dent'],'dental non-ortho: only the unrestricted dentist');
 set(svc,'ort');assert.deepEqual(opts('provider_id').sort(),['dalia','dent'],'ortho: she is offered in her extra department');
 // book her laser session (live, reception): the command carries her and the laser service
 set(dept,'الجلدية والتجميل');set(svc,'lz');const prov=q('.rx-modal [name="provider_id"]');set(prov,'dalia');
 assert.equal(prov.value,'dalia');
 const form=q('.rx-modal form');form.elements.patient_id.value='pt';
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(Date.now()+86400e3+3600e3));set(form.elements.day,day);
 await wait(()=>form.elements.starts_at&&[...form.elements.starts_at.options||[]].some(o=>o.value));
 const t=[...form.elements.starts_at.options].find(o=>o.value);set(form.elements.starts_at,t.value);
 q('.rx-modal form [type=submit]').click();await wait(()=>sent.length);
 assert.equal(sent[0].a,'book');assert.equal(sent[0].p.provider_id,'dalia');assert.equal(sent[0].p.service_id,'lz');
 assert.deepEqual(errors,[]);
 // 2) the same doctor without a restriction map = today's behaviour
}
{const {w,q,wait,errors}=await boot('reception',{provider_restricted:{}});
 q('[data-rx-section="appointments"]').click();await new Promise(r=>setTimeout(r,30));q('[data-rx-action="book"]').click();await wait(()=>q('.rx-modal'));
 const opts=n=>[...q('.rx-modal [name="'+n+'"]').options].filter(o=>o.value).map(o=>o.value);
 const dept=q('.rx-modal [data-rx-dept]'),svc=q('.rx-modal [name="service_id"]'),set=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 set(dept,'الجلدية والتجميل');set(svc,'peel');assert.deepEqual(opts('provider_id').sort(),['dalia','derm2'],'no restriction map: unchanged');
 assert.deepEqual(errors,[]);}
// 3) arrival picker of a «الخدمة تتحدد عند الحضور» booking (service-later module, same data)
{const d=new JSDOM('<div id="m"><form><p>x</p><label>نوع الزيارة<select name="encounter_type"><option value="checkup">كشف</option></select></label></form><button type="submit">تسجيل</button></div>',{runScripts:'outside-only'}),w=d.window;
 w.eval(fs.readFileSync('assets/js/reception-service-later.js','utf8'));
 const data=JSON.parse(JSON.stringify(snap));w.SSMPDServiceLater.arrival(w.document.getElementById('m'),later,{data});
 const list=[...w.document.querySelectorAll('[name="service_id"] option')].filter(o=>o.value).map(o=>o.value).sort();
 assert.deepEqual(list,['kj','lz','ort'],'arrival list: her laser + basic + ortho only — got '+JSON.stringify(list));
 const free=JSON.parse(JSON.stringify(snap));delete free.provider_restricted;const d2=new JSDOM(d.serialize().replace(/<div class="rx-sl-arrive"[\s\S]*?<\/div>/,''),{runScripts:'outside-only'});
 d2.window.eval(fs.readFileSync('assets/js/reception-service-later.js','utf8'));d2.window.document.querySelectorAll('.rx-sl-arrive').forEach(e=>e.remove());
 d2.window.SSMPDServiceLater.arrival(d2.window.document.getElementById('m'),later,{data:free});
 assert([...d2.window.document.querySelectorAll('[name="service_id"] option')].some(o=>o.value==='peel'),'without restriction: every department service');}
// 4) readiness modal (manager view): the restricted note
{const {q,wait,errors}=await boot('super_admin');
 q('[data-rx-action="back"]')&&q('[data-rx-action="back"]').click();q('[data-rx-section="settings"]').click();await new Promise(r=>setTimeout(r,20));
 q('[data-rx-action="booking-readiness"]').click();await wait(()=>q('.rx-ready'));
 const cards=[...q('.rx-ready-list').querySelectorAll('.rx-ready')],dal=cards.find(c=>c.textContent.includes('د.داليا')),oth=cards.find(c=>c.textContent.includes('د.جلدية تاني'));
 assert(dal.textContent.includes('خدمات قسمه: 1 (خدمات محددة بس في: الاسنان، الجلدية والتجميل)'),dal.textContent);
 assert(!oth.textContent.includes('خدمات محددة بس'));assert.deepEqual(errors,[]);}
process.exitCode=0;setTimeout(()=>process.exit(0),10);console.log('PASS restricted doctor UI (live, reception): booking doctor list follows provider_restricted (laser / ortho only, basics open, other doctors unchanged, no map = unchanged); arrival picker lists only her services; readiness shows «خدمات محددة بس في».');
})().catch(e=>{console.error(e);process.exit(1);});
