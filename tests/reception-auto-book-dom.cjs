// Owner 2026-11-19: automatic bookings — reception screen (sync bar, source chips, «بدون ميعاد», review actions).
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions"></div><ol><li><button data-tl-open="ap1">مريض</button><article data-tl-card="ap1"><header><h4>مريض تجريبي</h4></header></article></li></ol><details class="rx-fb-imports"></details></div></body>',{runScripts:'outside-only'});
 const w=dom.window,calls=[],toasts=[];
 const T=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
 const rows=[
  {id:'e1',source:'masa',state:'booked',day:T,starts_at:T+'T14:00:00Z',appointment_id:'ap1',customer_name:'مريض تجريبي',patient_created:false},
  {id:'e2',source:'whatsapp',state:'booked',day:T,starts_at:T+'T15:00:00Z',appointment_id:'ap2',patient_created:true},
  {id:'e3',source:'masa',state:'needs_time',day:T,day_only:true,customer_name:'مريض بدون ساعة',phone:'01000000000',doctor_name:'أخصائي جلدية'},
  {id:'e4',source:'masa',state:'review',review_kind:'patient',reason:'الرقم ده متسجّل لمريض تاني',day:T,starts_at:T+'T16:00:00Z',customer_name:'يوسف أحمد تجريبي',phone:'01012345637',doctor_name:'أخصائي جلدية',candidate:{id:'p1',patient_code:'P-2026-000188',full_name:'أحمد محمود تجريبي'}},
  {id:'e5',source:'portal',state:'review',review_kind:'service',reason:'اختار خدمة',day:T,starts_at:T+'T17:00:00Z',customer_name:'مريضة',doctor_name:'أخصائي أسنان'},
  {id:'e6',source:'masa',state:'review',review_kind:'slot',reason:'مقدرتش أسجّل الميعاد: الميعاد محجوز',day:T,starts_at:T+'T18:00:00Z',customer_name:'مريض',doctor_name:'أخصائي جلدية'}];
 let enabled=true;
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);if(a.p_action==='list')return {data:{enabled,synced_at:new Date(Date.now()-4*60000).toISOString(),rows,services:[{id:'s1',name:'كشف',department:'أسنان'}]},error:null};return {data:{id:a.p_payload.id,state:'booked'},error:null};}}};
 w.eval(fs.readFileSync('assets/js/reception-auto-book.js','utf8'));
 const host=w.document.getElementById('host');let loads=0;
 const c={host,workspace:'ws1',from:T,to:T,data:{workspace:{mode:'live'}},load:()=>{loads++;return Promise.resolve();}};
 await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 const box=host.querySelector('[data-rx-auto-book]');assert.ok(box&&!box.hidden);
 assert.equal(calls[0][0],'clinic_reception_auto_book');assert.equal(calls[0][1].p_action,'list');assert.equal(calls[0][1].p_payload.from,T);
 assert.match(box.textContent,/الحجز التلقائي شغال/);assert.match(box.textContent,/من 4 دقيقة/);assert.match(box.textContent,/اتضاف النهارده 2 موعد/);
 assert.ok(host.querySelector('[data-tl-card="ap1"] h4 .rx-ab-masa'),'chip on the appointment card');assert.ok(host.querySelector('[data-tl-open="ap1"] .rx-ab-tag'));
 assert.ok(host.classList.contains('rx-ab-on'),'old Masa import list hidden when automatic booking is on');
 assert.match(box.textContent,/حجوزات من غير ساعة \(1\)/);assert.match(box.textContent,/حجوزات تحتاج استكمال \(3\)/);
 assert.match(box.textContent,/P-2026-000188/);assert.match(box.textContent,/افتح ملف جديد باسم «يوسف»/);
 // «new file» needs an age
 const item=[...box.querySelectorAll('.rx-ab-item')].find(x=>x.textContent.includes('P-2026-000188'));
 item.querySelector('[data-ab="new"]').click();assert.equal(toasts.pop()[0],'اكتب سن المريض الأول');
 item.querySelector('[data-ab-age]').value='9';item.querySelector('[data-ab="new"]').click();assert.match(toasts.pop()[0],/اختار صاحب الرقم/,'shared phone: relationship required (owner 2026-11-21)');
 item.querySelector('[data-po="mother"]').click();item.querySelector('[data-ab="new"]').click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.at(-1)[1],{p_workspace:'ws1',p_action:'resolve_patient',p_payload:{id:'e4',choice:'new',age:9,phone_owner:'mother'}});assert.equal(loads,1);
 item.querySelector('[data-ab="existing"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.at(-1)[1].p_payload.choice,'existing');
 // service + time
 const sv=[...box.querySelectorAll('.rx-ab-item')].find(x=>x.querySelector('[data-ab-svc]'));sv.querySelector('[data-ab-svc]').value='s1';sv.querySelector('[data-ab="service"]').click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.at(-1)[1].p_payload,{id:'e5',service_id:'s1'});
 const tm=box.querySelector('.rx-ab-time');tm.querySelector('[data-ab-time]').value='16:20';tm.querySelector('[data-ab="time"]').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.at(-1)[1].p_action,'set_time');assert.equal(new Date(calls.at(-1)[1].p_payload.starts_at).toISOString(),w.SSMPDReceptionAutoBook.cairoISO(T,'16:20'));
 // Cairo offset (winter +02:00, summer +03:00)
 assert.equal(w.SSMPDReceptionAutoBook.cairoISO('2026-01-15','10:00'),'2026-01-15T08:00:00.000Z');
 assert.equal(w.SSMPDReceptionAutoBook.cairoISO('2026-07-15','10:00'),'2026-07-15T07:00:00.000Z');
 // dismiss needs a reason
 w.prompt=()=>'';box.querySelector('[data-ab="dismiss"]').click();const n=calls.length;await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,n);
 w.prompt=()=>'المريض لغى بالتليفون';box.querySelector('[data-ab="dismiss"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.at(-1)[1].p_action,'dismiss');
 // escaping
 rows.push({id:'x',source:'masa',state:'needs_time',day:T,customer_name:'<img src=x onerror=1>'});await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 assert.ok(!box.querySelector('img'));
 // disabled or other sections: nothing shown
 enabled=false;await w.SSMPDReceptionAutoBook.decorate(c,'appointments');assert.ok(box.hidden);assert.ok(!host.classList.contains('rx-ab-on'));
 const before=calls.length;await w.SSMPDReceptionAutoBook.decorate(c,'visits');await w.SSMPDReceptionAutoBook.decorate({...c,data:{workspace:{mode:'trial'}}},'appointments');assert.equal(calls.length,before);
 // wired into the reception screen and loaded by index.html
 assert.match(fs.readFileSync('assets/js/reception-workspace.js','utf8'),/SSMPDReceptionAutoBook\.decorate\(context\(\),section\)/);
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/reception-auto-book\.js\?v=/);assert.match(html,/reception-auto-book\.css\?v=/);
 console.log('PASS reception auto-book screen.');
})().catch(e=>{console.error(e);process.exit(1);});
