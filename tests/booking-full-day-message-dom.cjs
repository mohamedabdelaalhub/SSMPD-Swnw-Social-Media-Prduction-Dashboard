// Owner 2026-11-16: a fully booked doctor showed only «لا توجد مواعيد متاحة»; now say why and show the next free slot.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
const fmt=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date(t)),today=fmt(Date.now()),tomorrow=fmt(Date.now()+86400000),future=fmt(Date.now()+3*86400000);
const at=(dd,hm)=>new Date(Date.parse(dd+'T'+hm+':00+02:00')).toISOString();
const slot=(id,s,e)=>({id,provider_id:'as',patient_id:'pt',service_id:'k2',status:'booked',starts_at:at(tomorrow,s),ends_at:at(tomorrow,e)});
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[{id:'pt',file_no:'1',name:'مريض'}],
 services:[{id:'k2',code:'0001372',name:'كشف الاستشاري',department:'خدمات الكشف',price:600,minutes:20}],providers:[{id:'as',name:'د. أحمد سمير',department:'الجلدية والتجميل'}],
 availability:[{id:'a1',provider_id:'as',starts_at:at(tomorrow,'22:00'),ends_at:at(tomorrow,'23:30')},{id:'a2',provider_id:'as',starts_at:at(future,'14:00'),ends_at:at(future,'16:00')}],
 appointments:[slot('b1','22:00','22:20'),slot('b2','22:20','22:40'),slot('b3','22:40','23:00'),slot('b4','23:00','23:20')],
 visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{as:['0001372']},provider_service_scopes:{}};
w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async(ws,f,t)=>JSON.parse(JSON.stringify(snap)),receptionCommand:async()=>({})};
w.eval(fs.readFileSync('assets/js/reception-workspace.js','utf8'));const q=s=>w.document.querySelector(s),sleep=ms=>new Promise(r=>setTimeout(r,ms));
w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();q('[data-rx-section="appointments"]').click();await sleep(80);q('[data-rx-action="book"]').click();await sleep(30);
const set=(n,v)=>{const e=q('.rx-modal [name="'+n+'"]');e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('service_id','k2');set('provider_id','as');set('day',tomorrow);await sleep(30);
const first=()=>q('.rx-modal [name=starts_at]').options[0].textContent,hint=()=>q('.rx-modal [data-rx-slot-hint]');
// 20-minute service: only 23:20–23:30 (10 min) is left → fully booked, next free day shown
assert.equal([...q('.rx-modal [name=starts_at]').options].filter(o=>o.value&&o.value!=='__custom__').length,0);assert.equal(first(),'اليوم ده محجوز بالكامل للدكتور');assert(!hint().hidden&&hint().textContent.includes('أول ميعاد فاضي'));
// half an hour: fully booked, says so and points to the next free day
const dc=q('.rx-modal [name="duration_choice"]');dc.value='30';dc.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(20);
assert.equal(first(),'اليوم ده محجوز بالكامل للدكتور');assert(!hint().hidden&&hint().textContent.includes('أول ميعاد فاضي')&&hint().textContent.includes('02:00'),hint().textContent);
assert(hint().textContent.includes('المدة المختارة أطول'),'explains the duration');
// a day without any availability
set('day',fmt(Date.now()+2*86400000));await sleep(20);assert.equal(first(),'الدكتور مالوش تواجد في اليوم ده');assert(hint().textContent.includes('أول ميعاد فاضي'));
assert.deepEqual(errors,[]);console.log('PASS booking full-day message: fits shows times; full window says «محجوز بالكامل» + duration note + next free slot; no availability says so.');})().catch(e=>{console.error(e);process.exit(1);});
