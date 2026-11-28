// 20261128180000 «تنبيه الخدمة المكررة» (owner 2026-11-28): the real reception screen + the real server functions (PGlite), as a
// RECEPTION member (admin 3). «أثناء التسجيل» (owner 2026-11-28): the window opens the MOMENT the service is chosen, before «حفظ».
// The guard does not depend on the workspace mode; this DOM harness boots the trial workspace (a
// live one needs the full finance bridge) — the LIVE path is proven by the hub dry-run as Mazen (tests/duplicate-service-live-rollback.sql). «+ إضافة خدمة» of a service already on the visit → the server refuses
// (hint duplicate_service) → duplicate-service.js shows «الخدمة دي موجودة بالفعل» with the server's message:
//   «لا، تراجع» → nothing saved, the form says «تراجعت — الخدمة ما اتضافتش تاني»;  ✕ and Esc → the same;
//   «أيوه، ضيفها تاني» → resent ONCE with confirm_duplicate → saved. Another service → no window. Journey «طلب خدمة» → «again» RPC.
// Rules 9 / 10.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{webcrypto,randomUUID}=require('crypto');
(async()=>{const {db,rpc,id,as}=await boot(['reception_services_packages','reception_contracts_controls']);const ws=await rpc('clinic_reception_bootstrap'),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cmd=(p_action,p_payload,p_token=randomUUID())=>rpc('clinic_reception_command',{p_workspace:ws,p_action,p_payload,p_token});let data=await rpc('clinic_reception_snapshot',{p_workspace:ws,p_from:day,p_to:day});
await db.exec('reset role');const mode=(await db.query('select mode from clinic_reception.workspaces where id=$1',[ws])).rows[0].mode;assert.equal(mode,'trial');await as(1);
const provider=data.providers[0].id,dept=data.providers[0].department,patient=data.patients[0].id;
await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
for(const [c,n,pr] of [['INJ','حقنة عضل',50],['ECG','رسم قلب',200]])await cmd('service',{code:c,name:n,department:dept,price:pr,minutes:15,bom:[]});
data=await rpc('clinic_reception_snapshot',{p_workspace:ws,p_from:day,p_to:day});const S=c=>data.services.find(x=>x.code===c).id;
await cmd('availability',{provider_id:provider,starts_at:day+'T05:00Z',ends_at:day+'T20:00Z'});
const app=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:S('INJ'),starts_at:day+'T08:00Z'})).id;const visit=(await cmd('arrive',{id:app})).id;
await db.exec('reset role');
 if(!(await db.query("select to_regprocedure('public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid)') p")).rows[0].p){
  await db.exec(`create table if not exists clinic_reception.journey_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,idempotency_key text,metadata jsonb);
   create function public.clinic_reception_journey_request_service(p_workspace uuid,p_appointment uuid,p_service uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $f$
   declare v clinic_reception.visits%rowtype;s clinic_reception.services%rowtype;o uuid;e uuid;begin
    select id into e from clinic_reception.journey_events where workspace_id=p_workspace and idempotency_key='service-request:'||p_token::text;
    if e is not null then return jsonb_build_object('event_id',e,'duplicate',true);end if;
    select * into v from clinic_reception.visits where appointment_id=p_appointment and status='open';select * into s from clinic_reception.services where id=p_service;
    insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by) values(p_workspace,v.id,s.id,(select provider_id from clinic_reception.appointments where id=p_appointment),1,s.price,to_jsonb(s),public.my_admin_id()) returning id into o;
    insert into clinic_reception.journey_events(workspace_id,idempotency_key,metadata) values(p_workspace,'service-request:'||p_token::text,jsonb_build_object('order_id',o)) returning id into e;
    return jsonb_build_object('order_id',o,'event_id',e);end $f$;
   revoke all on function public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid) from public,anon;grant execute on function public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid) to authenticated;`);}
