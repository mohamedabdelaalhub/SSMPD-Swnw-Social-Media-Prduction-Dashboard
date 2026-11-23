// «باكج مدفوع قبل السيستم» UI (20261123110000): real reception screen in LIVE mode + real server functions (PGlite; the PGlite ledger
// stays in trial posting — the live 3198 / 2151 / 1122 entries are proven by tests/legacy-prepaid-package-live-rollback.sql).
//   RECEPTION: patient row «باكج مدفوع قبل السيستم» → 2 services (searchable select) → «ابعت للاعتماد» → pending request.
//   FINANCIAL MANAGER: approvals card → «اعتمد» → package + sessions.
//   RECEPTION: arrived card ⋯ «خصم من باكج المريض» → ordered service → patient pays 0; an executed-unpaid service → due 0.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_contracts_controls']);
 const today=cairoDay(new Date()),ago=n=>new Date(Date.parse(today)-n*864e5).toISOString().slice(0,10);
 const at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'63000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department,patient=s.patients[0].id;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const physio=(await cmd('service',{code:'PT1',name:'جلسة علاج طبيعي',department:dept,price:500,minutes:30,bom:[]})).id;
 const arm=(await cmd('service',{code:'LZA',name:'جلسة ليزر الإبط',department:dept,price:200,minutes:15,bom:[]})).id;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'PT1',rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 await db.exec('reset role');
 await db.exec(`create schema if not exists clinic_finance;create table if not exists clinic_finance.accounts(code text primary key,name text not null,kind text not null);
   insert into clinic_finance.accounts values('2151','مقدمات باكجات','liability') on conflict do nothing;create or replace function clinic_finance.lock_day() returns void language sql as $$select$$;`);
 await db.exec("insert into admins values('61000000-0000-4000-8000-000000000009','financial_manager',true)");
 await db.exec(fs.readFileSync('supabase/migrations/20261123110000_legacy_prepaid_package.sql','utf8'));
 await as(1);await cmd('member',{admin_id:id(9),capabilities:['view']});
 const a1=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:physio,starts_at:at('20:00')})).id;
 const a2=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:physio,starts_at:at('21:00'),same_day_ok:true})).id;
 await as(3);await cmd('arrive',{id:a1});await cmd('arrive',{id:a2});s=await snap();
 const ord=ap=>s.orders.find(o=>o.visit_id===s.visits.find(v=>v.appointment_id===ap).id);await cmd('execute',{id:ord(a2).id});
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.exposeFunction('rxAs',n=>as(n));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-legacy-package'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:a=>[a.role],hasRole:(a,r)=>a.role===r,hasAnyRole:(a,l)=>l.indexOf(a.role)>=0};window.SSMPDToast={show:m=>{window.lastToast=m;}};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}).then(d=>{d.workspace=Object.assign({},d.workspace,{mode:'live'});return d;}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-look','reception-legacy-package','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 const render=async()=>{await page.evaluate(()=>{document.querySelector('#root').innerHTML='';SSMPDReception.render(document.querySelector('#root'));});await page.waitForSelector('[data-rx-section]');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();};
 const submit=async()=>{await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});};
 // 1) reception registers the package from the patient row
 await render();await page.locator('[data-rx-section="patients"]').click();
 const b=page.locator(`[data-rx-action="legacy-package"][data-id="${patient}"]`).first();await b.waitFor({state:'attached'});await b.locator('xpath=ancestor::details[1]/summary').click();await b.click();await page.waitForSelector('.rx-modal [data-rlp-lines]');
 await page.fill('.rx-modal input[name="rlp_name"]','12 جلسة علاج طبيعي + ليزر');await page.fill('.rx-modal input[name="rlp_paid_on"]',ago(19));
 let line=page.locator('.rx-modal [data-rlp-line]').nth(0);await line.locator('select').selectOption(physio);await line.locator('[name="rlp_sessions"]').fill('12');await line.locator('[name="rlp_amount"]').fill('4200');
 await page.locator('.rx-modal [data-rlp-add]').click();line=page.locator('.rx-modal [data-rlp-line]').nth(1);await line.locator('select').selectOption(arm);await line.locator('[name="rlp_sessions"]').fill('3');await line.locator('[name="rlp_amount"]').fill('385');
 assert.match(await page.locator('.rx-modal [data-rlp-sum]').innerText(),/4,585 ج\.م[\s\S]*350 ج\.م[\s\S]*128\.33 ج\.م/,'total + per session');
 await page.fill('.rx-modal input[name="rlp_receipt"]','إيصال ورقي 1520');
 if(process.env.SHOT)await page.locator('.rx-modal .modal').screenshot({path:process.env.SHOT+'/legacy-request.png'});
 await submit();let lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.pending.length,1);assert.equal(+lp.pending[0].total,4585);
 assert.equal(await page.locator('[data-rlp-approvals]').count(),0,'no approvals card for reception');
 // 2) the financial manager approves from the card
 await page.evaluate(()=>{window.SSMPDAuth.currentAdmin={id:'fm',role:'financial_manager'};});await as(9);await page.evaluate(()=>rxAs(9));await render();
 await page.waitForSelector('[data-rlp-approvals] [data-rlp-ok]');assert.match(await page.locator('[data-rlp-approvals]').innerText(),/4,585 ج\.م[\s\S]*مدفوع قبل التشغيل/);
 if(process.env.SHOT)await page.locator('[data-rlp-approvals]').screenshot({path:process.env.SHOT+'/legacy-approvals.png'});
 await page.locator('[data-rlp-approvals] [data-rlp-ok]').click();await page.waitForSelector('[data-rlp-approvals]',{state:'detached'});
 await as(3);lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.pending.length,0);assert.equal(lp.sessions.filter(x=>x.service_id===physio)[0].left,12);
 // 3) reception: ⋯ «خصم من باكج المريض» on the ordered visit, then on the executed-unpaid visit
 await page.evaluate(()=>{window.SSMPDAuth.currentAdmin={id:'rec',role:'reception'};});await page.evaluate(()=>rxAs(3));await render();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 for(const ap of [a1,a2]){const card=await openCard(ap);await card.locator('[data-rx-action="use-package"]').click();await page.waitForSelector('.rx-modal .rlp-ent');
  assert.match(await page.locator('.rx-modal').innerText(),/جلسة علاج طبيعي[\s\S]*فاضل \d+ من 12[\s\S]*350 ج\.م[\s\S]*المريض يدفع[\s\S]*0 ج\.م/);
  if(process.env.SHOT&&ap===a2)await page.locator('.rx-modal .modal').screenshot({path:process.env.SHOT+'/legacy-use.png'});
  await submit();await page.waitForSelector('.rx-tl-week');}
 s=await snap();const o1=ord(a1),o2=ord(a2);assert(o1.entitlement_id&&o2.entitlement_id);assert.equal(+o1.price,350);
 const inv2=s.invoices.find(i=>i.order_id===o2.id);assert.equal(+inv2.due,0,'executed + unpaid → patient pays 0');
 lp=await rpc('clinic_reception_legacy_packages',{p_workspace:w,p_patient:patient});assert.equal(lp.sessions.filter(x=>x.service_id===physio)[0].left,10);
 const card=await openCard(a1);assert.equal(await card.locator('[data-rx-action="use-package"]').count(),0,'hidden once used');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS legacy prepaid package UI (live): reception «باكج مدفوع قبل السيستم» (2 services, total 4,585, 350 / 128.33 per session) → pending; financial manager «اعتمد» → 12 + 3 sessions; reception ⋯ «خصم من باكج المريض» on an ordered and an executed-unpaid physio session → patient pays 0, 10 left, button hidden once used.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
