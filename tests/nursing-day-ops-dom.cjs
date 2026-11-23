// Nursing day ops UI + doctor triage strip (mocked RPC, no real data).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NOW=new Date().toISOString();
const DAY={date:'2026-11-20',my_section:'physio',sections:['physio','dental'],unread:1,appointments:[
 {id:'a1',starts_at:'2026-11-20T07:00:00Z',section:'physio',patient_name:'مريض ١',file_no:'P-1',archive_patient_id:'ar1',service:'جلسة',doctor:'د. أ',status:'arrived',queue_status:'waiting',ticket_no:3,triage:'none',prep:['سرير الجلسة جاهز']},
 {id:'a2',starts_at:'2026-11-20T08:00:00Z',section:'dental',taken_by:'ممرضة عام',patient_name:'مريض ٢',file_no:'P-2',archive_patient_id:'ar2',service:'حشو',doctor:'د. ب',status:'booked',queue_status:null,ticket_no:null,triage:'draft',prep:[]}]};
const STAFF={date:'2026-11-20',now:'2026-11-20T09:42:00Z',can_manage:true,covered:{physio:false,dental:true},nurses:[
 {admin_id:'u1',name:'ممرضة علاج',section:'physio',state:'absent',first_in:null,exp_start:'2026-11-20T08:00:00Z',exp_end:'2026-11-20T16:00:00Z',late_min:null},
 {admin_id:'u2',name:'ممرضة أسنان',section:'dental',state:'present',first_in:'2026-11-20T08:25:00Z',exp_start:'2026-11-20T08:00:00Z',exp_end:'2026-11-20T16:00:00Z',late_min:25,returned:3,kept:2},
 {admin_id:'u3',name:'ممرضة عام',section:'general',state:'leave',exp_start:'2026-11-20T08:00:00Z',exp_end:'2026-11-20T16:00:00Z'}]};
