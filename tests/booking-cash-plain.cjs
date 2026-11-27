// «خزينة الاستقبال والحجوزات» plain-language layout (help 276): real Chromium, the real finance-controls chain
// (finance-controls → finance-advances → accountant-workspace → statement-import → finance-cash helpers → finance-today) + booking-cash-view.
// As the reception cashier (live): no raw uuid on screen, rejected handover first with its reason and the recount button,
// «اتحصّل في ورديتك» from clinic_finance_my_collections (hidden when shift=null or the RPC is missing), every button opens its existing modal,
// period chips drive the snapshot dates, one empty line for empty sections, no sideways scroll at 1280/390.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),ME=U(3),SH=U(11),REQ='9f2c7a1e-44b0-4c1d-9e3a-6b8d2f0c5a71';
const now=Date.now(),iso=m=>new Date(now+m*60000).toISOString();
const snap={me:ME,can_create:true,can_review:false,can_allocate:true,treasury_main:{id:U(90),name:'الخزينة الرئيسية'},registers:[{id:U(20),name:'خزينة الاستقبال 1'}],
 active_shifts:[{id:SH,cashier_id:ME,status:'open',register_name:'خزينة منار',opened_at:iso(-300),is_main:false}],shifts:[{id:SH,status:'open',register_name:'خزينة منار',opened_at:iso(-300)}],
 treasury_transfers:[
  {id:U(31),from_shift:U(12),from_register:'خزينة منار',to_register_name:'الخزينة الرئيسية',amount:1500,end_difference:null,reference:'تسليم نهاية وردية 8e230b43-1111-4111-8111-111111111111',status:'approved',review_note:'اعتماد النقدية',created_at:iso(-1500),reviewed_at:iso(-1100),created_by:ME},
  {id:U(32),from_shift:U(13),from_register:'خزينة منار',to_register_name:'الخزينة الرئيسية',amount:1500,end_difference:-20,reference:'تسليم نهاية وردية 4dccb6be-2222-4222-8222-222222222222',status:'rejected',review_note:'التسليم ناقص تحصيل 1200 جنيه',created_at:iso(-3000),reviewed_at:iso(-2900),created_by:ME}],
 advances:[{id:U(41),patient_ref:REQ,reference:'IP-77812',method:'instapay',amount:500,available:500,status:'received',created_by:ME,created_at:iso(-60)},{id:U(42),patient_ref:'P-2026-000412',reference:'RC-261124-180211-733',method:'cash',amount:300,available:100,status:'received',created_by:ME}],
 advance_uses:[],bookings:[{id:U(51),customer_name:'ياسمين خالد',booking_request_id:REQ,appointment_date:'2026-11-28',appointment_time:'21:40',status:'confirmed'}],
 messages:[{id:U(61),body:'تأكيد حجز: ياسمين خالد يوم 2026-11-28 الساعة 21:40',phone:'01012345678',status:'ready',current_version:true,booking_status:'confirmed'}]};
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/booking-cash-view.css"></head><body><main id="root" style="padding:16px"></main><script>
window.SNAP=${JSON.stringify(snap)};window.calls=[];window.noColl=false;window.collNull=false;window.SSMPDAuth={currentAdmin:{id:'${ME}',role:'reception'}};window.SSMPDToast={show(){},error(){}};
window.SSMPDPeerHandover={openSend(){window.peerOpened=(window.peerOpened||0)+1;}};
window.SSMPDDb={bookingSnapshot:async(f,t)=>{calls.push(['snapshot',f,t]);return JSON.parse(JSON.stringify(SNAP));},bookingCommand:async(a,v)=>{calls.push(['cmd',a,v]);return {};},bookingShift:async(a,v)=>{calls.push(['shift',a,v]);return {};},
 client:{rpc:(n,a)=>{calls.push(['rpc',n]);if(n==='clinic_finance_my_collections'){if(noColl)return Promise.resolve({error:{code:'PGRST202',message:'missing'}});return Promise.resolve({data:collNull?{shift:null,methods:[],count:0,total:0}:{shift:{id:'${SH}',register:'خزينة منار',opened_at:'${iso(-300)}'},methods:[{method:'cash',count:4,total:1450},{method:'pos',count:1,total:400},{method:'instapay',count:0,total:0}],count:5,total:1850}});}return Promise.resolve({data:null});}}};
