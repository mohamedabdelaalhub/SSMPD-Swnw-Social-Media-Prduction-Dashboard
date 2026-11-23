// 20261123030000 (owner: reception records each doctor's clinic room daily): the doctor card link control. Base = tests/today-rooms-tile-dom.cjs.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. جلدية تجريبية',department:'جلدية',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:false,patient_due:0,due_invoices:[]},extra||{});
 const model={day,settings:{},doctor_sessions:[{provider_id:'d1',status:'started'},{provider_id:'d2',status:'ended'}],help_requests:[],events:[],outbox:[{id:'o1',target_role:'patient',status:'draft'},{id:'o2',delivered_at:'x'},{id:'o3',status:'cancelled'},{id:'o4',target_role:'doctor'},{id:'o5',status:'approved'}],appointments:[ap('1','سارة تجريبية','waiting'),ap('2','منى تجريبية','expected'),ap('3','أحمد تجريبي','completed',{provider_id:'d2',provider_name:'د. أسنان تجريبي',visit_id:'v3'})]};
 const mb=(id,ch,name,extra)=>Object.assign({id,channel:ch,wa_id:null,customer_name:name,phone:'01000000001',doctor_name:'د. جلدية تجريبية',provider_id:'d1',appointment_date:day,appointment_time:'10:00:00',status:'confirmed',registered:false,local_status:null,tries:0,not_test:false},extra||{});
 let list={can_manage:false,bookings:[mb('b1','whatsapp','هبة سمير',{tries:1,last_try_at:new Date().toISOString(),last_try_by:'منار'}),mb('b2','whatsapp','كريم علي',{local_status:'cancelled',reason:'المريض اعتذر'}),mb('b3','messenger','ليلى حسن'),mb('b4','instagram','يوسف أمين'),mb('b5','other','مريض اختبار',{wa_id:'web:9',phone:'01000000000'}),mb('b6','whatsapp','حجز محذوف',{local_status:'void_test'})]};
 let queueCalls=0;let canLinkRooms=true;const assigns=[];const rooms=[{id:'r1',label:'عيادة 1',kind:'clinic',active:true,assignment:null},{id:'r2',label:'عيادة 2',kind:'clinic',active:true,assignment:{provider_id:'dX',doctor_name:'د. تاني'}},{id:'rL',label:'سحب العينات',kind:'lab',active:true,ticket_prefix:'L'}];const dom=new JSDOM('<section hidden><div data-journey-root data-journey-mode="trial"><div data-tds-tiles></div></div></section><main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args&&args.p_action,args&&args.p_payload]);
   if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
   if(name==='clinic_reception_auto_booking'){if(args.p_action==='list')return {data:JSON.parse(JSON.stringify(list)),error:null};return {data:{id:args.p_payload.id},error:null};}
   if(name==='clinic_reception_queue'){queueCalls++;if(args.p_action==='agent_bookings')return {data:{bookings:[]},error:null};if(args.p_action==='assign'){assigns.push(JSON.parse(JSON.stringify(args.p_payload)));rooms.forEach(r=>{if(r.assignment&&r.assignment.provider_id===args.p_payload.provider_id)r.assignment=null;});const r=rooms.find(x=>x.id===args.p_payload.room_id);r.assignment={provider_id:args.p_payload.provider_id,doctor_name:'د'};return {data:{ok:true},error:null};}return {data:{date:day,can_link_rooms:canLinkRooms,rooms:JSON.parse(JSON.stringify(rooms)),doctors:[],departments:[],dept_tickets:[],calls:[]},error:null};}
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
 const slot=await until(()=>root.querySelector('[data-tds-room-slot="d1"] [data-qr-link]'),'«اربط الدكتور بالعيادة» on the doctor card');
 assert.equal(slot.textContent,'اربط الدكتور بالعيادة');
 slot.click();await tick();
 const sel=root.querySelector('[data-tds-room-slot="d1"] [data-qr-linkroom]');assert(sel,'room picker');
 const opts=[...sel.options].map(o=>o.textContent);assert.deepEqual(opts,['اختار العيادة','عيادة 1 — فاضية','عيادة 2 — مع د. تاني'],'clinic rooms only (no department room), with who is in them');
 root.querySelector('[data-qr-linkgo="d1"]').click();await tick();assert.equal(assigns.length,0,'needs a room');
 sel.value='r1';root.querySelector('[data-qr-linkgo="d1"]').click();
 await until(()=>assigns.length===1,'assign sent');assert.equal(JSON.stringify(assigns[0]),JSON.stringify({room_id:'r1',provider_id:'d1'}));
 const linked=await until(()=>{const s=root.querySelector('[data-tds-room-slot="d1"]');return s&&s.querySelector('.qr-docroom')&&s;},'card shows the room after refresh');
 assert.equal(linked.querySelector('.qr-docroom').textContent,'عيادة 1');assert.equal(linked.querySelector('[data-qr-link]').textContent,'تغيير العيادة');
 linked.querySelector('[data-qr-link]').click();await tick();root.querySelector('[data-qr-linkx]').click();await tick();
 assert(root.querySelector('[data-tds-room-slot="d1"] .qr-docroom'),'cancel brings the room back');
 // the server says this account may not link → no link buttons anywhere (only the room name)
 canLinkRooms=false;await w.__SWNWQueueTest.refresh(true);
 await until(()=>!root.querySelector('[data-qr-link]'),'link buttons hidden');
 assert.equal(root.querySelector('[data-tds-room-slot="d1"] .qr-docroom').textContent,'عيادة 1','room still shown');
 assert(!root.querySelector('[data-journey-queue] [data-qa="assign"]')&&!root.querySelector('[data-journey-queue] [data-qr-pick]')&&!root.querySelector('[data-journey-queue] [data-qa="end_assignment"]'),'rooms sheet read-only');
 canLinkRooms=true;await w.__SWNWQueueTest.refresh(true);await until(()=>root.querySelector('[data-journey-queue] [data-qa="assign"]'),'back for a reception account');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS reception room link UI: «اربط الدكتور بالعيادة» on each doctor card, clinic-room picker with occupants, assign via the queue RPC, card shows the room + «تغيير العيادة», cancel; hidden when can_link_rooms is false.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
