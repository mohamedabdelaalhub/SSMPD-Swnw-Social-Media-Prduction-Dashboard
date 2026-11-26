// help 297 (owner «طبقه» 2026-11-26, mockup treasury-accordion): real Chromium, real finance-controls chain + finance-cash helpers + treasury-accordion.js.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003',X='00000000-0000-4000-8000-000000000009';
const D={me:ME,can_create:true,can_review:true,treasury_main:{id:'m',name:'الخزينة الرئيسية'},registers:[],shifts:[],
 treasury_transfers:[
  {id:'t1',from_shift:'s1',from_register:'خزينة الاستقبال 1',to_register_name:'الخزينة الرئيسية',amount:4350,end_difference:-30,reference:'SHIFT-1a3c5e7a-1111-4111-8111-111111111111',status:'pending',created_by:X,created_at:'2026-11-25T18:56:00Z'},
  {id:'t2',from_shift:'s2',from_register:'خزينة الاستقبال 1',to_register_name:'الخزينة الرئيسية',amount:3980,end_difference:0,reference:'SHIFT-2b4d6f8b-2222-4222-8222-222222222222',status:'approved',review_note:'استلمت 3980',created_by:X,created_at:'2026-11-24T16:56:00Z',reviewed_at:'2026-11-24T18:56:00Z'},
  {id:'t3',from_shift:'s3',from_register:'خزينة الاستقبال 2',to_register_name:'الخزينة الرئيسية',amount:1200,end_difference:null,reference:'تسليم-نص-اليوم',status:'rejected',review_note:'المبلغ ناقص 50',created_by:ME,created_at:'2026-11-23T17:56:00Z',reviewed_at:'2026-11-23T18:56:00Z'}]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/finance-today.css"><link rel="stylesheet" href="/assets/css/finance-today.css"></head><body><main id="root" style="padding:16px"></main><div id="mb"><div data-fc-main-balance></div></div><script>
window.D=${JSON.stringify(D)};window.LM={at:'2026-11-25T17:56:00Z',description:'تسليم خزينة SHIFT-2b4d6f8b-0d2f-4b4d-8f6b-8d0f2b4d6f8c-d2f4b6d8-f0b2-4d4f-8b6d-0f2b4d6f8b0a',amount:3980,source:'treasury_transfer_in',from_register:'خزينة الاستقبال 1'};
window.SSMPDAuth={currentAdmin:{id:'${ME}'}};window.SSMPDToast={show(){},error(){}};window.SSMPDDb={client:{rpc:async n=>n==='clinic_finance_main_treasury_balance'?{data:{configured:true,register:'الخزينة الرئيسية',balance:18450,shift:{opened_at:'2026-11-25T10:56:00Z',custodian:'أ. هالة',opening:12000,cash_in:9800,cash_out:3350},last_move:LM}}:{data:null}}};
window.draw=function(){var h=SSMPDFinanceCash.helpers,r=document.getElementById('root');r.innerHTML=SSMPDFinanceControls.panel('shifts',D,h);};
</script>${['finance-controls','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','finance-cash','treasury-accordion'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.evaluate(()=>{window.draw2=function(){var h=SSMPDFinanceCash.helpers,r=document.getElementById('root');
  r.innerHTML=SSMPDFinanceControls.panel('shifts',D,h)+'<div class="fc-movements" data-fc-movements></div>'+h.table(['فتحت امتى','الخزينة'],[['1','a'],['2','b'],['3','c']]);
  r.querySelector('[data-fc-drawers]').innerHTML='<h4>خزن التحصيل المفتوحة</h4><div class="fc-drawer"><b>خزينة مازن</b><button class="btn" data-fin-action="treasury-review" data-id="t1">استلم</button></div><div class="fc-drawer"><b>خزينة منار</b></div>';
  window.__acts=[];r.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){__acts.push(b.dataset.finAction);};});
  SSMPDTreasuryAccordion.wrap(r,'shifts');};draw2();});
 const items=await page.$$eval('[data-ta-item]',x=>x.map(e=>e.getAttribute('data-ta-item')));assert.deepEqual(items,['drawers','handovers','shifts'],'three buttons');
 const open=()=>page.$$eval('[data-ta-item].open',x=>x.map(e=>e.getAttribute('data-ta-item')));
 assert.deepEqual(await open(),[],'all closed by default');assert.equal(await page.locator('[data-ta-body]:visible').count(),0,'no details visible while closed');
 assert.equal(await page.locator('#root h3',{hasText:'تسليم التحصيل للخزينة الرئيسية'}).isHidden(),true,'old long heading hidden (the button carries the title)');
 assert.match(await page.locator('[data-ta-item="handovers"] [data-ta-badge]').innerText(),/مستني الاستلام/);assert.equal(await page.locator('[data-ta-item="handovers"] [data-ta-badge].is-need').count(),1,'orange only where I have something to do');
 assert.equal((await page.locator('[data-ta-item="shifts"] [data-ta-badge]').innerText()).trim(),'3');
 assert.match(await page.locator('[data-ta-item="drawers"] [data-ta-badge]').innerText(),/1 محتاج منك/);
 // one open at a time
 await page.click('[data-ta-btn="drawers"]');assert.deepEqual(await open(),['drawers']);assert.equal(await page.locator('[data-ta-btn="drawers"]').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('[data-ta-item="drawers"] [data-fc-drawers]:visible').count(),1);
 await page.click('[data-ta-btn="handovers"]');assert.deepEqual(await open(),['handovers'],'opening another closes the first');assert.equal(await page.locator('[data-ta-item="drawers"] [data-ta-body]:visible').count(),0);assert.equal(await page.locator('[data-ta-item="handovers"] [data-ho-list]:visible').count(),1);
 await page.click('[data-ta-btn="shifts"]');assert.deepEqual(await open(),['shifts']);assert.equal(await page.locator('[data-ta-item="shifts"] .fc-table:visible').count(),1);
 await page.click('[data-ta-btn="shifts"]');assert.deepEqual(await open(),[],'tapping the open one closes it');
 // the existing buttons still work from inside an open item (moved, not rebuilt)
 await page.click('[data-ta-btn="drawers"]');await page.click('[data-ta-item="drawers"] [data-fin-action="treasury-review"]');assert.deepEqual(await page.evaluate(()=>__acts),['treasury-review']);
 // top buttons stay outside the accordion; a re-render keeps the open item
 assert.equal(await page.locator('.ta [data-fin-action="treasury-statement"], .ta [data-fin-action="cash-vouchers"]').count(),0,'top tools stay where they were');assert.equal(await page.locator('#root > .fc-actions [data-fin-action="cash-vouchers"]').count(),1);
 await page.evaluate(()=>draw2());assert.deepEqual(await open(),['drawers'],'open item survives a re-render');
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS treasury accordion 1280/390: 3 buttons (drawers / handovers / shifts), closed by default with badges (orange only on «محتاج منك»), one open at a time, tap again closes, moved buttons still fire, top tools untouched, open item survives a re-render.');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
