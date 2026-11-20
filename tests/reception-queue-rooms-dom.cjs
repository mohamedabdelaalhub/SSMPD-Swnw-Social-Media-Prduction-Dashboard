// Queue phase 2: Today Operations "rooms and queue" layer + standalone queue-room.html (mocked RPC, no real data).
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const STATE={date:'2026-11-20',
 doctors:[{provider_id:'p1',name:'د. اختبار ١',specialty:'جراحة',room_label:'عيادة ١',current_no:2,waiting_nos:[3,4],waiting_count:2,done_count:1},{provider_id:'p2',name:'د. اختبار ٢',specialty:'باطنة',room_label:null,current_no:null,waiting_nos:[1],waiting_count:1,done_count:0}],
 departments:[{room_id:'rl',name:'غرفة سحب العينات',room_label:'غرفة سحب العينات',ticket_prefix:'L',current_no:'L2',waiting_nos:['L3'],waiting_count:1,done_count:0},{room_id:'rr',name:'غرفة الأشعة',room_label:'غرفة الأشعة',ticket_prefix:'R',current_no:null,waiting_nos:[],waiting_count:0,done_count:0}],
 calls:[{call_id:'c1',ticket_no:'L2',room_label:'غرفة سحب العينات',called_at:new Date().toISOString()}],
 rooms:[{id:'c1r',label:'عيادة ١',kind:'clinic',ticket_prefix:null,active:true,sort_order:1,staff:[],mine:false,assignment:{id:'a1',provider_id:'p1',doctor_name:'د. اختبار ١',started_at:null}},
  {id:'c2r',label:'عيادة ٢',kind:'clinic',ticket_prefix:null,active:true,sort_order:2,staff:[],mine:false,assignment:null},
  {id:'rl',label:'غرفة سحب العينات',kind:'lab',ticket_prefix:'L',active:true,sort_order:3,staff:[],mine:false,assignment:null},
  {id:'rr',label:'غرفة الأشعة',kind:'radiology',ticket_prefix:'R',active:true,sort_order:4,staff:[],mine:false,assignment:null}],
 tickets:[],dept_tickets:[{id:'t2',room_id:'rl',label:'L2',status:'called',appointment_id:null,created_at:null}]};
