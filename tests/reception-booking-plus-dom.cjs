// Owner 2026-11-20: «العدد» next to the service, «جلسة استكمال», «لم يرد» on the timeline card.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM(`<!doctype html><body><form id="f"><select name="patient_id"><option value="">-</option><option value="p1">م</option><option value="p2">ن</option></select>
  <select name="package_id"><option value="">بدون</option><option value="k1">باكج</option></select>
  <div class="rx-card"><div class="rx-combo-field"><label>الخدمة</label></div><select name="service_id"><option value="">-</option><option value="crown">طربوش</option><option value="fill">حشو</option></select></div></form></body>`,{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,0));
 const cand={p1:[{id:'o1',service:'طربوش زيركون',at:'2026-11-12T10:00:00Z',doctor:'د. أسنان',amount:4000},{id:'o2',service:'طربوش زيركون',at:'2026-11-02T10:00:00Z',doctor:'د. أسنان',amount:4000}],p2:[]};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);if(n==='clinic_reception_nurses')return {data:[{id:'n1',name:'ممرضة أولى',code:'EMP-1'},{id:'n2',name:'<b>x</b>',code:null}]};return {data:cand[a.p_patient]||[]};}}};
 w.eval(fs.readFileSync('assets/js/reception-booking-plus.js','utf8'));const P=w.SSMPDReceptionBookingPlus;
 const f=d.getElementById('f'),data={services:[{id:'crown',price:4000},{id:'fill',price:1500}]};
 P.enhance(f,{data,workspace:'ws1',mode:'live'});P.enhance(f,{data,workspace:'ws1',mode:'live'});
 assert.equal(d.querySelectorAll('[data-rbp]').length,1,'enhanced once');
 const fire=(el,t)=>el.dispatchEvent(new w.Event(t,{bubbles:true}));
 // quantity + total
 f.elements.service_id.value='crown';fire(f.elements.service_id,'change');
 const tot=d.querySelector('.rbp-total');assert.equal(tot.hidden,true,'no total at 1');
 d.querySelector('[data-rbp-step="1"]').click();d.querySelector('[data-rbp-step="1"]').click();
 assert.equal(f.elements.quantity.value,'3');assert.equal(tot.hidden,false);assert.match(tot.textContent,/3 × 4,000 جم/);assert.match(tot.textContent,/الإجمالي 12,000 جم/);
 for(let i=0;i<5;i++)d.querySelector('[data-rbp-step="-1"]').click();assert.equal(f.elements.quantity.value,'1','never below 1');
 f.elements.quantity.value='150';fire(f.elements.quantity,'change');assert.equal(f.elements.quantity.value,'99','capped');
 // package hides quantity and continuation, forces 1
 f.elements.package_id.value='k1';fire(f.elements.package_id,'change');assert.equal(d.querySelector('.rbp-qty').hidden,true);assert.equal(d.querySelector('.rbp-cont').hidden,true);assert.equal(f.elements.quantity.value,'1');
 f.elements.package_id.value='';fire(f.elements.package_id,'change');
 // continuation: needs patient + service; lists earlier sessions, first picked
 const cb=d.querySelector('[data-rbp-cont]');cb.checked=true;fire(cb,'change');assert.match(d.querySelector('[data-rbp-pick]').textContent,/اختار المريض والخدمة الأول/);
 f.elements.patient_id.value='p1';fire(f.elements.patient_id,'change');await tick();
 assert.deepEqual(calls.at(-1),['clinic_reception_continuation_candidates',{p_workspace:'ws1',p_patient:'p1',p_service:'crown'}]);
 const btns=d.querySelectorAll('[data-rbp-id]');assert.equal(btns.length,2);assert.equal(f.elements.continuation_of.value,'o1');assert.equal(d.querySelector('.rbp-qty').hidden,true,'continuation is 1 session');
 assert.match(btns[0].textContent,/اتدفع 4,000 جم/);btns[1].click();assert.equal(f.elements.continuation_of.value,'o2');assert.equal(btns[1].getAttribute('aria-pressed'),'true');
 // patient without earlier session → warning and switch off
 f.elements.patient_id.value='p2';fire(f.elements.patient_id,'change');await tick();
 assert.match(d.querySelector('[data-rbp-pick]').textContent,/مالوش جلسة سابقة/);assert.equal(cb.checked,false);assert.equal(f.elements.continuation_of.value,'');
 // submit with the switch on but nothing picked is stopped
 cb.checked=true;f.elements.continuation_of.value='';let reached=false;f.addEventListener('submit',e=>{reached=true;e.preventDefault();});
 f.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(reached,false);
 // trial mode: no continuation
 const f2=f.cloneNode(true);f2.querySelectorAll('[data-rbp]').forEach(x=>x.replaceWith(x.querySelector('.rx-combo-field')));f2.querySelectorAll('.rbp-total,.rbp-cont,[data-rbp-perf]').forEach(x=>x.remove());f2.id='f2';d.body.appendChild(f2);
 P.enhance(f2,{data,workspace:'ws1',mode:'trial'});assert.equal(f2.querySelector('.rbp-cont').hidden,true);
 // editing a booking keeps its quantity
 const f3=f2.cloneNode(true);f3.querySelectorAll('[data-rbp]').forEach(x=>x.replaceWith(x.querySelector('.rx-combo-field')));f3.querySelectorAll('.rbp-total,.rbp-cont,[data-rbp-perf]').forEach(x=>x.remove());f3.id='f3';d.body.appendChild(f3);
 P.enhance(f3,{data,workspace:'ws1',mode:'live',appointment:{quantity:4}});assert.equal(f3.elements.quantity.value,'4');
 // performer: doctor by default, nurse modes need a nurse (escaped list, loaded once)
 const seg=d.querySelectorAll('#f [data-rbp-mode]');assert.equal(seg.length,3);assert.equal(f.elements.performer_mode.value,'doctor');assert.equal(d.querySelector('#f [data-rbp-nurse]').hidden,true);
 d.querySelector('#f [data-rbp-mode="nurse_alone"]').click();await tick();assert.equal(f.elements.performer_mode.value,'nurse_alone');assert.equal(f.elements.nurse_admin_id.required,true);
 assert.equal(f.elements.nurse_admin_id.options.length,3);assert.ok(!d.querySelector('#f [data-rbp-nurse] b'),'escaped');assert.match(f.elements.nurse_admin_id.textContent,/ممرضة أولى — EMP-1/);
 assert.equal(d.querySelector('#f [data-rbp-nurse-hint]').hidden,false);
 d.querySelector('#f [data-rbp-mode="nurse_with_doctor"]').click();assert.equal(d.querySelector('#f [data-rbp-nurse-hint]').hidden,true);
 f.elements.nurse_admin_id.value='n1';d.querySelector('#f [data-rbp-mode="doctor"]').click();assert.equal(f.elements.nurse_admin_id.value,'');assert.equal(f.elements.nurse_admin_id.required,false);
 assert.equal(calls.filter(c=>c[0]==='clinic_reception_nurses').length,1,'nurse list fetched once');
 // trial forms have no performer part
 assert.equal(f2.querySelector('[data-rbp-perf]'),null);
 // card bits
 let b=P.cardBits({status:'booked',no_answer_count:2,last_no_answer_at:'2030-01-01T09:40:00Z',quantity:3,continuation_of:'o1'},()=>'11:40 ص');
 assert.match(b.name,/لم يرد · مرتين · آخر مرة 11:40 ص/);assert.match(b.line,/× 3/);assert.match(b.line,/استكمال/);
 assert.equal(P.cardBits({status:'booked',confirmed_at:'x',no_answer_count:2}).name,'','hidden once confirmed');
 assert.match(P.cardBits({status:'booked',performer_mode:'nurse_alone',nurse_admin_id:'n1'}).line,/🩺 ممرض\/ة: ممرضة أولى/);assert.equal(P.cardBits({status:'booked',performer_mode:'doctor'}).line,'');
 assert.equal(P._t.times(1),'مرة');assert.equal(P._t.times(5),'5 مرات');
 // wiring
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
 assert.match(src,/btn\('no_answer',a\.id,'لم يرد'\)/);assert.match(src,/command\('no_answer',\{id:id\},crypto\.randomUUID\(\)\)/);assert.match(src,/SSMPDReceptionBookingPlus\.enhance\(form,/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reception-booking-plus.js')<html.indexOf('reception-workspace.js?v='),'loaded before the workspace');
 assert.ok(html.includes('reception-booking-plus.css?v='));
 console.log('PASS reception booking quantity / continuation / no-answer screen.');
})().catch(e=>{console.error(e);process.exit(1);});
