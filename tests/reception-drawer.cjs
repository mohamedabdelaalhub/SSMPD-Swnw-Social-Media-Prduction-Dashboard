// «درجي» (owner «طبقه» 2026-11-26, mockup reception-drawer-actions.html): real Chromium, the real app shell + personal home + role-landing + reception-drawer.
// Reception only (customer service: nothing), no balance anywhere, every tile opens the EXISTING screen and presses the existing button
// (advance-receive / treasury-end / data-rse-spend / quick_collect) or calls the exported opener (openShiftOpen / PeerHandover.openSend);
// «طلب صرف من الدرج» hidden until the finance P2 opener exists; need_open → only «افتح ورديتي»; «عايز تعمل كذا؟» sheet; «تشغيل اليوم» bar.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/personal-home.css"><link rel="stylesheet" href="/assets/css/role-landing.css"><link rel="stylesheet" href="/assets/css/reception-drawer.css"></head><body><div id="app-root"></div><script>
window.calls=[];window.hits=[];window.SHIFT={show:false,state:'open',opened_at:new Date(Date.now()-3*3600e3).toISOString()};window.SSMPDToast={show(m){hits.push('toast:'+m);},error(){}};window.SSMPDI18n={textHtml:s=>s,t:s=>s,buttonHtml:()=>''};window.SSMPD_CONFIG={centerName:'سونو'};
window.SSMPDAuth={currentAdmin:{id:'rx1',name:'استقبال',role:'reception'}};
window.SSMPDDb={unsubscribe(){},subscribeTable:()=>null,receptionWorkspaces:()=>Promise.resolve([{id:'live-ws',mode:'live'}]),client:{channel:()=>({on(){return this},subscribe(){return this}}),rpc:(n,a)=>{calls.push(n);
 if(n==='clinic_reception_shift_reminder')return Promise.resolve({data:SHIFT});
 if(n==='clinic_reception_workspaces')return Promise.resolve({data:[{id:'live-ws',mode:'live'}]});
 if(n==='clinic_reception_journey_hub_snapshot')return Promise.resolve({data:{appointments:[]}});
 if(n==='personal_home_inbox')return Promise.resolve({data:{notices:[],unread:0,limited:false}});if(n==='personal_home_rating_queue')return Promise.resolve({data:[]});
 return Promise.resolve({data:{generated_at:new Date().toISOString(),tasks:null,content:null,supplies:[]}});}}};
/* the existing screens, reduced to the buttons the drawer presses */
const B=(attr,t)=>'<button type="button" '+attr+' onclick="hits.push(\\''+t+'\\')">'+t+'</button>';
window.SSMPDReception={render:r=>{const s=window.__rxSection||'';r.innerHTML='<div id="rx-page" data-section="'+s+'">'+(s==='appointments'?B('data-rse-spend','spend'):'')+(s==='journey'?'<details><summary>المزيد</summary>'+B('data-journey-action="quick_collect" data-id=""','quick_collect')+'</details>':'')+'</div>';},
 openSection:async k=>{window.__rxSection=k;document.querySelector('[data-goto="reception_services"]').click();return true;},openShiftOpen:async f=>{hits.push('openShiftOpen:'+f);return true;}};
