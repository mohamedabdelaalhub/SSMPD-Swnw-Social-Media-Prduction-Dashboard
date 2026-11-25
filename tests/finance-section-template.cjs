// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/finance-section-template.html): every «الحسابات» section opens with the
// SAME look — the title is the menu name with its path, one short line, the long explanation folded into «إزاي بيشتغل؟», a count over each list,
// a plain empty text, and «ده كل اللي في الفترة دي.» instead of two dead pager buttons. Real browser, real shell + CSS, accountant, 1280/390.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://fst.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="padding:16px"></main></html>'}));
await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
await page.goto('https://fst.test/');for(const f of ['styles','finance-cash','finance-section-template','accounting-shell'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
await page.addScriptTag({content:`window.fixture={can_create:true,can_review:true,me:'me',closed_through:'2026-10-31',registers:[{id:'g1',name:'خزينة الاستقبال'}],shifts:[],invoices:[{id:'i1',reference:'INV-1',patient_ref:'P-1',description:'كشف باطنة',amount:300,collected:300,refunded:0},{id:'i2',reference:'INV-2',patient_ref:'P-2',description:'سونار',amount:450,collected:0,refunded:0}],payments:[],requests:[],trial:[],entries:[],audit:[],disbursements:[],suppliers:[],doctor_contracts:[],employment_contracts:[]};
window.SSMPDAuth={currentAdmin:{id:'me',role:'accountant'}};window.SSMPDRoles={canSeeTab:()=>true,canModuleAction:()=>true};
window.SSMPDDb={financeSnapshot:async function(){return {...fixture};},listPricingSupplies:async()=>({data:[]}),listPricingServices:async()=>({data:[]}),listPricingPackages:async()=>({data:[]})};
window.SSMPDRenderInventory={go(){},group(){return 'overview';},render(el){el.innerHTML='<div></div>';}};`});
for(const f of ['finance-controls','finance-doctors','finance-suppliers','finance-bank','finance-business','finance-reports','finance-advances','finance-treasury','finance-cash','accounting-shell','render-accounting'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
await page.evaluate(()=>SSMPDRenderAccounting.render(document.querySelector('#root')));await page.waitForSelector('.acs [data-acs-go]');
const mobile=width<861;async function go(id){if(mobile){await page.click('[data-acs-open]');await page.waitForTimeout(450);}await page.click('[data-acs-go="'+id+'"]');await page.waitForSelector('.fc-v2 .fst-path');}
// invoices: menu title + path, long intro folded, count over the list
await go('invoices');await page.waitForFunction(()=>document.querySelector('[data-fc-heading]').textContent.trim()==='الخدمات والفواتير');
assert.equal((await page.textContent('.fst-path')).trim(),'الحسابات › الخزينة اليومية');
const how=page.locator('.fst-how');assert.equal(await how.count(),1);assert(!(await how.getAttribute('open')));assert((await how.textContent()).includes('سجل الخدمة بعد تنفيذها'),'the same intro text, folded');
assert(!(await page.locator('.fst-how p').first().isVisible()));await page.click('.fst-how>summary');assert(await page.locator('.fst-how p').first().isVisible());
assert.equal((await page.locator('.fst-count').first().textContent()).trim(),'2 سجلات');
assert.equal((await page.textContent('.fst-pager span')).trim(),'ده كل اللي في الفترة دي.');assert(!(await page.locator('[data-fc-next]').isVisible()));assert(!(await page.locator('.fc-limit').isVisible()));
if(process.env.FST_QA)await page.screenshot({path:process.env.FST_QA+'/fst-invoices-'+width+'.png',fullPage:true});
// the section's own button still works (same handler)
await page.locator('[data-fin-action="invoice"]').click();await page.waitForSelector('.fc-modal');await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>(m.closest('.fc-overlay,.modal-backdrop')||m).remove()));
// doctors: the menu says «عقود الأطباء» (the old panel name «الأطباء والأتعاب» is gone from the heading)
await go('doctors');await page.waitForFunction(()=>document.querySelector('[data-fc-heading]').textContent.trim()==='عقود الأطباء');assert.equal((await page.textContent('.fst-path')).trim(),'الحسابات › الصرف والمستحقات');
// payments: empty text
await go('payments');await page.waitForFunction(()=>document.querySelector('[data-fc-heading]').textContent.trim()==='التحصيل');assert(await page.locator('.fc-empty',{hasText:'مفيش حاجة هنا في الفترة دي.'}).first().isVisible());
if(process.env.FST_QA)await page.screenshot({path:process.env.FST_QA+'/fst-payments-'+width+'.png'});
const sw=await page.evaluate(()=>document.scrollingElement.scrollWidth);assert(sw<=width+1,'no sideways scroll '+sw);
assert.deepEqual(errors,[]);await page.close();}
console.log('PASS finance section template 1280/390: menu-name title + path, long intro folded in «إزاي بيشتغل؟», list count, plain empty text, «ده كل اللي في الفترة دي.», section buttons unchanged.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
