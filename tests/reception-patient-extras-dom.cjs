// Owner 2026-11-19: home-visit address/location + permanent/temporary notes in the booking modal and on the today board.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const d=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=d.window,tick=(ms=10)=>new Promise(r=>setTimeout(r,ms));
 const calls=[];let profile={address:{area:'حدائق الأهرام',building:'45'},note:null,pending:null};
 w.SSMPDDb={client:{rpc:async(fn,a)=>{calls.push([a.p_action,JSON.parse(JSON.stringify(a.p_payload))]);
  if(a.p_action==='get')return {data:profile};if(a.p_action==='board')return {data:{extras:{ap1:{home:true,address:{area:'حدائق',building:'45',floor:'3',apartment:'12',maps_url:'https://maps.app.goo.gl/x1'},note:'كرسي متحرك',patient_note:'بعد العصر'}}}};
  if(a.p_action==='note_requests')return {data:[{id:'q1',file_no:'F1',patient:'مريضة',old_note:'قديمة',new_note:null,reason:'اتدفع',requested_by:'دينا'}]};return {data:{ok:true}};}}};
 let opened='';w.open=(u)=>{opened=u;return null;};w.alert=()=>{};
 w.eval(fs.readFileSync('assets/js/reception-patient-extras.js','utf8'));const X=w.SSMPDReceptionExtras;
 const form=w.document.createElement('form');form.innerHTML='<section class="rx-card"><label><select name="patient_id"><option value="">—</option><option value="p1">مريضة</option></select></label></section><section class="rx-card"><select name="service_id"><option value="">—</option><option value="s1">عيادة</option><option value="s2">جلسة منزلية</option></select></section><section class="rx-card"></section>';
 w.document.body.appendChild(form);
 const data={patients:[{id:'p1',phone:'01012345612'}],services:[{id:'s1',is_home:false},{id:'s2',is_home:true}]};
 form.elements.patient_id.value='p1';X.enhance(form,{data,workspace:'ws1',appointment:null});await tick();
 assert(form.elements.x_note,'empty permanent note → textarea to write one');
 const home=form.querySelector('[data-rxe-home]');assert.equal(home.hidden,true,'address hidden for a normal booking');
 form.elements.service_id.value='s2';form.elements.service_id.dispatchEvent(new w.Event('change'));
 assert.equal(form.elements.x_home.checked,true,'home service switches the home visit on');assert.equal(home.hidden,false);assert.equal(form.elements.x_area.required,true);
 assert.equal(form.elements.x_area.value,'حدائق الأهرام','address pre-filled from the patient file');
 const go=form.querySelector('[data-rxe-go]');assert.equal(go.getAttribute('aria-disabled'),'true');
 form.elements.x_maps_url.value='https://maps.app.goo.gl/abc';form.elements.x_maps_url.dispatchEvent(new w.Event('input'));assert.equal(go.getAttribute('aria-disabled'),'false');assert.equal(go.href,'https://maps.app.goo.gl/abc');
 form.querySelector('[data-rxe-ask]').click();assert(opened.startsWith('https://wa.me/201012345612?text='),'WhatsApp opens with a ready message (not sent)');
 // payload split + save after booking
 const payload={patient_id:'p1',service_id:'s2',x_home:'on',x_area:'حدائق',x_building:'45',x_floor:'3',x_maps_url:'https://maps.app.goo.gl/abc',x_note:'بعد العصر',x_appointment_note:'كرسي'};
 const x=X.take(payload);assert.equal(Object.keys(payload).filter(k=>k.startsWith('x_')).length,0,'booking command gets no x_ fields');
 const r=await X.after('ws1',{id:'ap9'},x,'p1');assert.equal(r.id,'ap9');
 const save=calls.find(c=>c[0]==='save_booking')[1];assert.equal(save.appointment_id,'ap9');assert.equal(save.home,true);assert.equal(save.address.floor,'3');assert.equal(save.note,'بعد العصر');assert.equal(save.appointment_note,'كرسي');
 await assert.rejects(()=>X.after('ws1',{id:'a'},{home:'on',area:'x',building:'1',maps_url:'https://evil.example'},'p1'),/خرائط جوجل/);
 // existing permanent note → band with a request button (no direct edit)
 profile={address:{},note:'عليه باقي معمل',note_by:'دينا',pending:null};const f2=form.cloneNode(true);f2.querySelectorAll('[data-rxe],[data-rxe-note],[data-rxe-home],.rxe-switch,.rxe-tnote').forEach(n=>n.remove());w.document.body.appendChild(f2);
 f2.elements.patient_id.value='p1';X.enhance(f2,{data,workspace:'ws1'});await tick();
 assert(!f2.elements.x_note,'no free edit of an existing note');assert(/عليه باقي معمل/.test(f2.textContent));f2.querySelector('[data-rxe-req]').click();
 const m=w.document.querySelector('.rx-modal');assert(/طلب تعديل/.test(m.textContent));m.querySelector('[name=reason]').value='اتدفع';m.querySelector('[name=note]').value='';m.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 const req=calls.find(c=>c[0]==='note_change_request')[1];assert.equal(req.note,'');assert.equal(req.reason,'اتدفع');
 // today board decoration + manager requests
 const host=w.document.createElement('div');host.innerHTML='<article data-appointment="ap1"><button class="journey-chip">مريضة</button><div class="journey-card-detail" hidden></div></article>';w.document.body.appendChild(host);
 X.decorate(host,'ws1',[{id:'ap1'}]);await tick();
 assert(host.querySelector('.rxe-tag-home')&&host.querySelector('.rxe-tag-note'),'🏠 and 📌 on the chip');assert(/عمارة 45/.test(host.textContent)&&/كرسي متحرك/.test(host.textContent)&&/بعد العصر/.test(host.textContent));
 assert.equal(host.querySelector('.rxe-board a').getAttribute('href'),'https://maps.app.goo.gl/x1');
 const rb=host.querySelector('[data-rxe-reqs]');assert(/\(1\)/.test(rb.textContent));rb.click();const rm=[...w.document.querySelectorAll('.rx-modal')].pop();rm.querySelector('[data-ok]').click();await tick();
 assert.equal(calls.find(c=>c[0]==='note_review')[1].approve,true);
 console.log('PASS patient extras DOM: home switch from service, prefilled address, maps link + WhatsApp request, payload split, note band → request, board marks, manager approval.');
})().catch(e=>{console.error(e);process.exitCode=1;});
