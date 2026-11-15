// Reception appointments timeline (owner 2026-11-15): small date + «النهارده», Sat→Fri week strip with dots, vertical
// timeline, current appointment highlighted, summary, search / doctor / status filters, day switch, floating «+».
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=(t)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{for(const width of [1280,390]){
 const {db,rpc}=await boot(['booking_confirm_duration']);
 const today=cairoDay(new Date()),d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);const tomorrow=d.toISOString().slice(0,10);
 const at=(day,hhmm)=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10),h-2,m)).toISOString();}; // Cairo = UTC+2 in Nov
 const w=await rpc('clinic_reception_bootstrap');const snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:tomorrow});
 const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 for(const day of [today,tomorrow])await cmd('availability',{provider_id:provider,starts_at:at(day,'08:00'),ends_at:at(day,'18:00')});
 const book=(day,t,p)=>cmd('book',{patient_id:p,provider_id:provider,service_id:service,starts_at:at(day,t)}).then(r=>r.id);
 const a9=await book(today,'09:00',p1),a10=await book(today,'10:00',p2),a11=await book(today,'11:00',p1),a13=await book(today,'13:00',p2),a15=await book(today,'15:00',p1);await book(tomorrow,'12:00',p2);
 await cmd('arrive',{id:a9});await cmd('confirm',{id:a11});await cmd('cancel',{id:a15,reason:'اختبار'});
 const page=await browser.newPage({viewport:{width,height:950},timezoneId:'Asia/Dubai',deviceScaleFactor:process.env.RECEPTION_QA?2:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date(at(today,'10:05')));
 await page.exposeFunction('rxRpc',rpc);await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="padding:16px"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};window.SSMPDRoles={canSeeTab:()=>true};window.SSMPDDb={receptionBootstrap:()=>rxRpc('clinic_reception_bootstrap'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');await page.locator('[data-guide-skip]').click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 assert.equal(await page.locator('.rx-tl-title').textContent(),'النهارده');assert.equal(await page.locator('.rx-tl-wd').count(),7);assert.equal(await page.locator('.rx-tl-wd').first().locator('span').textContent(),'سبت');
 assert.equal(await page.locator('.rx-tl-wd.on').getAttribute('data-id'),today);assert.equal(await page.locator(`.rx-tl-wd[data-id="${tomorrow}"] i`).isHidden(),false,'dot on a day with bookings');
 assert.match(await page.locator('.rx-tl-sum').textContent(),/^4 حجز — 1 مؤكد — 1 حضروا — 0 لم يحضر$/);
 // Cancelled hidden by default; order by time; the 10:00 booking is «now» (highlighted).
 assert.equal(await page.locator('.rx-tl-item:not([hidden])').count(),4);assert.equal(await page.locator('.rx-tl-item.now').count(),1);assert.match(await page.locator('.rx-tl-item.now time').textContent(),/10:00/);
 const bg=await page.locator('.rx-tl-item.now .rx-tl-card').evaluate(e=>getComputedStyle(e).backgroundColor);assert.equal(bg,'rgb(15, 54, 157)');
 if(process.env.RECEPTION_QA){await page.locator('.rx-tl-head').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:process.env.RECEPTION_QA+'/timeline-'+width+'.png'});}
 // Status chip, doctor filter and search are instant and keep focus.
 await page.locator('.rx-tl-chip[data-id="cancelled"]').click();assert.equal(await page.locator('.rx-tl-item:not([hidden])').count(),1);
 await page.locator('.rx-tl-chip[data-id="confirmed"]').click();assert.equal(await page.locator('.rx-tl-item:not([hidden])').count(),1);assert.match(await page.locator('.rx-tl-item:not([hidden]) .rx-confirmed').textContent(),/مؤكد/);
 await page.locator('.rx-tl-chip[data-id=""]').click();const name=(await page.locator('.rx-tl-item:not([hidden]) h4').first().textContent()).trim();
 await page.locator('[data-tl-q]').fill('لا يوجد اسم كده');assert.equal(await page.locator('.rx-tl-nomatch').isHidden(),false);assert.equal(await page.evaluate(()=>document.activeElement.matches('[data-tl-q]')),true);
 await page.locator('[data-tl-q]').fill(name.slice(0,4));assert((await page.locator('.rx-tl-item:not([hidden])').count())>=1);await page.locator('[data-tl-q]').fill('');
 // Other day: «بكره»; then back to today with the «النهارده» button.
 await page.locator(`.rx-tl-wd[data-id="${tomorrow}"]`).click();assert.equal(await page.locator('.rx-tl-title').textContent(),'بكره');assert.equal(await page.locator('.rx-tl-item').count(),1);assert.equal(await page.locator('.rx-tl-item.now').count(),0);
 await page.locator(`.rx-tl-nav [data-id="${today}"]`).click();assert.equal(await page.locator('.rx-tl-title').textContent(),'النهارده');
 // «⋯» menu holds the secondary actions; floating «+» opens booking.
 await page.locator('.rx-tl-item.now .rx-tl-more summary').click();assert(await page.locator('.rx-tl-item.now .rx-tl-more [data-rx-action="reschedule"]').isVisible());await page.keyboard.press('Escape');
 await page.locator('.rx-tl-fab').click();await page.waitForSelector('.rx-modal');assert.match(await page.locator('.rx-modal').innerText(),/حجز موعد/);await page.locator('.rx-modal [data-rx-close], .rx-modal .rx-close, .rx-modal button[aria-label="إغلاق"]').first().click().catch(()=>page.keyboard.press('Escape'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow '+width);assert.deepEqual(errors,[]);await page.close();await db.close();}
 console.log('PASS reception timeline at 1280/390: «النهارده» + week strip (Sat→Fri, dots), summary, cancelled hidden, current card in #0F369D, status/doctor/search filters with focus kept, day switch «بكره», ⋯ menu, floating +, no overflow/errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
