// Owner 2026-11-23 «طبق حل الحجوزات»: «بلّغ المريض بالميعاد» list, «يوم الدكتور مليان» rows with free-time chips from
// 'extras', capacity, «حجز إضافي فوق الجدول» / «ميعاد يدوي» payloads, «اتبلّغ المريض», today-ops Masa strip (mocked RPC).
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions" data-section-actions></div></div></body>',{runScripts:'outside-only'});
 const w=dom.window,calls=[],toasts=[];
 const T=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
 const T2=new Date(Date.parse(T+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const rows=[
  {id:'a1',source:'masa',state:'booked',auto_timed:true,time_told_at:null,day:T2,starts_at:T2+'T20:40:00Z',appointment_id:'ap1',customer_name:'منى سمير',phone:'01000000000',doctor_name:'أخصائي جلدية',provider_id:'pv1'},
  {id:'a2',source:'masa',state:'booked',auto_timed:true,time_told_at:new Date().toISOString(),day:T2,starts_at:T2+'T21:00:00Z',appointment_id:'ap2',customer_name:'متبلّغ قبل كده',provider_id:'pv1'},
  {id:'f1',source:'masa',state:'review',review_kind:'full_day',reason:'يوم الدكتور مليان — مفيش ميعاد فاضي في اليوم ده.',day:T2,customer_name:'هالة مصطفى',phone:'01000000000',doctor_name:'أخصائي جلدية',provider_id:'pv1'}];
 const extras={f1:{id:'f1',free:[],suggest:[T2.replace(/\d\d$/,m=>String(+m+1).padStart(2,'0'))+'T20:15:00Z'],capacity:{booked:12,capacity:8}},a1:{id:'a1',free:[T2+'T21:20:00Z'],suggest:[],capacity:{booked:6,capacity:8}}};
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};w.confirm=()=>true;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);
  if(a.p_action==='list')return {data:{enabled:true,synced_at:new Date().toISOString(),rows,services:[]},error:null};
  if(a.p_action==='extras')return {data:{rows:a.p_payload.ids.map(i=>extras[i]).filter(Boolean)},error:null};
  return {data:{id:a.p_payload.id,state:'booked',told:a.p_action==='told'},error:null};}}};
 w.eval(fs.readFileSync('assets/js/reception-auto-book.js','utf8'));
 const host=w.document.getElementById('host'),c={host,workspace:'ws1',from:T,to:T,data:{workspace:{mode:'live'}},load:()=>Promise.resolve()};
 await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 const box=host.querySelector('[data-rx-auto-book]');
 const tile=box.querySelector('[data-ab-open="told"]');assert(tile,'«بلّغ المريض بالميعاد» tile');assert.equal(tile.querySelector('.rx-ab-n').textContent,'1','only the not-told one');
 assert.match(box.querySelector('[data-ab-open="review"]').textContent,/1 منهم يوم الدكتور مليان/);
 // told list
 tile.click();let m=w.document.querySelector('.rx-ab-modal');assert.match(m.querySelector('[data-ab-title]').textContent,/بلّغ المريض بالميعاد \(1\)/);
 const it=m.querySelector('.rx-ab-told');assert.match(it.textContent,/اتحط ميعاد لوحده/);assert.match(it.textContent,/بلّغ المريض بالساعة/);
 it.querySelector('[data-ab="told"]').click();await sleep(5);assert.deepEqual(calls.at(-1)[1],{p_workspace:'ws1',p_action:'told',p_payload:{id:'a1'}});assert.match(toasts.at(-1)[0],/اتبلّغ/);
 // change time → picker with today's free chip, normal mode
 m=w.document.querySelector('.rx-ab-modal');m.querySelector('[data-ab="change"]').click();for(let i=0;i<30&&!w.document.querySelector('.rx-ab-told [data-ab="slot"]');i++)await sleep(5);
 m=w.document.querySelector('.rx-ab-modal');assert(calls.some(x=>x[1].p_action==='extras'&&x[1].p_payload.ids.includes('a1')),'extras fetched for the open row');
 let chip=m.querySelector('.rx-ab-told [data-ab="slot"]');chip.click();assert(chip.classList.contains('on'));
 m.querySelector('.rx-ab-told [data-ab="pick"]').click();await sleep(5);
 assert.deepEqual(calls.at(-1)[1].p_payload,{id:'a1',starts_at:T2+'T21:20:00Z',mode:'normal'});
 w.document.querySelector('[data-ab-close]').click();
 // full day row: capacity, suggestion on another day, overbook / manual payloads, no blind-only box
 box.querySelector('[data-ab-open="review"]').click();for(let i=0;i<30&&!w.document.querySelector('.rx-ab-full [data-ab="slot"]');i++)await sleep(5);
 m=w.document.querySelector('.rx-ab-modal');const fr=m.querySelector('.rx-ab-full');assert(fr,'full-day row');assert.match(fr.textContent,/يوم الدكتور مليان/);
 assert.match(fr.querySelector('.rx-ab-cap').textContent,/المحجوز 12 من 8 · مليان/);assert.match(fr.textContent,/مفيش وقت فاضي في اليوم ده/);
 assert(fr.querySelector('a.rx-ab-call[href^="tel:"]'),'contact to postpone');
 fr.querySelector('[data-ab="overbook"]').click();await sleep(5);assert.match(toasts.at(-1)[0],/اختار وقت/,'needs a time first');
 fr.querySelector('[data-ab="slot"]').click();fr.querySelector('[data-ab="overbook"]').click();await sleep(5);
 assert.equal(calls.at(-1)[1].p_payload.mode,'overbook');assert.equal(calls.at(-1)[1].p_payload.id,'f1');assert(calls.at(-1)[1].p_payload.reason_kind);
 m=w.document.querySelector('.rx-ab-modal');const fr2=m.querySelector('.rx-ab-full');fr2.querySelector('[data-ab-time]').value='23:30';fr2.querySelector('[data-ab="manual"]').click();await sleep(5);
 const pm=calls.at(-1)[1].p_payload;assert.equal(pm.mode,'manual');assert.equal(pm.starts_at,w.SSMPDReceptionAutoBook.cairoISO(T2,'23:30'));
 assert(!/[٠-٩]/.test(w.document.body.textContent),'English digits only');
 // today ops: Masa strip in «حجوزات آلية»
 const src=fs.readFileSync('assets/js/today-auto-bookings.js','utf8');assert(/data-tds-masa/.test(src)&&/clinic_reception_auto_book/.test(src),'today ops strip wired');
 // «حجز موعد»: doctor's day capacity under the date
 w.eval(fs.readFileSync('assets/js/reception-day-capacity.js','utf8'));
 const f=w.document.createElement('form');f.innerHTML='<label>الطبيب<select name="provider_id"><option value="">-</option><option value="pv1" selected>د</option></select></label><label>التاريخ<input name="day" type="date" value="'+T2+'"></label>';w.document.body.appendChild(f);
 const capFor={};capFor[T2]={day:T2,booked:12,capacity:8};capFor[T]={day:T,booked:2,capacity:8};
 w.SSMPDDb.client.rpc=async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return {data:{days:[capFor[a.p_payload.from]]},error:null};};
 w.SSMPDDayCapacity.enhance(f,{workspace:'ws1'});for(let i=0;i<20&&f.querySelector('[data-rx-cap]').hidden;i++)await sleep(5);
 const cp=f.querySelector('[data-rx-cap]');assert.equal(cp.textContent,'المحجوز عند الدكتور في اليوم ده: 12 من 8 · اليوم مليان');assert(cp.classList.contains('is-full'));
 assert.equal(calls.at(-1)[1].p_action,'capacity');assert.deepEqual(calls.at(-1)[1].p_payload,{provider_id:'pv1',from:T2,to:T2});
 f.elements.day.value=T;f.elements.day.dispatchEvent(new w.Event('change',{bubbles:true}));await sleep(200);assert.equal(cp.textContent,'المحجوز عند الدكتور في اليوم ده: 2 من 8');
 assert(/SSMPDDayCapacity\.enhance\(form,\{workspace:workspace/.test(fs.readFileSync('assets/js/reception-workspace.js','utf8')),'hooked in the booking form');
 const html=fs.readFileSync('index.html','utf8');assert(html.indexOf('reception-day-capacity.js')>0&&html.indexOf('reception-day-capacity.js')<html.indexOf('reception-workspace.js'));
 console.log('PASS masa day-only auto time UI: capacity on «حجز موعد», told tile/list + told, change time chips (normal), full-day row with capacity, other-day suggestion, overbook/manual payloads, contact link.');
})().catch(e=>{console.error(e);process.exit(1);});
