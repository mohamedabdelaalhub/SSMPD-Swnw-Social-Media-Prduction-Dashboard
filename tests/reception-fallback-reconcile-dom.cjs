// Reconcile with Masa (owner 2026-11-18): alerts and bookings made directly in Masa show in «المواعيد»; alerts can be marked reviewed.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[],services:[],providers:[],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
let data={bookings:[],alerts:[{id:'a1',kind:'missing_in_masa',customer_name:'مريض <i>x</i>',doctor_name:'د. داليا سعيد',appointment_date:'2026-11-20',appointment_time:'10:00'},{id:'a2',kind:'double_booked'},{id:'a3',kind:'stale_sync',detail:'آخر مزامنة مع ماسا: 2026-11-18 10:00'}],
 masa_imports:[{official_booking_id:'M-1',patient_name:'مريض ماسا',phone:'01000000003',doctor_name:'د. داليا سعيد',appointment_date:'2026-11-20',appointment_time:'11:00',needed_service:'كشف'},{official_booking_id:'M-2',patient_name:'مريض يوم',doctor_name:'د. داليا سعيد',appointment_date:'2026-11-20',appointment_time:null,day_only:true}]};
const rpcs=[];w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async()=>({}),
 client:{rpc:async(n,a)=>{rpcs.push(JSON.parse(JSON.stringify(a)));if(a.p_action==='list')return {data,error:null};return {data:{ok:true},error:null};}}};
for(const f of ['assets/js/reception-fallback.js','assets/js/reception-workspace.js'])w.eval(fs.readFileSync(f,'utf8'));
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],sleep=ms=>new Promise(r=>setTimeout(r,ms));
w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();
q('[data-rx-section="appointments"]').click();await sleep(60);
const box=q('[data-rx-fallback]');assert(box&&!box.hidden,'panel shown even with no fallback bookings');
assert(/تنبيهات المقارنة مع ماسا\s*3/.test(box.textContent),'count chip');assert.equal(box.closest('.rx-header'),null,'box is outside the hero header');assert(box.querySelector('.rx-fb-alerts .rx-fb-alert .btn-primary[data-fb-act="open_booking"]'),'«افتح الحجز» on rows with a patient');assert(/حجز مش موجود في ماسا/.test(box.textContent)&&/ميعاد محجوز مرتين/.test(box.textContent));
assert(!box.querySelector('i'),'escaped (no injected element)');assert(/المزامنة مع ماسا متأخرة/.test(box.textContent)&&/2026-11-18 10:00/.test(box.textContent),'stale alert with time');assert(!/حجوزات احتياطية/.test(box.textContent),'no empty fallback section');
const det=q('.rx-fb-imports');assert(det&&/على ماسا مباشرة/.test(det.textContent)&&/مريض ماسا/.test(det.textContent)&&/11:00/.test(det.textContent));assert(/مريض يوم[^]*بدون ميعاد/.test(det.textContent)&&!/null/.test(det.textContent),'day-only shown as «بدون ميعاد»');
{const saved=data;data={bookings:[],masa_imports:[],alerts:[1,2,3,4,5].map(i=>({id:'z'+i,kind:'missing_in_masa',customer_name:'مريض '+i,doctor_name:'د. سارة',appointment_date:'2026-11-2'+i,appointment_time:'10:0'+i}))};
 q('[data-rx-action="back"]').click();await sleep(30);q('[data-rx-section="appointments"]').click();await sleep(60);
 assert.equal(q('[data-rx-fallback]').querySelectorAll('.rx-fb-alert').length,3,'only 3 rows inline');const all=q('[data-fb-act="all_alerts"]');assert(all&&/\(5\)/.test(all.textContent),'«عرض كل التنبيهات (5)»');
 all.click();await sleep(20);const sh=w.document.querySelector('.rx-fb-sheet');assert(sh&&sh.querySelectorAll('.rx-fb-alert').length===5,'sheet lists all 5');sh.querySelector('[data-fb-close]').click();assert(!w.document.querySelector('.rx-fb-sheet'));
 data=saved;q('[data-rx-action="back"]').click();await sleep(30);q('[data-rx-section="appointments"]').click();await sleep(60);}
q('[data-fb-act="alert_resolve"][data-id="a1"]').click();await sleep(30);
assert(rpcs.some(r=>r.p_action==='alert_resolve'&&r.p_payload.id==='a1'));
data={bookings:[],alerts:[],masa_imports:[]};q('[data-rx-action="back"]').click();await sleep(30);q('[data-rx-section="appointments"]').click();await sleep(60);
assert(q('[data-rx-fallback]').hidden,'hidden when all empty');
assert.deepEqual(errors,[]);console.log('PASS reconcile UI: Masa alerts (escaped, «راجعته») and direct-Masa bookings in المواعيد; hidden when empty.');
})().catch(e=>{console.error(e);process.exit(1);});
