// help 300 (owner 2026-11-26): HR «الإجازات والطلبات» — no preselected employee (placeholder, button off, ended people never offered); «مراجعة السجل» summary line + standard ✕;
// the folded «انتهت علاقتهم» list lives under «الناس» only. Real browser, real CSS, HR manager, 1280/390. Based on tests/hr-lists-look.cjs.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const people=[{id:'p1',admin_id:'hr',full_name:'منى أحمد السيد',code:'EMP-1',kind:'employee',department:'الاستقبال',status:'active',revision:2},{id:'p2',admin_id:'a2',full_name:'هالة مصطفى',code:'EMP-2',kind:'employee',status:'on_leave',revision:2},
 {id:'p4',admin_id:null,full_name:'ياسمين خالد',code:'EMP-4',kind:'employee',status:'ended',revision:1},{id:'p5',admin_id:null,full_name:'أ/ لينا الحسيني',code:'EMP-5',kind:'employee',status:'active',end_date:'2026-01-31',revision:1}];
const requests=[{id:'r1',person_id:'p1',kind:'leave',leave_type:'annual',from_date:'2026-11-27',to_date:'2026-11-28',units:2,status:'pending',created_by:'someone-else',note:'ظروف عائلية',rule_break_labels:[]}];
const item=o=>Object.assign({id:'i'+Math.random(),code:'CUS-000001',item_name:'لاب توب Dell',category:'device',description:'',serial_ref:'SN1',value:25000,status:'with_holder',holder_id:'p1',holder_name:'منى أحمد السيد',came_from_note:'المخزن',issued_on:'2026-10-01',returned_on:null,revision:2},o);
const custody={can_manage:true,can_view_all:true,today:'2026-11-25',people:[{id:'p1',code:'EMP-1',full_name:'منى أحمد السيد'}],items:[item({id:'i1'}),item({id:'i2',code:'CUS-000002',item_name:'مفتاح العيادة 3',value:0,status:'in_store',holder_id:null,holder_name:null,returned_on:'2026-10-05'}),item({id:'i3',code:'CUS-000003',item_name:'شاشة سامسونج',status:'lost',value:4000})],movements:[]};
const ins={can_manage:true,can_view_all:true,today:'2026-11-25',people:[{id:'p1',code:'EMP-1',full_name:'منى أحمد السيد'}],items:[
 {id:'a1',person_id:'p1',full_name:'منى أحمد السيد',code:'EMP-1',insurance_type:'social',insurance_number:'123',employee_deduction:200,center_share:300,status:'active',started_on:'2026-01-01',stopped_on:null,stop_reference:'',notification_deadline:null,revision:1},
 {id:'a2',person_id:'p4',full_name:'ياسمين خالد',code:'EMP-4',insurance_type:'social',insurance_number:'456',employee_deduction:100,center_share:150,status:'stopped',started_on:'2026-01-01',stopped_on:'2026-11-20',stop_reference:'',notification_deadline:'2026-11-30',revision:2}]};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://hrl.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:10px"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://hrl.test/');for(const f of ['styles','workforce','workforce-prices','ops-panels','hr-look','hr-lists-look','dashboard-theme'])if(fs.existsSync('assets/css/'+f+'.css'))await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'hr',role:'super_admin',has_hr_access:true}};window.SSMPDToast={show:function(){}};window.__calls=[];var people=${JSON.stringify(people)},requests=${JSON.stringify(requests)},custody=${JSON.stringify(custody)},ins=${JSON.stringify(ins)};
  window.SSMPDDb={client:{rpc:async function(fn,args){if(fn==='hr_workspace')return {data:{can_manage:true,people:people,requests:requests,attendance:[],documents:[],accounts:[],doctor_keys:[],employee_keys:[]}};if(fn==='hr_custody_workspace')return {data:custody};if(fn==='hr_insurance_workspace')return {data:ins};
   if(/_command$/.test(fn)){window.__calls.push([fn,args]);return {data:'x'};}return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};}}};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/roles.js','utf8')});
 for(const f of ['workforce-prices','hr-payroll-workspace','hr-custody','hr-insurance','hr-navigation'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDHumanResources.render(document.getElementById('view-container')));await page.waitForSelector('[data-hr-group=money]');

 // ---- «النهارده»: the folded «انتهت علاقتهم» list is not above the today view any more
 assert.equal(await page.locator('.wp > details.hrl-ended').count(),0,'not a direct child of the workspace (it sat above every section)');
 assert.equal(await page.locator('[data-hr-section=home] details.hrl-ended').count(),0,'not in «النهارده»');
 assert.equal(await page.locator('[data-hr-section=people] details.hrl-ended').count(),1,'it lives under «الناس»');assert.equal(await page.evaluate(()=>document.querySelector('details.hrl-ended').open),false,'collapsed by default');
 // ---- «الإجازات والطلبات»: no preselected person, ended people never offered
 await page.click('[data-hr-group=time]');await page.click('[data-hr-open=requests]');await page.waitForSelector('[name=person_for_request]');
 const sel=page.locator('[name=person_for_request]');assert.equal(await sel.inputValue(),'','nobody preselected');
 const opts=await sel.locator('option').allInnerTexts();assert.equal(opts[0],'اختار الموظف');assert.deepEqual(opts.slice(1),['منى أحمد السيد','هالة مصطفى'],'ended (status or end_date in the past) not offered');
 const addBtn=page.locator('[data-wp=request]').first();assert.equal(await addBtn.isDisabled(),true,'«إضافة طلب» off until a person is chosen');
 await sel.selectOption('p1');assert.equal(await addBtn.isDisabled(),false);assert.equal(await addBtn.getAttribute('data-id'),'p1');
 await sel.selectOption('');assert.equal(await addBtn.isDisabled(),true,'back to the placeholder → off again');
 // ---- «مراجعة السجل»: summary line + the standard ✕
 await page.locator('[data-hr-section=requests] [data-wp=request-review]').first().click();await page.waitForSelector('.wp-modal');
 const sum=page.locator('.wp-modal [data-review-summary]');assert.equal(await sum.count(),1);const t=(await sum.innerText()).replace(/\s+/g,' ');
 assert.match(t,/منى أحمد السيد · إجازة سنوية · 2026-11-27 إلى 2026-11-28 · 2 يوم/);assert.match(t,/الملاحظة: ظروف عائلية/);
 assert.ok(await page.locator('.wp-modal form').evaluate((f,s)=>f.querySelector(s)&&f.compareDocumentPosition(f.querySelector(s)),'[data-review-summary]')!==null,'summary sits inside the form, on top');
 assert.ok(await page.evaluate(()=>{const f=document.querySelector('.wp-modal .wp-form'),s=f.querySelector('[data-review-summary]');return f.firstElementChild===s;}),'summary is the first line');
 if(process.env.HRP_SHOTS)await page.screenshot({path:process.env.HRP_SHOTS+'/hrp-'+width+'.png'});
 const x=page.locator('.wp-modal header [data-close]');const box=await x.boundingBox();if(process.env.DBG)console.log(JSON.stringify(box),await x.evaluate(b=>getComputedStyle(b).cssText.length+' '+getComputedStyle(b).width+' '+getComputedStyle(b).display));assert.ok(box.width>=34&&box.height>=34&&box.width<=46&&Math.abs(box.width-box.height)<2,'✕ is a square touch target (36–44px)');
 assert.notEqual(await x.evaluate(b=>getComputedStyle(b).borderTopWidth),'0px','✕ has the standard border');
 await x.click();assert.equal(await page.locator('.wp-modal').count(),0,'✕ closes');
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'no overflow '+ov);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS hr requests polish 1280/390: no preselected person (placeholder + button off), ended people not offered, review modal summary line + standard ✕, «انتهت علاقتهم» only under «الناس» (collapsed).');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
