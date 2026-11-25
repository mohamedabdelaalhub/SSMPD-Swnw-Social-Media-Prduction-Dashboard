// Supplies at service — PR1 buttons (rule 9), as the reception role on the LIVE workspace, with the real reception modal:
//  1) today board «إنهاء الزيارة» with a missing billable supply → «كمّل الإنهاء» → «متأكد عايز تنهي؟» → journey visit_complete
//     with missing_ack; «رجوع وسجّل المستلزم» sends nothing; nothing missing → the normal confirmation.
//  2) «تعديل قبل التحصيل» shows only on a finished, unpaid card of today → clinic_reception_visit_reopen.
//  3) «مستلزمات الزيارة» → «إضافة المستلزم» → duplicate + included warnings → «متأكد، ضيفه» → add with both confirmations.
//  4) «تفاصيل الزيارة» → «إنهاء الزيارة» goes through the same guard (visit_close with missing_ack).
//  5) execute form «بدون مستلزمات (سبب)» clears the lines and makes the reason required.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const wait=(ms=20)=>new Promise(r=>setTimeout(r,ms));
function realModal(w){const src=fs.readFileSync('assets/js/reception-workspace.js','utf8'),i=src.indexOf('function modal(title,body,save,onSaved,opts)'),j=src.indexOf('return root;}',i)+'return root;}'.length;
 w.eval('var host=null;function load(){} function friendly(e){return e;} function esc(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});}'+src.slice(i,j)+';window.__modal=modal;');return w.__modal;}
