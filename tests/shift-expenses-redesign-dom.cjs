// help 299 (owner «طبقه» 2026-11-26, mockup shift-expenses-redesign): real Chromium, real finance-cash modal helper + reception-shift-expenses.js finance tab.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003';
const X={can_review:true,from:'2026-11-01',to:'2026-11-26',registers:[{id:'r1',name:'خزينة مازن',kind:'reception',allowance:500,max:300},{id:'m',name:'الخزينة الرئيسية',kind:'main',allowance:0,max:0}],
 expenses:[{id:'e1',reason:'مياه شرب',amount:120,at:'2026-11-26T09:20:00Z',register:'خزينة مازن',by:'أحمد',receipt:'p/1.jpg',post_review:'pending',own:false},
  {id:'e2',reason:'إكرامية',amount:50,at:'2026-11-25T11:10:00Z',register:'خزينة منار',by:'هبة',receipt:'no-receipt',post_review:'pending',own:true},
  {id:'e3',reason:'أدوات نظافة',amount:210,at:'2026-11-25T13:05:00Z',register:'خزينة مريم',by:'منى',receipt:'p/3.jpg',post_review:'ok',reviewed_by:'ليلى',own:false},
  {id:'e4',reason:'صيانة',amount:400,at:'2026-11-24T10:00:00Z',register:'خزينة مازن',by:'أحمد',receipt:'no-receipt',post_review:'rejected',review_note:'من غير إيصال',own:false}]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/reception-shift-expenses.css"></head><body><form class="fc-filters"><input name="from" type="date" value="2026-11-02"><input name="to" type="date" value="2026-11-20"></form><div id="root"></div><script>
window.X=${JSON.stringify(X)};window.calls=[];window.CAN=true;window.SSMPDAuth={currentAdmin:{id:'${ME}'}};window.SSMPDToast={show(){},error(){}};
window.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a.p_action,a.p]);if(a.p_action==='list'){var x=JSON.parse(JSON.stringify(X));x.can_review=CAN;return {data:x,error:null};}return {data:{ok:true},error:null};}}};
</script>${['finance-controls','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','reception-shift-expenses','finance-cash'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 const draw=()=>page.evaluate(()=>{window.calls.length=0;SSMPDShiftExpenses.state.only='';SSMPDShiftExpenses.state.setOpen=false;document.getElementById('root').innerHTML=SSMPDFinanceControls.panel('shift-expenses',{},SSMPDFinanceCash.helpers);});
 const rpcs=a=>page.evaluate(x=>calls.filter(c=>!x||c[1]===x),a);
 await draw();await page.waitForSelector('.rse-ex');
 assert.deepEqual((await rpcs('list'))[0][2],{from:'2026-11-02',to:'2026-11-20'},'the period comes from the shell filter (one period)');
 assert.match(await page.locator('.rse-period').innerText(),/2026-11-02[\s\S]*2026-11-20/);
 assert.equal(await page.locator('.rse-kpi').count(),3);assert.match(await page.locator('.rse-kpi').nth(0).innerText(),/4/);assert.match(await page.locator('.rse-kpi').nth(1).innerText(),/780\s*ج\.م/);
 assert.match(await page.locator('.rse-kpi.need').innerText(),/مستني مراجعتك[\s\S]*1/,'own expense is not «mine to review»');
 assert.equal(await page.locator('.rse-ex').count(),4);assert.equal(await page.locator('[data-rse-ok]').count(),1,'review only on others\' pending');assert.equal(await page.locator('[data-rse-no]').count(),1);assert.equal(await page.locator('[data-rse-file]').count(),2,'receipt button only with a receipt');
 assert.doesNotMatch(await page.locator('.rse').innerText(),/5216|5224/,'no account numbers');
 if(process.env.SE_SHOTS)await page.screenshot({path:path.join(process.env.SE_SHOTS,'se-'+width+'.png'),fullPage:true});
 // chips = client-side filter, no new RPC
 await page.click('[data-rse-only="pending"]');assert.equal(await page.locator('.rse-ex').count(),2);assert.equal((await rpcs('list')).length,1,'status filter stays client-side');
 await page.click('[data-rse-only="rejected"]');assert.equal(await page.locator('.rse-ex').count(),1);assert.match(await page.locator('.rse-st.bad').innerText(),/من غير إيصال/);
 await page.click('[data-rse-only=""]');
 // approve
 await page.click('[data-rse-ok]');await page.waitForFunction(()=>calls.some(c=>c[1]==='review'));assert.deepEqual((await rpcs('review'))[0][2],{id:'e1',ok:true});
 // reject: a sheet with ✕, same payload, note >= 3, server text on error
 await draw();await page.waitForSelector('[data-rse-no]');await page.click('[data-rse-no]');await page.waitForSelector('.fc-modal');
 assert.equal(await page.locator('.fc-modal .modal-close').count(),1,'✕ on the sheet');assert.match(await page.locator('.fc-modal').innerText(),/الفلوس والقيد مابيتغيروش/);assert.doesNotMatch(await page.locator('.fc-modal').innerText(),/إلغاء الصرف|استرجاع/);
 await page.click('.fc-modal .modal-close');assert.equal(await page.locator('.fc-modal').count(),0,'✕ closes');assert.equal((await rpcs('review')).length,0,'closing sends nothing');
 await page.click('[data-rse-no]');await page.waitForSelector('.fc-modal');await page.fill('.fc-modal input[name=note]','من غير إيصال');await page.click('.fc-modal button[type=submit]');await page.waitForFunction(()=>calls.some(c=>c[1]==='review'));
 assert.deepEqual((await rpcs('review'))[0][2],{id:'e1',ok:false,note:'من غير إيصال'});await page.waitForFunction(()=>!document.querySelector('.fc-modal'));
 // limits: behind a button, sheet with the current values, same payload
 await draw();await page.waitForSelector('.rse-ex');assert.equal(await page.locator('[data-rse-setbody]').isHidden(),true,'limits folded');assert.equal(await page.locator('[data-rse-lim]').count(),1,'main treasury not listed');
 await page.click('[data-rse-set]');assert.equal(await page.locator('[data-rse-setbody]').isVisible(),true);assert.match(await page.locator('[data-rse-setbody]').innerText(),/ج\.م/);
 await page.click('[data-rse-lim]');await page.waitForSelector('.fc-modal');assert.equal(await page.inputValue('.fc-modal input[name=allowance]'),'500');assert.equal(await page.inputValue('.fc-modal input[name=max]'),'300');
 await page.fill('.fc-modal input[name=allowance]','600');await page.fill('.fc-modal input[name=max]','250');await page.click('.fc-modal button[type=submit]');await page.waitForFunction(()=>calls.some(c=>c[1]==='set_limits'));
 assert.deepEqual((await rpcs('set_limits'))[0][2],{register_id:'r1',allowance:600,max:250});
 // reader without can_review: no review buttons, no limits
 await page.evaluate(()=>{CAN=false;});await draw();await page.waitForSelector('.rse-ex');assert.equal(await page.locator('[data-rse-ok],[data-rse-no],[data-rse-lim],[data-rse-set]').count(),0,'no review / limits without can_review');assert.match(await page.locator('.rse-kpi').nth(2).innerText(),/مستني مراجعة\s/);
 // empty period → plain message, no table header
 await page.evaluate(()=>{X.expenses=[];CAN=true;});await draw();await page.waitForSelector('.rse-empty');assert.match(await page.locator('.rse-empty').innerText(),/مفيش مصروفات في الفترة دي/);assert.equal(await page.locator('table').count(),0,'no empty table header');
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS shift expenses redesign 1280/390: one period (shell), KPIs, chips (client-side), cards with the same actions, reject/limits sheets with ✕ and the same payloads, limits folded + only for can_review, plain empty state.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
