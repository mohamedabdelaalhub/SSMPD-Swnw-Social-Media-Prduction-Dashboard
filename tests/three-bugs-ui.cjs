// UX review 2026-11-25 — owner «ابدأ بالأخطاء التلاتة». Real browser (native form validation, real modals + CSS):
// 1) doctor contract: with the fixed-fee flag NOT true, the hidden «نوع الأتعاب» no longer blocks submit (financeDoctorCommand is reached, percent payload);
//    with the flag true the selector shows, required and empty, exactly as before.
// 2) end of service (HR manager): «بدء إنهاء خدمة» starts on «— اختار الموظف —» (nothing preselected), refuses to submit without a person, red confirm names the person,
//    the «⋯» sheet opens it with THAT person preselected; hr_offboarding_command('open') payload unchanged.
// 3) «الخزائن والورديات»: a hidden main-treasury-count card takes no space (no empty blue box).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const shell=async(browser,width)=>{const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://bugs.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://bugs.test/');page.errors=errors;return page;};
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 // ---------- 1) doctor contract form, flag false then true
 for(const flag of [false,true]){const page=await shell(browser,width);
  for(const f of ['styles','finance-cash','dashboard-theme'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
  await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.__sent=null;window.SSMPDDb={financeFixedFeeEnabled:async()=>${flag},financeLinesEnabled:async()=>true,financeContractServices:async()=>[],financeContractDepartments:async()=>[],financeDoctorCommand:async(a,p,k)=>{window.__sent={a:a,p:p};return {};},financeSnapshot:async()=>({})};`});
  for(const f of ['finance-cash','finance-controls','finance-doctors'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
  await page.evaluate(()=>{SSMPDFinanceControls.act('doctor-contract','',{today:'2026-11-25',me:'fm',can_create:true,can_review:true,stock_catalog:[],invoices:[],doctor_allocations:[],doctor_payouts:[],doctor_balances:[],doctor_contracts:[]},SSMPDFinanceCash.helpers);});
  await page.waitForSelector('.fc-modal form [name=fee_kind]',{state:'attached'});await page.waitForTimeout(150);
  const st=await page.evaluate(()=>{var s=document.querySelector('.fc-modal [name=fee_kind]');return {hidden:s.closest('label').hidden,required:s.required,value:s.value};});
  if(!flag){assert.deepEqual(st,{hidden:true,required:false,value:'percent'},'flag false: hidden selector is percent and never blocks');}
  else{assert.deepEqual(st,{hidden:false,required:true,value:''},'flag true: selector shown, required, empty (unchanged)');await page.selectOption('.fc-modal [name=fee_kind]','percent');}
  // fill every visible required field like a user would, then press the real submit button
  await page.evaluate(()=>{document.querySelectorAll('.fc-modal form input, .fc-modal form select').forEach(function(el){var l=el.closest('label');if(el.disabled||(l&&l.hidden)||el.type==='hidden')return;if(el.type==='checkbox'){if(el.required)el.checked=true;return;}if(el.value)return;if(el.tagName==='SELECT'){var o=[].find.call(el.options,function(x){return x.value;});if(o)el.value=o.value;}else if(el.type==='date')el.value=el.name==='to'?'2027-12-31':'2027-01-01';else if(el.type==='number')el.value='30';else el.value=el.name==='doctor_key'?'EMP-7':'HV';el.dispatchEvent(new Event('change',{bubbles:true}));});});
  await page.locator('.fc-modal form button[type=submit]').click();await page.waitForTimeout(300);
  const sent=await page.evaluate(()=>window.__sent);assert(sent,'submit reached financeDoctorCommand (flag '+flag+') — status: '+await page.evaluate(()=>{var s=document.querySelector('.fc-modal [data-fc-status]');return s?s.textContent:'(closed)';}));
  assert.equal(sent.a,'contract');assert(!('fee_kind' in sent.p),'percent sends the old payload');assert.equal(sent.p.rate,30);
  assert.deepEqual(page.errors,[]);await page.close();}
 // ---------- 2) end of service
 {const page=await shell(browser,width);
  for(const f of ['styles','workforce','hr-look','dashboard-theme'])if(fs.existsSync('assets/css/'+f+'.css'))await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
  const people=[{id:'p1',admin_id:'hr',full_name:'منى أحمد السيد',code:'EMP-1',kind:'employee',status:'active',revision:2},{id:'p2',admin_id:null,full_name:'كريم عادل',code:'EMP-2',kind:'employee',status:'active',revision:1}];
  await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'hr',role:'super_admin',has_hr_access:true}};window.SSMPDToast={show:function(){}};window.__calls=[];var people=${JSON.stringify(people)};
   window.SSMPDDb={client:{rpc:async function(fn,args){if(fn==='hr_workspace')return {data:{can_manage:true,people:people,requests:[],attendance:[],documents:[],accounts:[],doctor_keys:[],employee_keys:[]}};
    if(fn==='hr_offboarding_workspace')return {data:{can_manage:true,can_sheet:true,today:'2026-11-25',people:people,cases:[],templates:[]}};if(fn==='hr_offboarding_lock_due')return {data:0};
    if(fn==='hr_offboarding_command'){window.__calls.push(args);return {data:'c1'};}return {data:{rules:[],adjustments:[],devices:[],imports:[],services:[]}};}}};`});
  await page.addScriptTag({content:fs.readFileSync('assets/js/roles.js','utf8')});
  for(const f of ['workforce-prices','hr-offboarding','hr-navigation','hr-actions'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
  await page.evaluate(()=>SSMPDHumanResources.render(document.getElementById('view-container')));await page.waitForSelector('[data-hr-group=end]');
  await page.click('[data-hr-group=end]');await page.waitForSelector('[data-offb=new]');await page.click('[data-offb=new]');await page.waitForSelector('.wp-modal select[name=person_id]');
  const go=page.locator('.wp-modal [data-offb-confirm]');
  assert.equal(await page.inputValue('.wp-modal select[name=person_id]'),'','nothing preselected');assert.equal((await go.innerText()).trim(),'ابدأ إنهاء الخدمة');
  assert(await go.evaluate(b=>b.classList.contains('danger-btn')),'red confirm');assert(await page.locator('[data-offb-next]').isVisible());
  await go.click();await page.waitForTimeout(150);assert.equal((await page.evaluate(()=>window.__calls)).length,0,'no person -> blocked by validation');
  await page.selectOption('.wp-modal select[name=person_id]','p2');assert.equal((await go.innerText()).trim(),'ابدأ إنهاء خدمة كريم عادل');
  if(process.env.BUGS_QA)await page.screenshot({path:process.env.BUGS_QA+'/offb-'+width+'.png'});
  await go.click();await page.waitForTimeout(300);let c=await page.evaluate(()=>window.__calls);assert.equal(c.length,1);assert.equal(c[0].p_action,'open');assert.equal(c[0].p_payload.person_id,'p2');assert.equal(c[0].p_payload.reason,'resignation');assert(/^[0-9a-f-]{36}$/.test(c[0].p_payload.request_id));
  // from the «⋯» sheet of a specific person
  await page.evaluate(p=>{SSMPDHRActions.remember(p);SSMPDHRActions.open('p2','كريم عادل');},people);await page.click('[data-hra-act=offboarding]');
  await page.waitForFunction(()=>{var s=document.querySelector('.wp-modal select[name=person_id]');return s&&s.value==='p2';},null,{timeout:3000});
  assert.equal((await page.locator('.wp-modal [data-offb-confirm]').innerText()).trim(),'ابدأ إنهاء خدمة كريم عادل','sheet preselects THAT person');
  assert.deepEqual(page.errors,[]);await page.close();}
 // ---------- 3) hidden main-treasury-count card takes no space
 {const page=await shell(browser,width);await page.addStyleTag({content:fs.readFileSync('assets/css/finance-cash.css','utf8')});
  const r=await page.evaluate(()=>{var m=document.getElementById('view-container');m.innerHTML='<section class="mc" data-fc-main-count hidden></section><section class="mc" data-shown>x</section>';var a=m.children[0],b=m.children[1];return [getComputedStyle(a).display,a.getBoundingClientRect().height,getComputedStyle(b).display];});
  assert.deepEqual(r.slice(0,2),['none',0],'hidden card invisible');assert.equal(r[2],'grid','shown card unchanged');await page.close();}
 }
 console.log('PASS three bugs (1280/390, real browser): doctor contract submits with the fixed-fee flag false (percent, old payload) and keeps the required selector when true; end of service starts unselected, blocks without a person, red confirm names the person, «⋯» preselects that person, same hr_offboarding_command payload; hidden main-count card takes no space.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