await db.exec(fs.readFileSync('supabase/migrations/20261128180000_duplicate_service_warn.sql','utf8'));
// the receptionist (admin 3)
await as(3);
const calls=[];const dom=new JSDOM('<main id="root"></main>',{url:'https://reception.test',runScripts:'outside-only'}),w=dom.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:id(3),role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
// the shared client exactly like db.js: rpc → {data,error}; receptionCommand = handle(client.rpc(...))
const client={rpc:(name,args)=>{calls.push([name,JSON.parse(JSON.stringify(args))]);return rpc(name,args).then(data=>({data,error:null}),e=>({data:null,error:{message:e.message,hint:e.hint,details:e.detail,code:e.code}}));}};
const handle=p=>Promise.resolve(p).then(r=>{if(r.error){const x=new Error(r.error.message);x.hint=r.error.hint;throw x;}return r.data;});
w.SSMPDDb={client,receptionWorkspaces:()=>handle(client.rpc('clinic_reception_workspaces',{})),receptionBootstrap:()=>handle(client.rpc('clinic_reception_bootstrap',{})),receptionSnapshot:(p_workspace,p_from,p_to)=>handle(client.rpc('clinic_reception_snapshot',{p_workspace,p_from,p_to})),receptionReport:(p_workspace,p_from,p_to)=>handle(client.rpc('clinic_reception_report',{p_workspace,p_from,p_to})),
 receptionCommand:(p_workspace,p_action,p_payload,p_token)=>handle(client.rpc('clinic_reception_command',{p_workspace,p_action,p_payload,p_token}))};
for(const file of ['reception-controls','reception-services','reception-look','reception-workspace','duplicate-service'])w.eval(fs.readFileSync('assets/js/'+file+'.js','utf8'));
assert.equal(w.SSMPDDupService.wrap(),true,'client wrapped');
const q=s=>w.document.querySelector(s),click=s=>{assert(q(s),'missing '+s);q(s).click();},set=(n,v)=>{const el=q('.rx-modal [name="'+n+'"]');assert(el,n);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));},
 wait=async(f,what)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+(what||'')+': '+w.document.body.textContent.slice(0,400));};
const orders=async()=>{await db.exec('reset role');const r=(await db.query("select s.code from clinic_reception.orders o join clinic_reception.services s on s.id=o.service_id where o.visit_id=$1 and o.status<>'cancelled' order by o.created_at",[visit])).rows.map(x=>x.code);await as(3);return r;};
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'),'sections');if(q('[data-guide-skip]'))click('[data-guide-skip]');
// open the visit window («+ إضافة خدمة» lives there)
const openAdd=async()=>{for(let i=0;i<3&&q(".rx-modal");i++){const x=q(".rx-modal .modal-close")||q(".rx-modal [data-rx-cancel]");if(!x)break;x.click();await new Promise(r=>setTimeout(r,30));}assert(!q(".rx-modal"),"no window left open: "+(q(".rx-modal")&&q(".rx-modal").textContent.slice(0,120)));if(!q('[data-rx-action="visit-detail"][data-id="'+visit+'"]')){if(q('[data-rx-action="back"]')&&!q('[data-rx-section="visits"]'))click('[data-rx-action="back"]');await wait(()=>q('[data-rx-section="visits"]'),'visits tab');click('[data-rx-section="visits"]');}
 await wait(()=>q('[data-rx-action="visit-detail"][data-id="'+visit+'"]'),'visit row');click('[data-rx-action="visit-detail"][data-id="'+visit+'"]');
 await wait(()=>q('[data-rx-action="order_add"][data-id="'+visit+'"]'),'order_add button');click('[data-rx-action="order_add"][data-id="'+visit+'"]');await wait(()=>q('.rx-modal [name="service_id"]'),'order_add form');};
