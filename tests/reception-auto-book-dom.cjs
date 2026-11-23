// Owner 2026-11-19: automatic bookings — reception screen (sync bar, source chips, «بدون ميعاد», review actions).
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><header class="rx-header"><div class="rx-actions"></div></header><div class="rx-actions" data-section-actions></div><ol><li><button data-tl-open="ap1">مريض</button><article data-tl-card="ap1"><header><h4>مريض تجريبي</h4></header></article></li></ol><details class="rx-fb-imports"></details></div></body>',{runScripts:'outside-only'});
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
 const box=host.querySelector('[data-rx-auto-book]');assert.ok(box&&!box.hidden);assert.equal(box.closest('.rx-header'),null,'auto-book box must sit outside the blue hero header');assert.equal(box.previousElementSibling&&box.previousElementSibling.hasAttribute('data-section-actions'),true,'placed after the section actions');
 assert.equal(calls[0][0],'clinic_reception_auto_book');assert.equal(calls[0][1].p_action,'list');assert.equal(calls[0][1].p_payload.from,T);
 assert.match(box.textContent,/الحجز التلقائي شغال/);assert.match(box.textContent,/من 4 دقيقة/);assert.match(box.textContent,/اتضاف النهارده 2 موعد/);
 assert.ok(host.querySelector('[data-tl-card="ap1"] h4 .rx-ab-masa'),'chip on the appointment card');assert.ok(host.querySelector('[data-tl-open="ap1"] .rx-ab-tag'));
 assert.ok(host.classList.contains('rx-ab-on'),'old Masa import list hidden when automatic booking is on');
 // long lists: the screen shows two summary tiles only; rows live in a searchable, paged popup (owner 2026-11-22)
 assert.equal(box.querySelectorAll('.rx-ab-item').length,0,'no rows inline');
 assert.equal(box.querySelectorAll('.rx-ab-tile').length,2);assert.match(box.querySelector('[data-ab-open="times-new"]').textContent,/1.*حجوزات من غير ساعة/);assert.match(box.querySelector('[data-ab-open="review"]').textContent,/3.*حجوزات تحتاج استكمال/);
 const doc=w.document,open=t=>{box.querySelector('[data-ab-open="'+t+'"]').click();return doc.querySelector('.rx-ab-modal');};
 let m=open('review');assert.match(m.textContent,/حجوزات تحتاج استكمال \(3\)/);assert.match(m.textContent,/P-2026-000188/);assert.match(m.textContent,/افتح ملف جديد باسم «يوسف»/);
 // «new file» needs an age
 const item=[...m.querySelectorAll('.rx-ab-item')].find(x=>x.textContent.includes('P-2026-000188'));
 item.querySelector('[data-ab="new"]').click();assert.equal(toasts.pop()[0],'اكتب سن المريض الأول');
 item.querySelector('[data-ab-age]').value='9';item.querySelector('[data-ab="new"]').click();assert.match(toasts.pop()[0],/اختار صاحب الرقم/,'shared phone: relationship required (owner 2026-11-21)');
 item.querySelector('[data-po="mother"]').click();item.querySelector('[data-ab="new"]').click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.at(-1)[1],{p_workspace:'ws1',p_action:'resolve_patient',p_payload:{id:'e4',choice:'new',age:9,phone_owner:'mother'}});assert.equal(loads,1);
 item.querySelector('[data-ab="existing"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.at(-1)[1].p_payload.choice,'existing');
 // service + time
 m=doc.querySelector('.rx-ab-modal');const sv=[...m.querySelectorAll('.rx-ab-item')].find(x=>x.querySelector('[data-ab-svc]'));sv.querySelector('[data-ab-svc]').value='s1';sv.querySelector('[data-ab="service"]').click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls.at(-1)[1].p_payload,{id:'e5',service_id:'s1'});
 doc.querySelector('[data-ab-close]').click();assert.equal(doc.querySelector('.rx-ab-modal'),null,'popup closes');
 m=open('times-new');let tm=m.querySelector('.rx-ab-time');tm.querySelector('[data-ab-time]').value='16:20';tm.querySelector('[data-ab="pick"]').click();await new Promise(r=>setTimeout(r,0));
 for(let i=0;i<20&&calls.at(-1)[1].p_action!=='set_time';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.at(-1)[1].p_action,'set_time');assert.equal(calls.at(-1)[1].p_payload.mode,'normal');assert.equal(new Date(calls.at(-1)[1].p_payload.starts_at).toISOString(),w.SSMPDReceptionAutoBook.cairoISO(T,'16:20'));
 // Cairo offset (winter +02:00, summer +03:00)
 assert.equal(w.SSMPDReceptionAutoBook.cairoISO('2026-01-15','10:00'),'2026-01-15T08:00:00.000Z');
 assert.equal(w.SSMPDReceptionAutoBook.cairoISO('2026-07-15','10:00'),'2026-07-15T07:00:00.000Z');
 // dismiss needs a reason
 w.prompt=()=>'';doc.querySelector('.rx-ab-modal [data-ab="dismiss"]').click();const n=calls.length;await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,n);
 w.prompt=()=>'المريض لغى بالتليفون';doc.querySelector('.rx-ab-modal [data-ab="dismiss"]').click();await new Promise(r=>setTimeout(r,0));assert.equal(calls.at(-1)[1].p_action,'dismiss');
// search, source filter and paging (15 per page)
 for(let i=0;i<40;i++)rows.push({id:'p'+i,source:i%2?'whatsapp':'masa',state:'needs_time',day:T,customer_name:'مريض '+i,phone:'0100000'+String(1000+i),doctor_name:'د. تجربة'});
 await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 m=doc.querySelector('.rx-ab-modal')||open('times-new');assert.equal(m.querySelectorAll('.rx-ab-time').length,15,'15 per page');assert.match(m.querySelector('.rx-ab-cnt').textContent,/1–15 من 41/);
 m.querySelector('[data-ab-page="1"]').click();assert.match(doc.querySelector('.rx-ab-cnt').textContent,/16–30 من 41/);
 const q=doc.querySelector('[data-ab-q]');q.value='102';q.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(doc.querySelectorAll('.rx-ab-modal .rx-ab-time').length,10,'phone search');
 q.value='';q.dispatchEvent(new w.Event('input',{bubbles:true}));doc.querySelector('[data-ab-src="whatsapp"]').click();assert.ok([...doc.querySelectorAll('.rx-ab-modal .rx-ab-time')].every(x=>x.textContent.includes('من الواتساب')),'source filter');
 doc.querySelector('[data-ab-close]').click();rows.length=rows.length-40;
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
