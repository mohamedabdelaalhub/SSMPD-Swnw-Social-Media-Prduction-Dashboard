// Package offers UI (20261123170000) — real reception screen + real local SQL, RECEPTION user (live-style snapshot):
//   «تعاقد على باكج» lists only templates inside their sell window («عرض لحد …»), the expired offer is not offered; sale works.
//   «تحصيل» on the package shows «أقل دفعة مسموح بيها دلوقتي» (25 % first), prefilled; a smaller amount is refused by the server
//   with its message in the modal; the minimum is accepted.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const b=await boot(),{db,as,call,key,id}=b;await as(1);const workspace=await call('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cmd=(a,p)=>call('clinic_reception_command',[workspace,a,p,key()]),snap=()=>call('clinic_reception_snapshot',[workspace,date,date]);let data=await snap();
 const service=data.services.find(x=>x.code==='CONSULT').id,patient=data.patients[0];
 await cmd('member',{admin_id:id(4),capabilities:['view','book','execute','collect']});
 const mk=code=>cmd('template',{code,name:code==='OFFER'?'عرض الموسم 4 زيارات':'عرض قديم',price:4000,visits:4,validity_days:120,terms:'عرض',lines:[1,2,3,4].map(visit_no=>({visit_no,service_id:service,quantity:1}))}).then(r=>r.id);
 const offer=await mk('OFFER'),old=await mk('OLD');
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261123170000_package_offers.sql','utf8'));
 await db.query("update clinic_reception.package_templates set min_first_percent=25, sell_from=$2::date-5, sell_until=$2::date+10 where id=$1",[offer,date]);
 await db.query("update clinic_reception.package_templates set sell_until=$2::date-1 where id=$1",[old,date]);
 await as(4);
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('rxCall',call);
 await page.route('https://rx.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><main id="root" style="padding:16px;max-width:1400px;margin:auto"></main></html>'}));
 await page.goto('https://rx.test/');for(const f of ['styles','finance-cash','reception-workspace','reception-look'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`try{localStorage.clear()}catch(e){};window.SSMPDAuth={currentAdmin:{id:'${id(4)}',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={receptionBootstrap:()=>rxCall('clinic_reception_bootstrap'),receptionWorkspaces:()=>rxCall('clinic_reception_workspaces'),receptionSnapshot:(...a)=>rxCall('clinic_reception_snapshot',a).then(d=>{d.workspace=Object.assign({},d.workspace,{mode:'live'});return d;}),receptionCommand:(...a)=>rxCall('clinic_reception_command',a),receptionReport:(...a)=>rxCall('clinic_reception_report',a),receptionMarketing:(...a)=>rxCall('clinic_reception_marketing',a),receptionMasters:(...a)=>rxCall('clinic_reception_masters',a)};`});
 for(const f of ['swnw-print','finance-cash','reception-bridge','reception-controls','reception-look','reception-services','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');if(await page.locator('[data-guide-skip]').count())await page.locator('[data-guide-skip]').click();
 // 1) sale: only the offer inside its window
 await page.locator('[data-rx-section="packages"]').click();await page.locator('[data-rx-action="package_sell"]').first().click();await page.waitForSelector('.rx-modal [name="template_id"]');
 const opts=await page.$$eval('.rx-modal [name="template_id"] option',o=>o.map(x=>[x.value,x.textContent]));
 assert(opts.some(o=>o[0]===offer&&/عرض لحد/.test(o[1])),'offer listed with «عرض لحد»: '+JSON.stringify(opts));assert(!opts.some(o=>o[0]===old),'expired offer hidden');
 await page.selectOption('.rx-modal [name="patient_id"]',patient.id).catch(()=>{});await page.selectOption('.rx-modal [name="template_id"]',offer);
 const lines=page.locator('.rx-modal [data-rx-lines] .rx-line-editor button');while(await lines.count())await lines.first().click();
 if(process.env.SHOT)await page.locator('.rx-modal .modal').screenshot({path:process.env.SHOT+'/offer-sell.png'});
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 data=await snap();const P=data.packages.find(p=>p.template_id===offer);assert(P,'sold');assert.equal(+P.min_first_percent,25);
 // 2) collect: minimum shown + prefilled; below → server refusal in the modal; the minimum → ok
 const open=async()=>{await page.locator('.rv-pk details.rv-menu summary').first().click();await page.locator('.rv-pk details.rv-menu[open] [data-rx-action="package-detail"]').click();await page.waitForSelector('.rx-modal [data-rx-action="collect-package"]');await page.locator('.rx-modal [data-rx-action="collect-package"]').click();await page.waitForSelector('.rx-modal [data-rx-package-min]');};
 await page.locator('[data-rx-section="packages"]').click().catch(()=>{});await page.waitForSelector('.rv-pk');await open();
 assert.match(await page.locator('.rx-modal [data-rx-package-min]').innerText(),/أقل دفعة مسموح بيها دلوقتي: 1,000[\s\S]*25٪ من قيمة الباكج كأول دفعة/);
 assert.equal(+(await page.inputValue('.rx-modal [name="amount"]')),1000,'prefilled with the minimum');
 if(process.env.SHOT)await page.locator('.rx-modal .modal').screenshot({path:process.env.SHOT+'/offer-collect.png'});
 await page.fill('.rx-modal [name="amount"]','500');await page.selectOption('.rx-modal [name="method"]','instapay');await page.fill('.rx-modal [name="reference"]','IP-OFFER-1');
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForFunction(()=>/أقل دفعة للباكج دلوقتي 1,000.00/.test((document.querySelector('.rx-modal [data-rx-status]')||{}).textContent||''));
 await page.fill('.rx-modal [name="amount"]','1000');await page.fill('.rx-modal [name="reference"]','IP-OFFER-2');await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 data=await snap();assert.equal(+data.packages.find(p=>p.id===P.id).funded,1000);
 assert(!errors.length,errors.join('\n'));
 console.log('PASS package offers UI (reception): sale lists only the offer inside its window («عرض لحد …»), expired hidden; «تحصيل» shows + prefills the 25 % minimum, 500 refused by the server in the modal, 1,000 accepted.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
