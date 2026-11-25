// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/finance-ledger.html): «القيود وميزان المراجعة» — a total row that says
// balanced or shows the difference in red, zero accounts hidden behind a toggle, sides written «مدين/دائن», entries as one compact list
// (date in words, «قيد #event_no», amount, «تلقائي/يدوي») that opens on its lines with the SAME buttons. Real browser, real CSS, FM, 1280/390.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const trial=[{code:'1111',name:'الخزينة',opening:5000,debit:12400,credit:6550,balance:10850},{code:'2110',name:'مستحقات الأطباء',opening:0,debit:0,credit:2400,balance:-2400},
 {code:'4110',name:'إيراد الكشوفات',opening:0,debit:0,credit:10830,balance:-10830},{code:'5210',name:'أتعاب الأطباء',opening:0,debit:2400,credit:0,balance:2400},{code:'3100',name:'رأس المال',opening:-5000,debit:0,credit:0,balance:-5000},
 {code:'5120',name:'إيجار',opening:0,debit:0,credit:0,balance:0},{code:'5130',name:'كهرباء',opening:0,debit:0,credit:0,balance:0},{code:'5110',name:'مصروفات تشغيل',opening:0,debit:4980,credit:0,balance:4980}];
const entries=[{id:'e1',event_no:805,business_date:'2026-11-25',description:'تحصيل كشف باطنة',source:'reception_payment',can_reverse:true,lines:[{account:'1111',account_name:'الخزينة',debit:300,credit:0},{account:'4110',account_name:'إيراد الكشوفات',debit:0,credit:300}]},
 {id:'e2',event_no:800,business_date:'2026-11-20',description:'تسوية عجز خزينة الأسنان',source:'manual_correction',manual_kind:'correction',can_reverse:false,lines:[{account:'5110',account_name:'مصروفات تشغيل',debit:20,credit:0},{account:'1111',account_name:'الخزينة',debit:0,credit:20}]},
 {id:'e3',event_no:null,business_date:'2026-11-19',description:'قيد قديم',source:'manual_opening',lines:[{account:'1111',debit:5,credit:0},{account:'3100',debit:0,credit:5}]}];
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://le.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:12px"><div id="host"></div></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://le.test/');for(const f of ['styles','finance-cash','ledger-look','dashboard-theme','dashboard-glass'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:"window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.__origin=[];window.SSMPDDb={financeEntryOrigin:function(id){window.__origin.push(id);return Promise.resolve({reference:'INV-1',kind:'invoice'});},financeLedgerCommand:function(){return Promise.resolve({});}};"});
 for(const f of ['finance-labels','finance-cash','finance-controls','ledger-editor'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 const run=async d=>page.evaluate(d=>{var h=SSMPDFinanceCash.helpers,host=document.getElementById('host');window.__d=d;host.innerHTML=SSMPDLedgerEditor.ledger(d,h);host.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,d,h);};});},d);
 await run({trial,entries,finance_accounts:[],can_review:true});
 // balance + total row (same Σdebit/Σcredit)
 assert.equal(await page.locator('[data-le-balance]').innerText(),'متوازن ✓');
 assert.deepEqual(await page.locator('.le-trial tfoot td').allInnerTexts().then(a=>a.filter(Boolean)),['الإجمالي','19,780.00','19,780.00','متوازن ✓'],'Σdebit = Σcredit');
 // sides in words
 const row=n=>page.locator('.le-trial tbody tr',{hasText:n});
 assert((await row('مستحقات الأطباء').innerText()).includes('2,400.00 دائن'));assert((await row('الخزينة').innerText()).includes('10,850.00 مدين'));
 // zero accounts hidden → toggle
 assert.equal(await row('كهرباء').isVisible(),false);const zt=page.locator('.le-zero');assert.equal((await zt.innerText()).trim(),'إظهار الحسابات الصفرية (2)');
 await zt.click();assert(await row('كهرباء').isVisible());await zt.click();assert.equal(await row('كهرباء').isVisible(),false);
 // entries list
 const e1=page.locator('.le-entry').nth(0),e2=page.locator('.le-entry').nth(1),e3=page.locator('.le-entry').nth(2);
 assert((await e1.locator('summary').innerText()).includes('25 نوفمبر 2026'));assert.equal(await e1.locator('.le-no').innerText(),'قيد #805');assert.equal(await e1.locator('.le-amt').innerText(),'300.00');
 assert.equal(await e1.locator('.le-tag').innerText(),'تلقائي');assert.equal(await e2.locator('.le-tag').innerText(),'يدوي');assert.equal(await e3.locator('.le-tag').innerText(),'يدوي');assert.equal(await e3.locator('.le-no').innerText(),'');
 assert.equal(await e1.locator('td').first().isVisible(),false,'lines folded');await e1.locator('summary').click();assert(await e1.locator('td',{hasText:'1111 — الخزينة'}).isVisible());
 if(process.env.LE_QA)await page.screenshot({path:process.env.LE_QA+'/le-'+width+'.png',fullPage:true});
 // the same buttons → same handlers
 assert.equal(await e2.locator('[data-fin-action="ledger-correct"]').count(),0,'no correction when can_reverse is false');
 await e1.locator('[data-fin-action="ledger-origin"]').click();await page.waitForFunction(()=>window.__origin.length===1);assert.deepEqual(await page.evaluate(()=>window.__origin),['e1']);
 await page.waitForSelector('.fc-modal');await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>(m.closest('.fc-overlay')||m).remove()));
 await e1.locator('[data-fin-action="ledger-correct"]').click();await page.waitForSelector('.fc-modal');assert((await page.locator('.fc-modal').last().innerText()).includes('تصحيح قيد بعكس وبديل'));
 await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>(m.closest('.fc-overlay')||m).remove()));
 const sw=await page.evaluate(()=>document.scrollingElement.scrollWidth);assert(sw<=width,'no sideways scroll '+sw);
 // unbalanced → red difference
 await run({trial:trial.concat([{code:'9',name:'فرق',opening:0,debit:50,credit:0,balance:50}]),entries:[],can_review:true});
 assert.equal(await page.locator('[data-le-balance]').innerText(),'فيه فرق 50.00 — راجع القيود');assert(await page.locator('.le-trial tfoot tr.is-bad').count());assert.equal(await page.locator('.le-empty').innerText(),'مفيش قيود في الفترة دي.');
 if(process.env.LE_QA)await page.screenshot({path:process.env.LE_QA+'/le-bad-'+width+'.png'});
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS ledger look 1280/390: balanced/difference total row, zero accounts behind a toggle, sides in words, compact entries (date in words, «قيد #N», amount, تلقائي/يدوي) that open on their lines, same origin/correction buttons, no sideways scroll.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
