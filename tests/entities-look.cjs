// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/entities-look.html): «جهات التعاقد» — follow-up defaults to «متأخر + النهارده»
// sorted by date with overdue in red, dates in words, phone section select, readable «رجوع للجهات» pill, indicators in a grid, suspend/delete in a
// dashed «إجراءات خطيرة» zone, add-entity form without duplicate headings, required/optional marks and an inline error. Real browser, real CSS, 1280/390.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const add=(n)=>{const t=new Date(today+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
const rows=[{entity_id:'a',entity_name:'مدرسة الياسمين',category:'insurance',contract_status:'active',end_date:add(200),next_follow_up_date:add(-13),primary_contact_name:'أ. وليد'},
 {entity_id:'b',entity_name:'نقابة المهندسين',category:'unions',contract_status:'active',end_date:add(15),next_follow_up_date:add(-5),primary_contact_name:'م. هشام'},
 {entity_id:'c',entity_name:'شركة النيل',category:'insurance',contract_status:'negotiating',end_date:add(300),next_follow_up_date:today,primary_contact_name:'أ. منى'},
 {entity_id:'d',entity_name:'جهة مستقبلية',category:'insurance',contract_status:'active',end_date:add(400),next_follow_up_date:add(9),primary_contact_name:'—'}];
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://ce.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:12px"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://ce.test/');for(const f of ['styles','contracting-partnerships','contracts-workbench','contracts-look','dashboard-theme'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`try{localStorage.clear()}catch(e){};window.SSMPDAuth={currentAdmin:{id:'admin',name:'مدير',role:'super_admin'}};window.SSMPDRoles={canModuleAction:function(){return true},isControlledFinance:function(){return false},canDeleteContractingEntity:function(){return true},isSuperAdmin:function(){return true},hasRole:function(){return false}};window.SSMPDToast={show:function(){}};window.__created=0;
  window.SSMPDDb={listContractingEntities:async function(){return ${JSON.stringify(rows)};},getContractingEntityDetails:async function(id){return {entity:{id:id,name:'نقابة المهندسين',category:'unions',entity_type:'other'},contracts:[{id:'c',status:'active',start_date:'2026-01-01',end_date:'${add(15)}',price_list_id:'l',price_list_link_status:'pending',discount_percent:15}],finance:[],contacts:[],activities:[],metrics:{patients:42,revenue:18500}};},createContractingEntity:async function(){window.__created++;return {id:'n'};}};
  window.SSMPDContractPrices={can:function(){return true},render:function(h){h.textContent='قوائم الأسعار';}};window.SSMPDContractingPartnerships={renderInline:function(record,host,tab){host.textContent='محتوى '+tab;}};`});
 for(const f of ['contract-navigation','render-contracting-entities'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDRenderContractingEntities.render(document.getElementById('view-container')));await page.waitForSelector('.wn-entity-table');
 // follow-up section: default «متأخر + النهارده», oldest first, overdue red
 if(width<=600){assert(await page.locator('[data-ce-section-select]').isVisible(),'phone section select');await page.selectOption('[data-ce-section-select]','followup');}else{assert.equal(await page.locator('[data-ce-section-select]').isVisible(),false);await page.click('[data-ce-section="followup"]');}
 await page.waitForSelector('[data-ce-follow="due"]');assert.equal(await page.locator('[data-ce-follow="due"]').getAttribute('aria-pressed'),'true');
 const names=await page.locator('.wn-entity-table .wn-entity-link').allInnerTexts();assert.deepEqual(names,['مدرسة الياسمين','نقابة المهندسين','شركة النيل'],'due only, oldest first: '+names);
 assert((await page.locator('.wn-late').first().innerText()).includes('متأخر 13 يوم'));assert.equal(await page.locator('.wn-late').first().evaluate(n=>getComputedStyle(n).color),'rgb(208, 64, 42)');assert(await page.locator('.wn-today').count()===1);
 {const t=await page.locator('.wn-late').first().innerText();assert(/(يناير|فبراير|مارس|أبريل|إبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)/.test(t)&&!/\//.test(t),'date in words: '+t);}
 await page.click('[data-ce-follow="all"]');assert.equal(await page.locator('.wn-entity-table .wn-entity-link').count(),4);
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+ov);
 if(process.env.CE_QA)await page.screenshot({path:process.env.CE_QA+'/ce-follow-'+width+'.png',fullPage:true});
 // entity file
 if(width<=600)await page.selectOption('[data-ce-section-select]','entities');else await page.click('[data-ce-section="entities"]');await page.waitForSelector('[data-open="b"]');await page.click('[data-open="b"]');await page.waitForSelector('.wn-file-back');
 const back=page.locator('.wn-file-back');assert.equal((await back.innerText()).replace('‹','').trim(),'رجوع للجهات');assert.equal(await back.evaluate(b=>getComputedStyle(b).backgroundColor),'rgb(255, 255, 255)','white pill');
 const zone=page.locator('.wn-danger-zone');assert.equal(await zone.count(),1);await zone.locator('summary').click();assert.equal(await page.locator('.wn-danger-btn').count(),2);assert.equal(await page.locator('.wn-danger-btn').first().evaluate(b=>getComputedStyle(b).color),'rgb(208, 64, 42)');
 if(process.env.CE_QA)await page.screenshot({path:process.env.CE_QA+'/ce-file-'+width+'.png',fullPage:true});
 await back.click();await page.waitForSelector('#ce-new');
 // add entity form
 await page.click('#ce-new');await page.waitForSelector('#ce-name');
 const heads=await page.locator('.modal .section > h4').allInnerTexts();assert(!heads.some(h=>/بيانات المسؤول|العقد الأول|المتابعة/.test(h)),'no duplicate headings: '+heads);
 assert.equal(await page.locator('.modal .ce-req').count(),1,'name marked required');assert(await page.locator('.modal .ce-opt').count()>3,'optional fields marked');
 await page.click('#ce-save');await page.waitForTimeout(150);assert.equal((await page.locator('.modal .ce-err').innerText()).trim(),'اكتب اسم الجهة');assert.equal(await page.evaluate(()=>window.__created),0);
 await page.fill('#ce-name','جهة تجربة');assert.equal(await page.locator('.modal .ce-err').count(),0,'error clears while typing');
 if(process.env.CE_QA)await page.screenshot({path:process.env.CE_QA+'/ce-form-'+width+'.png',fullPage:true});
 assert(!/[\u0660-\u0669]/.test(await page.locator('body').innerText())); // financial manager: the database refuses create/update/delete for finance accounts → no «إضافة جهة», no suspend/delete (even with module grants)
 await page.evaluate(()=>{SSMPDAuth.currentAdmin={id:'fm',role:'financial_manager'};SSMPDRoles.isControlledFinance=function(){return true};SSMPDRoles.isSuperAdmin=function(){return false};document.querySelectorAll('.modal-backdrop').forEach(n=>n.remove());SSMPDRenderContractingEntities.render(document.getElementById('view-container'));});
 await page.waitForSelector('.wn-entity-table');assert.equal(await page.locator('#ce-new:visible').count(),0,'FM: no «إضافة جهة»');
 if(width<=600)await page.selectOption('[data-ce-section-select]','entities');await page.waitForSelector('[data-open="b"]');await page.click('[data-open="b"]');await page.waitForSelector('.wn-file-back');
 assert.equal(await page.locator('.wn-danger-btn').count(),0,'FM: no suspend/delete');assert.equal(await page.locator('.wn-danger-zone').count(),0);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS entities look 1280/390: follow-up «متأخر + النهارده» default sorted with overdue red + days, dates in words, phone section select, white «رجوع للجهات» pill, danger zone, add-entity form without duplicate headings + required/optional marks + inline error.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
