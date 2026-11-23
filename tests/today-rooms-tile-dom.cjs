// Hotfix 2026-11-23 (reception screenshot: «الغرف والطابور» tile did nothing, «إدارة الغرف» not reachable, 171 messages waiting).
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. جلدية تجريبية',department:'جلدية',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:false,patient_due:0,due_invoices:[]},extra||{});
 const model={day,settings:{},doctor_sessions:[{provider_id:'d1',status:'started'},{provider_id:'d2',status:'ended'}],help_requests:[],events:[],outbox:[{id:'o1',target_role:'patient',status:'draft'},{id:'o2',delivered_at:'x'},{id:'o3',status:'cancelled'},{id:'o4',target_role:'doctor'},{id:'o5',status:'approved'}],appointments:[ap('1','سارة تجريبية','waiting'),ap('2','منى تجريبية','expected'),ap('3','أحمد تجريبي','completed',{provider_id:'d2',provider_name:'د. أسنان تجريبي',visit_id:'v3'})]};
 const mb=(id,ch,name,extra)=>Object.assign({id,channel:ch,wa_id:null,customer_name:name,phone:'01000000001',doctor_name:'د. جلدية تجريبية',provider_id:'d1',appointment_date:day,appointment_time:'10:00:00',status:'confirmed',registered:false,local_status:null,tries:0,not_test:false},extra||{});
 let list={can_manage:false,bookings:[mb('b1','whatsapp','هبة سمير',{tries:1,last_try_at:new Date().toISOString(),last_try_by:'منار'}),mb('b2','whatsapp','كريم علي',{local_status:'cancelled',reason:'المريض اعتذر'}),mb('b3','messenger','ليلى حسن'),mb('b4','instagram','يوسف أمين'),mb('b5','other','مريض اختبار',{wa_id:'web:9',phone:'01000000000'}),mb('b6','whatsapp','حجز محذوف',{local_status:'void_test'})]};
 let queueCalls=0;const dom=new JSDOM('<section hidden><div data-journey-root data-journey-mode="trial"><div data-tds-tiles></div></div></section><main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args&&args.p_action,args&&args.p_payload]);
   if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
   if(name==='clinic_reception_auto_booking'){if(args.p_action==='list')return {data:JSON.parse(JSON.stringify(list)),error:null};return {data:{id:args.p_payload.id},error:null};}
   if(name==='clinic_reception_queue'){queueCalls++;if(args.p_action==='agent_bookings')return {data:{bookings:[]},error:null};return {data:{date:day,rooms:[{id:'r1',label:'عيادة 1',kind:'clinic',active:true}],doctors:[],departments:[],dept_tickets:[],calls:[]},error:null};}
   if(name==='clinic_reception_fallback')return {data:{bookings:[{source:'website',appointment_date:day,appointment_time:'12:00',status:'pending',customer_name:'حجز احتياطي',doctor_name:'د. أسنان تجريبي'}]},error:null};
   return {data:null,error:{message:'unexpected '+name}};},
  functions:{invoke:async()=>({data:{requests:[{requested_date:day,status:'pending'}]}})}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.SSMPDPortalBookingRequests={render:el=>{el.innerHTML='<p data-portal-screen>شاشة البوابة</p>';}};
 for(const f of ['today-operations','today-shortcuts','today-auto-bookings','today-operations-queue'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const modals=[];const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{can_manage:true,providers:[{id:'d1',department:'جلدية'},{id:'d2',department:'أسنان'}],availability:[{provider_id:'d1',starts_at:day+'T14:00:00Z',ends_at:day+'T20:00:00Z'}]},modal:(t,b,save,saved,o)=>{modals.push({t,b,save,saved,o});return {};},field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)],tick=(n=30)=>new Promise(r=>setTimeout(r,n));
 const until=async(f,what)=>{for(let i=0;i<400;i++){const v=f();if(v)return v;await tick(10);}throw new Error('timed out waiting for '+what);};
 const click=async sel=>{const el=await until(()=>q(sel),sel);el.click();await tick();return el;};
 for(let n=0;n<300&&!(q('.journey-board')&&q('.tds-tile[data-tds-tile="auto"]')&&q('.tds-srcgrid'));n++)await tick(10);

 const root=await until(()=>qa('[data-journey-root]').find(r=>r.dataset.journeyMode!=='trial'),'live root');
 const tile=k=>root.querySelector('.tds-tile[data-tds-tile="'+k+'"]');
 await until(()=>tile('rooms')&&tile('admin')&&tile('outbox'),'rooms / admin / outbox tiles on the live board (a hidden trial board comes first in the page)');
 // 171-style count: only patient messages, not cancelled, not delivered
 assert.equal(tile('outbox').querySelector('.tds-n').textContent,'2','o1 + o5 (cancelled o3 and doctor o4 not counted)');
 assert(root.querySelector('[data-tds-panel="outbox"]').textContent.includes('1 رسالة اتبعتت'));
 // «الغرف والطابور» opens the live sheet even though a trial board sits first in the DOM
 tile('rooms').click();await until(()=>root.dataset.tdsOpen==='rooms','rooms sheet');
 const trial=w.document.querySelector('[data-journey-mode="trial"]');assert(!trial.dataset.tdsOpen,'trial copy untouched');
 const sec=root.querySelector('[data-journey-queue]');assert.equal(sec.getAttribute('role'),'dialog');
 // «إدارة الغرف» reachable from inside the rooms sheet
 const sw=await until(()=>sec.querySelector('[data-tds-switch="admin"]'),'«إدارة الغرف» button in the rooms sheet');assert.equal(sw.textContent,'إدارة الغرف');
 sw.click();await until(()=>root.dataset.tdsOpen==='admin','admin sheet');assert(sec.querySelector('details[data-qr-mgr]').open,'rooms manager open');
 await until(()=>!sec.querySelector('[data-tds-switch]'),'switch hidden on the admin sheet');
 w.SSMPDTodayShortcuts.close();await tick();
 // the rooms section was dropped by a re-render: the tile loads it instead of doing nothing
 sec.remove();const before=queueCalls;w.SSMPDTodayShortcuts.open('rooms');
 await until(()=>root.dataset.tdsOpen==='rooms'&&root.querySelector('[data-journey-queue]'),'reloaded and opened');assert(queueCalls>before,'queue reloaded');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS today rooms tile hotfix: live board chosen over a hidden trial copy, «الغرف والطابور» opens, «إدارة الغرف» from inside the sheet, missing section reloads, outbox counts only pending patient messages.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
