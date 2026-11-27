// help 277 (owner «طبقه», mockup finance-today-plain): real Chromium, the real finance-controls chain.
// Requests list: date, plain reason, coloured status, reviewer reason under it, rejected first with «اعمل طلب جديد», quick filters, review button.
// Shifts tools: «كشف الخزينة» only for reviewers, vouchers only with my own open main shift, «سجل السندات» for everyone.
// Voucher modal: plain guide + «متستخدموش في…», no system accounts. Request form: doctor and expense names without codes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003',OTHER='00000000-0000-4000-8000-000000000009';
const D={me:ME,can_create:true,can_review:false,
 requests:[
  {id:'r1',kind:'general_expense',category:'electricity',amount:1850,details:{method:'cash'},reference:'فاتورة كهرباء 11/2026',reason:'كهرباء شهر نوفمبر',creator_name:'أ. سامح',created_by:ME,status:'pending',created_at:'2026-11-25T08:02:00Z'},
  {id:'r2',kind:'expense',amount:150,details:{method:'cash'},reference:'إيصال 77',reason:'شراء مياه للعيادة',creator_name:'أ. سامح',created_by:ME,status:'rejected',review_note:'الإيصال مش واضح',created_at:'2026-11-24T13:10:00Z'},
  {id:'r3',kind:'supplier_payment',amount:3400,details:{method:'instapay'},reference:'IP-55120',reason:'سداد فاتورة مستلزمات',creator_name:'منى سعيد',created_by:OTHER,status:'approved',review_note:'تمام',created_at:'2026-11-24T11:15:00Z'},
  {id:'r4',kind:'salary_payment',amount:5200,details:{method:'cash'},reference:'SAL-2026-11-EMP-000021',reason:'مرتب نوفمبر',creator_name:'منى سعيد',created_by:OTHER,status:'pending',created_at:'2026-11-25T09:00:00Z'}],
 doctor_contracts:[{doctor_key:'EMP-000038',doctor_name:'د. أحمد سامي',status:'active'}],
 finance_accounts:[{code:'5216',name:'مصروفات إدارية',kind:'expense',is_postable:true},{code:'1111',name:'نقدية',kind:'asset',is_system:true,is_postable:true},{code:'3110',name:'جاري صاحب المركز',kind:'equity',is_postable:true}],
 shifts:[],registers:[{id:'g1',name:'الخزينة الرئيسية',treasury_kind:'main'}],treasury_transfers:[],invoices:[]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/finance-today.css"></head><body><main id="root" style="padding:16px"></main><script>
window.D=${JSON.stringify(D)};window.calls=[];window.SSMPDAuth={currentAdmin:{id:'${ME}',role:'accountant'}};window.SSMPDToast={show(){},error(){}};
window.SSMPDDb={client:{rpc:async()=>({data:null})},financeCashVoucherCommand:async(a,v)=>{calls.push(['voucher',a,v]);return {};},financeDisbursement:async(a,v)=>{calls.push(['disb',a,v]);return {};}};
window.draw=function(tab){var h=SSMPDFinanceCash.helpers,root=document.getElementById('root');root.innerHTML=SSMPDFinanceControls.panel(tab,D,h);root.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){document.querySelectorAll('.fc-modal').forEach(function(m){m.remove();});SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,D,h);};});};
</script>${['finance-controls','finance-business','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','finance-cash'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.FTP_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 // ---- requests list (accountant)
 await page.evaluate(()=>draw('requests'));
 const rows=await page.$$eval('.fc-rq',x=>x.map(r=>r.innerText.replace(/\s+/g,' ')));
 assert.match(rows[0],/24 نوفمبر · 3:10 م[\s\S]*شراء مياه للعيادة[\s\S]*إيصال 77[\s\S]*150\.00 ج[\s\S]*✗ اترفض[\s\S]*«الإيصال مش واضح»[\s\S]*اعمل طلب جديد/,'rejected first with reason and a new-request button');
 assert.match(rows[1],/مستني مراجعة/);assert.equal(await page.locator('.fc-rq [data-fin-action="disbursement-review"]').count(),0,'accountant: no review button');
 assert.equal(await page.locator('.fc-rq-chip.is-on').innerText(),'الكل 4');
 await page.click('[data-rq-filter="rejected"]');assert.equal(await page.locator('.fc-rq:not([hidden])').count(),1);await page.click('[data-rq-filter="pending"]');assert.equal(await page.locator('.fc-rq:not([hidden])').count(),2);await page.click('[data-rq-filter=""]');
 if(shots)await page.screenshot({path:path.join(shots,'ftp-requests-'+width+'.png'),fullPage:true});
 // «اعمل طلب جديد» opens the existing request form; doctor and expense names without codes
 await page.click('.fc-rq [data-fin-action="request"]');await page.waitForSelector('.fc-modal select[name=kind]');
 await page.selectOption('.fc-modal select[name=kind]','doctor_payment');assert.deepEqual(await page.$$eval('.fc-modal select[name=doctor_key] option',x=>x.map(o=>o.textContent)),['اختر','د. أحمد سامي']);
 await page.selectOption('.fc-modal select[name=kind]','general_expense');const cats=await page.$$eval('.fc-modal select[name=category] option',x=>x.map(o=>o.textContent));assert(cats.includes('مصروفات إدارية')&&!cats.some(c=>/\d{4}/.test(c)),'expense names without codes');
 await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));
 // reviewer sees «راجع» on others' pending requests only
 await page.evaluate(()=>{D.can_review=true;draw('requests');});assert.equal(await page.locator('.fc-rq [data-fin-action="disbursement-review"]').count(),1);
 // ---- shifts tools
 await page.evaluate(()=>{D.can_review=false;draw('shifts');});let tools=await page.$$eval('#root > .fc-actions [data-fin-action]',x=>x.map(b=>b.dataset.finAction));assert.deepEqual(tools,['cash-vouchers'],'accountant without main shift: only the vouchers log');
 await page.evaluate(()=>{D.shifts=[{id:'m1',cashier_id:D.me,status:'open',is_main:true,register_name:'الخزينة الرئيسية'}];draw('shifts');});tools=await page.$$eval('#root > .fc-actions [data-fin-action]',x=>x.map(b=>b.dataset.finAction));assert.deepEqual(tools,['cash-voucher-receive','cash-voucher-pay','cash-vouchers'],'custodian with open main shift: vouchers, no statement');
 await page.evaluate(()=>{D.can_review=true;D.shifts=[];draw('shifts');});tools=await page.$$eval('#root > .fc-actions [data-fin-action]',x=>x.map(b=>b.dataset.finAction));assert.deepEqual(tools,['treasury-statement','cash-vouchers'],'reviewer without main shift: statement, no vouchers');
 // ---- voucher modal: plain guide, no system accounts, saves through the same command
 await page.evaluate(()=>{D.can_review=false;D.shifts=[{id:'m1',cashier_id:D.me,status:'open',is_main:true,register_name:'الخزينة الرئيسية'}];draw('shifts');});await page.click('[data-fin-action="cash-voucher-pay"]');await page.waitForSelector('.fc-modal .fc-voucher-guide');
 const g=await page.textContent('.fc-modal .fc-voucher-guide');assert.match(g,/من الخزينة الرئيسية بس[\s\S]*شخص تاني يوافق/);assert.match(g,/مصروف صغير من درج الاستقبال ← مصروفات الوردية/);
 const accts=await page.$$eval('.fc-modal select[name=account] option',x=>x.map(o=>o.value));assert(!accts.includes('1111'),'system accounts hidden');assert(accts.includes('5216'));
 const labels=await page.locator('.fc-modal form').innerText();for(const bad of ['الحساب المقابل','مرجع السند','بيان السند','قبل الاستقطاع','مستلم النقد'])assert(!labels.includes(bad),'no jargon: '+bad);
 if(shots)await page.screenshot({path:path.join(shots,'ftp-voucher-'+width+'.png')});
 assert.equal(await page.getAttribute('.fc-modal input[name=recipient]','minlength'),'2','recipient needs 2+ chars like the server check');assert.equal(await page.getAttribute('.fc-modal input[name=reference]','minlength'),'2');await page.selectOption('.fc-modal select[name=account]','5216');await page.selectOption('.fc-modal select[name=shift_id]','m1');await page.fill('.fc-modal input[name=recipient]','شركة الكهرباء');await page.fill('.fc-modal input[name=amount]','500');await page.fill('.fc-modal input[name=reference]','KH-11');await page.fill('.fc-modal input[name=description]','فاتورة كهربا نوفمبر');
 await page.evaluate(()=>{const b=document.querySelector('.fc-modal input[name=branch]');if(b)b.value='';});await page.click('.fc-modal [type=submit]');await page.waitForFunction(()=>calls.some(c=>c[0]==='voucher'));
 const v=await page.evaluate(()=>calls.find(c=>c[0]==='voucher')[2]);assert.equal(v.kind,'pay');assert.equal(v.account,'5216');assert.equal(v.gross,500);assert.equal(v.reference,'KH-11');assert.equal(v.description,'فاتورة كهربا نوفمبر');
 await page.evaluate(()=>{calls.length=0;D.shifts=[];D.can_review=false;document.querySelectorAll('.fc-modal').forEach(m=>m.remove());});
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS finance today plain 1280/390: requests list (date, reason, coloured status + reviewer reason, rejected first + new request, filters, review only for reviewers), names without codes in the request form, shifts tools gated like the server (statement=review, vouchers=own main shift, log=view), voucher guide + no system accounts + same payload');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
