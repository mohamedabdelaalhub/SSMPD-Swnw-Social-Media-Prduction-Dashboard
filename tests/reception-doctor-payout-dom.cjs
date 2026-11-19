// Owner 2026-11-17 «صرف حساب الطبيب»: doctor strip button states, «حساب الطبيب» window (total, details, request, handover, print,
// optional receipt upload), approver badge (approve with a changed amount / reject). Server mocked; the SQL test covers the rules.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const tick=ms=>new Promise(r=>setTimeout(r,ms||30));
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ap=(id,prov,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:'مريض '+id,provider_id:prov,provider_name:prov==='d1'?'د. رامي':'د. سارة',service_name:'كشف',starts_at:new Date().toISOString(),queue_status:q,priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,patient_payable_total:300,due_invoices:[]},extra||{});
 const model={day,settings:{},can_view_finance:true,doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[
  ap('1','d1','completed',{visit_id:'v1'}),ap('2','d1','completed',{visit_id:'v2'}),        // d1: done and paid → «صرف الحساب»
  ap('3','d2','completed',{visit_id:'v3'}),ap('4','d2','waiting',{visit_id:'v4'})]};        // d2: still has a patient → nothing
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],calls=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));w.confirm=()=>true;
 let printed='';w.open=()=>({document:{write:h=>{printed+=h;},close(){}}});
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 const S={state:'ready',payable:500,held:0,paid_today:0,pending:null,approved:null,payouts:[]},inv=[{invoice_id:'i1',reference:'B-1',description:'كشف',amount:600,fee:300,created_at:new Date().toISOString()},{invoice_id:'i2',reference:'B-2',description:'كشف',amount:400,fee:200,created_at:new Date().toISOString()}];
 let isApprover=false,pend=[],uploaded=[];
 const row=()=>Object.assign({provider_id:'d1',name:'د. رامي',linked:true,doctor_key:'DOC-R'},S);
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args&&args.p_action,args&&args.p_payload]);
  if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
  if(name!=='clinic_reception_doctor_payout')return {data:null,error:{message:'unexpected '+name}};
  const a=args.p_action,p=args.p_payload;
  if(a==='board')return {data:{approver:isApprover,doctors:[row(),{provider_id:'d2',name:'د. سارة',linked:true,state:'ready',payable:100}]},error:null};
  if(a==='detail')return {data:Object.assign(row(),{invoices:S.state==='ready'?inv:[],payouts:S.payouts}),error:null};
  if(a==='request'){const q={id:'q1',status:'pending',gross:500,requested_by:'Rec',created_at:new Date().toISOString(),invoices:inv,doctor_name:'د. رامي',reference:'صرف استقبال — د. رامي'};S.state='pending';S.pending={id:'q1',gross:500};S.payouts=[q];S.payable=0;pend=[q];return {data:q,error:null};}
  if(a==='pending_list')return {data:{approver:isApprover,items:pend},error:null};
  if(a==='approve'){if(p.gross&&!p.note)return {data:null,error:{message:'اكتب سبب تعديل المبلغ'}};Object.assign(S.payouts[0],{status:'approved',gross:p.gross||500,reviewed_by:'المدير المالي',reviewed_at:new Date().toISOString(),adjust_note:p.gross?p.note:null});S.state='approved';S.pending=null;S.approved={id:'q1'};pend=[];return {data:S.payouts[0],error:null};}
  if(a==='handover'){S.payouts[0].handed_at=new Date().toISOString();S.state='paid';S.approved=null;S.paid_today=S.payouts[0].gross;return {data:S.payouts[0],error:null};}
  if(a==='receipt'){S.payouts[0].receipt_path=p.path;uploaded.push(p.path);return {data:S.payouts[0],error:null};}
  return {data:null,error:{message:'?'}};},
  storage:{from:b=>({upload:async(path)=>{uploaded.push(b+':'+path);return {data:{},error:null};},createSignedUrl:async()=>({data:{signedUrl:'about:blank'},error:null})})}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 for(const f of ['swnw-print','today-operations','today-operations-unified','reception-doctor-payout'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{},modal:()=>null,field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>w.document.querySelector(s);
 for(let n=0;n<200&&!q('[data-doctor-pay="d1"] .dp-pill');n++)await tick(10);
 const pill=id=>q('[data-doctor-pay="'+id+'"] .dp-pill');
 assert(pill('d1'),'button next to the finished doctor');assert.equal(pill('d1').textContent,'صرف الحساب');assert(pill('d1').classList.contains('is-due'),'orange');
 assert.equal(pill('d2'),null,'doctor with a patient left: no button yet');
 assert.equal(q('[data-doctor-pay-workspace]').getAttribute('data-doctor-pay-workspace'),'ws1');
 // «حساب الطبيب»: total + details + request (no amount input for reception)
 pill('d1').click();await tick(40);
 assert(/حساب الطبيب — د. رامي/.test(q('[data-dp-modal] h2').textContent));assert(/500/.test(q('.dp-total strong').textContent));
 assert.equal(q('[data-dp-modal] .dp-details summary').textContent,'التفاصيل (2 حالة)');assert.equal(q('[data-dp-modal] .dp-table tbody').children.length,2);
 assert.equal(q('[data-dp-modal] input[type=number]'),null,'reception cannot type the amount');
 q('[data-dp-request]').click();await tick(60);
 const req=calls.find(c=>c[1]==='request');assert.equal(req[2].provider_id,'d1');assert.equal(req[2].gross,undefined,'no amount sent');
 assert(/معلّق/.test(q('.dp-total small').textContent));assert.equal(pill('d1').textContent,'معلّق','strip shows pending');
 q('.dp-x').click();
 // approver: floating badge → approve with a changed amount (reason needed)
 isApprover=true;w.SSMPDDoctorPayout._poll();await tick(40);
 assert(q('[data-dp-badge]'),'badge for approvers');assert(/1/.test(q('[data-dp-badge] b').textContent));
 q('[data-dp-badge]').click();await tick(40);
 const card=q('[data-dp-item="q1"]');card.querySelector('[data-dp-gross]').value='450';card.querySelector('[data-dp-approve]').click();await tick(40);
 assert(calls.some(c=>c[1]==='approve'&&c[2].gross===450&&c[2].note===''),'sent the changed amount');
 card.querySelector('[data-dp-note]').value='خصم سلفة';card.querySelector('[data-dp-approve]').click();await tick(60);
 assert(calls.some(c=>c[1]==='approve'&&c[2].note==='خصم سلفة'));assert.equal(q('[data-dp-badge]'),null,'badge gone when nothing pending');
 q('.dp-x').click();isApprover=false;w.SSMPDDoctorPayout.refresh();await tick(60);
 assert.equal(pill('d1').textContent,'سلّم الحساب');
 // reception: print the receipt, hand over → «تم الصرف», optional receipt upload later
 pill('d1').click();await tick(40);
 q('[data-dp-modal] [data-dp-print]').click();assert(/إيصال استلام مستحقات طبيب/.test(printed)&&/450/.test(printed)&&/توقيع الطبيب/.test(printed)&&/swnw-official-letterhead/.test(printed),'printable receipt on the letterhead (owner 2026-11-19)');
 q('[data-dp-hand]').click();await tick(60);
 assert.equal(pill('d1').textContent,'✓ تم الصرف');assert(pill('d1').classList.contains('is-paid'),'green');
 const file=new w.File(['x'],'r.jpg',{type:'image/jpeg'}),inp=q('[data-dp-upload]');assert(inp,'upload offered after handover');
 Object.defineProperty(inp,'files',{value:[file]});inp.dispatchEvent(new w.Event('change'));await tick(60);
 assert(uploaded.some(u=>/^doctor-payout-receipts:q1\/receipt-\d+\.jpg$/.test(u)),'uploaded to the private bucket under the payout id');assert(calls.some(c=>c[1]==='receipt'));
 assert(q('[data-dp-view]'),'view the signed receipt');
 // partial state label
 S.state='partial';w.SSMPDDoctorPayout.refresh();await tick(60);assert.equal(pill('d1').textContent,'صرف جزئي');assert(pill('d1').classList.contains('is-due'));
 assert.equal(errors.length,0,errors.join('|'));
 console.log('PASS doctor payout UI: strip button after the doctor finishes, account window (total/details, no amount input), pending, approver badge (change with reason), print receipt, handover → تم الصرف, optional upload, partial.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
