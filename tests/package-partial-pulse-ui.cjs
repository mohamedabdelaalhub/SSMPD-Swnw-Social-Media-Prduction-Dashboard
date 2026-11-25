// 20261125130000 «من الباكج» for laser PULSE packages — UI (rule 9): real reception screen in LIVE mode + real server functions (PGlite).
//   RECEPTION: arrived pulse visit ⋯ «خصم من باكج المريض» → the session reads «فاضل 1,000 نبضة من 1,000» → attach → toast «فاضل 1,000 نبضة».
//   After «تنفيذ» with the device meter (320 pulses) the next visit's window reads «فاضل 680 نبضة من 1,000» and the line attaches again.
// The PGlite ledger stays in trial posting (as in tests/legacy-prepaid-package-ui.cjs); the screen runs in LIVE mode. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_laser_meter']);
 const today=cairoDay(new Date()),ago=n=>new Date(Date.parse(today)-n*864e5).toISOString().slice(0,10);
 const at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'63000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department,patient=s.patients[0].id;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 const pulse=(await cmd('service',{code:'PLS',name:'سعر النبضة الواحدة كانديلا',department:dept,price:2,minutes:20,bom:[]})).id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'PLS',rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 const dev=(await cmd('device',{code:'CAN1',name:'كانديلا',meter_kind:'shots'})).id;
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 await db.exec('reset role');
 await db.exec("insert into clinic_reception.laser_pulse_services values('PLS') on conflict do nothing");
 await db.exec(`create schema if not exists clinic_finance;create table if not exists clinic_finance.accounts(code text primary key,name text not null,kind text not null);
   insert into clinic_finance.accounts values('2151','مقدمات باكجات','liability') on conflict do nothing;create or replace function clinic_finance.lock_day() returns void language sql as $$select$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261123110000_legacy_prepaid_package.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261125130000_package_partial_pulse.sql','utf8'));
 await as(1);const tP=(await cmd('template',{code:'P1000',name:'باكج 1000 نبضة',price:'1600',visits:1,validity_days:120,terms:'نبضات',lines:[{visit_no:1,service_id:pulse,quantity:'1000'}]})).id;
 await as(3);await cmd('package_sell',{patient_id:patient,template_id:tP});
 await as(1);const a1=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:pulse,starts_at:at('20:00')})).id;
 const a2=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:pulse,starts_at:at('21:00'),same_day_ok:true})).id;
 await as(3);await cmd('arrive',{id:a1});await cmd('arrive',{id:a2});s=await snap();
 const ord=ap=>s.orders.find(o=>o.visit_id===s.visits.find(v=>v.appointment_id===ap).id);
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-legacy-package'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:a=>[a.role],hasRole:(a,r)=>a.role===r,hasAnyRole:(a,l)=>l.indexOf(a.role)>=0};window.SSMPDToast={show:m=>{window.lastToast=m;}};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}).then(d=>{d.workspace=Object.assign({},d.workspace,{mode:'live'});return d;}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-look','reception-legacy-package','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 const render=async()=>{await page.evaluate(()=>{document.querySelector('#root').innerHTML='';SSMPDReception.render(document.querySelector('#root'));});await page.waitForSelector('[data-rx-section], .rx-tl-week');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();};
 const submit=async()=>{await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});};
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const usePkg=async(ap,re)=>{await render();if(!(await page.locator('.rx-tl-week').count()))await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
  const card=await openCard(ap);await card.locator('[data-rx-action="use-package"]').click();await page.waitForSelector('.rx-modal .rlp-ent');
  assert.match(await page.locator('.rx-modal').innerText(),re);return card;};
 // 1) first visit: the whole 1000 pulses are on the line
 await usePkg(a1,/سعر النبضة الواحدة كانديلا[\s\S]*فاضل 1,000 نبضة من 1,000[\s\S]*عداد الجهاز/);
 if(process.env.SHOT)await page.locator('.rx-modal .modal').screenshot({path:process.env.SHOT+'/pulse-use.png'});
 await submit();assert.match(await page.evaluate(()=>window.lastToast),/اتربطت بنبضات الباكج ✓ — فاضل 1,000 نبضة/);
 s=await snap();let o1=ord(a1);assert(o1.entitlement_id);assert.equal(+o1.quantity,1000);assert.equal(+o1.price,1.6);
 // «تنفيذ» with the meter: 320 pulses
 await cmd('execute',{id:o1.id,device_id:dev,minutes:'20',meter_before:'5000',meter_after:'5320',additional_confirmed:false});
 // 2) second visit: the same line, 680 left
 await usePkg(a2,/فاضل 680 نبضة من 1,000/);await submit();assert.match(await page.evaluate(()=>window.lastToast),/فاضل 680 نبضة/);
 s=await snap();const o2=ord(a2);assert.equal(o2.entitlement_id,o1.entitlement_id,'same package line');assert.equal(+o2.quantity,680);
 const card=await openCard(a2);assert.equal(await card.locator('[data-rx-action="use-package"]').count(),0,'hidden once attached');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS package partial pulse UI (live, reception): ⋯ «خصم من باكج المريض» on a pulse visit reads «فاضل 1,000 نبضة من 1,000» → attached (qty 1000 × 1.6); after 320 pulses by the meter the next visit reads «فاضل 680 نبضة من 1,000» and attaches to the same line (qty 680); button hidden once attached.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
