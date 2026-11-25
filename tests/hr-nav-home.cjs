// Owner 2026-11-25 («طبق الكل», mockup docs/ui-references/mockups/hr-navigation-home.html): HR sections in 5 groups (one row of groups + the
// group's sections), and one home «محتاج منك النهارده» that lists everything waiting (leave/permission requests, manual attendance, files,
// overtime, end-of-service sheets, shift swaps, insurance notices) with «افتح» to the right section; the old review tables stay under it.
// «شهر المتابعة» only shows where it is used. Real browser, real CSS, HR manager, 1280/390. Display only: same read RPCs, no writes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const mk=(id,name,o)=>Object.assign({id,admin_id:null,full_name:name,code:'EMP-'+id,kind:'employee',department:'الاستقبال',status:'active',revision:1,leave_balance:21},o);
const people=[mk('p1','منى أحمد السيد',{admin_id:'a1'}),mk('p2','كريم محمود',{admin_id:'a2'}),mk('p3','أحمد علي',{status:'needs_setup'}),mk('p4','محمد عادل',{kind:'unclassified'})];
const hr={can_manage:true,people,documents:[],accounts:[],doctor_keys:[],employee_keys:[],
 requests:[{id:'q1',person_id:'p2',kind:'leave',leave_type:'annual',from_date:'2026-11-26',to_date:'2026-11-28',units:3,status:'pending',created_by:'a2'},{id:'q2',person_id:'p1',kind:'permission',from_date:'2026-11-25',to_date:'2026-11-25',units:2,status:'pending',created_by:'hr'}],
 attendance:[{id:'t1',person_id:'p2',day:'2026-11-24',actual_start:'2026-11-24T07:00:00Z',actual_end:null,status:'pending',created_by:'a9'}]};
