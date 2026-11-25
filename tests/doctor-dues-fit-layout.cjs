// Owner 2026-11-25 («طبقه», mockup docs/ui-references/mockups/doctor-dues-popup-fit.html): «صرف مستحقات بالفواتير» fits the screen.
// Real browser, REAL finance-cash.js modal + styles, as the financial manager: no horizontal overflow at 1280/1440 (whole table visible, one row per invoice),
// phone 390 shows each invoice as a stacked card with a working checkbox; select-all, running total and the submit call are unchanged.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1440,1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://dd.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main id="view-container"></main></body></html>'}));
 await page.route('**/*.woff2',r=>{const f='assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await page.goto('https://dd.test/');
 for(const f of ['styles','finance-cash','finance-doctor-dues','dashboard-theme','dashboard-glass'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'fm',role:'financial_manager'}};window.__sent=null;
  var inv=function(id,ref,fee,st,x){return Object.assign({invoice_id:id,reference:ref,patient_ref:'شهاب الدين إبراهيم حامد — P-2026-00'+id.slice(1)+'878',date:'2026-11-22',fee:fee,net:1000,collected:1000,dues_status:st,selectable:st==='payable',lines:[{service_name:'كشف استشاري تغذية',service_code:'S1'},{service_name:'متابعة التغذية',service_code:'S2'}]},x||{});};
  window.SSMPDDb={financeDoctorDues:async function(){return {invoices:[inv('i1','RX-20',250,'payable'),inv('i2','RX-21',200,'payable'),inv('i3','RX-25',75,'waiting_patient',{patient_open:75,collected:0}),inv('i4','RX-28',250,'payable'),inv('i5','RX-11',250,'requested'),inv('i6','RX-9',80,'waiting_insurer',{insurer:'شركة تأمين طويلة الاسم جداً للتجربة',insurer_open:400})],uncovered:[],dues:{payable_total:700,waiting_total:75,available_now:775}};},
   financePayoutInvoices:async function(){window.__sent=[].slice.call(arguments);return 'p1';},financeSnapshot:async function(){return {};},financeDoctorCommand:async function(){return {};},financeDoctorStatement:async function(){return {summary:{},invoices:[]};}};`});
 for(const f of ['finance-cash','finance-controls','finance-doctors','finance-doctor-dues'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>{var h=SSMPDFinanceCash.helpers;SSMPDFinanceControls.act('doctor-dues','EMP-38',{today:'2026-11-25',can_create:true,active_shifts:[{id:'sh1',register_name:'الخزنة'}],doctor_contracts:[{doctor_key:'EMP-38',doctor_name:'د.يحيى زكريا'}]},h);});
 await page.waitForSelector('.fc-dues-modal [data-dues-row]');await page.waitForTimeout(250);
 const r=await page.evaluate(()=>{const m=document.querySelector('.fc-dues-modal .modal'),t=m.querySelector('[data-dues-list] table');return {modalOver:m.scrollWidth-m.clientWidth,page:document.documentElement.scrollWidth-innerWidth,mw:m.getBoundingClientRect().width,tw:t.getBoundingClientRect().width,thead:getComputedStyle(t.querySelector('thead')).display,rowH:t.querySelector('tbody tr').getBoundingClientRect().height,cardDisplay:getComputedStyle(t.querySelector('tbody tr')).display,dateWrap:getComputedStyle(t.querySelector('td.dd-date')).whiteSpace};});
 assert(r.modalOver<=1,'no sideways scroll inside the window @'+width+' '+JSON.stringify(r));assert(r.page<=1,'no page overflow @'+width);
 if(width>=1280){assert(r.mw>1000||r.mw>=width*0.9,'wide window @'+width+' '+r.mw);assert.equal(r.thead,'table-header-group');assert.equal(r.dateWrap,'nowrap');}
 else{assert.equal(r.thead,'none','phone: header hidden');assert.equal(r.cardDisplay,'grid','phone: invoice is a card');}
 // checkboxes, select-all, total
 const boxes=page.locator('.fc-dues-modal [data-dues-row]');assert.equal(await boxes.count(),3);
 await boxes.nth(1).click();assert.equal(await page.locator('[data-dues-total]').innerText(),'200.00');
 await page.locator('[data-dues-all]').click();assert.equal(await page.locator('[data-dues-total]').innerText(),'700.00');
 await page.locator('.fc-dues-modal [name=method]').selectOption('bank');await page.locator('.fc-dues-modal [name=reference]').fill('TRX-77');
 if(process.env.DUES_QA)await page.screenshot({path:process.env.DUES_QA+'/dues-'+width+'.png',fullPage:false});
 await page.locator('.fc-dues-modal form button[type=submit]').click();await page.waitForTimeout(300);
 const sent=await page.evaluate(()=>window.__sent);assert(sent,'submit called financePayoutInvoices: '+await page.evaluate(()=>{var s=document.querySelector('[data-fc-status]');var inv=[].map.call(document.querySelectorAll('.fc-dues-modal :invalid'),function(x){return x.name+':'+x.validationMessage});return (s?s.textContent:'')+' | invalid '+inv.join(',');}));assert.equal(sent[0],'EMP-38');assert.deepEqual(sent[1].slice().sort(),['i1','i2','i4']);assert.equal(sent[4],'bank');assert.equal(sent[6],'TRX-77');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS doctor dues window fits 1440/1280 (wide, whole table, nowrap date/fee) and 390 (stacked invoice cards); checkboxes, select-all, total and financePayoutInvoices submit unchanged.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
