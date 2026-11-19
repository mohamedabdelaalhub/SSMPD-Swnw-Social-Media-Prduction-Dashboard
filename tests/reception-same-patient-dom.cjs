// Owner 2026-11-19: same-day warning (confirm / go back to the original booking), details popup, card button.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<!doctype html><body><div id="host"><article data-tl-card="ap1"><footer><div class="rx-actions"><button>تسجيل حضور</button></div></footer></article></div></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[];
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return {data:{service:'كشف جلدية',doctor:'أخصائي جلدية',starts_at:'2030-01-01T15:00:00Z',status:'booked',patient:'<b>x</b>',note:'هتيجي مع والدتها'},error:null};}}};
 w.eval(fs.readFileSync('assets/js/reception-same-patient.js','utf8'));const G=w.SSMPDReceptionSamePatient;
 const err={hint:'same_patient_same_day',message:'x',details:JSON.stringify([{id:'a1',starts_at:'2030-01-01T15:00:00Z',ends_at:'2030-01-01T15:20:00Z',service:'كشف جلدية',doctor:'أخصائي جلدية',status:'booked',confirmed:true,source:'unknown',booked_by:'دينا',note:'هتيجي مع والدتها',patient:'شهد',file_no:'P-1'}])};
 assert.equal(G.isSameDay(err),true);assert.equal(G.isSameDay({hint:'other'}),false);
 // confirm
 let p=G.ask(err,{},{service:'جلسة ليزر',doctor:'أخصائي ليزر',time:'18:00'});
 let m=d.querySelector('.rx-sp');assert.match(m.textContent,/عنده حجز تاني/);assert.match(m.textContent,/كشف جلدية/);assert.match(m.textContent,/متأكد/);
 assert.match(m.textContent,/الحجز الجديد: جلسة ليزر · د. أخصائي ليزر · الساعة 18:00/);
 // details from inside the warning
 m.querySelector('[data-sp-detail="0"]').click();let pops=d.querySelectorAll('.rx-sp');assert.equal(pops.length,2);assert.match(pops[1].textContent,/هتيجي مع والدتها/);assert.match(pops[1].textContent,/دينا/);
 pops[1].querySelector('[data-sp-close]').click();assert.equal(d.querySelectorAll('.rx-sp').length,1);
 m.querySelector('[data-sp-yes]').click();assert.equal(await p,true);assert.equal(d.querySelectorAll('.rx-sp').length,0);
 // go back: false + the original booking's details open
 p=G.ask(err,{},{});d.querySelector('[data-sp-no]').click();assert.equal(await p,false);
 pops=d.querySelectorAll('.rx-sp');assert.equal(pops.length,1);assert.match(pops[0].textContent,/تفاصيل الحجز/);
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(d.querySelectorAll('.rx-sp').length,0);
 // card button → RPC → popup, escaped
 G.decorate({host:d.getElementById('host'),workspace:'ws1'},'appointments');G.decorate({host:d.getElementById('host'),workspace:'ws1'},'appointments');
 const b=d.querySelectorAll('[data-sp-open]');assert.equal(b.length,1,'one button per card');b[0].click();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(calls[0],['clinic_reception_appointment_details',{p_workspace:'ws1',p_id:'ap1'}]);
 pops=d.querySelectorAll('.rx-sp');assert.equal(pops.length,1);assert.ok(!pops[0].querySelector('b b'),'escaped');
 // wiring in the reception screen: command() asks, re-sends with same_day_ok and a new token; extras skip the question
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
 assert.match(src,/g\.isSameDay\(e\)&&payload&&!payload\.same_day_ok/);assert.match(src,/p\.same_day_ok=true;return command\(action,p,crypto\.randomUUID\(\)\)/);
 assert.match(src,/command\('book',\{patient_id:payload\.patient_id,same_day_ok:true/);assert.match(src,/SSMPDReceptionSamePatient\.decorate\(context\(\),section\)/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reception-same-patient.js')<html.indexOf('reception-workspace.js?v='),'loaded before the workspace');
 console.log('PASS reception same-patient screen.');
})().catch(e=>{console.error(e);process.exit(1);});
