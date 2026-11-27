// 20261125140000 «زيارات كارت العيلة السابقة (السيستم القديم)» — rule 9, real browser on the real reception screen + real server
// functions (PGlite), LIVE workspace:
//   RECEPTION: booked card ⋯ «خصم …» → «كارت العيلة» → «+ زيارات كارت العيلة السابقة (السيستم القديم)» → 7 + reason + note →
//   «ابعت للاعتماد» → pending (not counted: still 10%); no approvals card for reception.
//   FINANCIAL MANAGER: approvals card → «اعتمد».
//   RECEPTION: the family panel shows «✓ 7 زيارة معتمدة …» and step 30%; saving the booking stores 30%.
// Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,p1=snap.patients[0].id;
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);
 await db.exec("insert into admins values('61000000-0000-4000-8000-000000000009','financial_manager',true)");
 await db.exec(fs.readFileSync('supabase/migrations/20261125140000_family_card_legacy_visits.sql','utf8'));await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});await cmd('member',{admin_id:id(9),capabilities:['view']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id;
 await as(3);
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.exposeFunction('rxAs',n=>as(n));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount','reception-legacy-package'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:a=>[a.role],hasRole:(a,r)=>a.role===r,hasAnyRole:(a,l)=>l.indexOf(a.role)>=0};window.SSMPDToast={show:m=>{window.lastToast=m;}};window.SSMPDDb={client:{auth:{getUser:()=>Promise.resolve({data:{user:{id:'u1'}}})},rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-booking-discount','reception-family-legacy','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 const render=async()=>{await page.evaluate(()=>{document.querySelector('#root').innerHTML='';SSMPDReception.render(document.querySelector('#root'));});await page.waitForSelector('[data-rx-section], .rx-tl-week',{timeout:8000});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();};
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const openFamily=async()=>{await render();if(!(await page.locator('.rx-tl-week').count()))await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
  const card=await openCard(a1);await card.locator('[data-rx-action="booking-discount"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
  await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="family"])').click();await page.waitForSelector('.rx-modal [data-rbd-legacy]');};
 // 1) reception enters 7 old-system visits
 await openFamily();assert.equal((await page.locator('.rx-modal .rbd-st.now').textContent()).trim(),'10٪');
 assert.equal(await page.locator('[data-rfl-approvals]').count(),0,'no approvals card for reception');
 const open=page.locator('.rx-modal [data-rbd-legacy-open]');assert.equal((await open.textContent()).trim(),'+ زيارات كارت العيلة السابقة (السيستم القديم)');await open.click();
 await page.locator('.rx-modal [data-rbd-lg-go]').click();assert.match(await page.locator('.rx-modal [data-rbd-lg-up]').textContent(),/عدد الزيارات/);
 await page.fill('.rx-modal [data-rbd-lg-n]','7');await page.fill('.rx-modal [data-rbd-lg-why]','العيلة كانت ماشية بالكارت قبل الداشبورد');await page.fill('.rx-modal [data-rbd-lg-note]','دفتر الاستقبال 2025 صفحة 14');
 if(process.env.SHOT)await page.locator('.rx-modal [data-rbd-fam]').screenshot({path:process.env.SHOT+'/family-legacy-enter.png'});
 await page.locator('.rx-modal [data-rbd-lg-go]').click();await page.waitForSelector('.rx-modal [data-rbd-legacy-pending]');
 assert.match(await page.locator('.rx-modal [data-rbd-legacy-pending]').textContent(),/7 زيارة مستنية الاعتماد[\s\S]*مش بتتحسب/);assert.equal(await page.locator('.rx-modal [data-rbd-legacy-open]').count(),0,'no second request while pending');
 assert.equal((await page.locator('.rx-modal .rbd-st.now').textContent()).trim(),'10٪','pending does not count');
 await page.locator('.rx-modal [data-rx-cancel]').click();
 // 2) financial manager approves from the card
 await page.evaluate(()=>{window.SSMPDAuth.currentAdmin={id:'fm',role:'financial_manager'};});await page.evaluate(()=>rxAs(9));await render();
 await page.waitForSelector('[data-rfl-approvals] [data-rfl-ok]');assert.match(await page.locator('[data-rfl-approvals]').innerText(),/7[\s\S]*زيارة قديمة[\s\S]*دفتر الاستقبال 2025 صفحة 14/);
 if(process.env.SHOT)await page.locator('[data-rfl-approvals]').screenshot({path:process.env.SHOT+'/family-legacy-approve.png'});
 await page.locator('[data-rfl-approvals] [data-rfl-ok]').click();await page.waitForSelector('[data-rfl-approvals]',{state:'detached'});
 assert.match(await page.evaluate(()=>window.lastToast),/اتعتمدت ✓ — خصم العيلة الجاي 30٪/);
 // 3) reception: approved line + step 30%; the booking saves 30%
 await page.evaluate(()=>{window.SSMPDAuth.currentAdmin={id:'rec',role:'reception'};});await page.evaluate(()=>rxAs(3));await openFamily();
 await page.waitForSelector('.rx-modal [data-rbd-legacy-approved]');assert.match(await page.locator('.rx-modal [data-rbd-legacy-approved]').textContent(),/7 زيارة معتمدة/);
 assert.equal((await page.locator('.rx-modal .rbd-st.now').textContent()).trim(),'30٪');assert.equal((await page.locator('.rx-modal [data-rbd-legacy-open]').textContent()).trim(),'تعديل الزيارات السابقة');
 if(process.env.SHOT)await page.locator('.rx-modal [data-rbd-fam]').screenshot({path:process.env.SHOT+'/family-legacy-approved.png'});
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 const s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const ap=s.appointments.find(x=>x.id===a1);assert.equal(ap.discount_kind,'family');assert.equal(+ap.discount_percent,30);
 assert(!errors.length,errors.join('\n'));
 console.log('PASS family card old-system visits UI (live): reception «+ زيارات كارت العيلة السابقة» 7 → pending, still 10%, no approvals card; financial manager «اعتمد» from the card; reception sees «✓ 7 زيارة معتمدة» + 30% and the booking saves 30%.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
