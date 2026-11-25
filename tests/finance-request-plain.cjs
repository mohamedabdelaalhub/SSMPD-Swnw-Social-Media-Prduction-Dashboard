// «طلب مالي» in plain words (owner 2026-11-25, help 276): real Chromium, the real finance-controls chain + finance-business + finance-cash helpers.
// Advance: employee picked by name (no EMP typing), ready unique reference, «السبب», cash only with my own open shift, payload unchanged,
// duplicate reference → Arabic message. Payroll: subject follows the chosen contract.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003';
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"></head><body><main id="root"></main><script>
window.calls=[];window.dup=false;window.SSMPDAuth={currentAdmin:{id:'${ME}',role:'accountant'}};window.SSMPDToast={show(){},error(){}};
window.D={me:'${ME}',can_create:true,employment_contracts:[{id:'c1',subject:'EMP-000004',amount:5200,payload:{employee_name:'منى سعيد'}},{id:'c2',subject:'EMP-000006',amount:4800,payload:{employee_name:'أحمد فتحي'}}],active_shifts:[],business_requests:[],fixed_assets:[]};
window.SSMPDDb={financeBusinessCommand:async(a,v)=>{calls.push([a,v]);if(dup){const e=new Error('duplicate key value violates unique constraint');e.code='23505';throw e;}return {};},financeSnapshot:async()=>D};
</script><script src="/assets/js/finance-controls.js"></script><script src="/assets/js/finance-business.js"></script><script src="/assets/js/finance-cash.js"></script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.FRQ_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 const open=async()=>{await page.evaluate(()=>{document.querySelectorAll('.fc-modal').forEach(m=>m.remove());SSMPDFinanceControls.act('business-new','payroll',D,SSMPDFinanceCash.helpers);});await page.waitForSelector('.fc-modal select[name=kind]');};
 await open();assert.equal(await page.textContent('#fc-modal-title'),'طلب جديد — المرتبات والسلف');
 assert.deepEqual(await page.$$eval('.fc-modal select[name=kind] option',x=>x.map(o=>o.textContent)),['اختر','عقد موظف جديد','مرتب شهر لموظف','سلفة لموظف','دفع ضريبة أجور أو تأمينات']);
 await page.selectOption('.fc-modal select[name=kind]','advance');assert.equal(await page.textContent('#fc-modal-title'),'سلفة لموظف');
 const txt=await page.locator('.fc-modal').innerText();for(const bad of ['معرف','الالتزام','مرجع المستند','شرح المستند','قناة'])assert(!txt.includes(bad),'no jargon: '+bad);
 assert.deepEqual(await page.$$eval('.fc-modal select[name=subject] option',x=>x.map(o=>o.textContent)),['اختر','أحمد فتحي','منى سعيد'],'employees by name');
 const ref=await page.inputValue('.fc-modal input[name=reference]');assert.match(ref,/^ADV-\d{8}-\d{4}-[A-Z0-9]{4}$/);
 assert.deepEqual(await page.$$eval('.fc-modal select[name=method] option',x=>x.map(o=>o.value)),['','bank'],'no own shift: bank only');assert.match(txt,/«نقدي» بيظهر بس/);
 if(shots)await page.screenshot({path:path.join(shots,'frq-advance-'+width+'.png')});
 await page.selectOption('.fc-modal select[name=subject]','EMP-000004');await page.fill('.fc-modal input[name=note]','سلفة طارئة');await page.fill('.fc-modal input[name=amount]','1500');await page.selectOption('.fc-modal select[name=method]','bank');
 await page.click('.fc-modal [type=submit]');await page.waitForFunction(()=>calls.length===1);const v=await page.evaluate(()=>calls[0][1]);
 assert.equal(await page.evaluate(()=>calls[0][0]),'request');assert.equal(v.kind,'advance');assert.equal(v.subject,'EMP-000004');assert.equal(v.reference,ref);assert.equal(v.note,'سلفة طارئة');assert.equal(v.amount,'1500');assert.equal(v.method,'bank');
 // duplicate reference → Arabic
 await page.evaluate(()=>{dup=true;});await open();await page.selectOption('.fc-modal select[name=kind]','advance');await page.selectOption('.fc-modal select[name=subject]','EMP-000006');await page.fill('.fc-modal input[name=note]','سلفة');await page.fill('.fc-modal input[name=amount]','100');await page.selectOption('.fc-modal select[name=method]','bank');await page.click('.fc-modal [type=submit]');
 await page.waitForFunction(()=>/اتكتب قبل كده/.test(document.querySelector('.fc-modal [data-fc-status]').textContent));await page.evaluate(()=>{dup=false;});
 // with my own open shift: cash offered, the shift picked automatically
 await page.evaluate(()=>{D.active_shifts=[{id:'s1',cashier_id:D.me,status:'open',register_name:'خزينة الحسابات'}];});await open();await page.selectOption('.fc-modal select[name=kind]','advance');
 assert.deepEqual(await page.$$eval('.fc-modal select[name=method] option',x=>x.map(o=>o.value)),['','cash','bank']);await page.selectOption('.fc-modal select[name=method]','cash');assert.equal(await page.inputValue('.fc-modal select[name=shift_id]'),'s1');assert.equal(await page.locator('.fc-modal select[name=shift_id]').isHidden(),true,'single shift chosen automatically');
 await page.evaluate(()=>{D.active_shifts=[];});
 // payroll: contract picked by name, subject follows the contract
 await open();await page.selectOption('.fc-modal select[name=kind]','payroll');assert.match(await page.textContent('.fc-modal select[name=contract_id]'),/أحمد فتحي — 4,800\.00/);await page.selectOption('.fc-modal select[name=contract_id]','c2');
 assert.equal(await page.inputValue('.fc-modal input[name=subject]'),'EMP-000006');await page.fill('.fc-modal input[name=note]','مرتب نوفمبر');await page.fill('.fc-modal input[name=month]','2026-11');await page.click('.fc-modal [type=submit]');
 await page.waitForTimeout(400);if(process.env.FRQ_DEBUG)console.log(await page.evaluate(()=>JSON.stringify(calls.length)+[...document.querySelectorAll('.fc-modal :invalid')].map(e=>e.name).join(',')+(document.querySelector('.fc-modal [data-fc-status]')||{}).textContent));await page.waitForFunction(()=>calls.length>=3,null,{timeout:5000});const pv=await page.evaluate(()=>calls[calls.length-1][1]);assert.equal(pv.kind,'payroll');assert.equal(pv.subject,'EMP-000006');assert.equal(pv.contract_id,'c2');assert.equal(pv.month,'2026-11-01');assert.match(pv.reference,/^PAY-/);
 await page.evaluate(()=>{calls.length=0;});
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS finance request plain 1280/390: plain title/kinds, no jargon, employee picker by name, generated ADV-/PAY- reference, «السبب», bank-only without own shift / cash with it (auto shift), unchanged payloads, 23505 → Arabic, payroll subject from the contract');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
