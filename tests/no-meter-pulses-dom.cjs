// «مش عارف قراية العداد» (mig 20261127300000, owner 2026-11-27 «موافق على النبضات من غير عداد مؤقتاً», help 346) — the real reception
// screen + the real server functions (PGlite), as a RECEPTION member with execute (rules 9 / 10 / 12):
//   * single «تنفيذ»: a counter device with no reading yet → the hint; «مش عارف قراية العداد» hides «قبل / بعد», asks the pulses
//     (message under the field when empty), the optional photo field is there; saved → executed and marked «من غير عداد»;
//   * «تنفيذ الكل» with «مش عارف قراية العداد»: session pulses split → every service marked;
//   * the report card: nothing for the reception member; the manager sees the rows (device / employee / pulses), ✕ hides it.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{webcrypto,randomUUID}=require('crypto');
(async()=>{const {db,rpc,id,as}=await boot(['reception_services_packages','reception_contracts_controls']);
 const ws=await rpc('clinic_reception_bootstrap'),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),yday=new Date(Date.parse(day)-86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:ws,p_action:a,p_payload:p,p_token:t}),snapshot=()=>rpc('clinic_reception_snapshot',{p_workspace:ws,p_from:day,p_to:day});
 let s=await snapshot();const provider=s.providers[0].id,dept=s.providers[0].department,pat=s.patients[0].id;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const dev=(await cmd('device',{code:'CAND',name:'كانديلا (إزالة الشعر)',meter_kind:'shots'})).id;
 for(const [code,name,price,mins] of [['LZ-BK','ليزر كانديلا — بيكيني',190,15],['LZ-SH','ليزر كانديلا — شارب',50,5],['LZ-AX','ليزر كانديلا — تحت الإبط',140,5]]){
  await cmd('service',{code,name,department:dept,price,minutes:mins,requires_device:true,bom:[]});const ag=(await cmd('agreement',{provider_id:provider,service_code:code,rate:20,from:yday,to:'2030-01-01',reference:'AG-'+code})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);}
 await cmd('availability',{provider_id:provider,starts_at:day+'T04:00:00Z',ends_at:day+'T21:00:00Z'});s=await snapshot();const sv=c=>s.services.find(x=>x.code===c).id;
 const app=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:sv('LZ-BK'),starts_at:day+'T08:00Z',device_id:dev})).id;const visit=(await cmd('arrive',{id:app})).id;
 await cmd('order_add',{visit_id:visit,service_id:sv('LZ-SH'),provider_id:provider,quantity:1});await cmd('order_add',{visit_id:visit,service_id:sv('LZ-AX'),provider_id:provider,quantity:1});
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261127270000_execute_all.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261127300000_no_meter_pulses.sql','utf8'));
 await as(3);
 const calls=[];const dom=new JSDOM('<main id="root"></main>',{url:'https://reception.test',runScripts:'outside-only'}),w=dom.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:id(3),role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
 const wrap=p=>p.catch(e=>{const x=new Error(e.message);x.hint=e.hint;throw x;});
 w.SSMPDDb={receptionWorkspaces:()=>rpc('clinic_reception_workspaces'),receptionBootstrap:()=>rpc('clinic_reception_bootstrap'),receptionSnapshot:(p_workspace,p_from,p_to)=>rpc('clinic_reception_snapshot',{p_workspace,p_from,p_to}),receptionReport:(p_workspace,p_from,p_to)=>rpc('clinic_reception_report',{p_workspace,p_from,p_to}),
  receptionCommand:(p_workspace,p_action,p_payload,p_token)=>{calls.push([p_action,JSON.parse(JSON.stringify(p_payload))]);return wrap(rpc('clinic_reception_command',{p_workspace,p_action,p_payload,p_token}));},
  client:{rpc:(n,a)=>rpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))}};
 for(const f of ['reception-controls','reception-services','reception-look','reception-collect-once','reception-execute-all','reception-no-meter','reception-workspace'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 let ctx=null;const P=w.SSMPDReceptionModules.panel;w.SSMPDReceptionModules.panel=(sec,c)=>{ctx=c;return P(sec,c);};
 const q=s=>w.document.querySelector(s),click=s=>{assert(q(s),'missing '+s);q(s).click();},
  wait=async(f,why)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+(why||'')+': '+(q('.rx-modal')||w.document.body).textContent.slice(0,400));};
 const set=(sel,v)=>{const el=q(sel);assert(el,sel);el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));if(q('[data-guide-skip]'))click('[data-guide-skip]');
 click('[data-rx-section="operations"]');await wait(()=>ctx&&ctx.data&&ctx.data.orders,'context');
 const done=async()=>{await db.exec('reset role');const r=(await db.query("select count(*)::int n from clinic_reception.orders where visit_id=$1 and status='completed'",[visit])).rows[0].n;await as(3);return r;};
 const nm=async oid=>{await db.exec('reset role');const r=(await db.query("select no_meter,no_meter_pulses from clinic_reception.device_uses where order_id=$1",[oid])).rows[0];await as(3);return r;};
 // ---- single «تنفيذ»
 const oBK=ctx.data.orders.find(o=>o.visit_id===visit&&o.snapshot.code==='LZ-BK');
 ctx.act('execute',oBK.id);await wait(()=>q('.rx-modal [name="meter_before"]'),'execute window');
 set('.rx-modal [name="additional_confirmed"]','false');set('.rx-modal [name="device_id"]',dev);set('.rx-modal [name="minutes"]','15');
 await wait(()=>/مفيش قراية عداد متسجلة للجهاز ده/.test((q('.rx-modal [data-last-reading]')||{}).textContent||''),'no-reading hint');
 const opt=q('.rx-modal [data-no-meter-opt]');assert(opt,'«مش عارف قراية العداد» offered');opt.checked=true;opt.onchange();
 assert(q('.rx-modal [name="meter_before"]').closest('label').hidden&&q('.rx-modal [name="meter_after"]').closest('label').hidden,'«قبل / بعد» hidden');
 assert(q('.rx-modal [data-no-meter-photo]'),'optional photo field');assert(!q('.rx-modal [data-no-meter-box]').hidden);
 q('.rx-modal [type="submit"]').click();await new Promise(r=>setTimeout(r,30));
 assert([...w.document.querySelectorAll('.rx-modal [data-field-err]')].some(x=>/اكتب عدد النبضات/.test(x.textContent)),'pulses required under the field');assert(!calls.some(c=>c[0]==='execute'));
 set('.rx-modal [name="pulses"]','300');q('.rx-modal [type="submit"]').click();await wait(()=>!q('.rx-modal'),'executed');
 const sx=calls.filter(c=>c[0]==='execute').pop()[1];assert.equal(String(sx.no_meter),'true');assert.equal(String(sx.pulses),'300');assert(!('meter_before' in sx)||sx.meter_before==='','no before sent');
 let u=await nm(oBK.id);assert.equal(u.no_meter,true);assert.equal(+u.no_meter_pulses,300);
 // ---- «تنفيذ الكل» with «مش عارف قراية العداد» (2 services left on the visit)
 await ctx.load();await wait(()=>ctx.data.orders.filter(o=>o.visit_id===visit&&o.status==='ordered').length===2,'reload');
 ctx.act('visit-detail',visit);await wait(()=>q('.rx-modal [data-xall]')&&!q('.rx-modal [data-xall]').hidden,'button');click('.rx-modal [data-xall]');
 await wait(()=>q('[data-xall-modal] [data-no-meter-opt]'),'window with the option');const m=()=>q('[data-xall-modal]');
 const o2=m().querySelector('[data-no-meter-opt]');o2.checked=true;o2.onchange();assert(m().querySelector('[name="meter_before"]').closest('label').hidden,'session «قبل» hidden');
 set('[data-xall-modal] [name="session_pulses"]','100');assert.match(m().querySelector('[data-xall-split]').textContent,/من غير عداد/);
 m().querySelector('[type="submit"]').click();await wait(()=>!q('[data-xall-modal]'),'executed all');
 const sent=calls.find(c=>c[0]==='execute_many')[1];assert.equal(sent.no_meter,true);assert.equal(sent.orders.reduce((t,o)=>t+o.pulses,0),100,'session pulses split');
 for(const o of sent.orders){u=await nm(o.id);assert.equal(u.no_meter,true);}
 // ---- report card: reception → nothing; manager (admin 1) → rows, ✕ hides
 const host=q('#root');assert.equal(await w.SSMPDNoMeter.card(host,ctx),null,'reception member: no card');assert(!q('[data-no-meter-card]'));
 await as(1);const card=await w.SSMPDNoMeter.card(host,ctx);assert(card&&q('[data-no-meter-card]'),'manager card');
 assert.equal(q('[data-no-meter-card]').querySelectorAll('[data-no-meter-row]').length,3);assert.match(q('[data-no-meter-card]').textContent,/كانديلا[\s\S]*300/);
 click('[data-no-meter-card] [data-no-meter-close]');assert(!q('[data-no-meter-card]'),'✕ hides');
 assert.deepEqual(errors,[]);await db.close();console.log('PASS no-meter UI (reception member, real server functions): no-reading hint, «مش عارف قراية العداد» hides «قبل / بعد», pulses required under the field, optional photo field, executed and marked; «تنفيذ الكل» session pulses split and every service marked; report card hidden for reception, shown to the manager with the rows, ✕ hides.');
})().catch(e=>{console.error(e);process.exit(1);});
