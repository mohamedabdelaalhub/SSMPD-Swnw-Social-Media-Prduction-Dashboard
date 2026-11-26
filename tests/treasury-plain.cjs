// help 278 (owner «طبقه», mockup treasury-shifts-plain): real Chromium, real finance-controls chain + finance-cash.
// Handover rows without ids, diff chips only when present, coloured status + reviewer note, review button only for others' pending,
// «ورديتي» only with an open shift, main treasury «آخر حركة» in words (from_register from #867, or no SHIFT id), «الرصيد دلوقتي».
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003',X='00000000-0000-4000-8000-000000000009';
const D={me:ME,can_create:true,can_review:true,treasury_main:{id:'m',name:'الخزينة الرئيسية'},registers:[],shifts:[],
 treasury_transfers:[
  {id:'t1',from_shift:'s1',from_register:'خزينة الاستقبال 1',to_register_name:'الخزينة الرئيسية',amount:4350,end_difference:-30,reference:'SHIFT-1a3c5e7a-1111-4111-8111-111111111111',status:'pending',created_by:X,created_at:'2026-11-25T18:56:00Z'},
  {id:'t2',from_shift:'s2',from_register:'خزينة الاستقبال 1',to_register_name:'الخزينة الرئيسية',amount:3980,end_difference:0,reference:'SHIFT-2b4d6f8b-2222-4222-8222-222222222222',status:'approved',review_note:'استلمت 3980',created_by:X,created_at:'2026-11-24T16:56:00Z',reviewed_at:'2026-11-24T18:56:00Z'},
  {id:'t3',from_shift:'s3',from_register:'خزينة الاستقبال 2',to_register_name:'الخزينة الرئيسية',amount:1200,end_difference:null,reference:'تسليم-نص-اليوم',status:'rejected',review_note:'المبلغ ناقص 50',created_by:ME,created_at:'2026-11-23T17:56:00Z',reviewed_at:'2026-11-23T18:56:00Z'}]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/finance-today.css"></head><body><main id="root" style="padding:16px"></main><div id="mb"><div data-fc-main-balance></div></div><script>
window.D=${JSON.stringify(D)};window.LM={at:'2026-11-25T17:56:00Z',description:'تسليم خزينة SHIFT-2b4d6f8b-0d2f-4b4d-8f6b-8d0f2b4d6f8c-d2f4b6d8-f0b2-4d4f-8b6d-0f2b4d6f8b0a',amount:3980,source:'treasury_transfer_in',from_register:'خزينة الاستقبال 1'};
window.SSMPDAuth={currentAdmin:{id:'${ME}'}};window.SSMPDToast={show(){},error(){}};window.SSMPDDb={client:{rpc:async n=>n==='clinic_finance_main_treasury_balance'?{data:{configured:true,register:'الخزينة الرئيسية',balance:18450,shift:{opened_at:'2026-11-25T10:56:00Z',custodian:'أ. هالة',opening:12000,cash_in:9800,cash_out:3350},last_move:LM}}:{data:null}}};
window.draw=function(){var h=SSMPDFinanceCash.helpers,r=document.getElementById('root');r.innerHTML=SSMPDFinanceControls.panel('shifts',D,h);};
</script>${['finance-controls','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','finance-cash'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.TRP_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.evaluate(()=>draw());const txt=await page.locator('#root').innerText();
 assert(!/1a3c5e7a|2b4d6f8b|SHIFT-/.test(txt),'no shift ids');assert.equal(await page.locator('#root h3',{hasText:'ورديتي'}).count(),0,'no «ورديتي» without an open shift');
 const rows=await page.$$eval('[data-ho-list] .fc-ho',x=>x.map(r=>r.innerText.replace(/\s+/g,' ')));
 assert.match(rows[0],/آخر وردية — خزينة الاستقبال 1[\s\S]*4,350\.00 ج[\s\S]*ناقص 30\.00[\s\S]*مستني الاستلام[\s\S]*عِد واستلم/,'pending first with review button');
 assert.match(rows[1],/مطابق ✓[\s\S]*✓ اتسلّم/);assert.match(rows[1],/«استلمت 3980»/);
 assert.match(rows[2],/نص اليوم — خزينة الاستقبال 2[\s\S]*السبب: المبلغ ناقص 50[\s\S]*✗ اترفض/);assert.doesNotMatch(rows[2],/ناقص 0|مطابق/,'no diff chip when the difference is unknown');
 assert.equal(await page.locator('[data-ho-list] [data-fin-action="treasury-review"]').count(),1,'review only on others\' pending');
 // my open shift → «ورديتي» with the end-shift button; ended + rejected → recount
 await page.evaluate(()=>{D.shifts=[{id:'my',cashier_id:D.me,status:'open',is_main:false,register_name:'خزينة الحسابات'}];draw();});assert.equal(await page.locator('#root [data-fin-action="treasury-end"]').count(),1);
 await page.evaluate(()=>{D.shifts[0].ended_at='2026-11-25T20:00:00Z';draw();});assert.equal(await page.locator('#root [data-fin-action="treasury-recount"]').count(),1);
 await page.evaluate(()=>{D.shifts=[];draw();});
 // main treasury card
 await page.evaluate(()=>SSMPDFinanceCash.helpers.fillMainBalance(document.getElementById('mb')));await page.waitForSelector('#mb .fc-mb-tile');const mb=await page.locator('#mb').innerText();
 assert.match(mb,/الخزينة الرئيسية دلوقتي/);assert.doesNotMatch(mb,/دفتري|SHIFT-/);assert.match(mb,/آخر حركة: استلام من خزينة الاستقبال 1 3,980\.00 ج —/);
 await page.evaluate(()=>{delete LM.from_register;});await page.evaluate(()=>SSMPDFinanceCash.helpers.fillMainBalance(document.getElementById('mb')));await page.waitForTimeout(100);assert.match(await page.locator('#mb').innerText(),/آخر حركة: استلام تسليم وردية 3,980\.00 ج —/,'fallback without the drawer name');
 await page.evaluate(()=>{LM.description='reception_receipt_amount_fix';LM.amount=-150;});await page.evaluate(()=>SSMPDFinanceCash.helpers.fillMainBalance(document.getElementById('mb')));await page.waitForTimeout(100);{const t=await page.locator('#mb').innerText();assert.match(t,/آخر حركة: خرج 150\.00 ج —/,'non-handover source, negative reads خرج');assert.doesNotMatch(t,/reception_receipt|_fix/);}
 await page.evaluate(()=>{LM.from_register='خزينة الاستقبال 1';});
 if(shots)await page.screenshot({path:path.join(shots,'trp-'+width+'.png'),fullPage:true});
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS treasury plain 1280/390: handovers without ids, diff chips only when present, coloured status + note, review only for others\' pending, «ورديتي» only with an open shift (end / recount), main treasury «الرصيد دلوقتي» + «آخر حركة» in words (from_register / fallback)');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