const pick=async()=>{await openAdd();set('provider_id',provider);set('quantity','1');set('service_id',S('INJ'));await wait(()=>q('[data-dup-service]'),'dup window at choose');};
assert.deepEqual(await orders(),['INJ']);
// 1) choosing the same service → the window opens right away (before «حفظ»), with the server's message; nothing is sent to save
const saves=()=>calls.filter(c=>c[0]==='clinic_reception_command'&&c[1].p_action==='order_add').length;const s0=saves();
await pick();
assert.match(q('[data-dup-msg]').textContent,/^الخدمة دي \(حقنة عضل\) موجودة بالفعل على الزيارة دي — اتضافت الساعة \d{1,2}:\d{2} [صم].*\. عايز تضيفها تاني فعلاً؟$/);
assert.equal(q('[data-dup-yes]').textContent,'أيوه، ضيفها تاني');assert.equal(q('[data-dup-no]').textContent,'لا، تراجع');assert(q('[data-dup-x]'),'✕ (rule 10)');
assert.equal(saves(),s0,'nothing sent before the answer');assert(calls.some(c=>c[0]==='clinic_reception_duplicate_service_check'&&c[1].p_payload.visit_id===visit),'checked the visit at choose');
// «لا، تراجع» → the choice is cleared, the form stays open, nothing saved
click('[data-dup-no]');await wait(()=>!q('[data-dup-service]'));assert.equal(q('.rx-modal [name="service_id"]').value,'','choice cleared');assert(q('.rx-modal'),'form stays');
assert.deepEqual(await orders(),['INJ']);
// ✕ and Esc → the same
set('service_id',S('INJ'));await wait(()=>q('[data-dup-service]'));click('[data-dup-x]');await wait(()=>!q('[data-dup-service]'));assert.equal(q('.rx-modal [name="service_id"]').value,'');
set('service_id',S('INJ'));await wait(()=>q('[data-dup-service]'));w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!q('[data-dup-service]'));assert.equal(q('.rx-modal [name="service_id"]').value,'');
assert.equal(saves(),s0);
// 2) «أيوه، ضيفها تاني» at choose → «حفظ» saves it confirmed, with NO second window
set('service_id',S('INJ'));await wait(()=>q('[data-dup-service]'));click('[data-dup-yes]');await wait(()=>!q('[data-dup-service]'));assert.equal(q('.rx-modal [name="service_id"]').value,S('INJ'),'choice kept');
click('.rx-modal [type="submit"]');await wait(()=>!q('.rx-modal'),'saved');assert(!q('[data-dup-service]'),'no second window');
assert.deepEqual(await orders(),['INJ','INJ']);const last=calls.filter(c=>c[1].p_action==='order_add').pop();assert.equal(last[1].p_payload.confirm_duplicate,true,'sent confirmed');
// 3) safety net: a save that was not checked at choose (e.g. another screen) still gets the window after «حفظ»
w.SSMPDDupService.setWorkspace(null);await openAdd();set('provider_id',provider);set('quantity','1');set('service_id',S('INJ'));await new Promise(r=>setTimeout(r,60));assert(!q('[data-dup-service]'),'no check without a workspace');
w.SSMPDDupService.setWorkspace(ws);click('.rx-modal [type="submit"]');await wait(()=>q('[data-dup-service]'),'window after save');click('[data-dup-no]');
await wait(()=>(q('.rx-modal')||w.document.body).textContent.includes('تراجعت — الخدمة ما اتضافتش تاني'),'back message');assert.deepEqual(await orders(),['INJ','INJ']);
// 4) another service → no window
await openAdd();set('service_id',S('ECG'));set('provider_id',provider);set('quantity','1');click('.rx-modal [type="submit"]');await wait(()=>!q('.rx-modal'),'ECG saved');assert(!q('[data-dup-service]'));
assert.deepEqual(await orders(),['INJ','INJ','ECG']);
// 5) journey «طلب خدمة» path: the wrapper sends «again» after yes (client-level; the server half is in duplicate-service-sql.cjs)
const fakeDup={data:null,error:{message:'الخدمة دي (رسم قلب) موجودة بالفعل على الزيارة دي — اتضافت الساعة 1:47 م. عايز تضيفها تاني فعلاً؟',hint:'duplicate_service'}};
const real=client.rpc;let n=0;const seen=[];
w.SSMPDDb.client.__dupServiceWrapped=false;const c2={rpc:(name,args)=>{seen.push(name);return Promise.resolve(name==='clinic_reception_journey_request_service'?fakeDup:{data:{order_id:'x'},error:null});}};w.SSMPDDb.client=c2;w.SSMPDDupService.wrap();
const pr=c2.rpc('clinic_reception_journey_request_service',{p_workspace:ws,p_appointment:app,p_service:S('ECG'),p_token:randomUUID()});await wait(()=>q('[data-dup-service]'));click('[data-dup-yes]');const jr=await pr;
assert.deepEqual(seen,['clinic_reception_journey_request_service','clinic_reception_journey_request_service_again']);assert.equal(jr.data.order_id,'x');
assert.deepEqual(errors,[]);await db.close();console.log('PASS duplicate service UI (reception member, real server functions): choosing the same service in «+ إضافة خدمة» opens «الخدمة دي موجودة بالفعل» at once (before «حفظ»); «لا، تراجع» / ✕ / Esc clear the choice, nothing saved; «أيوه، ضيفها تاني» → «حفظ» saves it confirmed with no second window; the window after «حفظ» stays as a safety net; another service → no window; journey request → «again» RPC.');
})().catch(e=>{console.error(e);process.exit(1);});
