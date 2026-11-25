// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/hr-lists-mobile.html): HR «العهد» one primary action per row + «⋯» (loss/damage red, last),
// coloured status chips, dates in words; «التأمينات» shows all by default with a pinned «إخطارات تأمين قرب ميعادها» banner and a red «إيقاف الاشتراك»;
// «الموظفون» cards carry a status chip and people who left fold into «انتهت علاقتهم». Real browser, real CSS, HR manager, 1280/390. Same RPCs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const people=[{id:'p1',admin_id:'hr',full_name:'منى أحمد السيد',code:'EMP-1',kind:'employee',department:'الاستقبال',status:'active',revision:2},{id:'p2',admin_id:'a2',full_name:'هالة مصطفى',code:'EMP-2',kind:'employee',status:'on_leave',revision:2},
 {id:'p3',admin_id:null,full_name:'أحمد علي',code:'EMP-3',kind:'employee',status:'needs_setup',revision:1},{id:'p4',admin_id:null,full_name:'ياسمين خالد',code:'EMP-4',kind:'employee',status:'ended',revision:1}];
const item=o=>Object.assign({id:'i'+Math.random(),code:'CUS-000001',item_name:'لاب توب Dell',category:'device',description:'',serial_ref:'SN1',value:25000,status:'with_holder',holder_id:'p1',holder_name:'منى أحمد السيد',came_from_note:'المخزن',issued_on:'2026-10-01',returned_on:null,revision:2},o);
const custody={can_manage:true,can_view_all:true,today:'2026-11-25',people:[{id:'p1',code:'EMP-1',full_name:'منى أحمد السيد'}],items:[item({id:'i1'}),item({id:'i2',code:'CUS-000002',item_name:'مفتاح العيادة 3',value:0,status:'in_store',holder_id:null,holder_name:null,returned_on:'2026-10-05'}),item({id:'i3',code:'CUS-000003',item_name:'شاشة سامسونج',status:'lost',value:4000})],movements:[]};
const ins={can_manage:true,can_view_all:true,today:'2026-11-25',people:[{id:'p1',code:'EMP-1',full_name:'منى أحمد السيد'}],items:[
 {id:'a1',person_id:'p1',full_name:'منى أحمد السيد',code:'EMP-1',insurance_type:'social',insurance_number:'123',employee_deduction:200,center_share:300,status:'active',started_on:'2026-01-01',stopped_on:null,stop_reference:'',notification_deadline:null,revision:1},
 {id:'a2',person_id:'p4',full_name:'ياسمين خالد',code:'EMP-4',insurance_type:'social',insurance_number:'456',employee_deduction:100,center_share:150,status:'stopped',started_on:'2026-01-01',stopped_on:'2026-11-20',stop_reference:'',notification_deadline:'2026-11-30',revision:2}]};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://hrl.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:10px"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://hrl.test/');for(const f of ['styles','workforce','hr-look','hr-lists-look','dashboard-theme'])if(fs.existsSync('assets/css/'+f+'.css'))await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'hr',role:'super_admin',has_hr_access:true}};window.SSMPDToast={show:function(){}};window.__calls=[];var people=${JSON.stringify(people)},custody=${JSON.stringify(custody)},ins=${JSON.stringify(ins)};
  window.SSMPDDb={client:{rpc:async function(fn,args){if(fn==='hr_workspace')return {data:{can_manage:true,people:people,requests:[],attendance:[],documents:[],accounts:[],doctor_keys:[],employee_keys:[]}};if(fn==='hr_custody_workspace')return {data:custody};if(fn==='hr_insurance_workspace')return {data:ins};
   if(/_command$/.test(fn)){window.__calls.push([fn,args]);return {data:'x'};}return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};}}};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/roles.js','utf8')});
 for(const f of ['workforce-prices','hr-payroll-workspace','hr-custody','hr-insurance','hr-navigation'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDHumanResources.render(document.getElementById('view-container')));await page.waitForSelector('[data-hr-open=custody]');
 // ---- custody
 await page.click('[data-hr-open=custody]');await page.waitForSelector('[data-custody-table] tbody tr');
 const row=page.locator('[data-custody-table] tbody tr').first();
 assert.equal((await row.locator('.hrl-primary').innerText()).trim(),'إرجاع للمخزن');assert.equal(await row.locator('.hrl-menu').isVisible(),false,'menu closed');
 await row.locator('.hrl-more>summary').click();assert(await row.locator('.hrl-menu').isVisible());
 const danger=row.locator('.hrl-danger');assert.deepEqual(await danger.allInnerTexts(),['اتسجلت فقد','اتسجلت تلف']);assert.equal(await danger.first().evaluate(b=>getComputedStyle(b).color),'rgb(208, 64, 42)');
 await row.locator('.hrl-more>summary').click();
 assert.equal((await page.locator('[data-custody-table] tbody tr').nth(2).locator('.hrl-primary').innerText()).trim(),'لقيناها — رجّعها');
 assert((await page.locator('[data-custody-table]').innerText()).includes('1 أكتوبر 2026'),'date in words');
 assert.equal(await page.locator('[data-custody-status="lost"]').evaluate(n=>getComputedStyle(n).color),'rgb(208, 64, 42)');
 if(width<=640)assert.equal(await row.evaluate(r=>getComputedStyle(r).display),'grid','phone card');
 let ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'custody overflow '+ov);
 if(process.env.HRL_QA){await row.locator('.hrl-more>summary').click();await page.screenshot({path:process.env.HRL_QA+'/hrl-custody-'+width+'.png',fullPage:true});await row.locator('.hrl-more>summary').click();}
 // the primary button still runs the existing return flow
 await row.locator('.hrl-primary').click();await page.waitForSelector('.wp-modal');assert((await page.locator('.wp-modal').innerText()).includes('إرجاع'));await page.locator('.wp-modal [data-close]').first().click();
 // ---- insurance
 await page.click('[data-hr-open=insurance]');await page.waitForSelector('[data-insurance-table] tbody tr');
 assert.equal(await page.locator('[data-insurance-table] tbody tr').count(),2,'all by default (stopped row visible)');
 const ban=page.locator('[data-insurance-due]');assert((await ban.innerText()).includes('إخطارات تأمين قرب ميعادها (1)'));assert((await ban.innerText()).includes('فاضل 5 يوم'));
 assert.equal(await page.locator('.hrl-danger[data-insurance="stop"]').count(),1);
 await ban.locator('.hrl-primary').click();await page.waitForSelector('.wp-modal');assert((await page.locator('.wp-modal').innerText()).includes('ياسمين خالد'),'banner opens the notification form for that person');await page.locator('.wp-modal [data-close]').first().click();
 ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'insurance overflow '+ov);
 if(process.env.HRL_QA)await page.screenshot({path:process.env.HRL_QA+'/hrl-ins-'+width+'.png',fullPage:true});
 // ---- people
 await page.click('[data-hr-open=people]');await page.waitForSelector('.wp-grid [data-wp="person"]:visible');
 const chips=await page.locator('.wp-grid [data-wp="person"] .hrl-chip').allInnerTexts();assert(chips.includes('يعمل')&&chips.includes('إجازة')&&chips.includes('ملف مبدئي'),'chips '+chips);
 const ended=page.locator('details.hrl-ended');assert.equal(await ended.count(),1);assert((await ended.locator('summary').innerText()).includes('انتهت علاقتهم (1)'));assert.equal(await ended.locator('[data-wp="person"]').isVisible(),false);
 await ended.locator('summary').click();assert(await ended.locator('[data-wp="person"]').isVisible());
 if(process.env.HRL_QA)await page.screenshot({path:process.env.HRL_QA+'/hrl-people-'+width+'.png',fullPage:true});
 assert(!/[\u0660-\u0669]/.test(await page.locator('body').innerText()));assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS hr lists look 1280/390: custody primary + ⋯ (red loss/damage), chips, dates in words, phone cards, primary runs the return flow; insurance all-by-default + due banner opens the form + red stop; people status chips + «انتهت علاقتهم» fold.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
