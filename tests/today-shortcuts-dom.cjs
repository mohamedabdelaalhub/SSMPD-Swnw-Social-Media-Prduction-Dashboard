// «تشغيل اليوم» redesign (owner 2026-11-22 «طبق يلا», mockup today-shortcuts-*): tiles row under the filters, one sheet at a time,
// doctors as cards, «حجوزات آلية» per source (واتساب / فيسبوك / انستجرام / الموقع / بوابة المرضى) with status + edit actions.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
(async()=>{
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const later=new Date(Date.now()+90*60000).toISOString();
 const ap=(id,name,q,extra)=>Object.assign({id,patient_id:'p'+id,patient_name:name,file_no:'F'+id,phone:'0100'+id,provider_id:'d1',provider_name:'د. جلدية تجريبية',department:'جلدية',service_name:'كشف',starts_at:later,queue_status:q,priority:0,wait_minutes:0,can_view_finance:false,patient_due:0,due_invoices:[]},extra||{});
 const model={day,settings:{},doctor_sessions:[{provider_id:'d1',status:'started'},{provider_id:'d2',status:'ended'}],help_requests:[],events:[],outbox:[{id:'o1'},{id:'o2',delivered_at:'x'}],appointments:[ap('1','سارة تجريبية','waiting'),ap('2','منى تجريبية','expected'),ap('3','أحمد تجريبي','completed',{provider_id:'d2',provider_name:'د. أسنان تجريبي',visit_id:'v3'})]};
 const mb=(id,ch,name,extra)=>Object.assign({id,channel:ch,wa_id:null,customer_name:name,phone:'01000000001',doctor_name:'د. جلدية تجريبية',provider_id:'d1',appointment_date:day,appointment_time:'10:00:00',status:'confirmed',registered:false,local_status:null,tries:0,not_test:false},extra||{});
 let list={can_manage:false,bookings:[mb('b1','whatsapp','هبة سمير',{tries:1,last_try_at:new Date().toISOString(),last_try_by:'منار'}),mb('b2','whatsapp','كريم علي',{local_status:'cancelled',reason:'المريض اعتذر'}),mb('b3','messenger','ليلى حسن'),mb('b4','instagram','يوسف أمين'),mb('b5','other','مريض اختبار',{wa_id:'web:9',phone:'01000000000'}),mb('b6','whatsapp','حجز محذوف',{local_status:'void_test'})]};
 const dom=new JSDOM('<main id="host"></main>',{url:'https://board.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 Object.defineProperty(w,'crypto',{value:webcrypto});w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};w.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:()=>false};
 w.SSMPDDb={client:{rpc:async(name,args)=>{calls.push([name,args&&args.p_action,args&&args.p_payload]);
   if(name==='clinic_reception_journey_hub_snapshot')return {data:JSON.parse(JSON.stringify(model)),error:null};
   if(name==='clinic_reception_auto_booking'){if(args.p_action==='list')return {data:JSON.parse(JSON.stringify(list)),error:null};return {data:{id:args.p_payload.id},error:null};}
   if(name==='clinic_reception_fallback')return {data:{bookings:[{source:'website',appointment_date:day,appointment_time:'12:00',status:'pending',customer_name:'حجز احتياطي',doctor_name:'د. أسنان تجريبي'}]},error:null};
   return {data:null,error:{message:'unexpected '+name}};},
  functions:{invoke:async()=>({data:{requests:[{requested_date:day,status:'pending'}]}})}}};
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.SSMPDPortalBookingRequests={render:el=>{el.innerHTML='<p data-portal-screen>شاشة البوابة</p>';}};
 for(const f of ['today-operations','today-shortcuts','today-auto-bookings'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 const modals=[];const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',data:{providers:[{id:'d1',department:'جلدية'},{id:'d2',department:'أسنان'}],availability:[{provider_id:'d1',starts_at:day+'T14:00:00Z',ends_at:day+'T20:00:00Z'}]},modal:(t,b,save,saved,o)=>{modals.push({t,b,save,saved,o});return {};},field:()=>'',select:()=>''};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);
 const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)],tick=(n=30)=>new Promise(r=>setTimeout(r,n));
 for(let n=0;n<300&&!(q('.journey-board')&&q('.tds-tile[data-tds-tile="auto"]')&&q('.tds-srcgrid'));n++)await tick(10);
 await tick(150);const root=q('[data-journey-root]');
 // tiles row
 const tile=k=>q('.tds-tile[data-tds-tile="'+k+'"]');
 assert(q('.journey-top [data-tds-tiles]'),'tiles live in the sticky top under the chips');
 assert.equal(tile('doctors').querySelector('.tds-n').textContent,'2','2 doctors');
 assert.equal(tile('outbox').querySelector('.tds-l').textContent,'رسائل في انتظار الإرسال للمرضى');assert.equal(tile('outbox').querySelector('.tds-n').textContent,'1');assert(tile('outbox').classList.contains('is-att'));
 assert(!tile('rooms')&&!tile('calls')&&!tile('admin'),'tiles only for sections that exist');
 assert.equal(tile('auto').querySelector('.tds-n').textContent,'6','auto = 4 live mirror + 1 fallback + 1 portal (cancelled and test-void left out)');
 assert(tile('auto').querySelector('.tds-dot'),'something needs action');
 // panels are hidden until a tile opens one; one at a time
 assert(!root.dataset.tdsOpen);
 tile('doctors').click();await tick();assert.equal(root.dataset.tdsOpen,'doctors');assert(q('[data-tds-panel="doctors"] [data-tds-close]'),'close button added');assert(q('[data-tds-veil]'));
 const cards=qa('.tds-doc');assert.equal(cards.length,2);assert(cards[0].textContent.includes('جلدية')&&cards[0].querySelector('.tds-doc-hr'),'specialty + hours on the card');
 assert(q('.tds-ds-started').textContent.includes('في الكشف'));assert(q('.tds-doc.is-done'),'finished doctor dimmed');
 assert(cards[0].textContent.includes('1 منتظر')&&cards[0].textContent.includes('2 حجز'),'waiting / booked counts');
 q('[data-tds-doctab="done"]').click();await tick();assert.equal(qa('.tds-doc').length,1,'«خلص» tab');
 q('[data-tds-doctab="all"]').click();await tick();
 q('[data-tds-doctor="d1"]').click();await tick();assert(!root.dataset.tdsOpen,'picking a doctor closes the sheet');assert.equal(q('[data-journey-doctor]').value,'d1','and filters the board on that doctor');
 // «حجوزات آلية»: 5 source cards
 tile('auto').click();await tick(60);assert.equal(root.dataset.tdsOpen,'auto');
 const src=k=>q('[data-tab-src="'+k+'"]');
 assert.deepEqual(qa('.tds-src-l').map(x=>x.textContent),['واتساب','فيسبوك','انستجرام','الموقع','بوابة المرضى']);
 assert.equal(src('whatsapp').querySelector('.tds-src-n').textContent,'1','whatsapp: cancelled + void hidden from the count');
 assert.equal(src('facebook').querySelector('.tds-src-n').textContent,'1');assert.equal(src('instagram').querySelector('.tds-src-n').textContent,'1');
 assert.equal(src('website').querySelector('.tds-src-n').textContent,'2','website = form mirror + fallback');assert.equal(src('portal').querySelector('.tds-src-n').textContent,'1');
 assert(src('website').textContent.includes('شكله حجز تجريبي'));
 src('whatsapp').click();await tick();
 const bk=id=>q('[data-tab-bk="'+id+'"]');
 assert(bk('b1')&&bk('b2')&&!bk('b6'),'void test booking hidden');
 assert(bk('b1').querySelector('.tds-stc').textContent.includes('مردّش ×1')&&bk('b1').textContent.includes('منار'),'no-answer tries with who');
 assert(bk('b2').querySelector('.tds-masa').textContent.includes('الغيه على مسا كمان'),'local cancel waits for Masa');
 assert.deepEqual([...bk('b1').querySelectorAll('.tds-seg button')].map(b=>b.textContent),['مؤكد','مردّش','وصل','لم يحضر','ملغي']);
 bk('b1').querySelector('[data-tab-act="no_answer"]').click();await tick(60);
 assert(calls.some(c=>c[0]==='clinic_reception_auto_booking'&&c[1]==='no_answer'&&c[2].id==='b1'),'مردّش logged');
 q('[data-tab-bk="b1"] [data-tab-act="cancel"]').click();await tick();
 const m=modals.pop();assert(/إلغاء الحجز/.test(m.t)&&/لازم يتلغي على مسا كمان/.test(m.b)&&m.o.danger,'cancel asks for a reason and says Masa');
 await m.save({reason_kind:'patient_excused',note:'هيكلمنا'});assert(calls.some(c=>c[1]==='cancel'&&c[2].reason_kind==='patient_excused'));
 q('[data-tab-bk="b1"] [data-tab-act="reschedule"]').click();await tick();const r=modals.pop();assert(/تعديل الميعاد/.test(r.t)&&/type="time"/.test(r.b));
 q('[data-tab-back]').click();await tick();assert(q('.tds-srcgrid'),'back to the sources');
 src('website').click();await tick();const t=q('.tds-bk.is-test');assert(t&&t.textContent.includes('شكله حجز تجريبي'));
 assert(!t.querySelector('[data-tab-act="test_void"]')&&t.querySelector('[data-tab-act="not_test"]'),'reception: no delete, only «مش تجريبي»');
 assert(q('.tds-bk:not(.is-test)').textContent.includes('الحجوزات الاحتياطية'),'fallback booking points to its screen');
 list.can_manage=true;await w.SSMPDTodayAuto.refresh();await tick();assert(q('.tds-bk.is-test [data-tab-act="test_void"]'),'managers can delete a test booking');
 q('[data-tab-back]').click();await tick();src('portal').click();await tick();assert(q('[data-portal-screen]'),'portal reuses its own screen');
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));await tick();assert(!root.dataset.tdsOpen,'Esc closes');
 assert(!/[٠-٩]/.test(host.textContent),'English digits only');
 assert.deepEqual(errors,[]);
 console.log('PASS today shortcuts: tiles under the filters with counts, one sheet at a time, doctor cards (specialty, hours, status, counts, tabs, pick filters), «حجوزات آلية» by 5 sources with status / no-answer / cancel reason / reschedule / test rules, Masa notes, portal screen reused, Esc.');
 w.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
