// Owner 2026-11-17: orange «التحصيل» next to a finished patient with money due → collect screen; green «تم التحصيل» once paid.
// Fixture from the single reception day board test (audit item 4, part 2): one board, patients by hour, chip strip with «الكل», one main button per card, finance tags, filters, search.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const past=new Date(Date.now()-40*60000).toISOString(),later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'عيادة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[{provider_id:'d1',status:'delayed',eta_minutes:15}],help_requests:[],events:[],outbox:[],appointments:[
  ap('1','أحمد متأخر','expected',{starts_at:past}),ap('2','منى جاية','expected',{booking_source:'whatsapp'}),ap('3','كريم مستني','waiting',{wait_minutes:35,visit_id:'v3'}),
  ap('4','سلمى جوه','in_service',{visit_id:'v4'}),ap('5','يوسف خلص','completed',{visit_id:'v5',patient_due:150,patient_payable_total:300,due_invoices:[{id:'inv5',invoice_no:'INV-5',due:150}]}),
  ap('6','هدى دفعت','completed',{visit_id:'v6',patient_due:0,patient_payable_total:200}),ap('7','لم يحضر','no_show'),ap('8','سامي دفع جزء','completed',{visit_id:'v8',patient_due:100,patient_paid:200,patient_payable_total:300,due_invoices:[{id:'inv8',invoice_no:'INV-8',due:100}]})]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only'}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push(name);if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};return {data:null,error:{message:'unexpected '+name}};}}};
 let collected=null;w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:(a,id)=>{if(a==='collect-invoice'){collected=id;return true;}return false;},bookingFields:()=>'',bookingWire:()=>{}};
 for(const f of ['today-operations','today-operations-unified'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{invoices:[{id:'inv5'}]},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)];
 for(let n=0;n<200&&!q('.journey-board');n++)await new Promise(r=>setTimeout(r,10));
 assert(q('.journey-board'),'board rendered');assert.equal(calls[0],'clinic_reception_journey_hub_snapshot');
 assert.equal(w.document.querySelectorAll('[data-unified-hub]').length,0,'no second board');
 // owner 2026-11-17 redesign: patients grouped by hour (time order), one chip strip with «الكل», compact sticky top

 const card=id=>q('[data-appointment="'+id+'"]');
 const due=card('5').querySelector('.journey-pay');assert(due&&due.matches('button.journey-pay-due'),'orange collect button on the finished patient with money due');
 assert.equal(due.textContent,'التحصيل');assert(!due.closest('.journey-card-detail'),'visible without opening the card');
 assert.equal(card('6').querySelector('.journey-pay').textContent,'✓ تم التحصيل');assert(card('6').querySelector('.journey-pay-done'));
 assert.equal(card('8').querySelector('.journey-pay-due').textContent,'دفع جزئي','partial payment label');assert(/الباقي/.test(card('8').querySelector('.journey-pay-due').title));
 for(const k of ['1','2','3','4','7'])assert.equal(card(k).querySelector('.journey-pay'),null,'no pay pill before the visit ends ('+k+')');
 due.click();await new Promise(r=>setTimeout(r,20));assert.equal(collected,'inv5','opens the collect screen for that invoice');
 const css=fs.readFileSync('assets/css/today-operations.css','utf8');assert(/\.journey-pay-due\{[^}]*#F15A22/.test(css)&&/\.journey-pay-done\{[^}]*#2F7D5C/.test(css),'orange / green colours');
 assert.equal(errors.length,0,errors.join('|'));
 console.log('PASS collect pill: orange «التحصيل» on finished patients with money due opens the collect screen; green «تم التحصيل» when paid; none before the visit ends.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
