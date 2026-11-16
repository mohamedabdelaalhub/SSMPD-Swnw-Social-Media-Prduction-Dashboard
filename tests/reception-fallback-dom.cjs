// Reception sees fallback bookings (WhatsApp/website while Masa was down) in «المواعيد»: confirm, release, cancel with a reason.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
(async()=>{const d=new JSDOM('<main id="root"></main>',{url:'https://r.test/',runScripts:'outside-only'}),w=d.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};w.SSMPDRoles={canSeeTab:()=>true};
const snap={workspace:{id:'w',mode:'live'},can_manage:true,patients:[],services:[],providers:[{id:'as',name:'د. أحمد سمير',department:'الجلدية'}],availability:[],appointments:[],visits:[],orders:[],packages:[],catalog_unavailable:[],consultation_scopes:{},provider_service_scopes:{}};
const base={doctor_name:'د. أحمد سمير',department:'الجلدية',appointment_date:'2026-11-20',appointment_time:'10:00',needed_service:'كشف',source:'whatsapp',phone:'01000000001',customer_age:30};
let list=[{...base,fallback_booking_id:'f1',customer_name:'مريض <b>واحد</b>',status:'pending'},{...base,fallback_booking_id:'f2',customer_name:'مريض اتنين',status:'conflict',source:'website'},{...base,fallback_booking_id:'f3',customer_name:'مريض تلاتة',status:'replayed',reception_confirmed:true,slot_released:true}];
const rpcs=[];w.SSMPDDb={receptionBootstrap:async()=>'w',receptionSnapshot:async()=>JSON.parse(JSON.stringify(snap)),receptionCommand:async()=>({}),
 client:{rpc:async(n,a)=>{rpcs.push([n,JSON.parse(JSON.stringify(a))]);if(n==='clinic_reception_fallback'&&a.p_action==='list')return {data:{bookings:list},error:null};return {data:{ok:true},error:null};}}};
for(const f of ['assets/js/reception-fallback.js','assets/js/reception-workspace.js'])w.eval(fs.readFileSync(f,'utf8'));
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)],sleep=ms=>new Promise(r=>setTimeout(r,ms));
w.SSMPDReception.render(q('#root'));await sleep(80);const sk=q('[data-guide-skip]');if(sk)sk.click();
q('[data-rx-section="appointments"]').click();await sleep(60);
const box=q('[data-rx-fallback]');assert(box&&!box.hidden,'panel shown in المواعيد');
assert(/حجوزات احتياطية \(3\)/.test(box.textContent)&&/1 محتاجين تكلّم المريض/.test(box.textContent));
assert(!box.innerHTML.includes('<b>واحد'),'names escaped');assert(/الموقع/.test(q('.rx-fb-conflict').textContent)&&/كلّم المريض/.test(q('.rx-fb-conflict').textContent));
assert.equal(qa('[data-fb-act="confirm"]').length,1,'confirm only for unconfirmed non-conflict');assert.equal(qa('[data-fb-act="release"]').length,2);assert.equal(qa('[data-fb-act="cancel"]').length,3);
w.prompt=()=>'  ';q('[data-fb-act="cancel"][data-id="f2"]').click();await sleep(20);assert(!rpcs.some(r=>r[1].p_action==='cancel'),'no reason → nothing sent');
w.prompt=()=>'المريض اعتذر';q('[data-fb-act="cancel"][data-id="f2"]').click();await sleep(30);
const c=rpcs.find(r=>r[1].p_action==='cancel');assert.deepEqual(c[1],{p_workspace:'w',p_action:'cancel',p_payload:{id:'f2',reason:'المريض اعتذر'}});
w.confirm=()=>false;q('[data-fb-act="release"][data-id="f1"]').click();await sleep(20);assert(!rpcs.some(r=>r[1].p_action==='release'));
w.confirm=()=>true;q('[data-fb-act="release"][data-id="f1"]').click();await sleep(30);assert(rpcs.some(r=>r[1].p_action==='release'&&r[1].p_payload.id==='f1'));
q('[data-fb-act="confirm"]').click();await sleep(30);assert(rpcs.some(r=>r[1].p_action==='confirm'&&r[1].p_payload.id==='f1'));
list=[];q('[data-rx-action="back"]').click();await sleep(30);q('[data-rx-section="appointments"]').click();await sleep(60);
assert(q('[data-rx-fallback]').hidden,'nothing to show → hidden');
assert.deepEqual(errors,[]);console.log('PASS reception fallback UI: panel in المواعيد with count and conflict warning, escaped, confirm/release/cancel (reason required, release asks first), hidden when empty.');
})().catch(e=>{console.error(e);process.exit(1);});