</script><script src="/assets/js/finance-controls.js"></script><script src="/assets/js/finance-advances.js"></script><script src="/assets/js/accountant-workspace.js"></script><script src="/assets/js/finance-statement-import.js"></script><script src="/assets/js/finance-labels.js"></script><script src="/assets/js/finance-cash.js"></script><script src="/assets/js/finance-today.js"></script><script src="/assets/js/booking-cash-view.js"></script><script>SSMPDBookingCash.render(document.getElementById('root'));</script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(p));}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.BCV_SHOTS;
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);
 await page.waitForSelector('.bcv [data-bcv-collections]');
 const text=await page.locator('.bcv').innerText();
 assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(text),'no full uuid anywhere on screen');assert(!/8e230b43|4dccb6be/.test(text),'no shift ids in handovers');
 assert.match(text,/خزينة منار · الوردية مفتوحة من/);
 // collections tile: total, receipts, only methods with receipts
 assert.match(await page.textContent('[data-bcv-collections]'),/1,850\.00 ج[\s\S]*5 إيصال/);assert.deepEqual(await page.$$eval('.bcv-methods span b',x=>x.map(e=>e.textContent)),['نقدي','فيزا']);
 // «محتاج منك»: rejected handover with reason + recount (own shift ended, nothing pending) and the unsent message
 await page.evaluate(async()=>{SNAP.active_shifts[0].ended_at=new Date().toISOString();SNAP.treasury_transfers[1].from_shift=SNAP.active_shifts[0].id;});await page.click('[data-bcv-range="month"]');await page.waitForSelector('[data-bcv-need] [data-fin-action="treasury-recount"]');
 const need=await page.locator('[data-bcv-need]').innerText();assert.match(need,/تسليم ورديتك اترفض[\s\S]*السبب: «التسليم ناقص تحصيل 1200 جنيه»/);assert.match(need,/رسالة لسه ماتبعتتش/);
 assert.equal(await page.locator('[data-ft-peer]').count(),0,'shift ended: no hand-over button');
 // owner 2026-11-27 «يفتح وردية بعد تسليم الوردية القديمة من غير انتظار الاعتماد»: handed-over shift → «فتح وردية استقبال» shows and opens its modal
 await page.click('.bcv [data-fin-action="booking-open"]');await page.waitForSelector('.fc-modal select[name="register_id"]');await page.evaluate(()=>{const m=document.querySelector('.fc-modal');if(m)m.remove();});
 await page.click('[data-bcv-need] [data-fin-action="treasury-recount"]');await page.waitForSelector('.fc-modal');await page.click('.fc-modal [data-fc-close],.fc-modal button[type="button"]').catch(()=>{});await page.evaluate(()=>{const m=document.querySelector('.fc-modal');if(m)m.remove();});
 await page.evaluate(()=>{delete SNAP.active_shifts[0].ended_at;SNAP.treasury_transfers[1].from_shift='x';});await page.click('[data-bcv-range="month"]');await page.waitForSelector('[data-ft-peer]');
 assert.equal(await page.locator('.bcv [data-fin-action="booking-open"]').count(),0,'open shift still running: no second open button');
 // handovers: readable kind + drawer, colored status, diff chip only when it exists, reason under rejected
 const rows=await page.$$eval('[data-bcv-handovers] .bcv-it',x=>x.map(e=>e.innerText.replace(/\s+/g,' ')));
 assert.match(rows[0],/آخر وردية — خزينة منار[\s\S]*1,500\.00 ج[\s\S]*✓ اتسلّم/);assert.match(rows[1],/السبب: التسليم ناقص[\s\S]*ناقص 20\.00 ج[\s\S]*✗ اترفض/);
 // bookings: name + words date + short ref with copy (full id copied), message button opens its modal
 assert.match(await page.textContent('[data-bcv-bookings]'),/ياسمين خالد — 28 نوفمبر · 9:40 م[\s\S]*مرجع 9f2c7a1e/);
 // advances: booking advance shows the patient name, manual shows a short ref; «فاضل منه» only when it differs
 const adv=await page.locator('[data-bcv-advances]').innerText();assert.match(adv,/ياسمين خالد/);assert.match(adv,/فاضل منه 100\.00/);assert.doesNotMatch(adv,/فاضل منه 500/);
 // every action is the existing modal
 for(const [sel,title] of [['[data-fin-action="treasury-end"]',''],['[data-fin-action="treasury-transfer"]','تسليم'],['[data-fin-action="advance-receive"]','مقدم'],['[data-bcv-bookings] [data-fin-action="booking-message"]','رسالة'],['[data-bcv-need] [data-fin-action="booking-preview"]','واتساب'],['[data-bcv-advances] [data-fin-action="advance-allocate"]','المقدم'],['[data-bcv-advances] [data-fin-action="advance-proof"]','']]){
  await page.click(sel);await page.waitForSelector('.fc-modal');if(title)assert.match(await page.textContent('.fc-modal'),new RegExp(title),sel);await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));}
 await page.click('[data-ft-peer]');assert.equal(await page.evaluate(()=>window.peerOpened>=1),true,'peer handover opens');
 // the booking message really goes through the command
 await page.click('[data-bcv-bookings] [data-fin-action="booking-message"]');await page.waitForSelector('.fc-modal form');await page.selectOption('.fc-modal select[name=kind]','confirmation');await page.evaluate(()=>document.querySelector('.fc-modal form').requestSubmit());await page.waitForFunction(()=>calls.some(c=>c[0]==='cmd'&&c[1]==='message_prepare'),null,{timeout:5000});
 await page.evaluate(()=>document.querySelectorAll('.fc-modal').forEach(m=>m.remove()));
 // period chips: «النهارده» asks from today; «فترة تانية» shows the date form
 await page.click('[data-bcv-range="today"]');await page.waitForFunction(()=>{const s=calls.filter(c=>c[0]==='snapshot').pop();return s&&s[1]===new Date().toISOString().slice(0,10);});
 assert.equal(await page.locator('[data-booking-filter]').isHidden(),true);await page.click('[data-bcv-range="custom"]');assert.equal(await page.locator('[data-booking-filter]').isVisible(),true);
 if(shots){await page.click('[data-bcv-range="month"]');await page.waitForSelector('[data-bcv-collections]');await page.screenshot({path:path.join(shots,'bcv-'+width+'.png'),fullPage:true});fs.writeFileSync(path.join(shots,'bcv.html'),(await page.content()).replace(/<script[\s\S]*?<\/script>/g,'').replace(/href="\/?assets/g,'href="'+root+'/assets'));}
 // empty sections collapse to one line; collections hidden when no shift / RPC missing
 await page.evaluate(()=>{SNAP.advances=[];SNAP.bookings=[];SNAP.messages=[];collNull=true;});await page.click('[data-bcv-range="month"]');await page.waitForSelector('[data-bcv-empty]');
 assert.equal(await page.textContent('[data-bcv-empty]'),'✓ مفيش مقدمات ولا حجوزات ولا رسائل في الفترة دي.');await page.waitForTimeout(150);assert.equal(await page.locator('[data-bcv-collections]').count(),0);
 await page.evaluate(()=>{collNull=false;noColl=true;});await page.click('[data-bcv-range="month"]');await page.waitForTimeout(200);assert.equal(await page.locator('[data-bcv-collections]').count(),0,'missing RPC hides the tile');
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS booking cash plain 1280/390: no uuids, my shift + collections by method (#863, hidden when null/missing), rejected handover first with reason + recount, readable handovers with diff chips, names on advances/bookings + short copyable ref, all existing modals open, message command, period chips, one empty line, no sideways scroll');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
