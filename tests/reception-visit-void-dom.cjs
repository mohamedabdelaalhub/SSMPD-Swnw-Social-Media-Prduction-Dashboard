// «الزيارة اتسجلت غلط» button on the today board (20261122040000): only on a completed visit, only for collect rights, never in the sandbox;
// sends clinic_reception_visit_void_request with the reason and shows that finance must approve.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const later=new Date(Date.now()+60*60000).toISOString();
 const ap=(id,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:'مريض '+id,file_no:'F'+id,provider_id:'d1',provider_name:'د. سارة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,due_invoices:[]},extra||{});
 const model={day:'2026-11-21',settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[ap('1','completed',{visit_id:'v1'}),ap('2','waiting',{visit_id:'v2'}),ap('3','completed',{})]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[],toasts=[];let modal=null;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.includes('reception')};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args]);if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
  if(name==='clinic_reception_visit_void_request')return {data:{visit_id:'v1',pending:['r1'],replayed:false},error:null};return {data:null,error:null};}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{},modal:(t,h,save)=>{modal={t,h,save};return null;},field:(n,l)=>'<label>'+l+'<input name="'+n+'"></label>',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)];
 for(let n=0;n<200&&!q('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 const btns=qa('[data-journey-action="visit_void"]');assert.equal(btns.length,1,'only the completed visit with a visit id');assert.equal(btns[0].dataset.id,'1');assert.equal(btns[0].textContent,'الزيارة اتسجلت غلط');
 btns[0].click();await new Promise(r=>setTimeout(r,20));assert(modal,'confirm modal opened');assert.match(modal.t,/الزيارة اتسجلت غلط/);assert.match(modal.h,/المدير المالي يعتمد/);
 await modal.save({reason:'المريض ما جاش والزيارة اتسجلت بالغلط'});
 const c=calls.find(x=>x[0]==='clinic_reception_visit_void_request');assert.deepEqual([c[1].p_workspace,c[1].p_appointment,c[1].p_reason],['ws1','1','المريض ما جاش والزيارة اتسجلت بالغلط']);assert(c[1].p_token);
 assert.match(toasts.pop()[0],/مستني الاعتماد/);
 assert.deepEqual(errors,[]);console.log('PASS visit void button: completed visit only, confirm explains finance approval, sends appointment + reason + token, toast.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
