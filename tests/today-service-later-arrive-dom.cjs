// Owner 2026-11-27 «لو مفيش خدمة مطابقة ينتظر لما الموظف يقوم باختيار خدمة» (20261127310000): a Masa booking without a clear
// service is booked as «الخدمة تتحدد عند الحضور». On «تشغيل اليوم» (RECEPTION, LIVE workspace) its card says «محتاج تختار الخدمة»;
// «وصل» opens «وصل — اختار الخدمة الأول» (the REAL shared modal of reception-workspace.js: ✕ + «تراجع» + Esc), the service is
// required (only the doctor's own services), and «سجّل الحضور» calls clinic_reception_command 'arrive' WITH service_id — the same
// server path as «تسجيل حضور» (dry-run as Mazen in tests/auto-pick-own-department-live-rollback.sql). A normal booking keeps the
// old «وصل» confirm (journey arrive). The server refusal text shows in the window when the arrival is refused.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const WS=fs.readFileSync('assets/js/reception-workspace.js','utf8').split('\n');
const i=WS.findIndex(l=>l.startsWith('function modal(title,body,save,onSaved,opts)'));assert(i>=0,'shared modal moved');
const MODAL=WS.slice(i,i+3).join('\n');assert(MODAL.includes('modal-close')&&MODAL.includes('data-rx-cancel')&&MODAL.trim().endsWith('return root;}'),'shared modal: 3 lines');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function board(role,opts={}){
 const later=new Date(Date.now()+60*60000).toISOString();
 const ap=(id,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:'مريض '+id,file_no:'F'+id,provider_id:'d1',provider_name:'د. تجربة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,due_invoices:[]},extra||{});
 const model={day:'2026-11-27',settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],
  appointments:[ap('1','expected',{service_name:'الخدمة تتحدد عند الحضور'}),ap('2','expected',{})]};
 const data={workspace:{id:'ws1',mode:'live'},providers:[{id:'d1',name:'د. تجربة',department:'باطنة'}],provider_departments:{},provider_service_scopes:{},
  services:[{id:'s-int',code:'KIN',name:'كشف استشاري باطنة',department:'باطنة',active:true},{id:'s-heart',code:'KIN2',name:'كشف استشاري قلب',department:'باطنة',active:true},
   {id:'s-blood',code:'BLD',name:'كشف أخصائي أمراض الدم والمناعة',department:'امراض الدم',active:true},{id:'s-ph',code:'LATER-x',name:'الخدمة تتحدد عند الحضور',department:'باطنة',placeholder:true,active:false}],
  appointments:[{id:'1',status:'booked',service_later:true,provider_id:'d1',service_id:'s-ph'},{id:'2',status:'booked',service_later:false,provider_id:'d1',service_id:'s-int'}]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],calls=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:()=>{}};
 w.SSMPDAuth={currentAdmin:{id:'u1',role}};w.SSMPDRoles={rolesOf:()=>[role],hasRole:(a,r)=>r===role,hasAnyRole:(a,l)=>l.includes(role)};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args]);if(name==='clinic_reception_journey_hub_snapshot'||name==='clinic_reception_journey_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
  if(name==='clinic_reception_command'&&opts.refuse)return {data:null,error:{message:opts.refuse}};return {data:{id:args&&args.p_payload&&args.p_payload.id},error:null};}}};
 w.SSMPDReceptionLook={_state:{}};w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/reception-service-later.js','utf8'));
 w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));
 // the REAL shared modal (reception-workspace.js) + its two helpers
 w.eval('var esc=function(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});};var friendly=function(e){return e;};var host=null;var load=function(){};'+MODAL+';window.__modal=modal;');
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',sandbox:false,data,modal:w.__modal,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);for(let n=0;n<200&&!host.querySelector('.journey-board');n++)await sleep(10);
 assert.deepEqual(errors,[]);return {w,host,calls,errors};
}
(async()=>{
 // 1) reception, live: the waiting card is marked; the normal one is not
 let r=await board('reception');const d=r.w.document;
 const chip1=d.querySelector('[data-journey-open="1"]'),chip2=d.querySelector('[data-journey-open="2"]');
 assert(chip1.querySelector('[data-later-chip]'),'«محتاج تختار الخدمة» on the «الخدمة تتحدد عند الحضور» booking');
 assert.equal(chip1.querySelector('[data-later-chip]').textContent,'محتاج تختار الخدمة');
 assert(!chip2.querySelector('[data-later-chip]'),'not on a normal booking');
 // 2) «وصل» → the picker window (not the plain confirm); only the doctor's own services; ✕ closes it
 const arrive=id=>{const b=d.querySelector(`[data-journey-action="arrive"][data-id="${id}"]`);assert(b,'«وصل» on card '+id);b.click();};
 arrive('1');await sleep(20);let m=d.querySelector('.rx-modal');assert(m,'window opened');
 assert.equal(m.querySelector('#rx-title').textContent,'وصل — اختار الخدمة الأول');
 assert(m.querySelector('[data-later-warn]').textContent.includes('مفيش فاتورة ولا تحصيل قبل كده'));
 const opts=[...m.querySelectorAll('[data-later-service] option')].map(o=>o.value);
 assert.deepEqual(opts,['','s-int','s-heart'],'only the doctor\'s own services (no other department, no placeholder)');
 assert(m.querySelector('[data-later-service]').required,'the service is required');
 m.querySelector('.modal-close').click();assert(!d.querySelector('.rx-modal'),'✕ closes');
 arrive('1');await sleep(20);m=d.querySelector('.rx-modal');m.querySelector('[data-rx-cancel]').click();assert(!d.querySelector('.rx-modal'),'«تراجع» closes');
 assert.equal(m.querySelector('[data-rx-cancel]').textContent,'تراجع');
 // 3) without a service the form does not submit (no RPC)
 arrive('1');await sleep(20);m=d.querySelector('.rx-modal');const before=r.calls.filter(c=>c[0]==='clinic_reception_command').length;
 m.querySelector('[type="submit"]').click();await sleep(30);
 assert.equal(r.calls.filter(c=>c[0]==='clinic_reception_command').length,before,'no arrival without a service');assert(d.querySelector('.rx-modal'),'window stays open');
 // 4) choose → «سجّل الحضور» → clinic_reception_command arrive WITH service_id
 m.querySelector('[data-later-service]').value='s-heart';assert.equal(m.querySelector('[type="submit"]').textContent,'سجّل الحضور');
 m.querySelector('[type="submit"]').click();await sleep(60);
 const call=r.calls.filter(c=>c[0]==='clinic_reception_command').pop();assert(call,'arrive sent');
 assert.equal(call[1].p_action,'arrive');assert.deepEqual({id:call[1].p_payload.id,service_id:call[1].p_payload.service_id,encounter_type:call[1].p_payload.encounter_type},{id:'1',service_id:'s-heart',encounter_type:'checkup'});
 assert.equal(call[1].p_workspace,'ws1');assert(call[1].p_token,'idempotency token');assert(!d.querySelector('.rx-modal'),'window closes after the arrival');
 assert(r.calls.some(c=>/journey_(hub_)?snapshot$/.test(c[0])),'board refreshed');
 // 5) a normal booking keeps the old «وصل» confirm (journey arrive, no service picker)
 arrive('2');await sleep(20);m=d.querySelector('.rx-modal');assert(m,'confirm opened');assert(!m.querySelector('[data-later-service]'),'no picker on a normal booking');
 assert.equal(m.querySelector('#rx-title').textContent,'تأكيد: وصل');m.querySelector('.modal-close').click();
 // 6) the server refusal shows in the window
 r=await board('reception',{refuse:'الخدمة دي مش من خدمات الدكتور ده — اختار خدمة من قسمه'});const d2=r.w.document;
 d2.querySelector('[data-journey-action="arrive"][data-id="1"]').click();await sleep(20);m=d2.querySelector('.rx-modal');
 m.querySelector('[data-later-service]').value='s-int';m.querySelector('[type="submit"]').click();await sleep(60);
 assert(d2.querySelector('.rx-modal'),'stays open on refusal');assert.match(m.querySelector('[data-rx-status]').textContent,/مش من خدمات الدكتور ده/);
 console.log('PASS «تشغيل اليوم» + «الخدمة تتحدد عند الحضور» (reception, live): «محتاج تختار الخدمة» on that card only; «وصل» opens the real window (✕ / تراجع), own services only, required; arrive sent WITH service_id; normal bookings keep the old confirm; refusal shown.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
