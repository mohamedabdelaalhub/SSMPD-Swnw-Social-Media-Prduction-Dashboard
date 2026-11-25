// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/doctor-contracts-look.html): «عقود الأطباء» — status from TODAY's date
// (ساري / ينتهي خلال X يوم / منتهي / قيد الاعتماد / مرفوض / اتعدّل), default filter «سارية + قيد الاعتماد» with a per-doctor «السجل القديم» toggle,
// red «إنهاء العقد» after a divider, «إزاي بتتحسب الأتعاب؟» fold, phone cards, grouped add-contract form with required marks and inline Arabic errors.
// Real browser, real finance-cash.js helpers + CSS, as the financial manager (create + review), 1280 and 390. RPCs unchanged.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const mk=(id,status,from,to,extra)=>Object.assign({id,doctor_key:'EMP-12',doctor_name:'د. كريم حسان',service_scope:'0001374',valid_from:from,valid_to:to,rate:40,base_scope:'service',deduction:'none',basis:'performed',status,created_by:'maker'},extra||{});
const data={today:'2026-11-25',me:'fm',can_create:true,can_review:true,stock_catalog:[],invoices:[],doctor_allocations:[],doctor_payouts:[],doctor_balances:[],doctor_contracts:[
 mk('c1','active','2026-01-01','2026-12-31'),mk('c2','active','2026-01-01','2026-12-05',{service_scope:'D-2',rate:30}),mk('c3','pending','2027-01-01','2027-12-31',{rate:50}),
 mk('c4','active','2026-01-01','2026-06-30',{service_scope:'D-1',rate:25}),mk('c5','rejected','2026-07-01','2027-06-30',{service_scope:'D-1'}),mk('c6','superseded','2026-01-01','2026-12-31',{rate:35})]};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://dc.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:12px"><div id="host"></div></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://dc.test/');for(const f of ['styles','finance-cash','finance-doctors-look','dashboard-theme'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:"window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.__sent=[];window.SSMPDDb={financeFixedFeeEnabled:async()=>true,financeLinesEnabled:async()=>true,financeContractServices:async()=>[{code:'0001374',name:'كشف باطنة استشاري'}],financeContractDepartments:async()=>[],financeDoctorCommand:async(a,p,k)=>{window.__sent.push({a:a,p:p});return {};},financeSnapshot:async()=>({})};"});
 for(const f of ['finance-cash','finance-controls','finance-doctors'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(d=>{var h=SSMPDFinanceCash.helpers,host=document.getElementById('host');host.innerHTML=SSMPDFinanceControls.panel('doctors',d,h);host.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,d,h);};});},data);
 await page.waitForTimeout(150);
 const pill=id=>page.locator('.fc-doctor-group tbody tr',{has:page.locator('[data-dc-state]')}).filter({hasText:id});
 const pills=await page.locator('[data-dc-state]').allInnerTexts();
 for(const p of ['ساري','ينتهي خلال 10 يوم','قيد الاعتماد','منتهي','مرفوض','اتعدّل (نسخة أقدم)'])assert(pills.includes(p),'pill '+p+' in '+pills);
 assert.deepEqual(await page.locator('[data-fc-filter]').evaluateAll(n=>n.map(x=>x.dataset.fcFilter)),['live','pending','soon','all']);
 assert((await page.locator('[data-fc-filter="live"]').innerText()).includes('(3)'),'live = ساري + بينتهي + قيد الاعتماد');
 const visibleRows=()=>page.locator('.fc-doctor-group tbody tr:not([hidden])').count();
 assert.equal(await visibleRows(),3,'old rows hidden by default');
 const old=page.locator('[data-dc-old]');assert.equal((await old.innerText()).trim(),'السجل القديم (3)');await old.click();assert.equal(await visibleRows(),6);await old.click();assert.equal(await visibleRows(),3);
 await page.locator('[data-fc-filter="soon"]').click();assert.equal(await visibleRows(),1);await page.locator('[data-fc-filter="all"]').click();assert.equal(await visibleRows(),6);await page.locator('[data-fc-filter="live"]').click();
 // red «إنهاء العقد» after a divider; it still opens the existing end-contract flow
 const end=page.locator('.dc-danger').first();assert.equal((await end.innerText()).trim(),'إنهاء العقد');assert.equal(await end.evaluate(b=>b.previousElementSibling&&b.previousElementSibling.className),'dc-sep');
 await end.click();await page.waitForSelector('.fc-modal');assert((await page.locator('.fc-modal').innerText()).includes('إنهاء عقد'));await page.locator('.fc-modal .modal-close').click();
 assert(await page.locator('.dc-how summary').isVisible());assert((await page.locator('#host').innerText()).includes('3 عقود')===false);
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+width+' '+ov);
 if(width===390)assert.equal(await page.locator('.fc-doctor-group tbody tr').first().evaluate(r=>getComputedStyle(r).display),'grid','phone card');
 if(process.env.DC_QA)await page.screenshot({path:process.env.DC_QA+'/dc-'+width+'.png',fullPage:true});
 // add-contract form: 3 groups, required marks, inline Arabic errors, then a real submit reaches financeDoctorCommand('contract')
 await page.locator('[data-fin-action="doctor-contract"]').click();await page.waitForSelector('.fc-modal .dc-grp');
 assert.deepEqual(await page.locator('.fc-modal .dc-grp>legend').allInnerTexts(),['1 · الدكتور والخدمة','2 · المدة','3 · الأتعاب']);
 assert(await page.locator('.fc-modal .dc-req').count()>3,'required marks');
 await page.locator('.fc-modal form button[type=submit]').click();await page.waitForTimeout(150);
 assert((await page.locator('.fc-modal .dc-err').first().innerText()).includes('لازم تتملى'),'inline Arabic error');assert.equal((await page.evaluate(()=>window.__sent)).length,0);
 await page.locator('.fc-modal [name=doctor_key]').fill('EMP-12');await page.locator('.fc-modal [name=doctor_key]').dispatchEvent('change');assert.equal(await page.inputValue('.fc-modal [name=doctor_name]'),'د. كريم حسان','datalist pick fills the name');
 if(process.env.DC_QA)await page.screenshot({path:process.env.DC_QA+'/dc-form-'+width+'.png',fullPage:true});
 await page.selectOption('.fc-modal [name=fee_kind]','percent');
 await page.evaluate(()=>{document.querySelectorAll('.fc-modal form input, .fc-modal form select').forEach(function(el){var l=el.closest('label');if(el.disabled||(l&&l.closest('[hidden]'))||el.type==='hidden'||el.type==='search')return;if(el.type==='checkbox'){if(el.required)el.checked=true;return;}if(el.value)return;if(el.tagName==='SELECT'){var o=[].find.call(el.options,function(x){return x.value;});if(o)el.value=o.value;}else if(el.type==='date')el.value=el.name==='to'?'2027-12-31':'2027-01-01';else if(el.type==='number')el.value='30';else el.value='0001374';el.dispatchEvent(new Event('change',{bubbles:true}));});});
 await page.locator('.fc-modal form button[type=submit]').click();await page.waitForTimeout(300);
 const sent=await page.evaluate(()=>window.__sent);assert.equal(sent.length,1,'submit reached the RPC: '+await page.evaluate(()=>{var s=document.querySelector('.fc-modal [data-fc-status]');return s?s.textContent:'closed';}));assert.equal(sent[0].a,'contract');assert.equal(sent[0].p.doctor_key,'EMP-12');assert.equal(sent[0].p.rate,30);assert.equal(sent[0].p.refund_policy,'proportional_revenue');
 assert(!/[\u0660-\u0669]/.test(await page.locator('#host').innerText()));assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS doctor contracts look 1280/390: date-based pills, «سارية + قيد الاعتماد» default + السجل القديم toggle, soon/all filters, red end button opens the end flow, how-fold, phone cards, grouped form with required marks + inline Arabic errors, submit reaches financeDoctorCommand(contract) unchanged.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
