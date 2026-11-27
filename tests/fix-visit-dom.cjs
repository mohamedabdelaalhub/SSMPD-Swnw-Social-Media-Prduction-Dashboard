// «في غلط في زيارة أو حساب مريض» (help 295, owner «طبقه» 2026-11-26): picker → journey panel → the SAME card buttons, pressed through the real
// today-operations handlers. Real today-operations.js + fix-visit.js on a jsdom board, reception LIVE workspace (not the sandbox).
/* the trial workspace is guarded in today-operations.js (state.sandbox) — not driven here: it needs SWNJourneySandbox. */
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const tick=(n=20)=>new Promise(r=>setTimeout(r,n));
async function setup(role,sandbox){
 const later=new Date(Date.now()+60*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. تجربة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_paid:0,due_invoices:[]},extra||{});
 const model={day:new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],
  appointments:[ap('1','منى أحمد','called',{visit_id:'v1'}),ap('2','خالد محمود','expected'),ap('3','سارة علي','completed',{visit_id:'v3',patient_due:500,due_invoices:[{id:'i1',due:500}]}),ap('4','ملغي','cancelled')]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],acts=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:()=>{}};
 w.SSMPDAuth={currentAdmin:{id:'u1',role}};w.SSMPDRoles={rolesOf:()=>[role],hasRole:(a,r)=>r===role,hasAnyRole:(a,l)=>l.includes(role),canSeeTab:()=>true};
 w.SSMPDDb={client:{rpc:async name=>name==='clinic_reception_journey_hub_snapshot'?{data:JSON.parse(JSON.stringify(model)),error:null}:{data:null,error:null}}};
 w.SSMPDReceptionLook={_state:{}};w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:(a,id)=>{acts.push([a,id]);return true;},bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/reception-booking-discount.js','utf8'));w.opened=[];w.SSMPDReceptionBookingDiscount.openForBooking=i=>{w.opened.push(i);return true;};
 w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));w.eval(fs.readFileSync('assets/js/fix-visit.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',sandbox,data:{appointments:[{id:'2',status:'booked',patient_id:'p2',service_id:'s1',starts_at:later}],services:[{id:'s1'}],visits:[],orders:[]},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);for(let n=0;n<200&&!host.querySelector('.journey-board');n++)await tick(10);
 return {w,errors,acts,host,doc:w.document};
}
(async()=>{
 const t=await setup('reception',false),d=t.doc;
 assert.equal(await t.w.SSMPDFixVisit.open(),true,'opens when the board is loaded');
 const rows=[...d.querySelectorAll('[data-fv-pick]')].map(b=>b.getAttribute('data-fv-pick'));
 assert.deepEqual(rows,['3','1','2'],'cancelled hidden; completed first, then in-progress, then not-yet-arrived');
 assert.ok(d.querySelector('[data-fv-pick="1"]').classList.contains('hi'),'in-progress visit is highlighted with its next step');
 assert.match(d.querySelector('[data-fv-pick="1"] small').textContent,/الخطوة الجاية: دخل يكشف/);
 const q=d.querySelector('[data-fv-q]');q.value='خالد';q.dispatchEvent(new t.w.Event('input'));assert.deepEqual([...d.querySelectorAll('[data-fv-pick]')].map(b=>b.getAttribute('data-fv-pick')),['2'],'search by name');
 q.value='';q.dispatchEvent(new t.w.Event('input'));
 // called patient: journey steps + why + next step = the card's primary button
 d.querySelector('[data-fv-pick="1"]').click();
 const st=[...d.querySelectorAll('.fv-st')];assert.equal(st.length,5);assert.deepEqual(st.map(x=>x.classList.contains('ok')),[true,true,true,false,false]);assert.ok(st[3].classList.contains('miss'),'missing step = دخل يكشف');
 assert.match(d.querySelector('[data-fv-why]').textContent,/التحصيل بيظهر بعد/);
 const next=d.querySelector('.fv-next');assert.ok(next&&next.getAttribute('data-fv-act')==='consultation_start','next step = بدأ الكشف (the card main button)');
 const names=[...d.querySelectorAll('[data-fv-act]')].map(b=>b.getAttribute('data-fv-act'));
 assert.ok(names.includes('change_service'),'تغيير الخدمة (reception, arrived card)');
 assert.ok(!names.includes('booking_discount'),'no discount edit after arrival (no server action)');
 assert.ok(!/تعديل تفاصيل الخصم/.test(d.querySelector('[data-fv]').textContent),'no after-arrival discount edit text');
 assert.match(d.querySelector('.fv-note:last-child').textContent,/نسبة الدكتور/,'doctor share: read-only note, no button');
 // pressing = the real card handler: change_service goes through the reception module act('visit-detail')
 d.querySelector('[data-fv-act="change_service"]').click();await tick(30);
 assert.ok(!d.querySelector('[data-fv]'),'panel closes before the existing screen opens');
 assert.equal(t.acts.length,1);assert.equal(t.acts[0][0],'visit-detail');assert.equal(t.acts[0][1],'v1');
 // completed patient with a due: next step = collect
 await t.w.SSMPDFixVisit.open();d.querySelector('[data-fv-pick="3"]').click();
 assert.ok(d.querySelector('.fv-next[data-fv-act="collect_due"]'),'completed + due → «حصّل» is the next step');
 assert.ok(d.querySelector('.fv-st.ok:last-of-type'),'all five steps done');
 assert.ok(!d.querySelector('.fv-st.miss'),'no missing step');
 // not-yet-arrived: booking-level actions available (reschedule is a v2 button — pressed through the root so the capture listener fires)
 d.querySelector('[data-fv-back]').click();d.querySelector('[data-fv-pick="2"]').click();
 assert.ok(d.querySelector('.fv-next[data-fv-act="arrive"]'),'expected → «وصل»');
 assert.ok(d.querySelector('[data-fv-act="reschedule"][data-fv-v2="1"]'),'تغيير اليوم والساعة (v2 button) before arrival');
 const bd=d.querySelector('[data-fv-act="booking_discount"]');assert.ok(bd&&/تعديل تفاصيل الخصم/.test(bd.textContent),'تعديل تفاصيل الخصم before arrival');
 bd.click();await tick(30);assert.deepEqual(t.w.opened,['2'],'opens the existing booking_discount form for that booking');
 assert.deepEqual(t.errors,[]);
 // customer service: no change_service button (the card hides it; the panel only mirrors the card)
 const cs=await setup('customer_service',false);await cs.w.SSMPDFixVisit.open();cs.doc.querySelector('[data-fv-pick="1"]').click();
 assert.ok(![...cs.doc.querySelectorAll('[data-fv-act]')].some(b=>b.getAttribute('data-fv-act')==='change_service'),'customer service: change_service hidden');
 console.log('PASS fix-visit: reception live — picker order+search, journey steps/why/next, card buttons mirrored (no after-arrival discount edit, doctor share read-only), press goes through the real handler; customer service hides what the card hides (the trial workspace is excluded in code: ready/appointments/actions/press all return empty/false when state.sandbox).');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
