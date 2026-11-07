// Single reception day board (audit item 4, part 2): one board, 4 lanes, one main button per card, finance tags, filters, search.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const past=new Date(Date.now()-40*60000).toISOString(),later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. سارة',department:'عيادة',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:0,due_invoices:[]},extra||{});
 const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[{provider_id:'d1',status:'delayed',eta_minutes:15}],help_requests:[],events:[],outbox:[],appointments:[
  ap('1','أحمد متأخر','expected',{starts_at:past}),ap('2','منى جاية','expected'),ap('3','كريم مستني','waiting',{wait_minutes:35,visit_id:'v3'}),
  ap('4','سلمى جوه','in_service',{visit_id:'v4'}),ap('5','يوسف خلص','completed',{visit_id:'v5',patient_due:150,patient_payable_total:300,due_invoices:[{id:'inv5',invoice_no:'INV-5',due:150}]}),
  ap('6','هدى دفعت','completed',{visit_id:'v6',patient_due:0,patient_payable_total:200}),ap('7','لم يحضر','no_show')]};
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
 assert.deepEqual(qa('[data-journey-lane]').map(x=>x.dataset.journeyLane),['coming','waiting','inside','done']);
 const lane=k=>qa('[data-journey-lane="'+k+'"] .journey-card').map(x=>x.querySelector('h4').textContent);
 assert.deepEqual(lane('coming'),['أحمد متأخر','منى جاية']);assert.deepEqual(lane('waiting'),['كريم مستني']);assert.deepEqual(lane('inside'),['سلمى جوه']);assert.equal(lane('done').length,3);
 for(const c of qa('.journey-card'))assert(c.querySelectorAll('.journey-card-actions > .btn').length<=1,'at most one main button per card');
 const card=id=>q('.journey-card[data-appointment="'+id+'"]'),main=id=>{const b=card(id).querySelector('.journey-card-actions > .btn');return b?b.dataset.journeyAction:undefined;};
 assert.equal(main('1'),'arrive');assert.equal(main('3'),'call');assert.equal(main('4'),'visit_complete');assert.equal(main('5'),'collect_due');assert.equal(main('6'),undefined);
 assert(card('1').querySelector('.journey-more [data-journey-action="no_show"]'),'no-show in menu');assert(card('1').querySelector('.journey-more [data-journey-v2-action="reschedule"]'),'reschedule in menu');
 assert(card('3').querySelector('.journey-more [data-journey-action="priority"]'),'priority in menu');
 assert(card('1').textContent.includes('متأخر'));assert(card('3').querySelector('.journey-wait.late'));assert(card('5').textContent.includes('عليه 150.00'));assert(card('6').textContent.includes('مدفوع'));
 const metric=k=>q('[data-journey-filter="'+k+'"] strong').textContent;
 assert.equal(metric('coming'),'2');assert.equal(metric('late'),'1');assert.equal(metric('waiting'),'1');assert.equal(metric('inside'),'1');assert.equal(metric('done'),'2');assert.equal(metric('due'),'1');
 assert(q('.journey-doctor-delayed').textContent.includes('15'));assert(q('[data-journey-action="new_booking"]'),'new booking for reception');
 q('[data-journey-filter="due"]').click();assert.equal(qa('.journey-card').length,1);q('[data-journey-filter="due"]').click();assert.equal(qa('.journey-card').length,7);
 const s=q('[data-journey-search]');s.value='0100'+'3';s.dispatchEvent(new w.Event('input'));assert.deepEqual(qa('.journey-card h4').map(x=>x.textContent),['كريم مستني']);
 q('[data-journey-action="clear_filter"]').click();assert.equal(qa('.journey-card').length,7);
 card('5').querySelector('[data-journey-action="collect_due"]').click();assert.equal(collected,'inv5');
 assert.deepEqual(errors,[]);dom.window.close();
 console.log('PASS today board: one board, 4 lanes, one main button per card, menu actions, late/wait/due/paid tags, 6 filters, search, collect hand-off.');
})().catch(e=>{console.error(e);process.exit(1);});
