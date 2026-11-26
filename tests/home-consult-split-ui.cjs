// Owner 2026-11-26 00:37Z: «كشف منزلي» always goes with the doctor and books the visit (15) + «وقت الطريق (رايح وجاي)».
// Real reception screen + real reception server functions (PGlite), RECEPTION user, LIVE workspace. The snapshot gets the
// home_visit_split list that migration 20261126060000 adds (that migration needs the finance schema, which this light boot does
// not have — its server side is covered by home-consult-split-sql.cjs and the live rollback as Mazen); the booking command is
// captured to check the payload the form sends.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages']);const w=await rpc('clinic_reception_bootstrap');
 let k=0;const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:'63000000-0000-4000-8000-'+String(++k).padStart(12,'0')});
 const HC=(await cmd('service',{code:'SVC-0001396',name:'كشف منزلي (شامل الانتقال)',department:'خدمات الكشف',price:1500,minutes:15,bom:[]})).id;
 const KS=(await cmd('service',{code:'K-1',name:'كشف باطنة',department:'خدمات الكشف',price:400,minutes:15,bom:[]})).id;
 const PR=(await cmd('provider',{name:'د. منزلي',department:'خدمات الكشف',branch:'حدائق الأهرام',doctor_key:'DOC-H'})).id;
 const day0=(await db.query("select ((current_date+1)::timestamp at time zone 'Africa/Cairo') t")).rows[0].t,at=h=>new Date(new Date(day0).getTime()+h*3600000).toISOString();
 await cmd('availability',{provider_id:PR,starts_at:at(8),ends_at:at(22)});
 await cmd('patient',{name:'مريض تجربة',file_no:'F-1',phone:'0100'});
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});await as(3);
 const page=await browser.newPage({viewport:{width:1280,height:1400}}),errors=[],sent=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('rxRpc',async(n,a)=>{if(n==='clinic_reception_command'&&['book','reschedule','walk_in'].includes(a.p_action)){sent.push(a);return {id:'00000000-0000-4000-8000-000000000999'};}
   const v=await rpc(n,a);if(n==='clinic_reception_snapshot')v.home_visit_split=[{service_id:HC,code:'SVC-0001396',travel_minutes:60}];return v;});
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-patient-extras','reception-booking-plus','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>(n==='clinic_reception_nurses'?Promise.resolve([{id:'n1',name:'ممرضة تجربة'}]):n.startsWith('clinic_reception_')?rxRpc(n,a):Promise.resolve(null)).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-services','reception-patient-extras','reception-booking-plus','reception-booking-discount','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="patients"]').click();await page.locator('[data-rx-action="book"]').first().click();await page.waitForSelector('.rx-modal [data-rbp-perf]',{state:'attached'});
 const pick=(name,val)=>page.evaluate(([n,v])=>{const s=document.querySelector('.rx-modal select[name="'+n+'"]');if(![...s.options].some(o=>o.value===v)){const o=document.createElement('option');o.value=v;o.textContent=v;s.appendChild(o);}s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));},[name,val]);
 const st=()=>page.evaluate(()=>{const m=document.querySelector('.rx-modal'),q=s=>m.querySelector(s),vis=e=>!!(e&&e.offsetParent);
   return {perf:vis(q('[data-rbp-perf]')),alone:vis(q('[data-rbp-mode="nurse_alone"]')),aloneDisabled:q('[data-rbp-mode="nurse_alone"]').disabled,note:vis(q('[data-rbp-split-note]')),
     travel:vis(q('[data-rbp-travel]')),travelValue:q('select[name="travel_minutes"]').value,travelDisabled:q('select[name="travel_minutes"]').disabled,
     mode:q('input[name="performer_mode"]').value,duration:(q('[data-book-duration]')||{}).textContent||''};});
 // 1) the home consult: performer open, «ممرض/ة لوحده» gone (with the reason), «وقت الطريق» 60 → the doctor is booked 15 + 60
 await pick('service_id',HC);let s=await st();
 assert.deepEqual([s.perf,s.alone,s.aloneDisabled,s.note,s.travel,s.travelValue,s.travelDisabled,s.mode],[true,false,true,true,true,'60',false,'doctor'],'consult: nurse alone hidden, travel 60');
 assert.match(s.duration,/75 دقيقة.*شامل وقت الطريق رايح وجاي 60 دقيقة/,'slot length includes the road');
 if(process.env.SHOT)await page.locator('.rx-modal .modal').first().screenshot({path:process.env.SHOT+'/home-consult-split.png'});
 // 2) «ممرض/ة مع طبيب» + travel 90 → 105
 await page.locator('.rx-modal [data-rbp-mode="nurse_with_doctor"]').click();await page.locator('.rx-modal select[name="travel_minutes"]').selectOption('90');
 s=await st();assert.equal(s.mode,'nurse_with_doctor');assert.match(s.duration,/105 دقيقة/);
 // 3) another service + «زيارة منزلية»: «ممرض/ة لوحده» is back, no travel
 await pick('service_id',KS);await page.locator('.rx-modal label.rxe-switch').click();s=await st();
 assert.deepEqual([s.alone,s.aloneDisabled,s.note,s.travel,s.travelDisabled],[true,false,false,false,true],'other service: nurse alone available, no travel');
 assert.doesNotMatch(s.duration,/وقت الطريق/);
 await page.locator('.rx-modal [data-rbp-mode="nurse_alone"]').click();assert.equal((await st()).mode,'nurse_alone');
 // 4) back to the consult: nurse alone is reset to «الطبيب», travel back to the default
 await pick('service_id',HC);s=await st();assert.deepEqual([s.mode,s.alone,s.travelValue],['doctor',false,'60']);
 await page.locator('.rx-modal select[name="travel_minutes"]').selectOption('30');
 // 5) save: the payload carries travel_minutes and the performer
 const tomorrow=(await db.query("select to_char(current_date+1,'YYYY-MM-DD') d")).rows[0].d;
 await pick('provider_id',PR);await page.evaluate(d=>{const e=document.querySelector('.rx-modal [name="day"]');e.value=d;e.dispatchEvent(new Event('change',{bubbles:true}));},tomorrow);await page.waitForTimeout(100);
 const opt=await page.evaluate(()=>{const s=document.querySelector('.rx-modal select[name="starts_at"]');const o=[...s.options].find(x=>x.value&&x.value!=='__custom__');if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}return o&&o.value;});
 assert.ok(opt,'a free slot for 15 + 30');
 await page.evaluate(()=>document.querySelectorAll('.rx-modal [name^="x_"]:invalid').forEach(e=>{e.value='عنوان تجربة 12';e.dispatchEvent(new Event('input',{bubbles:true}));}));   // the home-visit address (required)
 await page.locator('.rx-modal button[type="submit"]').first().click();await page.waitForTimeout(300);
 assert.equal(sent.length,1,'one booking command sent');const p=sent[0].p_payload;
 assert.equal(sent[0].p_action,'book');assert.equal(p.service_id,HC);assert.equal(p.travel_minutes,'30');assert.equal(p.performer_mode,'doctor');assert.equal(p.minutes,undefined,'the server adds the road, the form does not double it');
 // 6) the booking line shows the road
 assert.match(await page.evaluate(()=>SSMPDReceptionBookingPlus.cardBits({travel_minutes:60}).line),/وقت الطريق 60 دقيقة/);
 assert(!errors.length,errors.join('\n'));
 console.log('PASS home consult split UI (reception, live): on «كشف منزلي» «ممرض/ة لوحده» hidden + disabled with the reason, «وقت الطريق (رايح وجاي)» 30/60/90/120 default 60 and the slot length = 15 + road; other services keep «ممرض/ة لوحده» and no road; switching back resets to «الطبيب»; «حفظ» sends travel_minutes + performer.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
