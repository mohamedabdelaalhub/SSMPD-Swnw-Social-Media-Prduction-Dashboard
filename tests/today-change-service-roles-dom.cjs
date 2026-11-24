// «تغيير الخدمة» (owner 2026-11-24) is shown only to reception, only in the live workspace, only on arrived cards with a visit
// (waiting / called / in_service / on_hold) — the server's order_add / order_cancel need 'execute', which customer service lacks.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
async function board(role,sandbox){
 const later=new Date(Date.now()+60*60000).toISOString();
 const ap=(id,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:'مريض '+id,file_no:'F'+id,provider_id:'d1',provider_name:'د. تجربة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,due_invoices:[]},extra||{});
 const model={day:'2026-11-24',settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[ap('1','waiting',{visit_id:'v1'}),ap('2','called',{visit_id:'v2'}),ap('3','in_service',{visit_id:'v3'}),ap('4','on_hold',{visit_id:'v4'}),ap('5','expected',{}),ap('6','completed',{visit_id:'v6'})]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,errors=[],acts=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:()=>{}};
 w.SSMPDAuth={currentAdmin:{id:'u1',role}};w.SSMPDRoles={rolesOf:()=>[role],hasRole:(a,r)=>r===role,hasAnyRole:(a,l)=>l.includes(role)};
 w.SSMPDDb={client:{rpc:async name=>name==='clinic_reception_journey_hub_snapshot'?{data:JSON.parse(JSON.stringify(model)),error:null}:{data:null,error:null}}};
 w.SSMPDReceptionLook={_state:{}};w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:(a,id)=>{acts.push([a,id,w.SSMPDReceptionLook._state.changeHint]);return true;},bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',sandbox,data:{},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);for(let n=0;n<200&&!host.querySelector('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(errors,[]);return {ids:[...host.querySelectorAll('[data-journey-action="change_service"]')].map(b=>b.dataset.id),host,acts};
}
(async()=>{
 const r=await board('reception',false);assert.deepEqual(r.ids.sort(),['v1','v2','v3','v4'],'reception live: arrived cards only');
 r.host.querySelector('[data-journey-action="change_service"][data-id="v2"]').click();await new Promise(x=>setTimeout(x,20));
 assert.deepEqual(r.acts.pop(),['visit-detail','v2','v2'],'opens the visit window with the how-to flag');
 assert.deepEqual((await board('customer_service',false)).ids,[],'customer service: hidden (no execute on the server)');
 assert.deepEqual((await board('reception',true)).ids,[],'sandbox: hidden');
 console.log('PASS «تغيير الخدمة» visibility: reception + live + arrived cards only (not booked / completed, not customer service, not the sandbox); opens visit-detail with the how-to.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
