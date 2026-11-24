// 20261123130000 UI: arrived card ⋯ «نفس خصم الزيارة (30٪) على باقي الخدمات» (reception, LIVE, real server functions) → the
// 2nd service gets the visit's approved 30% (500+500 → 700); the item disappears once every service has it.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere','visit_discount_all_services']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,dept=snap.providers[0].department,service=snap.services.find(s=>s.code==='CONSULT').id,[p1]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);
 await as(1);await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const physio=(await cmd('service',{code:'PT',name:'جلسة علاج طبيعي',department:dept,price:500,minutes:15,bom:[]})).id;
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id;
 await as(3);await cmd('arrive',{id:a1});snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 const v=snap.visits.find(x=>x.appointment_id===a1),o1=snap.orders.find(o=>o.visit_id===v.id);
 await cmd('discount',{id:o1.id,percent:'30',reason:'نقابة — كارنيه 77'});
 await db.exec('reset role');await db.query("update clinic_reception.discount_requests set status='approved',reviewed_by=$2 where order_id=$1",[o1.id,id(1)]);await db.query('update clinic_reception.orders set discount=30 where id=$1',[o1.id]);await as(3);
 await cmd('order_add',{visit_id:v.id,service_id:physio,provider_id:provider,quantity:1});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDToast={show:()=>{}};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-booking-discount','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 let card=await openCard(a1);const b=card.locator('[data-rx-action="visit-same-discount"]');assert.equal(await b.textContent(),'نفس خصم الزيارة (30٪) على باقي الخدمات');
 await b.click();await page.waitForFunction(()=>!document.querySelector('[data-rx-action="visit-same-discount"]'),null,{timeout:8000}).catch(()=>{});
 snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const ords=snap.orders.filter(o=>o.visit_id===v.id);
 assert.deepEqual(ords.map(o=>+o.discount),[30,30]);assert.equal(ords.reduce((t,o)=>t+o.price*(1-o.discount/100),0),700);
 card=await openCard(a1);assert.equal(await card.locator('[data-rx-action="visit-same-discount"]').count(),0,'hidden once every service has it');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS visit discount UI (reception, live): ⋯ «نفس خصم الزيارة (30٪) على باقي الخدمات» → 2nd service 30% (500+500 → 700), item hidden afterwards.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
