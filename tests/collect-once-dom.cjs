// 20261127110000 «التحصيل بضغطة واحدة» (owner 2026-11-27): the real reception screen + the real server functions (PGlite), as a
// RECEPTION member. A double click on «حفظ» sends ONE request; a second «تحصيل» window for the same patient / amount / method within
// 2 minutes shows the red box (UI in the trial workspace: live collects need the full finance bridge, which this DOM harness does not
// boot — the LIVE path is covered by tests/collect-once-sql.cjs on the live reception bridge and by the hub dry-run as Mazen) in the same window: «حصّل تاني برضه» records it (noted), «لأ، ماتسجلش» records nothing. Rules 9 / 10.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{webcrypto,randomUUID}=require('crypto');
(async()=>{const {db,rpc,id,as}=await boot(['reception_services_packages','reception_contracts_controls']);const ws=await rpc('clinic_reception_bootstrap'),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const cmd=(p_action,p_payload,p_token=randomUUID())=>rpc('clinic_reception_command',{p_workspace:ws,p_action,p_payload,p_token}),snapshot=()=>rpc('clinic_reception_snapshot',{p_workspace:ws,p_from:day,p_to:day});let data=await snapshot();
const provider=data.providers[0].id,service=data.services.find(x=>x.code==='CONSULT').id,patient=data.patients[0].id;
await cmd('member',{admin_id:id(2),capabilities:['manage','view','review']});await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
const agreement=(await cmd('agreement',{provider_id:provider,service_code:'CONSULT',rate:20,from:new Date(Date.parse(day)-86400000).toISOString().slice(0,10),to:'2030-01-01',reference:'AGONCE'})).id;await as(2);await cmd('agreement_review',{id:agreement,approve:true});await as(1);
await cmd('availability',{provider_id:provider,starts_at:day+'T06:00Z',ends_at:day+'T15:00Z'});const app=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:day+'T08:00Z'})).id;await cmd('arrive',{id:app});
await db.exec('reset role');await db.exec('alter table clinic_reception.payments add column if not exists note text'); /* live has it (20261122160000) */await db.exec(fs.readFileSync('supabase/migrations/20261127110000_collect_once.sql','utf8'));
// the receptionist (admin 3, collect capability)
await as(3);
const calls=[];const dom=new JSDOM('<main id="root"></main>',{url:'https://reception.test',runScripts:'outside-only'}),w=dom.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
w.SSMPDAuth={currentAdmin:{id:id(3),role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
const wrap=p=>p.catch(e=>{const x=new Error(e.message);x.hint=e.hint;x.details=e.detail;throw x;});
w.SSMPDDb={receptionWorkspaces:()=>rpc('clinic_reception_workspaces'),receptionBootstrap:()=>rpc('clinic_reception_bootstrap'),receptionSnapshot:(p_workspace,p_from,p_to)=>rpc('clinic_reception_snapshot',{p_workspace,p_from,p_to}),receptionReport:(p_workspace,p_from,p_to)=>rpc('clinic_reception_report',{p_workspace,p_from,p_to}),
 receptionCommand:(p_workspace,p_action,p_payload,p_token)=>{calls.push([p_action,JSON.parse(JSON.stringify(p_payload)),p_token]);return wrap(rpc('clinic_reception_command',{p_workspace,p_action,p_payload,p_token}));}};
for(const file of ['reception-controls','reception-services','reception-collect-once','reception-workspace'])w.eval(fs.readFileSync('assets/js/'+file+'.js','utf8'));
const q=s=>w.document.querySelector(s),click=s=>{assert(q(s),'missing '+s);q(s).click();},set=(n,v)=>{const el=q('.rx-modal [name="'+n+'"]');assert(el,n);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}));},
 wait=async f=>{for(let n=0;n<200;n++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout: '+(q('.rx-modal')||w.document.body).textContent.slice(0,300));};
const pays=async()=>{await db.exec('reset role');const r=(await db.query("select amount,method,to_jsonb(p)->>'note' note from clinic_reception.payments p where workspace_id=$1 order by created_at",[ws])).rows;await as(3);return r;};
w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));if(q('[data-guide-skip]'))click('[data-guide-skip]');
// first window: «تحصيل» 50 إنستا باي — double click on save → ONE request, ONE receipt
click('[data-rx-section="operations"]');await new Promise(r=>setTimeout(r,300));await wait(()=>q('[data-rx-action="collect"]'));click('[data-rx-action="collect"]');set('patient_id',patient);set('amount','50');set('method','instapay');set('reference','ONCE-UI-1');
const btn=q('.rx-modal [type="submit"]');btn.click();btn.click();assert.equal(btn.disabled,true,'save locks at the first click');await wait(()=>!q('.rx-modal'));
assert.equal(calls.filter(c=>c[0]==='collect').length,1,'double click → one request');assert.equal((await pays()).length,1);
// second window, same patient / amount / method → red box in the same window, nothing recorded yet
await wait(()=>q('[data-rx-action="collect"]'));click('[data-rx-action="collect"]');set('patient_id',patient);set('amount','50');set('method','instapay');set('reference','ONCE-UI-2');click('.rx-modal [type="submit"]');
await wait(()=>q('.rx-modal [data-collect-once]'));const box=q('.rx-modal [data-collect-once]');
assert.match(box.textContent,/اتسجل للمريض ده نفس المبلغ \(50 ج\.م إنستا باي\) من \d+ ثانية — إيصال/);assert(box.querySelector('[data-collect-again]').textContent.includes('حصّل تاني برضه'));
assert.equal((await pays()).length,1,'nothing recorded before the confirm');
// «لأ، ماتسجلش» → nothing recorded, the window stays open with a plain message, its ✕ still closes it
click('.rx-modal [data-collect-no]');await wait(()=>q('.rx-modal [data-rx-status]').textContent.includes('ما اتسجلش تحصيل تاني'));
assert.equal((await pays()).length,1);assert(!q('.rx-modal [data-collect-once]'));
// try again in the same window → box again → «حصّل تاني برضه» → recorded with the note, window closes
click('.rx-modal [type="submit"]');await wait(()=>q('.rx-modal [data-collect-once]'));click('.rx-modal [data-collect-again]');await wait(()=>!q('.rx-modal'));
let p=await pays();assert.equal(p.length,2);assert.match(p[1].note||'',/تحصيل تاني متأكد منه — الإيصال السابق/);
assert.equal(calls.filter(c=>c[0]==='collect'&&c[1].confirm_duplicate===true).length,1,'resent once with confirm_duplicate');
// a different amount → no box
await wait(()=>q('[data-rx-action="collect"]'));click('[data-rx-action="collect"]');set('patient_id',patient);set('amount','60');set('method','instapay');set('reference','ONCE-UI-3');click('.rx-modal [type="submit"]');await wait(()=>!q('.rx-modal'));
assert.equal((await pays()).length,3);
// ✕ closes the window (rule 10)
await wait(()=>q('[data-rx-action="collect"]'));click('[data-rx-action="collect"]');set('patient_id',patient);click('.rx-modal .modal-close');assert(!q('.rx-modal'));
assert.deepEqual(errors,[]);await db.close();console.log('PASS collect once UI (reception member, real server functions): double click → one request/one receipt; second window same patient/amount/method → red box «حصّل تاني برضه» in the same window; «لأ، ماتسجلش» records nothing; «حصّل تاني برضه» records it with the note; other amount → no box; ✕ closes.');
})().catch(e=>{console.error(e);process.exit(1);});