const ws={hr_overtime:{to_review:[{id:'o1',person_name:'كريم محمود',day:'2026-11-23',minutes:90}],mine:[],people:[]},
 hr_shift_swaps_list:{me:'hr',can_manage:true,swaps:[{id:'s1',status:'pending_manager',created_by:'a1',partner_by:'a2',requester_name:'منى أحمد السيد',partner_name:'كريم محمود'},{id:'s2',status:'pending_manager',created_by:'hr',requester_name:'x',partner_name:'y'}]},
 hr_offboarding_workspace:{can_review:true,cases:[{id:'c1',status:'sheet_ready',full_name:'ياسمين خالد'},{id:'c2',status:'requested',full_name:'z'}]},
 hr_insurance_workspace:{can_manage:true,today:'2026-11-25',items:[{id:'i1',full_name:'كريم محمود',status:'stopped',notification_deadline:'2026-11-30',stop_reference:''},{id:'i2',full_name:'z',status:'stopped',notification_deadline:'2027-03-01',stop_reference:''}]}};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://hrn.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container" style="padding:10px"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://hrn.test/');for(const f of ['styles','workforce','hr-look','hr-lists-look','hr-nav-groups','workspace-navigation','dashboard-theme'])if(fs.existsSync('assets/css/'+f+'.css'))await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'hr',role:'super_admin',has_hr_access:true}};window.SSMPDToast={show:function(){}};window.__calls=[];var hr=${JSON.stringify(hr)},ws=${JSON.stringify(ws)};
  window.SSMPDDb={client:{rpc:async function(fn,args){window.__calls.push(fn+(args&&args.p_action?':'+args.p_action:''));if(fn==='hr_workspace')return {data:hr};if(ws[fn])return {data:ws[fn]};return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};}}};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/roles.js','utf8')});
 for(const f of ['workforce-prices','hr-payroll-workspace','hr-today-inbox','hr-navigation'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDHumanResources.render(document.getElementById('view-container')));await page.waitForSelector('[data-hrn-row=insurance]');
 // groups + home
 assert.deepEqual(await page.locator('[data-hr-group]').allInnerTexts().then(a=>a.map(x=>x.replace(/\d+/g,'').trim())),['النهارده','الناس','الوقت والإجازات','الفلوس','إنهاء الخدمة والإعدادات']);
 assert.deepEqual(await page.locator('.hrn-subs button:visible').allInnerTexts(),['محتاج منك النهارده','الحضور اللحظي'],'only the open group\'s sections show');
 assert.equal(await page.locator('[data-hr-section=home] > h2').innerText(),'محتاج منك النهارده');
 const rows=await page.locator('[data-hrn-row]').evaluateAll(n=>n.map(x=>x.dataset.hrnRow+'='+x.querySelector('.hrn-n').textContent));
 assert.deepEqual(rows,['requests=1','attendance=1','setup=1','unclassified=1','overtime=1','offboarding=1','swaps=1','insurance=1'],'own request, own swap, not-yet-ready sheet and far notice are not counted: '+rows);
 assert.equal(await page.locator('[data-hrn-left]').innerText(),'8 حاجات مستنياك');
 assert.equal(await page.locator('[data-hrn-gbadge=today]').innerText(),'8');assert.equal(await page.locator('[data-hrn-gbadge=time]').innerText(),'3');assert.equal(await page.locator('[data-hrn-gbadge=money]').innerText(),'1');
 assert(await page.locator('[data-hrn-row=swaps]').innerText().then(t=>t.includes('منى أحمد السيد ↔ كريم محمود')));assert(await page.locator('[data-hrn-row=attendance]').innerText().then(t=>t.includes('24 نوفمبر 2026')),'dates in words');
 assert(!(await page.locator('.wn-month').isVisible()),'no month on the home');
 assert(await page.locator('[data-hr-section=reviews] [data-wp=request-review][data-id=q1]').isVisible(),'review buttons stay under the list');
 assert(!(await page.locator('[data-hr-section=reviews] [data-wp=request-review][data-id=q2]').count()),'no self review');
 assert(!__noWrites(await page.evaluate(()=>window.__calls)),'read only');
 const sw=await page.evaluate(()=>document.scrollingElement.scrollWidth);assert(sw<=width,'no sideways scroll at '+width+': '+sw);
 if(process.env.HRN_QA)await page.screenshot({path:process.env.HRN_QA+'/hrn-home-'+width+'.png',fullPage:true});
 // «افتح» → section, group follows, crumb
 await page.locator('[data-hrn-row=overtime] [data-hrn-go]').click();await page.waitForSelector('[data-hr-section=overtime]:not([hidden])');
 assert.equal(await page.locator('[data-hr-group=time]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-hr-open=overtime]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-hr-section=overtime] .hrn-crumb').innerText(),'الوقت والإجازات ‹');
 assert.deepEqual(await page.locator('.hrn-subs button:visible').allInnerTexts(),['الإجازات والطلبات','الساعات الإضافية','تسجيل حضور يدوي ومراجعة البصمات']);
 // group → first section; month only where it is used
 await page.click('[data-hr-group=money]');await page.waitForSelector('[data-hr-section=payroll]:not([hidden])');assert(await page.locator('.wn-month').isVisible(),'month on payroll');
 assert.deepEqual(await page.locator('.hrn-subs button:visible').allInnerTexts(),['الرواتب والاستحقاقات','التأمينات','ضريبة الدخل','العهد']);
 await page.click('[data-hr-open=custody]');assert(!(await page.locator('.wn-month').isVisible()),'no month on custody');
 await page.click('[data-hr-group=people]');await page.waitForSelector('[data-hr-section=people]:not([hidden])');assert(await page.locator('.wn-month').isVisible(),'month on people');
 // unclassified row opens the filtered list
 await page.click('[data-hr-group=today]');await page.waitForSelector('[data-hrn-row=unclassified]');await page.locator('[data-hrn-row=unclassified] [data-hrn-go]').click();
 assert.equal(await page.locator('[name=hr_filter_kind]').inputValue(),'unclassified');
 if(process.env.HRN_QA){await page.click('[data-hr-group=time]');await page.screenshot({path:process.env.HRN_QA+'/hrn-time-'+width+'.png'});}
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS HR nav + home 1280/390: 5 groups with only the open group\'s sections, «محتاج منك النهارده» lists 8 waiting items (no self/own/far ones) with group badges, «افتح» opens the section with its group and crumb, month only where used, review buttons kept, read-only, no sideways scroll.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
function __noWrites(calls){return calls.some(c=>/_command|:(request|approve|reject|cancel|decide)/.test(c));}