window.SSMPDBookingCash={render:r=>{r.innerHTML='<div id="bc-page">'+B('data-fin-action="advance-receive" data-id=""','advance-receive')+B('data-fin-action="treasury-end" data-id="s1"','treasury-end')+'<section data-bcv-advances>مقدمات الحجز</section></div>';}};
window.SSMPDPeerHandover={openSend:()=>{hits.push('peer.openSend');}};
</script><script src="/assets/js/roles.js"></script><script src="/assets/js/ui-titles.js"></script><script src="/assets/js/finance-today.js"></script><script src="/assets/js/role-landing.js"></script><script src="/assets/js/reception-drawer.js"></script><script src="/assets/js/personal-home.js"></script><script src="/assets/js/app.js"></script><script>__homeApp.shell();</script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');let s=fs.readFileSync(p,'utf8');if(u==='/assets/js/app.js')s=s.slice(0,s.indexOf('  // ---------- تشغيل ----------'))+'window.__homeApp={shell:renderShell,go:switchTab};})();';res.end(s);}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.RD_SHOTS;
const home=async(page,admin,shift)=>{await page.evaluate(([a,s])=>{if(s)SHIFT=s;SSMPDAuth.currentAdmin=a;SSMPDRoleLanding.reset();SSMPDReceptionDrawer.reset();hits=[];window.__rxSection='';document.querySelectorAll('[data-rd-want]').forEach(x=>x.remove());__homeApp.shell();__homeApp.go('home');},[admin,shift||null]);await page.waitForSelector('.personal-home');};
const RX={id:'rx1',name:'استقبال',role:'reception'},OPEN={show:false,state:'open',opened_at:new Date(Date.now()-3*3600e3).toISOString()};
const tap=async(page,sel,expect)=>{await home(page,RX,OPEN);await page.waitForSelector('[data-rd-home] .rd-t');await page.click(sel);await page.waitForFunction(e=>hits.includes(e),expect,{timeout:6000});};
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);await page.waitForSelector('.personal-home');
 // reception, open shift: 5 tiles (no P2 opener yet), opened-at time, no money
 await home(page,RX,OPEN);await page.waitForSelector('[data-rd-home] .rd-t');
 assert.deepEqual(await page.$$eval('[data-rd-home] .rd-t span',x=>x.map(e=>e.textContent)),['حصّل من مريض','مصروف من الوردية','مقدم حجز','سلّم كاش لزميل','اقفل ورديتي وسلّم'],'5 tiles; «طلب صرف من الدرج» hidden until P2');
 const strip=await page.locator('[data-rd-home]').innerText();assert.match(strip,/ورديتك مفتوحة من \d{1,2}:\d{2}/);assert.doesNotMatch(strip,/ج\.م|رصيد|\d+\.\d{2}/,'no drawer balance (blind count)');assert(!/[٠-٩]/.test(strip));
 assert(await page.evaluate(()=>{const k=document.querySelector('[data-rl-kind="desk"] .rl-kp, [data-rl-kind="desk"] .rl-acts'),s=document.querySelector('[data-rd-home]');return !!(k.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING);}),'strip under the numbers/buttons');
 assert((await page.evaluate(()=>calls)).includes('clinic_reception_shift_reminder'));
 if(shots)await page.screenshot({path:path.join(shots,'rd-home-'+width+'.png'),fullPage:false});
 const ov=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(ov<=1,'overflow '+width+': '+ov);
 // every tile → the existing action
 await tap(page,'[data-rd="advance"]','advance-receive');assert(await page.locator('#bc-page').isVisible(),'booking cash tab opened');
 await tap(page,'[data-rd="end"]','treasury-end');
 await tap(page,'[data-rd="peer"]','peer.openSend');
 await tap(page,'[data-rd="expense"]','spend');assert.equal(await page.getAttribute('#rx-page','data-section'),'appointments');
 await tap(page,'[data-rd="collect"]','quick_collect');assert.equal(await page.getAttribute('#rx-page','data-section'),'journey');
 // «عايز تعمل كذا؟»: sheet, search, a sentence opens the action
 await home(page,RX,OPEN);await page.waitForSelector('[data-rd-home] [data-rd="want"]');await page.click('[data-rd-home] [data-rd="want"]');await page.waitForSelector('[data-rd-want]');
 assert.equal(await page.locator('[data-rd-want] [data-rd-go="payout"]').count(),0,'P2 sentence hidden too');
 assert.equal(await page.locator('[data-rd-want] [data-rd-go="fixvisit"]').count(),0,'«في غلط في زيارة» hidden until fix-visit.js is loaded');
 await page.fill('[data-rd-want] .rd-sheet-q','ورديتي');assert.equal(await page.locator('[data-rd-want] [data-rd-go]:visible').count(),2,'search filters (خلصت ورديتي + لسه ما فتحتش ورديتي)');
 if(shots)await page.screenshot({path:path.join(shots,'rd-want-'+width+'.png')});
 await page.click('[data-rd-want] [data-rd-go="end"]');await page.waitForFunction(()=>hits.includes('treasury-end'));assert.equal(await page.locator('[data-rd-want]').count(),0,'sheet closes');
 await home(page,RX,OPEN);await page.evaluate(()=>{window.SSMPDFixVisit={open:()=>hits.push('fix.open')};});await page.waitForSelector('[data-rd-home] [data-rd="want"]');await page.click('[data-rd-home] [data-rd="want"]');await page.waitForSelector('[data-rd-want] [data-rd-go="fixvisit"]');await page.click('[data-rd-want] [data-rd-go="fixvisit"]');await page.waitForFunction(()=>hits.includes('fix.open'));assert.equal(await page.locator('[data-rd-want]').count(),0,'sheet closes before the fix-visit panel opens');await page.evaluate(()=>{delete window.SSMPDFixVisit;});
 // need_open: only «افتح ورديتي» → openShiftOpen(true)
 await home(page,RX,{show:true,state:'need_open',reason:'punched'});await page.waitForSelector('[data-rd-home] .rd-closed');assert.equal(await page.locator('[data-rd-home] .rd-t').count(),0);
 if(shots)await page.screenshot({path:path.join(shots,'rd-closed-'+width+'.png'),fullPage:false});
 await page.click('[data-rd-home] [data-rd="open_shift"]');await page.waitForFunction(()=>hits.includes('openShiftOpen:true'));
 // P2 opener present → tile appears and calls it
 await page.evaluate(()=>{window.SSMPDDrawerPayout={open:()=>hits.push('p2.open')};});await tap(page,'[data-rd="payout"]','p2.open');await page.evaluate(()=>{delete window.SSMPDDrawerPayout;});
 // customer service: no drawer
 await home(page,{id:'cs1',name:'خدمة عملاء',role:'customer_service'},OPEN);await page.waitForSelector('[data-rl-kind="desk"]');await page.waitForTimeout(300);assert.equal(await page.locator('[data-rd-home]').count(),0,'customer service: no drawer');
 // «تشغيل اليوم» bar: compact buttons, collect presses the in-page quick_collect, «⋯» has peer/refund/want
 await home(page,RX,OPEN);await page.evaluate(()=>{const h=document.createElement('div');h.id='jb';h.innerHTML='<div data-rd-bar-slot hidden></div><details><summary>المزيد</summary><button data-journey-action="quick_collect" onclick="hits.push(\'quick_collect-here\')">تحصيل سريع</button></details>';document.querySelector('.personal-home').prepend(h);SSMPDReceptionDrawer.mountBar(h.querySelector('[data-rd-bar-slot]'));});
 await page.waitForSelector('#jb [data-rd-bar] [data-rd="collect"]');assert.match(await page.locator('#jb [data-rd-bar]').innerText(),/مفتوحة من/);
 await page.click('#jb [data-rd="collect"]');await page.waitForFunction(()=>hits.includes('quick_collect-here'));
 await page.click('#jb .rd-more summary');assert.deepEqual(await page.$$eval('#jb .rd-more [data-rd]',x=>x.map(e=>e.getAttribute('data-rd'))),['peer','refund','want']);
 if(shots)await page.screenshot({path:path.join(shots,'rd-bar-'+width+'.png'),clip:{x:0,y:0,width,height:260}});
 await page.click('#jb .rd-more [data-rd="refund"]');await page.waitForSelector('#bc-page [data-bcv-advances]');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS reception drawer 1280/390: reception only, no balance, 5 tiles (P2 hidden until its opener), each tile presses the existing button / calls the exported opener, «عايز تعمل كذا؟» search + go, need_open → «افتح ورديتي», «تشغيل اليوم» bar + «⋯», no overflow');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
