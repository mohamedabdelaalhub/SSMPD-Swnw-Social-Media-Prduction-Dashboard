// Mistaken hold→resume (≤120s): toast when the RPC returns mistaken:true, and a «بالغلط» mark in the visit timeline.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const past=new Date(Date.now()-40*60000).toISOString(),later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'عيادة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[],help_requests:[],outbox:[],appointments:[ap('1','هبة على الانتظار','on_hold',{visit_id:'v1'})],
  events:[{id:'e1',appointment_id:'1',event_type:'consultation.on_hold',event_at:new Date(Date.now()-60000).toISOString(),source:'dashboard',metadata:{mistaken:true}},{id:'e2',appointment_id:'1',event_type:'consultation.review',event_at:new Date().toISOString(),source:'dashboard',metadata:{mistaken:true}}]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push(name);if(name==='clinic_reception_journey_command')return {data:{event_id:'e2',mistaken:true},error:null};if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};return {data:null,error:{message:'unexpected '+name}};}}};
 let collected=null;const toasts=[];w.SSMPDToast={show:(m)=>toasts.push(m)};w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:(a,id)=>{if(a==='collect-invoice'){collected=id;return true;}return false;},bookingFields:()=>'',bookingWire:()=>{}};
 for(const f of ['today-operations','today-operations-unified'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{invoices:[]},modal:(t,b,save)=>{if(/^تأكيد/.test(t)){save({});return null;}const d=w.document.createElement('div');d.className='rx-modal';d.innerHTML=b+'<button type="submit"></button><button data-rx-cancel></button>';w.document.body.appendChild(d);return d;},field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 for(let n=0;n<200&&!host.querySelector('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 assert(host.querySelector('.journey-board'),'board rendered');
 host.querySelector('[data-journey-action="resume"]').click();for(let n=0;n<100&&!toasts.length;n++)await new Promise(r=>setTimeout(r,10));
 assert(toasts.includes('اتشال بالغلط — مش هيتحسب في المؤشرات'),'toast when the RPC marks it mistaken');
 host.querySelector('[data-journey-action="timeline"]').click();
 assert.equal(w.document.querySelectorAll('.journey-timeline .journey-mistaken').length,2,'both events carry the mistaken mark');
 console.log('PASS mistaken action: toast «اتشال بالغلط» + marked in the timeline.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