const NOTES={unread:1,items:[{id:'n1',kind:'booking_today',title:'مريض حجز علاج طبيعي الساعة 3:30',appointment_id:'a1',archive_patient_id:'ar1',created_at:NOW,read:false}]};
function mk(opts){opts=opts||{};const d=new JSDOM('<body><div id="h"></div><button data-goto="patients"></button></body>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,calls=[];
 w.scrollTo=()=>{};w.SSMPDToast={show:(m,k)=>{w.__t=(w.__t||[]).concat([[m,k]]);}};w.__t=[];
 w.SSMPDRoles={hasAnyRole:(a,l)=>(a.roles||[]).some(r=>l.includes(r))};w.SSMPDAuth={currentAdmin:{roles:opts.roles||['nursing']}};
 const rpc=async(name,args)=>{calls.push(JSON.parse(JSON.stringify([name,args.p_action,args.p_payload||null])));const a=args.p_action;
  if(name!=='clinic_reception_nursing')return {data:null,error:null};
  if(a==='day')return {data:DAY,error:null};if(a==='staff_today')return {data:STAFF,error:null};if(a==='notifications')return {data:NOTES,error:null};
  if(a==='settings_get')return opts.settings?{data:{nurses:[{admin_id:'u1',name:'ممرضة',default_section:'physio',override:null,section:'physio',absent_today:false}]},error:null}:{data:null,error:{message:'مش مسموح'}};
  if(a==='triage_get')return {data:{triage:opts.triage||null},error:null};
  if(a==='triage_confirm_profile')return {data:{ok:true,added:2},error:null};
  return {data:{ok:true},error:null};};
 w.SSMPDDb={client:{rpc}};w.SSMPDRenderPatients={openPatientById:id=>{w.__opened=id;}};
 w.SSMPDReceptionModules={sections:()=>[['journey','x','y']],panel:()=>'<p>j</p>'};return {w,calls};}
(async()=>{
 const {w,calls}=mk({settings:true});const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
 w.eval(fs.readFileSync('assets/js/nursing-day-ops.js','utf8'));
 const M=()=>w.SSMPDReceptionModules,live={workspace:'w1',data:{workspace:{mode:'live'}}};
 assert(M().sections(live).some(r=>r[0]==='nursing'&&r[1]==='تشغيل اليوم — التمريض'),'nursing section added');
 q('#h').innerHTML=M().panel('nursing',live);
 for(let i=0;i<100&&!q('[data-nd-card]');i++)await sleep(10);
 assert.equal(qa('[data-nd-card]').length,1,'only selected section cards');assert(q('#h').textContent.includes('رقم 3')&&q('#h').textContent.includes('بتشوف مرضى قسمك لليوم بس'));
 assert.equal(qa('.nd-tab').length,2);assert(q('.nd-tab.on').textContent.includes('علاج طبيعي'));
 assert(q('#h').textContent.includes('وصل — مستني'));assert(q('[data-nd-notes]').textContent.includes('مريض حجز علاج طبيعي'));
 for(let i=0;i<50&&!q('[data-nd-ex]');i++)await sleep(10);
 const sb=q('[data-nd-staff]');assert(sb,'presence board shown');assert(q('[data-nd-ex]'),'manager section change shown when settings_get resolves');
 assert(!q('[data-nd-abs]')&&!q('[data-nd="save_nurse"]'),'no manual absence or save button');
 assert.match(q('[data-nd-route="physio"]').textContent,/ممرضة علاج \(علاج طبيعي\) غايب النهارده لحد دلوقتي \(ورديته من 10:00 ص\)، فحالات العلاج الطبيعي اتحولت للتمريض العام/);
 assert(!q('[data-nd-route="dental"]'),'covered section has no note');
 assert.match(q('[data-nd-back="u2"]').textContent,/بصم 10:25 ص — متأخر 25 دقيقة\. رجعله 3 حالات محدش بدأ فيها\. حالتين فضلوا مع التمريض العام/);
 assert.equal(q('[data-nd-nurse="u3"]').dataset.state,'leave');assert(q('[data-nd-nurse="u2"]').textContent.includes('حاضر · متأخر 25 د'));
 assert(!/[٠-٩]/.test(sb.textContent),'English digits only');
 // switch tab
 qa('.nd-tab')[1].click();assert(q('[data-nd-card]').textContent.includes('مريض ٢'));assert(q('[data-nd-card]').textContent.includes('مع التمريض العام · ممرضة عام'));assert(!q('#h').textContent.includes('مريض ١'));qa('.nd-tab')[0].click();
 // open file
 q('[data-nd="open_file"]').click();for(let i=0;i<50&&!w.__opened;i++)await sleep(10);
 assert.deepEqual(calls.find(c=>c[1]==='open_file'),['clinic_reception_nursing','open_file',{patient_id:'ar1',appointment_id:'a1'}]);assert.equal(w.__opened,'ar1');
 // notification -> modal + read + prep
 await sleep(30);q('[data-nd="note"]').click();for(let i=0;i<50&&!q('[data-nd-modal] input[data-item]');i++)await sleep(10);
 assert(calls.some(c=>c[1]==='notifications_read'&&c[2].ids[0]==='n1'));
 const boxes=qa('[data-nd-modal] input[data-item]');assert.equal(boxes.length,3,'physio prep items');assert(boxes[0].checked&&!boxes[1].checked);
 boxes[1].checked=true;boxes[1].dispatchEvent(new w.Event('click',{bubbles:true}));for(let i=0;i<50&&!calls.some(c=>c[1]==='prep_set');i++)await sleep(10);
 assert.deepEqual(calls.find(c=>c[1]==='prep_set')[2],{appointment_id:'a1',item:'الأجهزة جاهزة',done:true});
 // triage form from modal
 await sleep(30);q('[data-nd-modal] [data-nd="triage"]').click();for(let i=0;i<50&&!q('[data-nd-form]');i++)await sleep(10);
 assert(!q('[data-nd-modal]'),'modal closed');assert(q('#h').textContent.includes('بيظهر للدكتور قبل ما المريض يدخل'));
 const f=()=>q('[data-nd-form]').elements;f().bp_sys.value='120';f().bp_dia.value='80';f().pulse.value='76';f().temp_c.value='36.8';
 q('[data-nd="chronic"][data-name="سكر"]').click();q('[data-nd="yn"][data-name="on_chronic_meds"][data-v="1"]').click();f().chronic_meds.value='ميتفورمين';f().chief_complaint.value='ألم';
 q('[data-nd="save_rec"]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='triage_save');i++)await sleep(10);
 let p=calls.find(c=>c[1]==='triage_save')[2];assert.equal(p.status,'recorded');assert.equal(p.bp_sys,120);assert.equal(p.temp_c,36.8);assert.deepEqual(p.chronic_diseases,['سكر']);assert.equal(p.on_chronic_meds,true);assert.equal(p.chronic_meds,'ميتفورمين');assert.equal(p.recent_surgery,null);assert.equal(p.chief_complaint,'ألم');assert.equal(p.appointment_id,'a1');
 // draft + validation
 await sleep(60);q('[data-nd="triage"]').click();for(let i=0;i<50&&!q('[data-nd-form]');i++)await sleep(10);
 f().bp_sys.value='999';q('[data-nd="save_draft"]').click();await sleep(30);assert.equal(calls.filter(c=>c[1]==='triage_save').length,1,'invalid range blocked');
 f().bp_sys.value='110';q('[data-nd="save_draft"]').click();for(let i=0;i<50&&calls.filter(c=>c[1]==='triage_save').length<2;i++)await sleep(10);
 assert.equal(calls.filter(c=>c[1]==='triage_save')[1][2].status,'draft');
 // settings save
 await sleep(60);q('[data-nd="back"]')&&q('[data-nd="back"]').click();for(let i=0;i<50&&!q('select[data-nd-ov]');i++)await sleep(10);
 const ov=q('select[data-nd-ov]');ov.value='dental';ov.dispatchEvent(new w.Event('change',{bubbles:true}));for(let i=0;i<50&&!calls.some(c=>c[1]==='settings_save');i++)await sleep(10);
 assert.deepEqual(calls.find(c=>c[1]==='settings_save')[2],{admin_id:'u1',section_override:'dental'});
 w.close();
 // settings hidden on permission error
 { const {w,calls}=mk();w.eval(fs.readFileSync('assets/js/nursing-day-ops.js','utf8'));w.document.querySelector('#h').innerHTML=w.SSMPDReceptionModules.panel('nursing',{workspace:'w1',data:{workspace:{mode:'live'}}});
  for(let i=0;i<100&&!w.document.querySelector('[data-nd-card]');i++)await sleep(10);await sleep(50);assert(!w.document.querySelector('[data-nd-ex]'),'no section change without settings access');assert(w.document.querySelector('[data-nd-staff]'),'nurses still see the presence board');w.close(); }
 // trial renders nothing
 { const {w,calls}=mk();w.eval(fs.readFileSync('assets/js/nursing-day-ops.js','utf8'));const t={workspace:'w1',data:{workspace:{mode:'trial'}}};
  assert.equal(w.SSMPDReceptionModules.panel('nursing',t),'');assert(!w.SSMPDReceptionModules.sections(t).some(r=>r[0]==='nursing'));await sleep(50);assert.equal(calls.length,0);w.close(); }
 // doctor strip
 { const tri={status:'recorded',nurse_name:'ممرضة س',recorded_at:NOW,bp_sys:160,bp_dia:100,pulse:88,temp_c:36.8,spo2:97,weight_kg:82,sugar_mgdl:110,chronic_diseases:['سكر','ضغط'],allergies:'بنسلين',chief_complaint:'ألم ضهر',nursing_note:'أخد الدواء'};
  const {w,calls}=mk({roles:['sono_doctor'],triage:tri});w.eval(fs.readFileSync('assets/js/nursing-triage-strip.js','utf8'));
  w.document.querySelector('#h').innerHTML='<div class="journey-board"><article class="journey-card is-open" data-appointment="a1"><div class="journey-card-detail"><div class="journey-card-actions"></div></div></article></div>';
  w.SSMPDReceptionModules.panel('journey',{workspace:'w1',data:{workspace:{mode:'live'}}});
  for(let i=0;i<100&&!w.document.querySelector('[data-nts]');i++)await sleep(10);
  const s=w.document.querySelector('[data-nts]');assert(s,'strip rendered');assert(s.textContent.includes('سجّلته ممرضة س'));assert(s.querySelector('.nts-tile.w b').textContent==='160/100','amber bp flag');assert.equal(s.querySelectorAll('.nts-tile.w').length,1);assert(s.textContent.includes('بنسلين')&&s.textContent.includes('«ألم ضهر»'));
  s.querySelector('[data-nts-confirm]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='triage_confirm_profile');i++)await sleep(10);
  assert.deepEqual(calls.find(c=>c[1]==='triage_confirm_profile')[2],{appointment_id:'a1'});await sleep(30);assert(w.__t.some(t=>t[0].includes('2')));w.close(); }
 console.log('PASS nursing day ops: section tabs/cards, open-file log, notices read, prep checklist, triage recorded/draft/validation, presence board + re-route notes, manager section change, trial skip, doctor strip amber flag and confirm.');
})().catch(e=>{console.error(e);process.exit(1);});
