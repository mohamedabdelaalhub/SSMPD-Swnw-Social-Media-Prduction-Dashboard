// 20261123060000 (owner 2026-11-23 «لا نقابات ولا خصومات»): end to end in a real browser on the real reception screen and the real
// server functions (PGlite), as a RECEPTION user in a LIVE workspace:
//   «⋯ ← خصم» on a booked card → saved on the booking; «تعديل / شيل الخصم» clears it; «تعديل الحجز» shows and keeps the discount;
//   after arrival «⋯ ← خصم على الزيارة (قبل التحصيل)» → the ordered service gets the discount (500 → 350).
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id,a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30')})).id;
 await as(3);await cmd('arrive',{id:a2});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-booking-discount.js','utf8')});await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 // (b) booked card ⋯ → «خصم …» → خاص 15% → saved on the booking
 let card=await openCard(a1);const disc=card.locator('[data-rx-action="booking-discount"]');assert.equal(await disc.textContent(),'خصم (نقابة / نادي / فيزيتا / العيلة / خاص)');
 await disc.click();await page.waitForSelector('.rx-modal [data-rbd]');
 assert.match(await page.locator('.rx-modal .rbd-sw').textContent(),/خصم \(نقابة \/ نادي \/ فيزيتا \/ كارت العيلة \/ خاص\)/);
 await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="special"])').click();await page.fill('.rx-modal input[name="discount_reason"]','قريب موظف');await page.fill('.rx-modal input[name="discount_percent"]','15');
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 let s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});let ap=s.appointments.find(x=>x.id===a1);assert.equal(ap.discount_kind,'special');assert.equal(+ap.discount_percent,15);
 await page.waitForSelector(`[data-tl-open="${a1}"] .rx-disc-tag`);assert.match(await page.locator(`[data-tl-open="${a1}"] .rx-disc-tag`).textContent(),/خصم 15٪/);
 // (a) «تعديل الحجز» shows the discount ticked + prefilled; saving keeps it
 card=await openCard(a1);await card.locator('[data-rx-action="reschedule"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
 assert.equal(await page.locator('.rx-modal [data-rbd-on]').isChecked(),true);assert.equal(await page.inputValue('.rx-modal input[name="discount_reason"]'),'قريب موظف');
 await page.locator('.rx-modal [data-rx-cancel]').click();
 // «تعديل / شيل الخصم» → untick → cleared
 card=await openCard(a1);const ed=card.locator('[data-rx-action="booking-discount"]');assert.equal(await ed.textContent(),'تعديل / شيل الخصم');await ed.click();await page.waitForSelector('.rx-modal [data-rbd]');
 await page.locator('.rx-modal [data-rbd-on]').uncheck();await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});assert.equal(s.appointments.find(x=>x.id===a1).discount_kind,null,'cleared');
 // (d) arrived card ⋯ → «خصم على الزيارة» → خاص 30% → ordered service 500 → 350
 card=await openCard(a2);const vd=card.locator('[data-rx-action="visit-discount"]');assert.equal(await vd.textContent(),'خصم على الزيارة (قبل التحصيل)');assert.equal(await card.locator('[data-rx-action="booking-discount"]').count(),0,'no booking item after arrival');
 await vd.click();await page.waitForSelector('.rx-modal [data-rbd]');assert.equal(await page.locator('.rx-modal [data-rbd-on]').isChecked(),true);
 await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="special"])').click();await page.fill('.rx-modal input[name="discount_reason"]','حالة إنسانية');await page.fill('.rx-modal input[name="discount_percent"]','30');
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const vis=s.visits.find(v=>v.appointment_id===a2),ord=s.orders.find(o=>o.visit_id===vis.id);assert.equal(+ord.discount,30);assert.equal(+ord.price*(1-ord.discount/100),350);
 card=await openCard(a2);assert.equal(await card.locator('[data-rx-action="visit-discount"]').count(),0,'hidden once the visit has its one discount');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS booking discount everywhere UI (reception user, live workspace, real server functions): ⋯ «خصم» on a booked card saves it, «تعديل الحجز» shows it, «تعديل / شيل الخصم» clears it, ⋯ «خصم على الزيارة» after arrival 500 → 350, items hidden when not allowed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
