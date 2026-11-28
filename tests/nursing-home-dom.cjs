// «شغل اليوم — التمريض» launcher (help 358): real nursing-day-ops + nursing-home modules, mocked RPC and inventory. Covers: groups/buttons shown per role (rule 9),
// each button lands on its action (existing buttons clicked, inventory views opened directly), «فتحت عبوة جديدة» pre-fills quantity 1 + the purpose, nothing removed.
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.SSMPD_TEST_MODULES||process.cwd()]})),fs=require('fs'),assert=require('node:assert/strict');
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
 for(const kind of ['store','nostore','plain']){
  const {w}=mk({roles:kind==='store'?['head_nursing']:['nursing']});const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
  const tabOk=kind!=='plain',went=[],selected=[];let navClicks=0,snaps=0;
  w.SSMPDAuth.currentAdmin.id='u-'+kind;const base=w.SSMPDDb.client.rpc;w.SSMPDDb.client.rpc=async(n,a)=>{if(n==='inventory_workspace_snapshot'){snaps++;return {data:{location_id:'loc-dental',can_receive:kind==='store',can_manage:false,me:'u-'+kind,staff:[]},error:null};}return base(n,a);};
  w.SSMPDRoles={hasAnyRole:(a,l)=>(a.roles||[]).some(r=>l.includes(r)),canSeeTab:(a,t)=>t==='inventory'?tabOk:true,canModuleAction:(a,m,act)=>m==='inventory'?tabOk&&act==='create':true};
  w.SSMPDPerformerSupplies={mount(){},mountKit(){}};if(tabOk){w.SSMPDRenderInventory={go:v=>{went.push(v);}};w.SSMPDInventoryWorkspace={select:id=>{selected.push(id);}};}
  w.document.querySelector('[data-goto="patients"]').setAttribute('data-goto','inventory');w.document.querySelector('[data-goto=inventory]').onclick=()=>{navClicks++;};
  w.eval(fs.readFileSync('assets/js/nursing-home.js','utf8'));w.eval(fs.readFileSync('assets/js/nursing-day-ops.js','utf8'));
  const M=()=>w.SSMPDReceptionModules,live={workspace:'w1',data:{workspace:{mode:'live'}}};
  q('#h').innerHTML=M().panel('nursing',live);await sleep(60);
  w.document.getElementById('h').dispatchEvent(new w.Event('x'));
  await sleep(150);
  const acts=qa('.nh [data-act]').map(b=>b.dataset.act);
  if(kind==='store'){
   assert.equal(snaps,1,'one snapshot call (cached)');
   assert.deepEqual(acts,['visit','issue','pack','patient','kit','request','transfer','count','balance','moves','vitals'],'storekeeper sees every button: '+acts);
   assert.deepEqual(qa('.nh-grp h4').map(h=>h.textContent),['الصرف والاستهلاك','المخزن والتوريد','المريض']);
   assert(!/تكلفة|سعر/.test(q('.nh').textContent),'no price/cost text in the panel');
   // each inventory button opens the matching view through the inventory nav
   const map={issue:'usage',pack:'usage',patient:'usage',request:'requests',transfer:'transfers',count:'counts',balance:'balances',moves:'movements'};
   for(const [a,v] of Object.entries(map)){went.length=0;selected.length=0;navClicks=0;q('.nh [data-act="'+a+'"]').click();await sleep(120);assert.equal(navClicks,1,a+' opens the inventory tab');assert.deepEqual(went,[v],a+' lands on '+v);assert.deepEqual(selected,['loc-dental'],a+' opens on the user\'s own store');}
   // «فتحت عبوة جديدة» pre-fills quantity 1 and the purpose once the usage form appears
   const f=w.document.createElement('form');f.setAttribute('data-w-usage','');f.innerHTML='<select name="item"></select><input name="quantity"><input name="note">';w.document.body.appendChild(f);
   went.length=0;q('.nh [data-act="pack"]').click();await sleep(500);assert.equal(f.querySelector('[name=quantity]').value,'1');assert(f.querySelector('[name=note]').value.startsWith('فتح عبوة جديدة'),'purpose written: '+f.querySelector('[name=note]').value);
   const pb=w.document.createElement('button');pb.setAttribute('data-w-usage-patient','');let pc=0;pb.onclick=()=>{pc++;};w.document.body.appendChild(pb);q('.nh [data-act="patient"]').click();await sleep(500);assert.equal(pc,1,'extra-supply flow opened');
  } else {
   assert(!acts.some(a=>['issue','pack','patient','request','transfer','count','balance','moves'].includes(a)),kind+' has no inventory buttons: '+acts);
   assert(acts.includes('visit')&&acts.includes('vitals'),'visit + vitals shown: '+acts);assert.equal(acts.includes('kit'),false,'kit only for managers (head nursing)');if(kind==='nostore')assert.equal(snaps>=1,true,'snapshot was asked');
   assert.equal(qa('.nh-grp h4').map(h=>h.textContent).includes('المخزن والتوريد'),false);
  }
  // the nursing screen's own buttons are still there (rule 11) and the launcher presses them
  assert(q('[data-nd=performer]'),'original «تنفيذ وتسجيل المستلزمات» kept');
  q('.nh [data-act="visit"]').click();await sleep(80);assert(q('.nd')&&true,'performer view opened');
  w.close();
 }
 const idx=fs.readFileSync('index.html','utf8'),cfg=fs.readFileSync('config.js','utf8');assert(/nursing-home\.css\?v=/.test(idx),'css loaded in index.html');assert(/loadOnce\("__SWNWNursingHomeV1","assets\/js\/nursing-home\.js\?v=/.test(cfg)&&cfg.indexOf('nursing-home.js')<cfg.indexOf('nursing-day-ops.js'),'js loaded by config.js before nursing-day-ops');
 console.log('PASS nursing home launcher: groups per role (storekeeper with a store row sees all 11; a nurse with the inventory tab but no store row, or without the tab, sees none of the inventory ones), inventory views opened directly, «فتحت عبوة جديدة» pre-filled, original buttons kept, no price text.');
})().catch(e=>{console.error(e);process.exit(1);});
