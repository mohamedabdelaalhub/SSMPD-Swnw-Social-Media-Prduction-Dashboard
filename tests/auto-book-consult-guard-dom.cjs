// Rule 9 (owner 2026-11-23) for 20261126040000: «حجوزات تحتاج استكمال» → «اختار الخدمة» as a reception employee in the LIVE
// workspace. The picker shows only what the server lists (consultations; no procedure / home service), explains it, the button
// «احفظها للدكتور ده وسجّل» sends set_service with the chosen service, and a server refusal is shown as-is.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><header class="rx-header"><div class="rx-actions"></div></header><div class="rx-actions" data-section-actions></div><ol></ol></div></body>',{runScripts:'outside-only'});
 const w=dom.window,calls=[],toasts=[],tick=()=>new Promise(r=>setTimeout(r,0));
 const T=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
 const rows=[{id:'e1',source:'masa',state:'review',review_kind:'service',reason:'اختار خدمة الحجز للدكتور ده مرة واحدة وهتتحفظ للحجوزات الجاية',day:T,starts_at:T+'T17:00:00Z',customer_name:'مريض',doctor_name:'د.شريف إبراهيم',provider_id:'pr1',needed_service:'كشف جديد'}];
 // what the patched list returns to reception: consult-pickable, non-home services only
 const listed=[{id:'k1',name:'كشف جراحة عامة',department:'الجراحة'},{id:'s1',name:'استشارة جراحة',department:'الجراحة'}];
 const consult=new Set(listed.map(s=>s.id));
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDAuth={current:()=>({role:'reception'})};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);
   if(a.p_action==='list')return {data:{enabled:true,synced_at:new Date().toISOString(),rows,services:listed},error:null};
   if(a.p_action==='set_service'&&!consult.has(a.p_payload.service_id))return {data:null,error:{message:'اختار خدمة كشف أو استشارة أو متابعة — الإجراءات والخدمات المنزلية ما بتتحفظش للحجز التلقائي'}};
   return {data:{id:a.p_payload.id,state:'booked'},error:null};}}};
 w.eval(fs.readFileSync('assets/js/reception-auto-book.js','utf8'));
 const host=w.document.getElementById('host');let loads=0;
 const c={host,workspace:'ws-live',from:T,to:T,data:{workspace:{mode:'live'}},load:()=>{loads++;return Promise.resolve();}};
 await w.SSMPDReceptionAutoBook.decorate(c,'appointments');
 const box=host.querySelector('[data-rx-auto-book]');assert.ok(box&&!box.hidden,'live workspace: auto-book box shown');
 box.querySelector('[data-ab-open="review"]').click();
 const m=w.document.querySelector('.rx-ab-modal');assert.ok(m);
 const item=[...m.querySelectorAll('.rx-ab-item')].find(x=>x.querySelector('[data-ab-svc]'));assert.ok(item,'service review row');
 const opts=[...item.querySelectorAll('[data-ab-svc] option')].map(o=>o.textContent);
 assert.deepEqual(opts,['اختار الخدمة…','الجراحة — كشف جراحة عامة','الجراحة — استشارة جراحة'],'only the listed consultations');
 assert.ok(!opts.some(t=>/غرز|منزلي|جلسة/.test(t)));
 assert.match(item.querySelector('[data-ab-svc-note]').textContent,/الكشف والاستشارة والمتابعة بس/);
 const btn=item.querySelector('[data-ab="service"]');assert.equal(btn.textContent,'احفظها للدكتور ده وسجّل');
 // no choice → local message, no RPC
 const n0=calls.length;btn.click();await tick();assert.equal(calls.length,n0);assert.equal(toasts.pop()[0],'اختار الخدمة');
 // a stale / tampered id (e.g. «غرز» from an old page) → the server refusal is shown, nothing reloads
 const sel=item.querySelector('[data-ab-svc]');const o=w.document.createElement('option');o.value='ghorz';o.textContent='غرز';sel.appendChild(o);sel.value='ghorz';
 btn.click();for(let i=0;i<20&&!toasts.length;i++)await tick();
 assert.deepEqual(calls.at(-1),['clinic_reception_auto_book',{p_workspace:'ws-live',p_action:'set_service',p_payload:{id:'e1',service_id:'ghorz'}}]);
 assert.match(toasts.pop()[0],/اختار خدمة كشف أو استشارة أو متابعة/);assert.equal(loads,0);
 // the consultation → set_service, success, list reloads
 const item2=[...w.document.querySelectorAll('.rx-ab-modal .rx-ab-item')].find(x=>x.querySelector('[data-ab-svc]'));
 item2.querySelector('[data-ab-svc]').value='k1';item2.querySelector('[data-ab="service"]').click();for(let i=0;i<20&&!loads;i++)await tick();
 assert.deepEqual(calls.filter(x=>x[1].p_action==='set_service').at(-1)[1].p_payload,{id:'e1',service_id:'k1'});assert.equal(loads,1,'reloaded after success');
 const html=fs.readFileSync('index.html','utf8');assert.match(html,/reception-auto-book\.js\?v=consult-guard-20261126-1/);
 console.log('PASS auto-book consult guard screen (reception, live): picker lists consultations only, note shown, set_service sent, server refusal shown.');
})().catch(e=>{console.error(e);process.exit(1);});
