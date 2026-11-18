// «الحسابات ← نظرة عامة» (owner-approved mockup 2026-11-18): drawn only from clinic_finance_overview() fields,
// tiles 4/2/1 (never 3+1), chart fills its card, «محتاج منك» opens the right section, nothing faked when a field is missing,
// people with nothing to see (or no RPC yet) go straight to their sections.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const full={generated_at:'2026-11-18T09:00:00Z',today:'2026-11-18',can_review:true,cash_on_hand:{amount:15850,registers:3,trend7:[1,2,3,4,5,6,7]},today_collections:{amount:4200.5,receipts:32,registers:3,trend7:[3,2,4,3,5,4,6]},doctor_dues_now:{amount:300,doctors:1},pending_requests:{count:4,older_than_day:2,amount:1250},
 collections_14d:Array.from({length:14},(_,i)=>({day:'2026-11-'+String(5+i).padStart(2,'0'),cash:i%5?1000+i*10:0,card:i%5?400:0,insurance:0,other:i%5?50:0})),
 needs:[{kind:'shift_review',section:'shifts',count:1,label:'مراجعة وردية',detail:'فرق −20 ج'},{kind:'bank_reconcile',section:'bank',count:1,label:'مطابقة كشف البنك',days_since:9}],expenses_month:[{category:'أتعاب ونسب الأطباء',amount:300},{category:'صفر',amount:0}]};
const partial={...full,cash_on_hand:null,collections_14d:Array.from({length:14},(_,i)=>({day:'2026-11-'+String(5+i).padStart(2,'0'),cash:0,card:0,insurance:0,other:0})),needs:[],expenses_month:[]};
const staff={generated_at:'x',today:'2026-11-18',can_review:false,cash_on_hand:null,today_collections:null,doctor_dues_now:null,pending_requests:null,collections_14d:null,needs:[],expenses_month:null};
async function open(browser,width,mode){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://ov.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="padding:16px"></main></html>'}));
 await page.goto('https://ov.test/');for(const f of ['styles','finance-cash','accounting-shell'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.MODE=${JSON.stringify(mode)};window.rpcCalls=[];window.navs=[];
 window.SSMPDAuth={currentAdmin:{id:'me'}};window.SSMPDRoles={canSeeTab:()=>true,canModuleAction:()=>true};
 window.SSMPDDb={client:{rpc:async n=>{rpcCalls.push(n);if(n!=='clinic_finance_overview')return {data:null};if(MODE==='error')return {data:null,error:{message:'function does not exist'}};return {data:MODE,error:null};}},listPricingSupplies:async()=>({data:[]}),listPricingServices:async()=>({data:[]}),listPricingPackages:async()=>({data:[]})};
 window.SSMPDFinanceCash={_t:null,allows:()=>true,current(){return this._t;},openSection(id){this._t=id;navs.push(id);},navigate(id){this._t=id;navs.push(id);},render(el){el.innerHTML='<section class="fc-workspace"><h4 data-fc-heading>'+this._t+'</h4></section>';}};
 window.SSMPDRenderInventory={go(){},group(){return 'overview';},render(el){el.innerHTML='<div class="inv-shell"></div>';}};`});
 for(const f of ['accounting-shell','accounting-overview','render-accounting'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDRenderAccounting.render(document.querySelector('#root')));await page.waitForTimeout(1300);
 return {page,errors};
}
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{
 for(const width of [1280,1000,390]){
  let {page,errors}=await open(browser,width,full);
  assert.equal(await page.locator('[data-acs-go="overview"][aria-current="page"]').count(),1,'accounting opens on نظرة عامة');
  assert.equal(await page.locator('.aco-k').count(),4);
  const rows=await page.$$eval('.aco-k',k=>{const r={};k.forEach(x=>{const t=Math.round(x.getBoundingClientRect().top);r[t]=(r[t]||0)+1;});return Object.values(r);});
  assert.deepEqual(rows,width>=1200?[4]:width>=700?[2,2]:[1,1,1,1],'tiles '+width+': '+rows);
  assert.equal(await page.locator('.aco-k [data-aco-spark]').count(),2,'sparklines only where trend7 exists (cash, today)');
  assert.equal((await page.textContent('.aco-k:nth-child(2) b bdi')).trim(),'4,200.5','numbers keep their real decimals');
  const svg=await page.$eval('[data-aco-cols]',s=>[Math.round(s.getBoundingClientRect().width),Math.round(s.viewBox.baseVal.width)]);assert.equal(svg[0],svg[1],'chart drawn at its real width');
  assert.equal(await page.locator('.aco-lg span').count(),3,'legend lists only methods that have money (no insurance)');
  assert.equal(await page.locator('.aco-bars li').count(),1,'zero expense rows dropped');
  const bad=await page.evaluate(()=>{const out=[];document.querySelectorAll('.aco-k small,.aco-k b,.aco-k i,.aco-ch h2,.aco-lnk,.aco-need em,.aco-reload,.aco-lg span,.acs-i').forEach(e=>{if(!e.offsetParent)return;const tw=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let t;while((t=tw.nextNode())){if(!t.nodeValue.trim())continue;const r=document.createRange();r.selectNodeContents(t);if(new Set([...r.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top))).size>1){out.push(e.textContent.trim());break;}}});return {out,ox:document.documentElement.scrollWidth-innerWidth};});
  assert.deepEqual(bad.out,[],'no wrapped text');assert(bad.ox<=0,'no sideways scroll');
  if(process.env.OV_QA_SHOTS)await page.screenshot({path:process.env.OV_QA_SHOTS+'/overview-'+width+'.png',fullPage:true});
  await page.click('.aco-need [data-aco-go="bank"]');await page.waitForSelector('[data-fc-heading]');
  assert.equal(await page.evaluate(()=>navs.at(-1)),'bank','«محتاج منك» opens the section');assert.equal(await page.locator('[data-acs-go="bank"][aria-current="page"]').count(),1);
  await (width<861?(async()=>{await page.click('[data-acs-open]');await page.waitForTimeout(450);})():Promise.resolve());await page.click('[data-acs-go="overview"]');await page.waitForSelector('.aco-k');
  await page.click('.aco-k[data-aco-go="requests"]');await page.waitForFunction(()=>navs.at(-1)==='requests');
  assert.deepEqual(errors,[]);await page.close();
 }
 ({page}=await open(browser,1280,partial));
 assert.equal(await page.locator('.aco-k').count(),3,'missing field → no tile');assert.equal(await page.locator('[data-aco-cols]').count(),0,'no money in 14 days → no chart (never an empty fake)');
 assert.match(await page.textContent('.aco'),/مفيش حاجة مستنياك/);await page.close();
 ({page}=await open(browser,1280,staff));
 assert.equal(await page.locator('[data-acs-go="overview"]').count(),0,'nothing to see → overview leaves the rail');assert.equal(await page.locator('[data-acs-go="supplies"][aria-current="page"]').count(),1);await page.close();
 ({page}=await open(browser,1280,'error'));
 assert.equal(await page.locator('[data-acs-go="overview"]').count(),0,'RPC not live yet → no broken page');assert.equal(await page.locator('[data-acs-go="supplies"][aria-current="page"]').count(),1);await page.close();
 console.log('PASS accounting overview 1280/1000/390: opens on نظرة عامة, tiles 4/2/1 from real fields, sparks only with trend7, chart at real width, legend/expenses without zero rows, needs+tiles open sections, partial data hides pieces, staff and missing RPC fall back to sections, no wrapped text');
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}})();
