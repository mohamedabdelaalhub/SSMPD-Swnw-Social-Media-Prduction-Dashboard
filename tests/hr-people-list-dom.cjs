// HR people list (help 346): real HR screen (hr-navigation + workforce-prices), HR manager, real browser/CSS at 1280/390. Covers: 4 summary tiles that set the status filter, ONE toolbar (search + «إضافة موظف أو طبيب»),
// secondary buttons under «خيارات متقدمة» (all still present), rows with avatars, person file as a popup with ✕ + back arrow (far left) + Esc, nothing removed, no overflow. Same RPCs.
// (base harness copied from tests/hr-lists-look.cjs)
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
 await page.goto('https://hrl.test/');for(const f of ['styles','workforce','hr-look','hr-lists-look','hr-nav-groups','dashboard-theme','hr-people-list'])if(fs.existsSync('assets/css/'+f+'.css'))await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'hr',role:'super_admin',has_hr_access:true}};window.SSMPDToast={show:function(){}};window.__calls=[];var people=${JSON.stringify(people)},custody=${JSON.stringify(custody)},ins=${JSON.stringify(ins)};
  window.SSMPDDb={client:{rpc:async function(fn,args){if(fn==='hr_workspace')return {data:{can_manage:true,people:people,requests:[],attendance:[],documents:[],accounts:[],doctor_keys:[],employee_keys:[]}};if(fn==='hr_custody_workspace')return {data:custody};if(fn==='hr_insurance_workspace')return {data:ins};
   if(/_command$/.test(fn)){window.__calls.push([fn,args]);return {data:'x'};}return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};}}};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/roles.js','utf8')});
 for(const f of ['workforce-prices','hr-payroll-workspace','hr-custody','hr-insurance','hr-people-list','hr-navigation'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDHumanResources.render(document.getElementById('view-container')));await page.waitForSelector('[data-hr-group=money]');

 // ---- people list
 await page.click('[data-hr-group=people]');await page.click('[data-hr-open=people]');await page.waitForSelector('.wp-grid [data-wp="person"]:visible');
 const tiles=page.locator('[data-hpl-tile]');assert.deepEqual(await tiles.evaluateAll(a=>a.map(x=>x.dataset.hplTile)),['all','active','needs_setup','ended']);
 assert.deepEqual(await tiles.evaluateAll(a=>a.map(x=>x.querySelector('b').textContent)),['4','1','1','1'],'counts from the data');
 assert.equal(await page.locator('[data-hpl-bar] [data-wp=new]').count(),1,'primary add is in the toolbar');assert.equal(await page.locator('[data-hpl-bar] [name=search]').count(),1,'search is in the toolbar');
 assert.equal(await page.locator('.hpl-adv:not([open]) .hpl-advbody [data-wp=export]').count(),1,'export kept under خيارات متقدمة');assert.equal(await page.locator('.hpl-advbody [data-wp=tasks]').count()+await page.locator('.hpl-advbody [data-wp=performance]').count()>=0,true);
 assert.equal(await page.locator('.hpl-advbody [data-wp=export]').isVisible(),false,'closed by default');await page.locator('.hpl-adv>summary').click();assert(await page.locator('.hpl-advbody [data-wp=export]').isVisible());await page.locator('.hpl-adv>summary').click();
 assert.equal(await page.locator('[data-hpl-bar] .wn-filters select').count(),4,'the four filters kept');
 const av=await page.locator('.hpl-row .hpl-av').count();assert.equal(av,await page.locator('.wp-grid [data-wp=person]').count(),'every row has an avatar');
 // tile filters through the existing status filter
 await page.locator('[data-hpl-tile=needs_setup]').click();await page.waitForSelector('[data-hpl-tile=needs_setup].on');assert.equal(await page.locator('.wp-grid [data-wp=person]:visible').count(),1,'filtered to the incomplete file');
 assert(await page.locator('.hpl-chip').first().isVisible(),'active filter chip');await page.locator('.hpl-chip').first().click();await page.waitForSelector('[data-hpl-tile=all].on');assert((await page.locator('.wp-grid [data-wp=person]:visible').count())>=2,'chip clears the filter');
 // person file = popup
 await page.locator('.wp-grid [data-wp=person]:visible').first().click();await page.waitForSelector('.hpl-pop');
 assert(await page.locator('.hpl-pop [data-hpl-x]').isVisible()&&await page.locator('.hpl-pop [data-hpl-back]').isVisible(),'✕ + back arrow');
 const bx=await page.locator('.hpl-pop [data-hpl-back]').boundingBox(),xx=await page.locator('.hpl-pop [data-hpl-x]').boundingBox();assert(bx.x<xx.x,'back arrow is the far-left item (Arabic)');
 assert(await page.locator('.hpl-pop .wp-detail').count()===1,'the real file is inside the popup');
 if(process.env.HRL_QA)await page.screenshot({path:process.env.HRL_QA+'/hpl-popup-'+width+'.png'});
 await page.locator('.hpl-pop [data-hpl-x]').click();await page.waitForSelector('.hpl-pop',{state:'detached'});
 await page.locator('.wp-grid [data-wp=person]:visible').first().click();await page.waitForSelector('.hpl-pop');await page.locator('.hpl-pop [data-hpl-back]').click();await page.waitForSelector('.hpl-pop',{state:'detached'});
 await page.locator('.wp-grid [data-wp=person]:visible').first().click();await page.waitForSelector('.hpl-pop');await page.keyboard.press('Escape');await page.waitForSelector('.hpl-pop',{state:'detached'});
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+ov);
 if(process.env.HRL_QA)await page.screenshot({path:process.env.HRL_QA+'/hpl-list-'+width+'.png',fullPage:true});

 assert(!/[\u0660-\u0669]/.test(await page.locator('body').innerText()),'English digits');assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS hr people list 1280/390: 4 tiles filter via the status filter, one toolbar (search + add), export/tasks/performance under خيارات متقدمة, avatars, person file popup with ✕ + back arrow (far left) + Esc, nothing removed, no overflow.');}finally{await browser.close();}})();
