// «راجع قبل ما تحصّل» (owner 2026-11-27, mig 20261127140000, help 329): the real reception screen + the real server functions (PGlite),
// as a RECEPTION member with the collect capability. «تسجيل تحصيل» → pick the patient → the blue box lists the visit's services
// (price → discount pending / approved → owed) from public.clinic_reception_collect_review; the «عدّل» buttons are exactly the visit-card
// actions (SSMPDTodayOps.actions) and pressing one closes the window, runs the card handler, then «تسجيل تحصيل» opens again for the same
// patient with the refreshed review; ✕ closes (rules 9 / 10). The live path of the RPC is covered by tests/review-before-money-doctor-sql.cjs
// (live reception bridge) and the hub dry-run as Mazen.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{webcrypto,randomUUID}=require('crypto');
(async()=>{const {db,rpc,id,as}=await boot(['reception_services_packages','reception_contracts_controls']);const ws=await rpc('clinic_reception_bootstrap'),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cmd=(p_action,p_payload,p_token=randomUUID())=>rpc('clinic_reception_command',{p_workspace:ws,p_action,p_payload,p_token}),snapshot=()=>rpc('clinic_reception_snapshot',{p_workspace:ws,p_from:day,p_to:day});let data=await snapshot();
const provider=data.providers[0].id,service=data.services.find(x=>x.code==='CONSULT').id,patient=data.patients[0].id;
await cmd('member',{admin_id:id(2),capabilities:['manage','view','review']});await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
await cmd('availability',{provider_id:provider,starts_at:day+'T06:00Z',ends_at:day+'T15:00Z'});const app=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:day+'T08:00Z'})).id;await cmd('arrive',{id:app});
data=await snapshot();const visit=data.visits.find(v=>v.appointment_id===app);assert(visit,'arrive opens the visit');
let order=data.orders.find(o=>o.visit_id===visit.id);if(!order){await cmd('order_add',{visit_id:visit.id,service_id:service,provider_id:provider,quantity:1});data=await snapshot();order=data.orders.find(o=>o.visit_id===visit.id);}
await as(3);await cmd('discount',{id:order.id,percent:10,reason:'مريض متكرر (اختبار)'});await as(1);
// the same migration also wraps the doctor payout / drawer functions (tested in review-before-money-*-sql.cjs): minimal stand-ins here
await db.exec('reset role');await db.exec(`create schema if not exists clinic_finance;
 do $$ begin if to_regclass('clinic_finance.doctor_payouts') is null then create table clinic_finance.doctor_payouts(id uuid primary key); end if;
  if to_regclass('clinic_finance.desk_payouts') is null then create table clinic_finance.desk_payouts(payout_id uuid); end if;
  if to_regclass('clinic_finance.desk_payout_rx') is null then create table clinic_finance.desk_payout_rx(payout_id uuid); end if;
  if to_regclass('clinic_finance.drawer_requests') is null then create table clinic_finance.drawer_requests(id uuid primary key); end if; end $$;
 create or replace function public.clinic_reception_doctor_payout(text,jsonb,uuid default null) returns jsonb language sql as $q$select '{}'::jsonb$q$;
 create or replace function public.clinic_finance_drawer_request(text,jsonb default '{}'::jsonb) returns jsonb language sql as $q$select '{}'::jsonb$q$;`);
await db.exec(fs.readFileSync('supabase/migrations/20261127140000_review_before_money.sql','utf8'));
await as(3);
const calls=[],reviews=[];const dom=new JSDOM('<main id="root"></main>',{url:'https://reception.test',runScripts:'outside-only'}),w=dom.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:id(3),role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
const wrap=p=>p.catch(e=>{const x=new Error(e.message);x.hint=e.hint;x.details=e.detail;throw x;});
w.SSMPDDb={receptionWorkspaces:()=>rpc('clinic_reception_workspaces'),receptionBootstrap:()=>rpc('clinic_reception_bootstrap'),receptionSnapshot:(p_workspace,p_from,p_to)=>rpc('clinic_reception_snapshot',{p_workspace,p_from,p_to}),receptionReport:(p_workspace,p_from,p_to)=>rpc('clinic_reception_report',{p_workspace,p_from,p_to}),
 receptionCommand:(p_workspace,p_action,p_payload,p_token)=>{calls.push([p_action,JSON.parse(JSON.stringify(p_payload)),p_token]);return wrap(rpc('clinic_reception_command',{p_workspace,p_action,p_payload,p_token}));},
 client:{rpc:(n,a)=>{reviews.push([n,JSON.parse(JSON.stringify(a))]);return rpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}));}}};
