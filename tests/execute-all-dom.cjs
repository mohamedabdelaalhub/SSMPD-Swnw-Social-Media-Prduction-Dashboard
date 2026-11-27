// «تنفيذ الكل» + clear «تنفيذ» checks (mig 20261127270000, help 331) — the real reception screen + the real server functions (PGlite),
// as a RECEPTION member with the execute capability (rules 9 / 10):
//   * single «تنفيذ» on a laser service with the counter device and empty readings → the message sits under the empty field, nothing sent;
//   * «تفاصيل الزيارة» shows «✓ تنفيذ الكل (3)» (hidden for a member without execute) → ONE window: session once, split shown, ✕ closes;
//     «✓ نفّذ 3 خدمات» → the 3 services executed with chained counter rows; an empty session counter is caught under the field first.
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
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261127270000_execute_all.sql','utf8'));
 await as(3);
 const calls=[];const dom=new JSDOM('<main id="root"></main>',{url:'https://reception.test',runScripts:'outside-only'}),w=dom.window,errors=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:id(3),role:'reception'}};w.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
 const wrap=p=>p.catch(e=>{const x=new Error(e.message);x.hint=e.hint;throw x;});
 w.SSMPDDb={receptionWorkspaces:()=>rpc('clinic_reception_workspaces'),receptionBootstrap:()=>rpc('clinic_reception_bootstrap'),receptionSnapshot:(p_workspace,p_from,p_to)=>rpc('clinic_reception_snapshot',{p_workspace,p_from,p_to}),receptionReport:(p_workspace,p_from,p_to)=>rpc('clinic_reception_report',{p_workspace,p_from,p_to}),
  receptionCommand:(p_workspace,p_action,p_payload,p_token)=>{calls.push([p_action,JSON.parse(JSON.stringify(p_payload))]);return wrap(rpc('clinic_reception_command',{p_workspace,p_action,p_payload,p_token}));},
  client:{rpc:(n,a)=>rpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))}};
 for(const f of ['reception-controls','reception-services','reception-look','reception-collect-once','reception-execute-all','reception-workspace'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 let ctx=null;const P=w.SSMPDReceptionModules.panel;w.SSMPDReceptionModules.panel=(sec,c)=>{ctx=c;return P(sec,c);};
 const q=s=>w.document.querySelector(s),click=s=>{assert(q(s),'missing '+s);q(s).click();},
  wait=async(f,why)=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+(why||'')+': '+(q('.rx-modal')||w.document.body).textContent.slice(0,400));};
 const set=(sel,v)=>{const el=q(sel);assert(el,sel);el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 w.SSMPDReception.render(q('#root'));await wait(()=>q('[data-rx-section]'));if(q('[data-guide-skip]'))click('[data-guide-skip]');
 click('[data-rx-section="operations"]');await wait(()=>ctx&&ctx.data&&ctx.data.orders,'context');
 const done=async()=>{await db.exec('reset role');const r=(await db.query("select count(*)::int n from clinic_reception.orders where visit_id=$1 and status='completed'",[visit])).rows[0].n;await as(3);return r;};
 // ---- single «تنفيذ»: empty counter → message under the field, nothing sent
 const oBK=ctx.data.orders.find(o=>o.visit_id===visit&&o.snapshot.code==='LZ-BK');
 ctx.act('execute',oBK.id);await wait(()=>q('.rx-modal [name="meter_before"]'),'execute window');
 set('.rx-modal [name="additional_confirmed"]','false');set('.rx-modal [name="device_id"]',dev);set('.rx-modal [name="minutes"]','15');
 q('.rx-modal [type="submit"]').click();await new Promise(r=>setTimeout(r,30));
 const errs=[...w.document.querySelectorAll('.rx-modal [data-field-err]')].map(x=>x.textContent);
 assert(errs.includes('اكتب قراءة العداد قبل وبعد'),'message under the empty counter: '+errs.join(' | '));
 assert(!calls.some(c=>c[0]==='execute'),'nothing sent');assert(!/راجع القيمة والوحدة والدقة/.test(q('.rx-modal').textContent));
 {const lr=q('.rx-modal [data-last-reading]');assert(lr.hidden||/مفيش قراية عداد متسجلة/.test(lr.textContent),'no reading yet on this device (20261127300000 shows the «مش عارف قراية العداد» hint)');}
 set('.rx-modal [name="meter_before"]','500');set('.rx-modal [name="meter_after"]','400');q('.rx-modal [type="submit"]').click();await new Promise(r=>setTimeout(r,30));
 assert(/قراءة بعد لازم تبقى أكبر من قراءة قبل/.test(q('.rx-modal').textContent));assert(!calls.some(c=>c[0]==='execute'));
 click('.rx-modal .modal-close');assert(!q('.rx-modal'),'✕ closes');
 // ---- «تفاصيل الزيارة» → «✓ تنفيذ الكل (3)»
 ctx.act('visit-detail',visit);await wait(()=>q('.rx-modal [data-xall]'),'button');await wait(()=>!q('.rx-modal [data-xall]').hidden,'button shown for execute capability');
 assert.match(q('.rx-modal [data-xall]').textContent,/تنفيذ الكل \(3\)/);
 assert.equal(w.document.querySelectorAll('.rx-modal [data-rx-action="execute"]').length,3,'every single «تنفيذ» stays');
 click('.rx-modal [data-xall]');await wait(()=>q('.rx-modal [data-xall-modal]')||q('[data-xall-modal]'),'window');
 const m=()=>q('[data-xall-modal]');assert.equal(m().querySelectorAll('[data-xall-on]:checked').length,3);
 assert.equal(m().querySelector('[name="device_id"]').value,dev,'device from the booking');assert.equal(m().querySelector('[name="minutes"]').value,'25','standard minutes total');
 // empty session counter → caught under the field
 m().querySelector('[type="submit"]').click();await new Promise(r=>setTimeout(r,40));
 assert([...m().querySelectorAll('[data-field-err]')].some(x=>x.textContent==='اكتب قراءة العداد قبل وبعد'));assert(!calls.some(c=>c[0]==='execute_many'));
 set('[data-xall-modal] [name="meter_before"]','1000');set('[data-xall-modal] [name="meter_after"]','1500');
 assert.match(m().querySelector('[data-xall-split]').textContent,/1,000 → 1,300/,'split shown (15/25 of 500)');
 m().querySelector('[type="submit"]').click();await wait(()=>!q('[data-xall-modal]'),'executed');
 const sent=calls.find(c=>c[0]==='execute_many')[1];assert.equal(sent.orders.length,3);assert.equal(sent.visit_id,visit);
 assert.deepEqual(sent.orders.map(o=>[o.minutes,o.meter_before,o.meter_after]),[[15,1000,1300],[5,1300,1400],[5,1400,1500]]);
 assert.equal(await done(),3,'3 services executed');
 // ---- «آخر قراءة» (any employee) prefills «قراءة قبل», and «عدد النبضات» instead of «من / إلى»
 await as(1);const ap3=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:sv('LZ-SH'),starts_at:day+'T14:00Z',device_id:dev})).id;const v3=(await cmd('arrive',{id:ap3})).id;await as(3);
 await ctx.load();await wait(()=>ctx.data.orders.some(o=>o.visit_id===v3),'reload3');const o3=ctx.data.orders.find(o=>o.visit_id===v3&&o.status==='ordered');
 ctx.act('execute',o3.id);await wait(()=>q('.rx-modal [name="meter_before"]'),'execute window 2');
 set('.rx-modal [name="additional_confirmed"]','false');set('.rx-modal [name="device_id"]',dev);await wait(()=>q('.rx-modal [name="meter_before"]').value==='1500','prefilled from the last reading');
 assert.match(q('.rx-modal [data-last-reading]').textContent,/آخر قراءة على الجهاز ده: 1,500/);
 set('.rx-modal [name="meter_before"]','1520');assert.match(q('.rx-modal [data-last-reading]').textContent,/فيه فجوة 20/);
 set('.rx-modal [name="meter_before"]','1490');assert.match(q('.rx-modal [data-last-reading]').textContent,/تداخل: أقل من آخر قراءة بـ 10/);
 set('.rx-modal [name="meter_before"]','1500');
 const cnt=q('.rx-modal [data-meter-mode] input[value="count"]');cnt.checked=true;cnt.onchange();assert(q('.rx-modal [name="meter_after"]').closest('label').hidden,'«إلى» hidden in count mode');
 set('.rx-modal [name="minutes"]','5');q('.rx-modal [type="submit"]').click();await new Promise(r=>setTimeout(r,30));
 assert([...w.document.querySelectorAll('.rx-modal [data-field-err]')].some(x=>/اكتب عدد النبضات/.test(x.textContent)),'count required');
 set('.rx-modal [name="pulses"]','120');q('.rx-modal [type="submit"]').click();await wait(()=>!q('.rx-modal'),'executed by count');
 const sx=calls.filter(c=>c[0]==='execute').pop()[1];assert.equal(String(sx.pulses),'120');assert.equal(String(sx.meter_before),'1500');
 await db.exec('reset role');const u3=(await db.query("select meter_before,meter_after from clinic_reception.device_uses where order_id=$1",[o3.id])).rows[0];await as(3);
 assert.deepEqual([+u3.meter_before,+u3.meter_after],[1500,1620],'stored as before / after');
 // ---- a member without execute: no button
 await db.exec('reset role');await db.query("update clinic_reception.members set capabilities=$2 where workspace_id=$1 and admin_id=$3",[ws,['view','book'],id(3)]);await as(3);
 w.SSMPDExecuteAll._t.reset();const ap2=(await (async()=>{await as(1);const a=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:sv('LZ-SH'),starts_at:day+'T12:00Z',device_id:dev})).id;const v2=(await cmd('arrive',{id:a})).id;await cmd('order_add',{visit_id:v2,service_id:sv('LZ-AX'),provider_id:provider,quantity:1});await as(3);return v2;})());
 await ctx.load();await wait(()=>ctx.data.orders.some(o=>o.visit_id===ap2),'reload');
 ctx.act('visit-detail',ap2);await wait(()=>q('.rx-modal [data-xall]'),'button2');await new Promise(r=>setTimeout(r,80));assert.equal(q('.rx-modal [data-xall]').hidden,true,'hidden without execute');
 click('.rx-modal .modal-close');
 assert.deepEqual(errors,[]);await db.close();console.log('PASS execute all UI (reception member, real server functions): single «تنفيذ» shows «اكتب قراءة العداد قبل وبعد» / «قراءة بعد لازم تبقى أكبر» under the field, nothing sent; «تنفيذ الكل (3)» for execute capability only, every «تنفيذ» stays, one window with booking device + standard minutes, empty counter caught, split shown, 3 executed with chained counter, ✕ closes; «آخر قراءة» prefills «قراءة قبل» with gap / overlap note, «عدد النبضات» mode stores before / after.');
})().catch(e=>{console.error(e);process.exit(1);});
