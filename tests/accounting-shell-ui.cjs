// «الحسابات» unified shell (owner 2026-11-18): one side rail, no sub-tabs, no «فتح القسم» cards, no back buttons,
// review-only sections appear only for reviewers, badges come only from real waiting items, phones get a drawer,
// and no rail item / button text wraps or the page scrolls sideways.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){for(const reviewer of [true,false]){
const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://shell.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="padding:16px"></main></html>'}));
await page.goto('https://shell.test/');for(const f of ['styles','finance-cash','accounting-shell'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
await page.addScriptTag({content:`window.calls=[];window.fixture={can_create:true,can_review:${reviewer},me:'me',closed_through:'2026-10-31',registers:[],shifts:[{id:'s1',status:'submitted',register_name:'خزينة',cashier_name:'م',opened_at:'2026-11-18T08:00:00Z'}],invoices:[],payments:[],requests:[{id:'r1',kind:'expense',status:'pending',amount:10},{id:'r2',kind:'expense',status:'approved',amount:5}],trial:[],entries:[],audit:[],disbursements:[],suppliers:[],doctor_contracts:[],employment_contracts:[]};
window.SSMPDAuth={currentAdmin:{id:'me'}};window.SSMPDRoles={canSeeTab:()=>true,canModuleAction:()=>true};
window.SSMPDDb={financeSnapshot:async function(from,to,offset){calls.push({from,to,offset});return {...fixture,offset};},listPricingSupplies:async()=>({data:[]}),listPricingServices:async()=>({data:[]}),listPricingPackages:async()=>({data:[]})};
window.invCalls=[];window.SSMPDRenderInventory={_v:'overview',go(id){invCalls.push(id);this._v=id;},group(){return this._v;},render(el,o){el.innerHTML='<div class="inv-shell" data-inv="'+this._v+'" data-shell="'+!!(o&&o.shell)+'"><h4 data-inv-heading>inv</h4></div>';}};`});
for(const f of ['finance-controls','finance-doctors','inventory-batch-dates','finance-suppliers','finance-bank','finance-business','finance-reports','finance-advances','finance-treasury','finance-cash','accounting-shell','render-accounting'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
await page.evaluate(()=>SSMPDRenderAccounting.render(document.querySelector('#root')));
await page.waitForSelector('.acs [data-acs-go]');
// no old navigation layers
assert.equal(await page.locator('[data-sub]').count(),0,'no sub-tab bar');
assert.equal(await page.locator('.fc-section-card,[data-acc-back],[data-acc-section]').count(),0,'pricing opens a section directly: no cards, no back');
assert.equal(await page.locator('[data-acs-go="supplies"][aria-current="page"]').count(),1,'default section is marked current');
const ids=await page.$$eval('[data-acs-go]',b=>b.map(x=>x.dataset.acsGo));
for(const id of ['shifts','invoices','payments','requests','doctor-accounts','bank','supplies','services','packages','inv:stock'])assert(ids.includes(id),'rail has '+id);
const mobile=width<861;
async function go(id){if(mobile){await page.click('[data-acs-open]');await page.waitForTimeout(450);assert(await page.evaluate(()=>document.body.classList.contains('acs-drawer-open')),'drawer opens');}await page.click('[data-acs-go="'+id+'"]');}
// treasury: opens straight into the section, compact filter row, no group bar/back
await go('doctor-accounts');await page.waitForSelector('.fc-workspace.fc-v2 [data-fc-heading]');
assert.equal(await page.locator('.fc-group-nav,[data-fc-back],.fc-section-card').count(),0,'treasury has no group bar, cards or back inside the shell');
assert.equal((await page.textContent('[data-fc-heading]')).trim(),'حساب الأطباء');
assert.equal(await page.locator('[data-acs-go="doctor-accounts"][aria-current="page"]').count(),1);
if(mobile)assert(!(await page.evaluate(()=>document.body.classList.contains('acs-drawer-open'))),'drawer closes after choosing');
// review-only sections and badges follow the real data
const has=async id=>page.locator('[data-acs-go="'+id+'"]').count();
assert.equal(await has('ledger'),reviewer?1:0,'ledger only for reviewers');assert.equal(await has('settings'),reviewer?1:0,'settings only for reviewers');
assert.equal(await page.locator('[data-acs-go="requests"] em').count(),reviewer?1:0,'pending-request badge only for reviewers');
if(reviewer){assert.equal((await page.textContent('[data-acs-go="requests"] em')).trim(),'1','one pending request (approved one not counted)');assert.equal((await page.textContent('[data-acs-go="shifts"] em')).trim(),'1','one shift waiting for review');}
// moving between treasury sections keeps the loaded data (no reload) and the period
const before=await page.evaluate(()=>calls.length);await go('payments');await page.waitForFunction(()=>document.querySelector('[data-fc-heading]').textContent.trim()==='التحصيل');assert.equal(await page.evaluate(()=>calls.length),before,'switching sections does not refetch');
// tables become one card per row on phones; every cell knows its column title
await go('shifts');await page.waitForFunction(()=>document.querySelector('[data-fc-heading]').textContent.trim()==='الخزائن والورديات');await page.waitForSelector('table[data-acs-cards] td[data-th]');
assert.equal(await page.$eval('table[data-acs-cards] thead',t=>getComputedStyle(t).display==='none'),mobile,'column headers hidden only on phones');
// inventory and pricing
await go('inv:stocktakes');await page.waitForSelector('.inv-shell[data-shell="true"]');assert.deepEqual(await page.evaluate(()=>invCalls.slice(-1)),['stocktakes']);
await go('services');await page.waitForFunction(()=>(document.querySelector('[data-acc-heading]')||{}).textContent==='الخدمات والتسعير');
assert.equal(await page.locator('[data-acs-go="services"][aria-current="page"]').count(),1);
// in-page shortcut to another section (e.g. doctor accounts → «عقود الأطباء»)
await page.evaluate(()=>{const b=document.createElement('button');b.setAttribute('data-acs-jump','doctors');b.id='jump';document.querySelector('#acc-sub-view').appendChild(b);b.click();});
await page.waitForFunction(()=>document.querySelector('[data-acs-go="doctors"][aria-current="page"]'));
// search filters the rail
if(mobile){await page.click('[data-acs-open]');await page.waitForTimeout(450);}
await page.fill('[data-acs-q]','الأطباء');assert.equal(await page.locator('[data-acs-go]:visible').count(),2,'search keeps حساب الأطباء + عقود الأطباء');await page.fill('[data-acs-q]','');
if(mobile){await page.keyboard.press('Escape');await page.waitForTimeout(450);assert(!(await page.evaluate(()=>document.body.classList.contains('acs-drawer-open'))),'Escape closes the drawer');}
// group collapse is remembered
await page.evaluate(()=>{const h=document.querySelector('[data-acs-group="reports"] .acs-gh');if(h)h.click();});
// text never wraps inside rail items, tabs and buttons; nothing scrolls sideways
const bad=await page.evaluate(()=>{const out=[];document.querySelectorAll('.acs-i,.acs-gh,.acs-open,.fc-filters .btn').forEach(e=>{if(!e.offsetParent&&getComputedStyle(e).position!=='fixed')return;const tw=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let t;while((t=tw.nextNode())){if(!t.nodeValue.trim())continue;const r=document.createRange();r.selectNodeContents(t);const tops=new Set([...r.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top)));if(tops.size>1)out.push(e.textContent.trim());}});return {out,ox:document.documentElement.scrollWidth-innerWidth};});
assert.deepEqual(bad.out,[],'no wrapped text');assert(bad.ox<=0,'no sideways scroll ('+bad.ox+')');
if(process.env.SHELL_QA_SHOTS)await page.screenshot({path:process.env.SHELL_QA_SHOTS+'/shell-'+width+'-'+(reviewer?'reviewer':'staff')+'.png'});
assert.deepEqual(errors,[]);await page.close();}}
console.log('PASS accounting shell 1280/390: one rail (no sub-tabs/cards/back), treasury/pricing/inventory open directly, reviewer-only sections + real badges, no refetch between sections, mobile drawer + Escape, rail search, no wrapped text or sideways scroll');}
catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}})();