const AG=[{id:'b1',booking_reference:'R1',customer_name:'عميل ١',phone:'01011112222',doctor_name:'د. اختبار ١',provider_id:'p1',appointment_time:'14:30:00',status:'confirmed',registered:false},{id:'b2',customer_name:'عميل ٢',phone:'01033334444',doctor_name:'د. ماسا',provider_id:null,appointment_time:'15:00:00',status:'confirmed',registered:false},{id:'b3',customer_name:'عميل ٣',phone:'01055556666',doctor_name:'د. اختبار ١',provider_id:'p1',appointment_time:'16:00:00',status:'arrived',registered:true}];
function mk(html,url){const d=new JSDOM(html,{url:url||'https://reception.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,calls=[];
 w.SSMPDToast={show:(m,k)=>{w.__toasts=(w.__toasts||[]).concat([[m,k]]);}};w.confirm=()=>true;w.__toasts=[];
 const rpc=async(name,args)=>{if(name==='clinic_reception_directory'){calls.push([name,args.p_term]);return {data:[{id:'arch1',full_name:'مريض اختبار',phone:'01000000000',patient_code:'P-2026-000001'}],error:null};}calls.push(JSON.parse(JSON.stringify([name,args.p_action,args.p_payload])));if(args.p_action==='state')return {data:STATE,error:null};if(args.p_action==='agent_bookings')return {data:{bookings:AG},error:null};if(args.p_action==='agent_booking_register')return {data:{ok:true,appointment_id:'ap1',token:'tk',ticket_no:7},error:null};if(args.p_action==='call_next')return {data:{ok:true,label:'3',room_label:'عيادة ١'},error:null};if(args.p_action==='dept_ticket')return {data:{ok:true,label:'L9',room_label:'غرفة سحب العينات'},error:null};return {data:{ok:true},error:null};};
 w.SSMPDDb={client:{rpc,auth:{getSession:async()=>({data:{session:{}}})}},listAdmins:async()=>[{id:'u1',name:'فني',active:true}]};return {w,calls};}
(async()=>{
 // 1) dashboard layer
 const live='<div data-journey-root><div class="journey-layout"><main></main><aside></aside></div></div>';
 const {w,calls}=mk('<body>'+live+'</body>');
 w.SSMPDReceptionModules={sections:()=>[],panel:()=>'<p>x</p>'};
 w.eval(fs.readFileSync('assets/js/today-operations-queue.js','utf8'));
 w.SSMPDReceptionModules.panel('journey',{workspace:'w1',data:{can_manage:true,providers:[{id:'p1',name:'د. اختبار ١'},{id:'p9',name:'د. بدون أرقام'}],services:[{id:'s1',code:'C1',name:'كشف',active:true},{id:'s2',code:'C2',name:'استشارة',active:true}],provider_service_scopes:{p1:['C1']}}});
 const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
 for(let i=0;i<100&&!q('[data-qr-doctor]');i++)await sleep(10);
 const sec=q('[data-journey-queue]');assert(sec,'section rendered');
 assert.equal(qa('[data-qr-room]').length,2,'clinic rooms only (no prefix)');
 assert(sec.textContent.includes('فاضية')&&sec.textContent.includes('د. اختبار ١'));
 assert.equal(qa('[data-qr-doctor]').length,2);assert(sec.textContent.includes('اربط الدكتور بعيادة الأول'));
 assert.equal(qa('[data-qr-dept]').length,2);assert(qa('[data-qr-pick="c2r"] option').some(o=>o.textContent==='د. بدون أرقام'),'providers from context in select');
 assert(sec.textContent.includes('إعادة الربط بطبيب آخر')&&sec.textContent.includes('إدارة الغرف'));
 // call next (doctor)
 q('[data-qr-doctor="p1"] [data-qa=call_next]').click();for(let i=0;i<50&&!calls.some(c=>c[1]==='call_next');i++)await sleep(10);
 assert.deepEqual(calls.find(c=>c[1]==='call_next'),['clinic_reception_queue','call_next',{provider_id:'p1'}]);
 await sleep(50);
 // call next (dept) and new ticket dialog
 q('[data-qr-dept="rr"] [data-qa=call_next]').click();await sleep(60);
 assert.deepEqual(calls.filter(c=>c[1]==='call_next')[1][2],{room_id:'rr'});
 q('[data-qr-dept="rl"] [data-qa=dept_ticket]').click();await sleep(60);assert.equal(q('[data-qr-label]').textContent,'L9');
 q('.qr-big button').click();
 q('[data-qr-dept="rl"] [data-qa=dept_done]').click();await sleep(60);assert.deepEqual(calls.find(c=>c[1]==='dept_done')[2],{id:'t2'});
 // assign needs a pick, then calls assign
 q('[data-qr-room="c2r"] [data-qa=assign]').click();await sleep(20);assert(!calls.some(c=>c[1]==='assign'));
 const pick=q('[data-qr-pick="c2r"]');pick.value='p9';pick.dispatchEvent(new w.Event('change',{bubbles:true}));q('[data-qr-room="c2r"] [data-qa=assign]').click();await sleep(60);
 assert.deepEqual(calls.find(c=>c[1]==='assign')[2],{room_id:'c2r',provider_id:'p9'});
 // end clinic
 q('[data-qr-room="c1r"] [data-qa=end_assignment]').click();await sleep(60);
 assert.deepEqual(calls.find(c=>c[1]==='end_assignment')[2],{room_id:'c1r'});
 // agent bookings section
 await sleep(50);
 assert.equal(qa('[data-qr-ag]').length,3);assert(sec.textContent.includes('دكتور غير مربوط'));assert.equal(qa('.qr-badge').length,1);assert.equal(qa('[data-qa=ag_open]').length,2);assert(sec.textContent.includes('14:30'));
 q('[data-qr-ag="b1"] [data-qa=ag_open]').click();await sleep(20);
 const mod=q('[data-qr-agmodal]');assert(mod);assert.equal(q('[data-qr-term]').value,'01011112222');assert.deepEqual([...qa('[data-qr-svc] option')].map(o=>o.value),['','s1'],'services scoped to provider');
 assert(q('[data-qr-confirm]').disabled);q('[data-qr-search]').click();await sleep(30);
 assert.deepEqual(calls.find(c=>c[0]==='clinic_reception_directory'),['clinic_reception_directory','01011112222']);
 q('[data-qr-pat]').click();const sv=q('[data-qr-svc]');sv.value='s1';sv.dispatchEvent(new w.Event('change'));assert(!q('[data-qr-confirm]').disabled);
 q('[data-qr-confirm]').click();q('[data-qr-confirm]')&&q('[data-qr-confirm]').click();await sleep(80);
 assert.equal(calls.filter(c=>c[1]==='agent_booking_register').length,1,'double click safe');assert.deepEqual(calls.find(c=>c[1]==='agent_booking_register')[2],{booking_id:'b1',patient_id:'arch1',service_id:'s1'});
 assert(!q('[data-qr-agmodal]'));assert.equal(q('[data-qr-label]').textContent,'7');assert(w.__toasts.some(x=>x[0].includes('رقمه 7')));q('.qr-big button').click();
 q('[data-qr-ag="b2"] [data-qa=ag_open]').click();await sleep(20);assert(q('[data-qr-hint]').textContent.includes('الدكتور ده غير مربوط أو موقوف؛ اطلب من المسؤول يربطه'));assert(q('[data-qr-confirm]').disabled);q('[data-qr-close]').click();
 // 2) trial mode renders nothing
 const t=mk('<body><div data-journey-root data-journey-mode="trial"><div class="journey-layout"><aside></aside></div></div></body>');
 t.w.SSMPDReceptionModules={sections:()=>[],panel:()=>''};t.w.eval(fs.readFileSync('assets/js/today-operations-queue.js','utf8'));
 t.w.SSMPDReceptionModules.panel('journey',{workspace:'w1',data:{}});await sleep(150);
 assert(!t.w.document.querySelector('[data-journey-queue]'),'trial: nothing rendered');assert.equal(t.calls.length,0);
 // 3) standalone page for one room
 const html=fs.readFileSync('queue-room.html','utf8').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g,'');
 const r=mk(html,'https://reception.test/queue-room.html?w=w1&room=rl');r.w.SSMPD_CONFIG={supabase:{url:'x',anonKey:'y'}};
 r.w.eval(fs.readFileSync('assets/js/queue-room.js','utf8'));for(let i=0;i<100&&!r.w.document.querySelector('[data-cur]');i++)await sleep(10);
 assert.equal(r.w.document.querySelector('[data-cur]').textContent,'L2');assert(r.w.document.body.textContent.includes('L3'));assert(!r.w.document.body.textContent.includes('غرفة الأشعة'),'only this room');
 r.w.document.querySelector('[data-qa=call_next]').click();await sleep(60);assert.deepEqual(r.calls.find(c=>c[1]==='call_next')[2],{room_id:'rl'});
 console.log('PASS reception queue rooms DOM: layer renders rooms, doctor and department queues; call_next/assign/end_assignment payloads; trial renders nothing; queue-room.html shows a single room');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