const submit=async(w)=>{const f=w.document.querySelector('.rx-modal form');f.requestSubmit?f.requestSubmit():f.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await wait(40);};
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'جلدية',service_name:'ليزر',starts_at:new Date().toISOString(),queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_paid:0,patient_payable_total:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[
  ap('4','منى جوه','in_service',{visit_id:'v4'}),ap('8','سارة جوه','in_service',{visit_id:'v8'}),
  ap('5','يوسف خلص','completed',{visit_id:'v5',patient_due:585,patient_payable_total:585,due_invoices:[{id:'inv5',due:585}]}),
  ap('6','هدى دفعت جزء','completed',{visit_id:'v6',patient_due:100,patient_paid:200,patient_payable_total:300,due_invoices:[{id:'inv6',due:100}]})]};
 const missing={visit_id:'v4',employee:'منى — استقبال',total:85,missing:[{order_id:'o4',service:'ليزر نص اليدين',item_id:'crm',item:'كريم مهدئ بعد الليزر',quantity:1,value:85}]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.alert=m=>errors.push('alert '+m);
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};w.SSMPDToast={show:()=>{}};
 const lists={list:{visit:{id:'v4',status:'open'},missing:missing.missing,orders:[{id:'o4',name:'ليزر نص اليدين',status:'completed',lines:[{item_id:'gel',item:'جل تبريد',quantity:1,billed:false,by:'شروق',at:new Date().toISOString(),source:'execute'}]}],
  items:[{id:'gel',name:'جل تبريد',sale_price:20,billable:false},{id:'crm',name:'كريم مهدئ بعد الليزر',sale_price:85,billable:true}],locations:[{id:'L1',name:'فرعي مستلزمات تمريض'}]}};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,JSON.parse(JSON.stringify(args||{}))]);
  if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
  if(name==='clinic_reception_finish_check')return {data:args.p_payload.appointment_id==='8'?{missing:[],total:0}:missing,error:null};
  if(name==='clinic_reception_journey_command'||name==='clinic_reception_visit_reopen')return {data:{ok:true},error:null};
  if(name==='clinic_reception_visit_supplies'){if(args.p_action==='list')return {data:lists.list,error:null};
   if(args.p_action==='check')return {data:{duplicate:{by:'شروق',at:new Date().toISOString(),quantity:1},included:true,billable:false,unit_price:20},error:null};
   if(args.p_action==='add')return {data:{id:'a1',billable:false,amount:0},error:null};}
  return {data:null,error:{message:'unexpected '+name}};}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 for(const f of ['today-operations','today-operations-unified','reception-visit-supplies'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const modal=realModal(w),host=w.document.querySelector('#host');
 const field=(n,l,t,v,x)=>'<label>'+l+'<input name="'+n+'" type="'+(t||'text')+'" value="'+(v||'')+'" '+(x||'')+'></label>';
 const ctx={host,workspace:'ws-live',data:{workspace:{mode:'live'},invoices:[]},modal,field,select:()=>'',load:()=>{}};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s);for(let n=0;n<200&&!q('.journey-board');n++)await wait(10);assert(q('.journey-board'),'board');
 const btn=(id,act)=>q('[data-journey-action="'+act+'"][data-id="'+id+'"]');
 const M=()=>w.document.querySelector('.rx-modal');
 // 1) «إنهاء الزيارة» with the cream missing
 btn('4','visit_complete').click();await wait(40);
 assert.match(M().textContent,/فيه مستلزم ناقص على الزيارة[\s\S]*كريم مهدئ بعد الليزر[\s\S]*85\.00/);
 assert.equal(M().querySelector('[type="submit"]').textContent,'كمّل الإنهاء');assert.equal(M().querySelector('[data-rx-cancel]').textContent,'رجوع وسجّل المستلزم');
 M().querySelector('[data-rx-cancel]').click();await wait(40);assert.equal(M(),null);assert(!calls.some(c=>c[0]==='clinic_reception_journey_command'),'«رجوع» sends nothing');
 btn('4','visit_complete').click();await wait(40);await submit(w);
 assert.match(M().textContent,/متأكد عايز تنهي؟[\s\S]*تم التنبيه على منى — استقبال إن فيه مستلزم ناقص كريم مهدئ بعد الليزر قيمته 85\.00 ج واختار الإنهاء رغم ذلك/);
 await submit(w);await wait(40);
 const jc=calls.filter(c=>c[0]==='clinic_reception_journey_command');assert.equal(jc.length,1);assert.equal(jc[0][1].p_action,'visit_complete');assert.equal(jc[0][1].p_payload.missing_ack,true);assert.equal(jc[0][1].p_payload.appointment_id,'4');
 // nothing missing → the usual confirmation (no missing_ack)
 btn('8','visit_complete').click();await wait(60);assert.match(M().textContent,/تأكيد: إنهاء الزيارة/);await submit(w);await wait(40);
 const jc2=calls.filter(c=>c[0]==='clinic_reception_journey_command');assert.equal(jc2.length,2);assert.equal(jc2[1][1].p_payload.missing_ack,undefined);
 // 2) «تعديل قبل التحصيل»: unpaid finished card yes, partly paid card no
 for(let n=0;n<50&&!btn('v5','visit_reopen');n++)await wait(10);
 assert(btn('v5','visit_reopen'),'reopen on the unpaid finished card');assert.equal(btn('v6','visit_reopen'),null,'not after a payment');
 btn('v5','visit_reopen').click();await wait(30);assert.match(M().textContent,/الزيارة هترجع مفتوحة/);await submit(w);
 const ro=calls.find(c=>c[0]==='clinic_reception_visit_reopen');assert.equal(ro[1].p_visit,'v5');assert.equal(ro[1].p_workspace,'ws-live');
 // 3) «مستلزمات الزيارة» → add gel (already recorded + in the price) → «متأكد، ضيفه»
 w.SSMPDVisitSupplies.open(ctx,'v4');await wait(40);
 assert.match(M().textContent,/ناقص بيتحاسب: كريم مهدئ بعد الليزر/);assert.match(M().textContent,/جل تبريد[\s\S]*في سعر الخدمة[\s\S]*شروق/);
 const sel=(s,v)=>{const el=M().querySelector(s);el.value=v;};sel('[data-vs-item]','gel');sel('[data-vs-loc]','L1');
 M().querySelector('[data-vs-go]').click();await wait(40);
 assert.match(M().querySelector('[data-vs-confirm-box]').textContent,/متسجّل قبل كده على الخدمة: شروق[\s\S]*في سعر الخدمة/);
 assert(!calls.some(c=>c[0]==='clinic_reception_visit_supplies'&&c[1].p_action==='add'),'nothing added before the confirmation');
 M().querySelector('[data-vs-confirm]').click();await wait(40);
 const add=calls.find(c=>c[0]==='clinic_reception_visit_supplies'&&c[1].p_action==='add');
 assert.deepEqual([add[1].p_payload.item_id,add[1].p_payload.location_id,add[1].p_payload.confirm_duplicate,add[1].p_payload.confirm_included],['gel','L1',true,true]);assert(add[1].p_payload.token);
 assert.match(M().querySelector('[data-rx-status]').textContent,/اتضاف — في سعر الخدمة/);
 M().querySelector('[data-rx-cancel]').click();await wait(20);
 // 4) «تفاصيل الزيارة» → «إنهاء الزيارة» (reception-services act hook) → the same guard → visit_close with missing_ack
 const cmds=[];const c2=Object.assign({},ctx,{command:(a,p)=>{cmds.push([a,p]);return Promise.resolve({});}});
 assert.equal(w.SSMPDVisitSupplies.act('visit_close','v4',c2),true);await wait(40);await submit(w);await submit(w);await wait(20);
 const fc=calls.filter(c=>c[0]==='clinic_reception_finish_check').pop();assert.equal(fc[1].p_payload.visit_id,'v4');
 assert.deepEqual(JSON.parse(JSON.stringify(cmds[0])),['visit_close',{id:'v4',missing_ack:true,reason:''}]);
 assert.deepEqual(errors,[]);
 // 5) execute form «بدون مستلزمات (سبب)» (reception-services)
 const d2=new JSDOM('<main></main>',{url:'https://rx.test/',runScripts:'outside-only',pretendToBeVisual:true}),w2=d2.window;Object.defineProperty(w2,'crypto',{value:webcrypto});
 w2.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w2.SSMPDRoles={rolesOf:()=>['reception'],hasRole:()=>true,hasAnyRole:()=>true,canSeeTab:()=>true};
 w2.eval(fs.readFileSync('assets/js/reception-services.js','utf8'));const modal2=realModal(w2),sent=[];
 const sel2=(n,l,opts,v)=>'<label>'+l+'<select name="'+n+'">'+(opts||[]).map(o=>'<option value="'+o[0]+'"'+(o[0]===v?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></label>';
 const c3={workspace:'ws-live',data:{workspace:{mode:'live'},orders:[{id:'o9',visit_id:'v9',status:'ordered',price:500,quantity:1,provider_id:'d1',snapshot:{name:'ليزر نص اليدين',minutes:30,bom:[{item_id:'gel',quantity:1,included:true},{item_id:'crm',quantity:1,included:true}]}}],
   providers:[{id:'d1',name:'د. سارة'}],locations:[{id:'L1',name:'فرعي مستلزمات تمريض'}],devices:[],items:[{id:'gel',name:'جل تبريد',sale_price:20},{id:'crm',name:'كريم مهدئ',sale_price:85,patient_billable:true}]},
   esc:s=>String(s==null?'':s),money:n=>Number(n).toFixed(2),btn:(a,id,l)=>'<button data-rx-action="'+a+'" data-id="'+id+'">'+l+'</button>',field,select:sel2,modal:modal2,lookup:()=>'',command:(a,p)=>{sent.push([a,p]);return Promise.resolve({});},load:()=>{}};
 w2.SSMPDReceptionModules.act('execute','o9',c3);await wait(20);const R=w2.document.querySelector('.rx-modal');
 assert.match(R.textContent,/كريم مهدئ — 85\.00 — بيتحاسب على المريض/);assert.equal(R.querySelectorAll('.rx-line-editor').length,2);
 R.querySelector('[data-rx-no-supplies]').click();assert.equal(R.querySelectorAll('.rx-line-editor').length,0);
 const note=R.querySelector('[name="material_note"]');assert.equal(note.required,true);
 note.value='المريضة رفضت';R.querySelector('[name="location_id"]').value='L1';
 const f2=R.querySelector('form');f2.requestSubmit?f2.requestSubmit():f2.dispatchEvent(new w2.Event('submit',{cancelable:true,bubbles:true}));await wait(30);
 assert.equal(sent[0][0],'execute');assert.equal(JSON.stringify(sent[0][1].materials),'[]');assert.equal(sent[0][1].material_note,'المريضة رفضت');
 console.log('PASS supplies PR1 buttons (reception, live): «إنهاء الزيارة» with a missing billable supply → «كمّل الإنهاء» → «متأكد عايز تنهي؟» (note shown) → visit_complete with missing_ack; «رجوع» sends nothing; nothing missing → usual confirm; «تعديل قبل التحصيل» only on an unpaid finished card → visit_reopen; «مستلزمات الزيارة» add → duplicate + included warnings → «متأكد، ضيفه» → add with both confirmations; «تفاصيل الزيارة» close goes through the guard; execute «بدون مستلزمات (سبب)» clears the lines and requires the reason.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
