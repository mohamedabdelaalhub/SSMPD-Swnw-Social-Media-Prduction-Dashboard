// Clinical drafts UI (mocked RPC, no real data): nurse form, doctor review panel, doctor section, nursing hook.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SRC=fs.readFileSync('assets/js/clinical-drafts.js','utf8'),NURS=fs.readFileSync('assets/js/nursing-day-ops.js','utf8');
const NOW=new Date().toISOString();
function mk(opts){opts=opts||{};const d=new JSDOM('<body><div id="h"></div></body>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,calls=[];
 w.scrollTo=()=>{};w.__t=[];w.SSMPDToast={show:(m,k)=>{w.__t.push([m,k]);}};
 w.SSMPDRoles={hasAnyRole:(a,l)=>(a.roles||[]).some(r=>l.includes(r))};w.SSMPDAuth={currentAdmin:{roles:opts.roles||['nursing']}};
 const rpc=async(name,args)=>{calls.push(JSON.parse(JSON.stringify([name,args.p_action,args.p_payload||null])));const a=args.p_action;
  if(name==='clinical_drafts'){
   if(a==='list_mine')return {data:{drafts:opts.mine||[]},error:null};
   if(a==='list_review')return {data:{drafts:opts.review||[]},error:null};
   if(a==='get')return {data:opts.get||null,error:null};
   if(a==='save')return {data:{ok:true,id:'d1',status:args.p_payload.submit?'pending_review':'draft',revision:1},error:null};
   return {data:{ok:true,status:a==='approve'?'approved':'returned'},error:null};}
  if(a==='day')return {data:{date:'2026-11-20',my_section:'dental',sections:['dental','physio'],appointments:[{id:'a1',starts_at:NOW,section:'dental',patient_name:'مريض',file_no:'P-1',archive_patient_id:'ar1',service:'حشو',doctor:'د. أ',status:'booked',triage:'none',prep:[]},{id:'a2',starts_at:NOW,section:'physio',patient_name:'مريض ٢',file_no:'P-2',archive_patient_id:'ar2',service:'جلسة',status:'booked',triage:'none',prep:[]}]},error:null};
  if(a==='notifications')return {data:{unread:1,items:[{id:'n1',kind:'draft_returned',title:'مسودتك (أسنان) رجعت للتعديل',appointment_id:'a1',archive_patient_id:'ar1',created_at:NOW,read:false}]},error:null};
  if(a==='settings_get')return {data:{nurses:[]},error:null};
  if(a==='unlinked_doctors')return {data:{doctors:[{provider_id:'p1',name:'د. غير مربوط',department:'أسنان',section:'dental'}]},error:null};
  return {data:{ok:true},error:null};};
 w.SSMPDDb={client:{rpc}};w.SSMPDReceptionModules={sections:()=>[['journey','x','y']],panel:()=>'<p>j</p>'};
 w.eval(SRC);return {w,calls};}
const live={workspace:'w1',data:{workspace:{mode:'live'}}};
(async()=>{
 // ---- dental form
 { const {w,calls}=mk();const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
  const fire=(el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
  await w.SWNWClinicalDrafts.open({kind:'dental',appointmentId:'a1',patientId:'ar1',patientLabel:'مريض'});
  assert(q('[data-cd-modal]'));assert(q('.cd-box').textContent.includes('مسودة الجلسة — مساعدة أسنان'));assert(q('[data-cd-status]').textContent==='مسودة');
  assert(q('.cd-box').textContent.includes('لحد ما الدكتور يعتمد، النص مش بيدخل الملف الرسمي'));
  assert(!q('[data-cf="material"]')&&!q('[data-cf="extraction_site"]'));
  assert.equal(qa('optgroup').length,2);assert.equal(qa('optgroup')[0].children.length,12);assert.equal(qa('optgroup')[1].children.length,8);
  q('[data-cf="tooth"]').value='36 — سفلي أيمن';
  const sel=q('[data-cf="procedure"]');sel.value='root_canal';fire(sel,'change');assert(q('[data-cf="material"]'),'material with root canal');assert(!q('[data-cf="extraction_site"]'));
  q('[data-cf="material"]').value='MTA';
  q('[data-cf="procedure"]').value='space_maintainer';fire(q('[data-cf="procedure"]'),'change');
  assert(q('[data-cf="extraction_site"]'),'site with space maintainer');assert(!q('[data-cf="material"]'));assert(q('[data-cf="pediatric"]').checked,'kids auto-on');
  q('[data-cf="extraction_site"]').value='سفلي أيسر';
  q('[data-cf="procedure"]').value='xray';fire(q('[data-cf="procedure"]'),'change');assert(q('[data-cf="radiograph_needed"]').checked&&q('.cd-tag'));
  q('[data-cf="procedure"]').value='root_canal';fire(q('[data-cf="procedure"]'),'change');q('[data-cf="material"]').value='MTA';q('[data-cf="notes"]').value='ملاحظة';q('[data-cf="plan"]').value='خطة';
  q('[data-cd="save"]').click();q('[data-cd="save"]')&&0;for(let i=0;i<50&&!calls.some(c=>c[1]==='save');i++)await sleep(10);
  let p=calls.find(c=>c[1]==='save')[2];assert.equal(p.submit,false);assert.equal(p.kind,'dental');assert.equal(p.patient_id,'ar1');assert.equal(p.appointment_id,'a1');
  assert.deepEqual(p.content,{tooth:'36 — سفلي أيمن',procedure:'root_canal',procedure_label:'حشو عصب',pediatric:true,material:'MTA',extraction_site:'',radiograph_needed:true,notes:'ملاحظة',plan:'خطة'});
  await sleep(30);assert(w.__t.some(t=>t[0]==='اتحفظت المسودة'));
  q('[data-cd="send"]').click();for(let i=0;i<50&&calls.filter(c=>c[1]==='save').length<2;i++)await sleep(10);
  const p2=calls.filter(c=>c[1]==='save')[1][2];assert.equal(p2.submit,true);assert.equal(p2.id,'d1');await sleep(30);assert(!q('[data-cd-modal]'),'closed after send');w.close(); }
 // ---- physio form
 { const {w,calls}=mk();const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
  await w.SWNWClinicalDrafts.open({kind:'physio',appointmentId:'a2',patientId:'ar2'});assert(q('.cd-box').textContent.includes('ممرضة علاج طبيعي'));assert(!q('[data-cf="procedure"]'));assert.equal(qa('[data-cd="treat"]').length,10);
  q('[data-cf="area"]').value='الركبة';qa('[data-cd="treat"]')[0].click();qa('[data-cd="treat"]')[6].click();q('[data-cf="duration"]').value='30';q('[data-cd="save"]').click();
  for(let i=0;i<50&&!calls.some(c=>c[1]==='save');i++)await sleep(10);assert.deepEqual(calls.find(c=>c[1]==='save')[2].content,{area:'الركبة',treatments:['Cryo','Laser'],duration:'30',notes:''});w.close(); }
 // ---- pending read-only; returned reason; reuse; no case doctor
 { const {w}=mk({mine:[{id:'d9',kind:'dental',status:'pending_review',patient_id:'ar1',appointment_id:'a1',content:{tooth:'11',procedure:'exam'},no_case_doctor:true}]});const q=s=>w.document.querySelector(s);
  await w.SWNWClinicalDrafts.open({kind:'dental',appointmentId:'a1',patientId:'ar1'});assert(q('[data-cd-status]').textContent==='مسودة — بانتظار اعتماد الدكتور');
  assert(q('[data-cf="tooth"]').disabled&&q('[data-cf="tooth"]').value==='11');assert(q('[data-cd="save"]').disabled&&q('[data-cd="send"]').disabled);assert(q('[data-cd-nocase]').textContent.includes('الدكتور ده مالوش حساب مربوط'));w.close(); }
 { const {w,calls}=mk({mine:[{id:'d8',kind:'dental',status:'returned',patient_id:'ar1',appointment_id:'a1',content:{tooth:'12',procedure:'filling'},return_reason:'ناقص الأشعة'}]});const q=s=>w.document.querySelector(s);
  await w.SWNWClinicalDrafts.open({kind:'dental',appointmentId:'a1',patientId:'ar1'});assert(q('[data-cd-status]').textContent==='رجعت للتعديل');assert(q('[data-cd-return]').textContent.includes('ناقص الأشعة'));assert(!q('[data-cf="tooth"]').disabled);
  q('[data-cd="send"]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='save');i++)await sleep(10);assert.equal(calls.find(c=>c[1]==='save')[2].id,'d8');w.close(); }
 // ---- review panel
 const GET={draft:{id:'r1',kind:'dental',status:'pending_review',patient_id:'ar1',patient_name:'مريض س',author:'مساعدة',can_review:true,no_case_doctor:true,content:{tooth:'36',procedure:'filling',procedure_label:'حشو',pediatric:false,notes:'ن',plan:'خ'}},log:[{action:'create',actor:'مساعدة',at:NOW},{action:'submit',actor:'مساعدة',at:NOW}]};
 { const {w,calls}=mk({roles:['sono_doctor'],get:GET});const q=s=>w.document.querySelector(s);
  await w.SWNWClinicalDrafts.openDraft('r1');assert(q('[data-cd-decide]'));assert(q('[data-cf="tooth"]').disabled);assert(q('[data-cd-nocase]'));assert(q('[data-cd-log]').textContent.includes('كتبه: مساعدة'));
  q('[data-cd="return"]').click();await sleep(20);assert(!calls.some(c=>c[1]==='return'),'return blocked without reason');assert(w.__t.some(t=>t[0]==='اكتب سبب الرجوع للتعديل'));
  q('[data-cd-reason]').value='عدّل السن';q('[data-cd="return"]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='return');i++)await sleep(10);
  assert.deepEqual(calls.find(c=>c[1]==='return')[2],{id:'r1',reason:'عدّل السن'});w.close(); }
 { const {w,calls}=mk({roles:['sono_doctor'],get:GET});const q=s=>w.document.querySelector(s);
  await w.SWNWClinicalDrafts.openDraft('r1');q('[data-cd="approve"]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='approve');i++)await sleep(10);
  assert.deepEqual(calls.find(c=>c[1]==='approve')[2],{id:'r1'});w.close(); }
 { const G2=JSON.parse(JSON.stringify(GET));const {w,calls}=mk({roles:['sono_doctor'],get:GET});const q=s=>w.document.querySelector(s);
  await w.SWNWClinicalDrafts.openDraft('r1');q('[data-cd="edit"]').click();assert(!q('[data-cf="plan"]').disabled);q('[data-cf="plan"]').value='خطة جديدة';
  GET.draft.status='approved';GET.draft.content.plan='خطة جديدة';GET.log=GET.log.concat([{action:'edit_by_doctor',actor:'د. ف',changed_fields:['plan'],at:NOW},{action:'approve',actor:'د. ف',at:NOW}]);
  q('[data-cd="approve_edit"]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='approve');i++)await sleep(10);
  const p=calls.find(c=>c[1]==='approve')[2];assert.equal(p.id,'r1');assert.equal(p.content.plan,'خطة جديدة');assert.equal(p.content.procedure,'filling');
  await sleep(50);assert(q('[data-cd-decide]').textContent.includes('معتمد ومقفول'));assert(!q('[data-cd="approve"]')&&!q('[data-cd="return"]'));
  assert(q('[data-cd-log]').textContent.includes('راجعه: د. ف · عدّل خانة (الخطة)')&&q('[data-cd-log]').textContent.includes('اعتمد: د. ف'));w.close(); }
 // ---- doctor section
 { const rv=[{id:'r1',kind:'dental',status:'pending_review',patient_id:'ar1',patient_name:'مريض س',author:'مساعدة',submitted_at:NOW,content:{}},{id:'r2',kind:'physio',patient_name:'مريض ص',author:'ممرضة',submitted_at:NOW,content:{}}];
  const {w,calls}=mk({roles:['sono_doctor'],review:rv,get:GET});const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
  const M=()=>w.SSMPDReceptionModules;const rows=M().sections(live);assert(rows.some(r=>r[0]==='clinical-drafts'&&r[1].includes('مسودات للمراجعة')));
  q('#h').innerHTML=M().panel('clinical-drafts',live);for(let i=0;i<50&&!q('.cd-row');i++)await sleep(10);
  assert.equal(qa('.cd-row').length,2);assert(q('.cd-row').textContent.includes('مريض س')&&q('.cd-row').textContent.includes('مساعدة'));assert.equal(q('.cd-badge').textContent,'2');
  q('.cd-row').click();for(let i=0;i<50&&!q('[data-cd-modal]');i++)await sleep(10);assert(calls.some(c=>c[1]==='get'&&c[2].id==='r1'));assert(q('[data-cd-decide]'));w.close();
  const e=mk({roles:['sono_doctor'],review:[]});e.w.document.querySelector('#h').innerHTML=e.w.SSMPDReceptionModules.panel('clinical-drafts',live);await sleep(60);assert(e.w.document.querySelector('#h').textContent.includes('مفيش مسودات مستنية مراجعتك'));e.w.close();
  const n=mk({roles:['nursing']});assert(!n.w.SSMPDReceptionModules.sections(live).some(r=>r[0]==='clinical-drafts'),'hidden from nurses');n.w.close(); }
 // ---- nursing hook
 { const {w,calls}=mk({settings:true});const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
  w.eval(NURS);q('#h').innerHTML=w.SSMPDReceptionModules.panel('nursing',live);for(let i=0;i<100&&!q('[data-nd-card]');i++)await sleep(10);
  const b=q('[data-nd="draft"]');assert(b&&b.textContent==='مسودة جلسة الأسنان');
  for(let i=0;i<50&&!q('[data-nd-unlinked]');i++)await sleep(10);assert(q('[data-nd-unlinked]').textContent.includes('دكاترة أسنان وعلاج طبيعي من غير حساب مربوط')&&q('[data-nd-unlinked]').textContent.includes('د. غير مربوط'));
  b.click();for(let i=0;i<50&&!q('[data-cd-modal]');i++)await sleep(10);assert(q('[data-cd-modal]'));assert(calls.some(c=>c[0]==='clinical_drafts'&&c[1]==='list_mine'&&c[2].appointment_id==='a1'));
  q('[data-cd="close"]').click();assert(!q('[data-cd-modal]'));
  q('[data-nd="note"]').click();for(let i=0;i<50&&!q('[data-cd-modal]');i++)await sleep(10);assert(q('[data-cd-modal]'),'returned notice opens the draft');w.close(); }
 console.log('PASS clinical drafts UI: dental/physio fields, conditional fields, save/send payloads, read-only pending, returned reason, review approve/edit-and-approve/return-with-reason, doctor section, nursing hook, unlinked warning.');
})().catch(e=>{console.error(e);process.exit(1);});
