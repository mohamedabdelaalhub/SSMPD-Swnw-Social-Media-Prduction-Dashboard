// help 284: «المرتبات والسلف» in plain language (real Chromium, real finance-controls chain).
// Names (#867 name → employment request → code), zero rows hidden unless pending, «اعرض الكل», reviewer needs, totals, same buttons.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003',X='00000000-0000-4000-8000-000000000009';
const D={me:ME,can_create:true,can_review:true,active_shifts:[],
 employee_balances:[{subject:'EMP-000004',name:'منى سعيد',due:5200,advance:0,pending:1},{subject:'EMP-000006',name:null,due:4800,advance:1000,pending:0},{subject:'EMP-000001',name:null,due:0,advance:0,pending:0},{subject:'EMP-000003',name:'أ. سامح',due:0,advance:0,pending:0},{subject:'EMP-000008',name:'هبة محمود',due:0,advance:0,pending:1}],
 employment_contracts:[{id:'c6',subject:'EMP-000006',amount:4800,status:'approved',payload:{employee_name:'أحمد فتحي'}}],
 business_requests:[{id:'q1',kind:'advance',subject:'EMP-000008',reference:'ADV-1',amount:1500,status:'pending',created_by:X,payload:{note:'سلفة طارئة'}},{id:'q2',kind:'payroll',subject:'EMP-000004',reference:'PAY-1',amount:5200,status:'approved',created_by:X,payload:{note:'مرتب نوفمبر'},created_at:'2026-11-20T10:00:00Z'}]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/finance-today.css"></head><body><main id="root" style="padding:16px"></main><script>
window.D=${JSON.stringify(D)};window.SSMPDAuth={currentAdmin:{id:'${ME}'}};window.SSMPDToast={show(){},error(){}};window.SSMPDDb={client:{rpc:async()=>({data:null})}};
window.draw=function(){var h=SSMPDFinanceCash.helpers,r=document.getElementById('root');r.innerHTML=SSMPDFinanceControls.panel('payroll',D,h);r.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){document.querySelectorAll('.fc-modal').forEach(function(m){m.remove();});SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,D,h);};});};
</script>${['finance-controls','finance-business','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','finance-cash'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.PR_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.evaluate(()=>draw());
 const vis=async()=>page.$$eval('[data-pr-list] .fc-pr:not([hidden]) .fc-ho-w b',x=>x.map(b=>b.textContent));
 assert.deepEqual(await vis(),['منى سعيد','أحمد فتحي','هبة محمود'],'names from #867 / employment request; zero rows hidden unless pending');
 assert.match(await page.locator('[data-pr-more]').innerText(),/2 موظفين تانيين ملهمش/);
 await page.click('[data-pr-all]');assert.equal((await vis()).length,5);assert.equal(await page.locator('[data-pr-all]').innerText(),'اخفي اللي رصيدهم صفر');await page.click('[data-pr-all]');assert.equal((await vis()).length,3);
 const k=await page.locator('.fc-pr-kpis').innerText();assert.match(k,/10,000\.00[\s\S]*لـ 2 موظفين/);assert.match(k,/1,000\.00[\s\S]*على موظف واحد/);assert.match(k,/موظفين ليهم رصيد\s*3/);
 assert.match(await page.locator('[data-pr-need]').innerText(),/محتاج منك \(1\)[\s\S]*هبة محمود[\s\S]*سلفة طارئة/);
 assert.match(await page.locator('#root').innerText(),/الأرصدة لحد النهارده/);assert(!/معرف الموظف/.test(await page.locator('#root').innerText()));
 // buttons: the same actions
 await page.click('[data-pr-need] [data-fin-action="business-review"]');await page.waitForSelector('.fc-modal');await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));
 await page.click('[data-fin-action="business-new"]');await page.waitForSelector('.fc-modal select[name=kind]');assert.equal(await page.textContent('#fc-modal-title'),'طلب جديد — المرتبات والسلف');await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));
 if(shots)await page.screenshot({path:path.join(shots,'pr-'+width+'.png'),fullPage:true});
 await page.evaluate(()=>{D.can_review=false;draw();});assert.equal(await page.locator('[data-pr-need]').count(),0,'non-reviewer: no needs');await page.evaluate(()=>{D.can_review=true;});
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS payroll plain 1280/390: names (#867 → contract → code), zero rows hidden unless pending + «اعرض الكل», totals, reviewer needs with review, «الأرصدة لحد النهارده», same buttons');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
