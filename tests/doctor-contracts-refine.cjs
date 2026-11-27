// Owner 2026-11-25 («طبقه», mockup docs/ui-references/mockups/doctor-contracts-refine.html): «عقود الأطباء» opens as a CLOSED list (one row per
// doctor), doctors needing attention (pending / ending soon) first, one open at a time + «فتح الكل»; the shared terms show once per doctor and a
// differing contract says «مختلف: …»; phone cards label the status; empty statement sections collapse to one line; one wording «بينتهي قريب»;
// a service code with no saved name says so. Real browser, real CSS, financial manager, 1280/390. Same buttons and RPCs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const mk=(id,key,name,status,from,to,extra)=>Object.assign({id,doctor_key:key,doctor_name:name,service_scope:'0001374',valid_from:from,valid_to:to,rate:40,base_scope:'service',deduction:'none',basis:'performed',status,created_by:'maker'},extra||{});
const base={today:'2026-11-25',me:'fm',can_create:true,can_review:true,stock_catalog:[],invoices:[],doctor_allocations:[],doctor_payouts:[],doctor_balances:[],doctor_contracts:[
 mk('s1','EMP-30','د. سارة مراد','active','2026-01-01','2026-12-31'),mk('s2','EMP-30','د. سارة مراد','active','2026-01-01','2026-12-31',{service_scope:'D-2',rate:30}),mk('s3','EMP-30','د. سارة مراد','active','2026-01-01','2026-12-31',{basis:'collected',rate:35}),
 mk('k1','EMP-12','د. كريم حسان','active','2026-01-01','2026-12-31'),mk('k2','EMP-12','د. كريم حسان','pending','2027-01-01','2027-12-31',{rate:50}),
 mk('a1','EMP-05','د. أحمد فؤاد','active','2026-01-01','2026-12-01')]};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://dcr.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:12px"><div id="host" class="fc-workspace"></div></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://dcr.test/');for(const f of ['styles','finance-cash','finance-doctors-look','dashboard-theme'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:"window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.SSMPDDb={financeFixedFeeEnabled:async()=>true,financeLinesEnabled:async()=>true,financeContractServices:async()=>[{code:'0001374',name:'كشف باطنة استشاري'}],financeContractDepartments:async()=>[],financeDoctorCommand:async()=>({}),financeSnapshot:async()=>({})};"});
 for(const f of ['finance-cash','finance-controls','finance-doctors'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 const render=async d=>{await page.evaluate(d=>{var h=SSMPDFinanceCash.helpers,host=document.getElementById('host');host.innerHTML=SSMPDFinanceControls.panel('doctors',d,h);host.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(ev){ev.preventDefault();SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,d,h);};});},d);await page.waitForTimeout(150);};
 await render(base);
 const g=k=>page.locator('.fc-doctor-group[data-dc-key="'+k+'"]');
 // 6) closed list, attention first, headers with counts
 assert.equal(await page.locator('.fc-doctor-group[open]').count(),0,'all doctors start closed');
 assert.deepEqual(await page.locator('.fc-doctor-group').evaluateAll(n=>n.map(x=>x.dataset.dcKey)),['EMP-05','EMP-12','EMP-30'],'ending-soon and pending first (by name), then the rest');
 assert.deepEqual(await page.locator('.dc-grp:visible').allInnerTexts(),['محتاجين حاجة منك (2)','باقي الدكاترة (1)']);
 assert(await g('EMP-12').evaluate(n=>n.classList.contains('dc-attn')));assert(!(await g('EMP-30').evaluate(n=>n.classList.contains('dc-attn'))));
 if(process.env.DCR_QA)await page.screenshot({path:process.env.DCR_QA+'/dcr-list-'+width+'.png',fullPage:true});
 // one open at a time
 await g('EMP-30').locator('summary strong').click();await page.waitForTimeout(50);assert.equal(await page.locator('.fc-doctor-group[open]').count(),1);
 await g('EMP-12').locator('summary strong').click();await page.waitForTimeout(50);assert.deepEqual(await page.locator('.fc-doctor-group[open]').evaluateAll(n=>n.map(x=>x.dataset.dcKey)),['EMP-12'],'opening another closes the first');
 await page.click('[data-dc-openall]');assert.equal(await page.locator('.fc-doctor-group[open]').count(),3);assert.equal((await page.textContent('[data-dc-openall]')).trim(),'قفل الكل');
 await page.click('[data-dc-openall]');assert.equal(await page.locator('.fc-doctor-group[open]').count(),0);
 // 2) shared terms once + «مختلف» on the differing contract; 4 columns
 await g('EMP-30').locator('summary strong').click();await page.waitForTimeout(80);
 assert.equal((await g('EMP-30').locator('.dc-terms').innerText()).replace(/\s+/g,' ').trim(),'النسبة بتتحسب على: الخدمة دون بنود المستلزمات خصم المستلزمات: بدون خصم مستلزمات الاستحقاق: عند تنفيذ الخدمة'.replace(/\s+/g,' '));
 assert.equal(await g('EMP-30').locator('thead th').count(),4);
 const diffs=await g('EMP-30').locator('.dc-diff').allInnerTexts();assert.equal(diffs.length,1);assert(diffs[0].startsWith('مختلف: الاستحقاق:'),diffs[0]);
 // 5) code without a saved name
 assert.equal((await g('EMP-30').locator('[data-fc-svc="D-2"] .dc-noname').innerText()).trim(),'مفيش اسم محفوظ للكود ده');
 // 4) one wording
 assert.equal(await page.locator('[data-fc-filter="soon"]').innerText().then(t=>t.replace(/\s*\(\d+\)/,'').trim()),'بينتهي قريب');
 await g('EMP-05').locator('summary strong').click();await page.waitForTimeout(50);assert.equal((await g('EMP-05').locator('[data-dc-state]').innerText()).trim(),'بينتهي خلال 6 يوم');
 // 1) phone: the status value carries its label
 if(width<=600){const lab=await g('EMP-05').locator('tbody td:nth-child(3)').evaluate(td=>getComputedStyle(td,'::before').content);assert.equal(lab,'"الحالة"');}
 if(process.env.DCR_QA)await page.screenshot({path:process.env.DCR_QA+'/dcr-open-'+width+'.png',fullPage:true});
 // 3) empty statement → one line
 assert.equal((await page.locator('.dc-stm-empty').innerText()).trim(),'رصيد الدكتور والفواتير والتسويات — مفيش حركات في الفترة دي');assert.equal(await page.locator('h4',{hasText:'استحقاق الفواتير'}).count(),0);
 // same buttons: «تعديل العقد» still opens the revise dialog
 await g('EMP-05').locator('[data-fin-action="doctor-contract-revise"]').click();await page.waitForSelector('.fc-modal');assert((await page.locator('.fc-modal').last().innerText()).length>0);
 await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>(m.closest('.fc-overlay,.modal-backdrop')||m).remove()));
 const sw=await page.evaluate(()=>document.scrollingElement.scrollWidth);assert(sw<=width+1,'no sideways scroll '+sw);
 // with movements the sections come back
 await render(Object.assign({},base,{doctor_balances:[{doctor_name:'د. كريم حسان',doctor_key:'EMP-12',balance:500}]}));
 assert.equal(await page.locator('.dc-stm-empty').count(),0);assert.equal(await page.locator('h4',{hasText:'رصيد الطبيب بعد التسويات'}).count(),1);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS doctor contracts refine 1280/390: closed list (attention first, one open at a time, فتح/قفل الكل), shared terms once + «مختلف», 4 columns, no-name note, «بينتهي قريب» wording, phone status label, one empty statement line (sections back with movements), revise button unchanged, no sideways scroll.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
