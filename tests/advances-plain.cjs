// help 280: accounting «مقدمات الحجز» tab uses the plain booking-cash sections (real Chromium, real finance-controls chain).
// Names instead of booking ids, reviewer «محتاج منك» with proof + verify, no duplicate proof table, refund review, one empty line.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const ME='00000000-0000-4000-8000-000000000003',X='00000000-0000-4000-8000-000000000009',REQ='9f2c7a1e-44b0-4c1d-9e3a-6b8d2f0c5a71';
const D={me:ME,can_create:true,can_review:true,can_allocate:true,invoices:[],
 advances:[{id:'a1',patient_ref:REQ,reference:'IP-77812',method:'instapay',amount:500,available:500,status:'pending',created_by:X,created_at:'2026-11-25T12:10:00Z'},{id:'a2',patient_ref:'P-2026-000412',patient_name:'محمود علي',reference:'RC-1',method:'cash',amount:300,available:100,status:'received',created_by:ME}],
 advance_uses:[{id:'u1',kind:'refund',patient_ref:'P-2026-000390',reference:'REF-ADV-12',amount:200,method:'cash',status:'pending',created_by:X}],
 bookings:[{id:'b1',customer_name:'ياسمين خالد',booking_request_id:REQ,appointment_date:'2026-11-27',appointment_time:'18:30',status:'confirmed'}],messages:[]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/finance-cash.css"><link rel="stylesheet" href="/assets/css/booking-cash-view.css"></head><body><main id="root" style="padding:16px"></main><script>
window.D=${JSON.stringify(D)};window.SSMPDAuth={currentAdmin:{id:'${ME}'}};window.SSMPDToast={show(){},error(){}};window.SSMPDDb={client:{rpc:async()=>({data:null})}};
window.draw=function(){var h=SSMPDFinanceCash.helpers,r=document.getElementById('root');r.innerHTML=SSMPDFinanceControls.panel('advances',D,h);r.querySelectorAll('[data-fin-action]').forEach(function(b){b.onclick=function(){document.querySelectorAll('.fc-modal').forEach(function(m){m.remove();});SSMPDFinanceControls.act(b.dataset.finAction,b.dataset.id,D,h);};});};
</script>${['finance-controls','finance-advances','booking-cash-view','finance-treasury','ledger-editor','accountant-workspace','finance-statement-import','finance-account-statements','finance-labels','finance-cash'].map(f=>'<script src="/assets/js/'+f+'.js"></script>').join('')}</body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.ADV_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.evaluate(()=>draw());const txt=await page.locator('#root').innerText();
 assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(txt),'no full uuid');assert(!/التزام|مسار الوكيل|إقرار القناة|مرجع الربط/.test(txt),'no jargon');
 assert.equal(await page.locator('#root h4',{hasText:'إثبات الفيزا'}).count(),0,'no duplicate proof table');
 const need=await page.locator('[data-bcv-need]').innerText();assert.match(need,/ياسمين خالد — اتأكد إن المقدم وصل/);assert.match(need,/طلب استرداد مقدم — مستني مراجعتك/);
 assert.equal(await page.locator('[data-bcv-need] [data-fin-action="advance-proof"]').count(),1);assert.equal(await page.locator('[data-bcv-need] [data-fin-action="advance-verify"]').count(),1);assert.equal(await page.locator('[data-bcv-need] [data-fin-action="advance-refund-review"]').count(),1);
 const adv=await page.locator('[data-bcv-advances]').innerText();assert.match(adv,/محمود علي/);assert.match(adv,/فاضل منه 100\.00/);
 assert.match(await page.locator('[data-bcv-bookings]').innerText(),/ياسمين خالد — 27 نوفمبر · 6:30 م[\s\S]*مرجع 9f2c7a1e/);
 assert.match(await page.locator('[data-bcv-empty]').innerText(),/مفيش رسائل/);
 for(const sel of ['[data-bcv-need] [data-fin-action="advance-verify"]','[data-bcv-advances] [data-fin-action="advance-allocate"]','.bcv-acts [data-fin-action="advance-receive"]']){await page.click(sel);await page.waitForSelector('.fc-modal');await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));}
 if(shots)await page.screenshot({path:path.join(shots,'adv-'+width+'.png'),fullPage:true});
 // a non-reviewer: no «محتاج منك» for others' advances
 await page.evaluate(()=>{D.can_review=false;draw();});assert.equal(await page.locator('[data-bcv-need]').count(),0);await page.evaluate(()=>{D.can_review=true;});
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1);
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS advances plain 1280/390: names instead of ids, reviewer needs (proof + verify + refund review), no duplicate proof table, allocate / receive modals, short copyable booking ref, one empty line, non-reviewer sees no needs');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
