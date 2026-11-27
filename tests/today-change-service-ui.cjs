// Owner 2026-11-24 («اه اعمله»): «تغيير الخدمة» in ⋯ on an arrived card of «تشغيل اليوم» opens the visit window with a short how-to;
// the receptionist cancels the old service («إلغاء الطلب» → order_cancel) and adds the new one («+ إضافة خدمة» → order_add).
// Real reception screen + real server functions (PGlite), RECEPTION user, LIVE workspace. Only the day-board snapshot is built from the
// real snapshot (the journey SQL stack is not loaded here); every command goes to the real clinic_reception_command.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'63000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const dept=snap.providers[0].department,other=(await cmd('service',{code:'ECHO2',name:'إيكو القلب',department:dept,price:700,minutes:15,bom:[]})).id;
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id;  // arrived, service still ordered
 const a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30')})).id;  // booked, not arrived
 await as(3);await cmd('arrive',{id:a1});
 snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const v1=snap.visits.find(v=>v.appointment_id===a1);assert(v1,'visit opened at arrival');
 const board=()=>({day:today,settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[
  {id:a1,patient_id:p1,patient_name:'مريض تجربة 1',file_no:'F1',provider_id:provider,provider_name:'د. تجربة',service_name:'كشف',starts_at:at('20:00'),queue_status:'waiting',visit_id:v1.id,priority:0,wait_minutes:3,can_view_finance:true,patient_due:0,due_invoices:[]},
  {id:a2,patient_id:p2,patient_name:'مريض تجربة 2',file_no:'F2',provider_id:provider,provider_name:'د. تجربة',service_name:'كشف',starts_at:at('20:30'),queue_status:'expected',priority:0,wait_minutes:0,can_view_finance:true,patient_due:0,due_invoices:[]}]});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>/journey_(hub_)?snapshot$/.test(n)?board():rpc(n,a));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));
 await page.route('**/assets/**',r=>r.fulfill({status:204,body:''}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-look','today-operations'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`try{localStorage.clear()}catch(e){};window.SSMPDAuth={currentAdmin:{id:'${id(3)}',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};
  const R=(n,a)=>rxRpc(n,a);window.SSMPDDb={client:{rpc:(n,a)=>R(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),
  receptionSnapshot:(w,f,t)=>R('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>R('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-look','reception-services','reception-workspace','today-operations'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));
 await page.waitForSelector('[data-rx-section="journey"]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,600),errors);throw e;});
 const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="journey"]').click();await page.waitForSelector(`[data-journey-action][data-id="${a1}"]`,{state:"attached",timeout:8000});
 const wait=async f=>{for(let n=0;n<120;n++){const s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});if(f(s))return s;await new Promise(r=>setTimeout(r,50));}throw Error('server state not reached');};
 const openShortcut=async()=>{
  // the board redraws after every window closes: wait until EITHER the patient chip (inside «تشغيل اليوم») or the section card
  // (home grid) is on the page — the card only exists on the home grid, so never click it while we are already inside the section
  await page.waitForSelector(`[data-journey-open="${a1}"], [data-rx-section="journey"]`,{state:'attached',timeout:15000});
  if(!(await page.locator(`[data-journey-open="${a1}"]`).count())&&await page.locator('[data-rx-section="journey"]').count())await page.locator('[data-rx-section="journey"]').click();const chip=page.locator(`[data-journey-open="${a1}"]`);await chip.waitFor({state:'attached'});
  const btn=page.locator(`[data-journey-action="change_service"][data-id="${v1.id}"]`);if(!(await btn.isVisible())){if(await page.locator(`[data-journey-open="${a1}"][aria-expanded="false"]`).count())await chip.click();await btn.evaluate(b=>{const d=b.closest('details');if(d)d.open=true;});}
  await btn.click();await page.waitForSelector('.rx-modal [data-change-hint]');};
 // 1) only on the arrived card (live, reception); never on a booked (not arrived) card
 assert.equal(await page.locator(`[data-journey-action="change_service"][data-id="${v1.id}"]`).count(),1,'«تغيير الخدمة» on the arrived card');
 assert.equal(await page.locator('[data-journey-action="change_service"]').count(),1,'not on the booked card');
 assert.equal((await page.locator('[data-journey-action="change_service"]').textContent()).trim(),'تغيير الخدمة');
 // 2) tap it: the visit window opens with the how-to
 await openShortcut();assert.match(await page.locator('.rx-modal [data-change-hint]').innerText(),/«\+ إضافة خدمة»[\s\S]*«إلغاء الطلب»/);
 if(process.env.SHOT)await page.locator('.rx-modal').screenshot({path:process.env.SHOT+'/change-service.png'});
 // 3) «+ إضافة خدمة» → the new service (real order_add)
 await page.locator('.rx-modal [data-rx-action="order_add"]').click();await page.waitForSelector('.rx-modal [name="service_id"]');
 await page.selectOption('.rx-modal [name="service_id"]',other);await page.selectOption('.rx-modal [name="provider_id"]',provider);await page.locator('.rx-modal [type="submit"]').click();
 await wait(s=>s.orders.some(o=>o.visit_id===v1.id&&o.service_id===other&&o.status==='ordered'));
 await page.waitForSelector('.rx-modal',{state:'detached'}).catch(()=>{});
 // 4) «تغيير الخدمة» again → ⋯ next to the old service → «إلغاء الطلب» with the reason (real order_cancel)
 await openShortcut();const oldRow=page.locator('.rx-modal .rv-orow',{hasText:'كشف'}).first();
 await oldRow.locator('details.rv-menu summary').click();await oldRow.locator('[data-rx-action="order_cancel"]').click();
 await page.waitForSelector('.rx-modal [name="reason"]');await page.fill('.rx-modal [name="reason"]','المريض محتاج إيكو بدل الكشف');await page.locator('.rx-modal [type="submit"]').click();
 const fin=await wait(s=>s.orders.some(o=>o.visit_id===v1.id&&o.service_id===service&&o.status==='cancelled'));
 assert.deepEqual(fin.orders.filter(o=>o.visit_id===v1.id).map(o=>[o.service_id===other?'new':'old',o.status]).sort(),[['new','ordered'],['old','cancelled']]);
 // 5) the reopened window shows the swap: old service cancelled, new one waiting
 await page.waitForSelector('.rx-modal',{state:'detached'}).catch(()=>{});await openShortcut();
 assert.equal(await page.locator('.rx-modal .rv-orow.cancel').count(),1);assert.match(await page.locator('.rx-modal .rv-orow.wait').innerText(),/إيكو القلب/);
 console.log('PASS «تغيير الخدمة» (reception, live, real SQL): only on the arrived card; opens the visit window with the how-to; «+ إضافة خدمة» adds the new service (order_add) and «إلغاء الطلب» cancels the old one with the reason (order_cancel); the window then shows the swap.');
 assert(!errors.length,errors.join('\n'));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
