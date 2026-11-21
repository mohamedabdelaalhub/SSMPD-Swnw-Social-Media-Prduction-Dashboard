// «متابعات مطلوبة» reception card: list (late/today/soon), tabs, actions → RPC, «احجز دلوقتي» opens the booking form prefilled,
// «+ متابعة جديدة» creates with months / weeks / date; hooked into reception-workspace + index.html.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const dom=new JSDOM('<body><div id="host"><section class="rx-section"></section></div></body>',{runScripts:'outside-only',url:'https://x.test/'}),w=dom.window,d=w.document;
 const calls=[],toasts=[];let rows=[{id:'f1',patient_id:'p1',patient_name:'سارة تجريبية',file_no:'F1',phone:'01000000000',provider_id:'d1',doctor_name:'د. جلدية تجريبي',due_date:'2026-11-16',days:-5,note:'مراجعة',status:'open',attempts:0},
  {id:'f2',patient_id:'p2',patient_name:'محمود تجريبي',provider_id:'d2',doctor_name:'د. باطنة تجريبي',service_id:'s2',due_date:'2026-11-21',days:0,status:'open',attempts:1},
  {id:'f3',patient_id:'p3',patient_name:'يوسف تجريبي',provider_id:'d1',doctor_name:'د. أطفال تجريبي',due_date:'2026-11-30',days:9,status:'open',attempts:0}];
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDDb={client:{rpc:async(fn,a)=>{calls.push([fn,JSON.parse(JSON.stringify(a))]);if(a.p_action==='list')return {data:{today:'2026-11-21',rows:a.p_payload.scope==='booked'?[]:rows,counts:{late:1,today:1,soon:1}}};return {data:{id:'new'}};}}};
 w.eval(fs.readFileSync('assets/js/reception-follow-ups.js','utf8'));
 let booked=null,modalSave=null;
 const ctx={host:d.getElementById('host'),workspace:'ws1',data:{workspace:{id:'ws1',mode:'live'},patients:[{id:'p1',name:'سارة تجريبية'},{id:'p9',name:'منى تجريبية'}],providers:[{id:'d1',name:'د. جلدية تجريبي',department:'الجلدية'}],appointments:[{id:'a1',patient_id:'p9',provider_id:'d1',status:'booked'}]},
  select:(n,t,r)=>'<label>'+t+'<select name="'+n+'" required><option value="">اختر</option>'+r.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+'</select></label>',
  book:id=>{booked=id;const m=d.createElement('div');m.className='rx-modal';m.innerHTML='<form><select name="provider_id"><option value="">-</option><option value="d2">x</option></select><select name="service_id"><option value="">-</option><option value="s2">y</option></select><p data-rx-status></p></form>';d.body.appendChild(m);},
  modal:(title,body,save,onSaved)=>{const m=d.createElement('div');m.className='rx-modal';m.innerHTML='<form>'+body+'</form>';d.body.appendChild(m);modalSave=async()=>{const v={};new w.FormData(m.querySelector('form')).forEach((val,k)=>v[k]=val);const r=await save(v);m.remove();onSaved&&onSaved(r);return r;};return m;}};
 const tick=()=>new Promise(r=>setTimeout(r,0));
 w.SSMPDFollowUps.decorate(ctx,'operations');await tick();await tick();
 const card=d.querySelector('[data-rfu]');assert.ok(card,'card mounted');
 assert.deepEqual([...card.querySelectorAll('.rfu-row')].map(r=>r.className.split(' ')[1]),['late','today','soon']);
 assert.match(card.querySelector('.rfu-count').textContent,/1 متأخرة · 1 النهارده · 1 خلال أسبوعين/);
 assert.match(card.querySelector('.rfu-row.late .rfu-due').textContent,/متأخرة5 أيام/);
 const wa=card.querySelector('[data-fu="wa"]');assert.match(wa.href,/^https:\/\/wa\.me\/201000000000\?text=/,'wa.me opens only');
 card.querySelector('.rfu-row.today [data-fu="attempt"]').click();await tick();await tick();
 assert.deepEqual(calls.find(c=>c[1].p_action==='attempt')[1].p_payload,{id:'f2',note:'مردش'});
 w.prompt=()=>'2027-01-10';d.querySelector('.rfu-row.late [data-fu="postpone"]').click();await tick();
 assert.deepEqual(calls.find(c=>c[1].p_action==='postpone')[1].p_payload,{id:'f1',due_date:'2027-01-10'});
 w.prompt=()=>'سافر بره';d.querySelector('.rfu-row.soon [data-fu="close"]').click();await tick();
 assert.deepEqual(calls.find(c=>c[1].p_action==='close')[1].p_payload,{id:'f3',reason:'سافر بره'});
 d.querySelector('.rfu-row.today [data-fu="book"]').click();
 assert.equal(booked,'p2');const bf=d.querySelector('.rx-modal form');assert.equal(bf.elements.provider_id.value,'d2');assert.equal(bf.elements.service_id.value,'s2');
 assert.match(bf.querySelector('[data-rx-status]').textContent,/هتتقفل «اتحجزت» لوحدها/);bf.closest('.rx-modal').remove();
 d.querySelector('[data-fu-scope="booked"]').click();await tick();await tick();
 assert.equal(calls.at(-1)[1].p_payload.scope,'booked');assert.match(d.querySelector('[data-rfu] .rfu-empty').textContent,/مفيش متابعات هنا/);
 // new follow-up: from today's appointment, default 3 months, then «تاريخ…»
 d.querySelector('[data-fu="new"]').click();const nf=d.querySelector('.rx-modal form');
 nf.elements.from_appt.value='a1';nf.elements.from_appt.onchange.call(nf.elements.from_appt);
 assert.equal(nf.elements.patient_id.value,'p9');assert.equal(nf.elements.provider_id.value,'d1');
 nf.elements.note.value='تحليل قبل الكشف';await modalSave();
 assert.deepEqual(calls.find(c=>c[1].p_action==='create')[1].p_payload,{patient_id:'p9',provider_id:'d1',note:'تحليل قبل الكشف',source_appointment_id:'a1',months:3});
 d.querySelector('[data-fu="new"]').click();const nf2=d.querySelectorAll('.rx-modal form');const f2=nf2[nf2.length-1];
 f2.elements.patient_id.value='p1';f2.elements.provider_id.value='d1';f2.querySelector('[data-after="date"]').click();
 assert.equal(f2.elements.due_date.hidden,false);await assert.rejects(modalSave,/اختار التاريخ/);
 f2.elements.due_date.value='2027-03-01';await modalSave();
 assert.equal(calls.filter(c=>c[1].p_action==='create').at(-1)[1].p_payload.due_date,'2027-03-01');
 // trial workspace: no card
 const host2=d.createElement('div');w.SSMPDFollowUps.decorate({...ctx,host:host2,data:{...ctx.data,workspace:{id:'t',mode:'trial'}}},'operations');assert.equal(host2.querySelector('[data-rfu]'),null);
 const rw=fs.readFileSync('assets/js/reception-workspace.js','utf8'),ix=fs.readFileSync('index.html','utf8');
 assert(/SSMPDFollowUps\.decorate\(context\(\),section\)/.test(rw)&&/,book:bookModal/.test(rw),'hook + book in context');
 assert(/reception-follow-ups\.js\?v=/.test(ix)&&/reception-follow-ups\.css\?v=/.test(ix),'loaded');
 console.log('PASS reception follow-ups card');
})().catch(e=>{console.error(e);process.exit(1);});
