// 20261123200000 (owner 2026-11-24 «العروض ملهاش اي خصومات تانية»): real reception screen + real server functions (PGlite), RECEPTION user,
// LIVE workspace. An offer-priced service shows no discount entry; the booking form shows the switch disabled with the reason.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere','visit_discount_all_services']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const dept=snap.providers[0].department;const ofr=(await cmd('service',{code:'OFR',name:'ليزر عرض الجمعة',department:dept,price:400,minutes:15,bom:[]})).id;
 await db.exec('reset role');await db.exec("alter table clinic_reception.services add column if not exists pricing_evidence jsonb");
 await db.query("update clinic_reception.services set pricing_evidence=$2 where id=$1",[ofr,{price:400,source:'offer',reason:'عرض الجمعة البيضا'}]);
 await db.exec(fs.readFileSync('supabase/migrations/20261123200000_offer_no_other_discount.sql','utf8'));await as(1);
 const [p3]=(await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today})).patients.map(p=>p.id).slice(2);
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:ofr,starts_at:at('20:00')})).id;   // booked offer
 const a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30')})).id; // arrived: normal + offer
 const a3=(await cmd('book',{patient_id:p3||p1,provider_id:provider,service_id:ofr,starts_at:at('21:00'),same_day_ok:true})).id; // arrived: offer only
 await as(3);await cmd('arrive',{id:a2});await cmd('arrive',{id:a3});
 {const s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const v=s.visits.find(x=>x.appointment_id===a2);await cmd('order_add',{visit_id:v.id,service_id:ofr,provider_id:provider,quantity:1});}
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-booking-discount.js','utf8')});await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};

 const items=async ap=>{const card=await openCard(ap);return card.locator('[data-rx-action]').evaluateAll(b=>b.map(x=>x.getAttribute('data-rx-action')));};
 // 1) booked offer: no «خصم» item on the card
 assert(!(await items(a1)).includes('booking-discount'),'no booking discount item on an offer booking');
 // 2) «تعديل الحجز» on the offer booking: the discount switch is off + disabled with the reason; switching to a normal service enables it
 {const card=await openCard(a1);await card.locator('[data-rx-action="reschedule"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
  assert.equal(await page.locator('.rx-modal [data-rbd-on]').isDisabled(),true);assert.equal(await page.locator('.rx-modal [data-rbd-offer]').isVisible(),true);
  assert.equal(await page.locator('.rx-modal [data-rbd-offer]').innerText(),'السعر ده عرض — مفيش خصم تاني عليه');
  if(process.env.SHOT)await page.locator('.rx-modal [data-rbd]').screenshot({path:process.env.SHOT+'/offer-booking.png'});
  await page.selectOption('.rx-modal [name="service_id"]',service);await page.dispatchEvent('.rx-modal [name="service_id"]','change');
  assert.equal(await page.locator('.rx-modal [data-rbd-on]').isDisabled(),false,'normal service: discount allowed');assert.equal(await page.locator('.rx-modal [data-rbd-offer]').isVisible(),false);
  await page.locator('.rx-modal [data-rx-cancel]').click();await page.waitForSelector('.rx-modal',{state:'detached'});}
 // 3) arrived visit with only the offer: no «خصم على الزيارة»
 assert(!(await items(a3)).includes('visit-discount'),'offer-only visit: no visit discount item');
 // 4) arrived visit with a normal service + the offer: «خصم على الزيارة» lists only the normal service
 {const card=await openCard(a2);await card.locator('[data-rx-action="visit-discount"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
  const txt=await page.locator('.rx-modal').innerText();assert(!/ليزر عرض الجمعة/.test(txt),'offer service not offered for the discount');
  await page.locator('.rx-modal [data-rx-cancel]').click();await page.waitForSelector('.rx-modal',{state:'detached'});}
 assert(!errors.length,errors.join('\n'));
 console.log('PASS offer = no other discount UI (reception, live): no «خصم» on an offer booking; «تعديل الحجز» shows the switch disabled with «السعر ده عرض — مفيش خصم تاني عليه» (enabled again for a normal service); no «خصم على الزيارة» on an offer-only visit; on a mixed visit only the normal service is offered.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