// the visit card of «تشغيل اليوم»: what it offers for this visit, and its handler (records the press, opens its own window)
const pressed=[];let lastCtx=null;
w.SSMPDTodayOps={context:()=>lastCtx,actions:aid=>aid===app?[{name:'visit_reopen',id:aid,label:'إعادة فتح الزيارة'},{name:'arrive',id:aid,label:'وصل'}]:[],
 press:(name,aid)=>{pressed.push([name,aid]);lastCtx.modal('إعادة فتح الزيارة قبل التحصيل','<p>تأكيد</p>',()=>Promise.resolve({}));return true;}};
for(const file of ['reception-controls','reception-services','reception-collect-once','reception-collect-review','reception-workspace'])w.eval(fs.readFileSync('assets/js/'+file+'.js','utf8'));
const P=w.SSMPDReceptionModules.panel;w.SSMPDReceptionModules.panel=(s,c)=>{lastCtx=c;return P(s,c);};
const q=s=>w.document.querySelector(s),click=s=>{assert(q(s),'missing '+s);q(s).click();},set=(n,v)=>{const el=q('.rx-modal [name="'+n+'"]');assert(el,n);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));},
 wait=async(f,why)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+(why||'')+': '+(q('.rx-modal')||w.document.body).textContent.slice(0,300));};
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));if(q('[data-guide-skip]'))click('[data-guide-skip]');
click('[data-rx-section="operations"]');await new Promise(r=>setTimeout(r,300));await wait(()=>q('[data-rx-action="collect"]'));
click('[data-rx-action="collect"]');const box=()=>q('.rx-modal [data-collect-review]');assert(box(),'review box inside «تسجيل تحصيل»');assert.equal(box().hidden,true,'hidden until a patient is picked');
// the box sits above the amount
assert(box().compareDocumentPosition(q('.rx-modal [name="amount"]'))&w.Node.DOCUMENT_POSITION_FOLLOWING,'before the payment fields');
set('patient_id',patient);await wait(()=>/مريض متكرر|مستني موافقة/.test(box().textContent),'review loaded');
assert.deepEqual(JSON.parse(JSON.stringify(reviews.find(r=>r[0]==='clinic_reception_collect_review')[1])),{p_workspace:ws,p_patient:patient});
assert.match(box().textContent,/راجع قبل ما تحصّل/);assert.match(box().textContent,/خصم 10% مستني موافقة/);assert.match(box().textContent,/لسه ما اتنفذتش/);
// «عدّل»: only the card's edit actions (not «وصل»), pressed through the card handler; then «تسجيل تحصيل» opens again for the same patient
const eds=[...box().querySelectorAll('[data-rbm-edit]')];assert.deepEqual(eds.map(b=>b.getAttribute('data-rbm-edit')),['visit_reopen']);assert.match(eds[0].textContent,/افتح الزيارة للتعديل/);
eds[0].click();assert.deepEqual(pressed,[['visit_reopen',app]]);await wait(()=>q('.rx-modal h3')&&/إعادة فتح الزيارة/.test(q('.rx-modal h3').textContent),'card window');
click('.rx-modal .modal-close');await wait(()=>q('.rx-modal [data-collect-review]')&&!box().hidden&&/مستني موافقة/.test(box().textContent),'collect reopened with the review');
assert.equal(q('.rx-modal [name="patient_id"]').value,patient,'same patient picked again');assert.match(q('.rx-modal h3').textContent,/تسجيل تحصيل/);
// a patient with nothing owed → plain line
const other=data.patients.find(p=>p.id!==patient);if(other){set('patient_id',other.id);await wait(()=>/مفيش زيارة عليها فلوس/.test(box().textContent),'empty');}
// ✕ closes (rule 10); nothing was collected
click('.rx-modal .modal-close');assert(!q('.rx-modal'));assert.equal(calls.filter(c=>c[0]==='collect').length,0);
assert.deepEqual(errors,[]);await db.close();console.log('PASS collect review UI (reception member, real server functions): box in «تسجيل تحصيل» after picking the patient, services with pending discount / not executed, only the visit-card edit actions, press → card window → back to «تسجيل تحصيل» for the same patient refreshed, empty patient, ✕ closes.');
})().catch(e=>{console.error(e);process.exit(1);});
