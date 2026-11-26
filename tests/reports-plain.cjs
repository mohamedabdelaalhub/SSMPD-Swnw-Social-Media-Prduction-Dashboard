// Reports plain pass (owner «طبقه» 2026-11-25, mockup reports-plain.html, help 281): «سجل المراجعة» in words —
// every action has an Arabic name (exact or prefix+verb), never the raw English code; no uuids / SHIFT ids; amount + drawer name when present.
const assert=require('assert'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--no-sandbox']});try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main style="padding:16px"><div id="host"></div></main></body></html>');
 for(const f of ['styles','finance-cash'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:"window.SSMPDAuth={currentAdmin:{id:'fm'}};window.SSMPDDb={};"});await page.addScriptTag({content:fs.readFileSync('assets/js/finance-cash.js','utf8')});
 const rows=[{created_at:'2026-11-25T18:56:00Z',actor_name:'أ. هالة',action:'treasury_transfer_reviewed',entity_id:'6f1c2a9e-1b2c-4d5e-8f90-123456789abc',detail:{from_register:'خزينة الاستقبال 1',amount:4350,note:'SHIFT-6f1c2a9e-1b2c-4d5e-8f90-123456789abc'}},
  {created_at:'2026-11-25T18:40:00Z',actor_name:'منى سعيد',action:'shift_ended_for_handover',entity_id:'aaaaaaaa-1b2c-4d5e-8f90-123456789abc',detail:{register_name:'خزينة الاستقبال 1'}},
  {created_at:'2026-11-24T15:17:00Z',actor_name:'أحمد فتحي',action:'cash_voucher_reject',detail:{}},{created_at:'2026-11-24T15:00:00Z',actor_name:'x',action:'something_unknown_xyz',detail:{}}];
 await page.evaluate(r=>{document.getElementById('host').innerHTML=SSMPDFinanceCash.helpers.auditList(r);},rows);
 const t=await page.locator('#host').innerText();
 assert.match(t,/مراجعة تحويل خزينة/);assert.match(t,/خزينة الاستقبال 1 · 4,350\.00 ج/);assert.match(t,/وردية اتقفلت للتسليم/);assert.match(t,/رفض سند/);assert.match(t,/25 نوفمبر · 8:56 م/,'time in words');assert.match(t,/عملية مالية/);
 assert.doesNotMatch(t,/[a-z]+_[a-z]+|SHIFT-|[0-9a-f]{8}-[0-9a-f]{4}/,'no English codes / ids');assert(!/[٠-٩]/.test(t),'English digits');
 assert.equal(await page.evaluate(()=>SSMPDFinanceCash.helpers.auditList([])),'<p class="fc-empty">مفيش عمليات في الفترة دي.</p>');
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+width+': '+ov);
 if(process.env.RP_QA)await page.screenshot({path:process.env.RP_QA+'/audit-'+width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS reports plain 1280/390: audit log in Arabic (exact + prefix/verb + fallback), drawer name + amount, no codes/uuids/SHIFT ids, English digits, no overflow');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
