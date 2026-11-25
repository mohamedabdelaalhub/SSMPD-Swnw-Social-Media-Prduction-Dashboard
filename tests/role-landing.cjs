// «أول شاشة حسب شغلك» (help 271): real Chromium, the real app shell + personal home + role-landing + finance-today.
// Each role sees its own board, every button opens the right screen, the counts follow the «تشغيل اليوم» rules,
// a failed read hides only its part, and the reception openSection really opens the live workspace section.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
const now=Date.now(),iso=m=>new Date(now+m*60000).toISOString();
const apps=[{queue_status:'expected',starts_at:iso(-30)},{queue_status:'expected',starts_at:iso(60)},{queue_status:'waiting',starts_at:iso(-10)},{queue_status:'called',starts_at:iso(-5)},{queue_status:'in_service',starts_at:iso(-20)},{queue_status:'completed',starts_at:iso(-90)},{queue_status:'no_show',starts_at:iso(-120)},{queue_status:'cancelled',starts_at:iso(-60)}];
const html=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/personal-home.css"><link rel="stylesheet" href="/assets/css/role-landing.css"></head><body><div id="app-root"></div><script>
window.calls=[];window.fail={};window.APPS=${JSON.stringify(apps)};window.SSMPDToast={show(){},error(){}};window.SSMPDI18n={textHtml:s=>s,t:s=>s,buttonHtml:()=>''};window.SSMPD_CONFIG={centerName:'سونو'};
window.SSMPDAuth={currentAdmin:{id:'rx1',name:'استقبال',role:'reception'}};
window.SSMPDDb={unsubscribe(){},subscribeTable:()=>null,receptionWorkspaces:()=>Promise.resolve([{id:'trial-ws',mode:'trial'},{id:'live-ws',mode:'live'}]),client:{channel:()=>({on(){return this},subscribe(){return this}}),rpc:(n,a)=>{calls.push([n,a]);if(fail[n])return Promise.resolve({error:{code:'42501',message:'denied'}});
 if(n==='clinic_reception_workspaces')return Promise.resolve({data:[{id:'trial-ws',mode:'trial'},{id:'live-ws',mode:'live'}]});
 if(n==='clinic_reception_journey_hub_snapshot')return Promise.resolve({data:{appointments:APPS}});
 if(n==='clinic_finance_overview')return Promise.resolve({data:{can_review:SSMPDAuth.currentAdmin.role!=='accountant',needs:[{kind:'handover',count:2},{kind:'requests',count:3},{kind:'cash_cases',count:0},{kind:'shift_review',count:1}]}});
 if(n==='personal_home_inbox')return Promise.resolve({data:{notices:[],unread:0,limited:false}});if(n==='personal_home_rating_queue')return Promise.resolve({data:[]});
 return Promise.resolve({data:{generated_at:new Date().toISOString(),tasks:null,content:null,supplies:[]}});}}};
window.SSMPDReception={render:r=>{r.innerHTML='<div id="rx-page" data-section="'+(window.__rxSection||'')+'">الاستقبال</div>';},openSection:async k=>{window.__rxSection=k;document.querySelector('[data-goto="reception_services"]').click();return true;}};
window.SSMPDRenderAccounting={selectSection:(sub,sec)=>{window.__acc=[sub,sec];},render:r=>{r.innerHTML='<div id="acc-page" data-sub="'+(window.__acc?window.__acc[0]:'')+'">الحسابات</div>';}};
window.SSMPDRenderTasks={render:r=>r.innerHTML='<div id="task-page">المهام</div>'};window.SSMPDRenderLeads={render:r=>r.innerHTML='<div id="leads-page">الليدز</div>'};
</script><script src="/assets/js/roles.js"></script><script src="/assets/js/ui-titles.js"></script><script src="/assets/js/finance-today.js"></script><script src="/assets/js/role-landing.js"></script><script src="/assets/js/personal-home.js"></script><script src="/assets/js/app.js"></script><script>__homeApp.shell();</script></body></html>`;
(async()=>{const server=http.createServer((req,res)=>{const u=req.url.split('?')[0];if(u==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}const p=path.join(root,u);if(!p.startsWith(root)||!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('content-type',p.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');let s=fs.readFileSync(p,'utf8');if(u==='/assets/js/app.js')s=s.slice(0,s.indexOf('  // ---------- تشغيل ----------'))+'window.__homeApp={shell:renderShell,go:switchTab};})();';res.end(s);}).listen(0);
const browser=await chromium.launch({args:['--no-sandbox']});const shots=process.env.RL_SHOTS;
const as=async(page,admin)=>{await page.evaluate(a=>{SSMPDAuth.currentAdmin=a;SSMPDRoleLanding.reset();window.__rxSection='';window.__acc=null;__homeApp.shell();__homeApp.go('home');},admin);await page.waitForSelector('.personal-home');};
try{for(const width of [1280,390]){const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:'+server.address().port);await page.waitForSelector('.personal-home');
 // reception: «تشغيل اليوم» board with the same counts as the screen chips
 await page.waitForSelector('[data-rl-kind="desk"] .rl-kp');
 assert.deepEqual(await page.$$eval('[data-rl-kind="desk"] .rl-k b',x=>x.map(e=>e.textContent)),['8','2','1','1'],'total 8, waiting 2 (waiting+called), late 1, done 1 (completed only)');
 const hub=(await page.evaluate(()=>calls)).find(c=>c[0]==='clinic_reception_journey_hub_snapshot');assert.equal(hub[1].p_workspace,'live-ws','live workspace, not trial');
 assert.equal(await page.evaluate(()=>{const s=document.querySelector('[data-role-landing]'),h=document.querySelector('.ph-welcome');return !!(h.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING)&&!s.hidden;}),true,'board right under the welcome');
 if(shots){await page.screenshot({path:path.join(shots,'rl-reception-'+width+'.png'),fullPage:false});fs.writeFileSync(path.join(shots,'rl-reception.html'),(await page.content()).replace(/<script[\s\S]*?<\/script>/g,'').replace(/href="\/?assets/g,'href="'+root+'/assets'));}
 for(const [sec] of [['journey'],['appointments'],['patients']]){await as(page,{id:'rx1',name:'استقبال',role:'reception'});await page.waitForSelector('[data-rl-rx="'+sec+'"]');await page.click('[data-rl-rx="'+sec+'"]');await page.waitForSelector('#rx-page[data-section="'+sec+'"]');}
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('ssmpd_active_tab')),'reception_services');
 // a failed read hides only the numbers; the buttons stay
 await page.evaluate(()=>{fail.clinic_reception_journey_hub_snapshot=1;});await as(page,{id:'rx2',name:'خدمة عملاء',role:'customer_service'});await page.waitForSelector('[data-rl-kind="desk"] [data-rl-rx="journey"]');await page.waitForTimeout(300);assert.equal(await page.locator('[data-rl-kind="desk"] .rl-kp').count(),0);await page.evaluate(()=>{fail={};});
 // accountant: «شغلي النهارده» with only the waiting tasks
 await as(page,{id:'acc1',name:'محاسب',role:'accountant',module_permissions:[{module_key:'accounting',can_view:true}]});await page.waitForSelector('[data-rl-kind="finance"] .rl-sub');await page.waitForFunction(()=>/مستنياك/.test(document.querySelector('[data-rl-kind="finance"] .rl-sub').textContent));
 assert.deepEqual(await page.$$eval('[data-rl-kind="finance"] .rl-row b',x=>x.map(e=>e.textContent)),['طلبات الصرف'],'accountant: only requests has a count');
 await page.click('[data-rl-kind="finance"] .rl-main');await page.waitForSelector('#acc-page[data-sub="overview"]');
 // financial manager: reviewer tasks with counts
 await as(page,{id:'fm1',name:'مدير مالي',role:'financial_manager',module_permissions:[{module_key:'accounting',can_view:true}]});await page.waitForSelector('[data-rl-kind="finance"] .rl-row');
 assert.deepEqual(await page.$$eval('[data-rl-kind="finance"] .rl-row',x=>x.map(e=>e.querySelector('b').textContent+':'+e.querySelector('.rl-n').textContent)),['استلم كاش من الخزن:2','اعتمادات مستنياك:3','مراجعة الورديات:1']);
 assert.match(await page.textContent('[data-rl-kind="finance"] .rl-sub'),/6 حاجات مستنياك/);
 if(shots){await page.screenshot({path:path.join(shots,'rl-finance-'+width+'.png'),fullPage:false});fs.writeFileSync(path.join(shots,'rl-finance.html'),(await page.content()).replace(/<script[\s\S]*?<\/script>/g,'').replace(/href="\/?assets/g,'href="'+root+'/assets'));}
 await page.click('[data-rl-kind="finance"] .rl-row .btn');await page.waitForSelector('#acc-page[data-sub="overview"]');
 // GM: finance board too (has accounting)
 await as(page,{id:'gm1',name:'مدير',role:'general_manager'});await page.waitForSelector('[data-rl-kind="finance"] .rl-row');
 // content role: no board; most-used tiles appear after using two tabs and open them
 await as(page,{id:'pm1',name:'صفحات',role:'page_manager'});assert.equal(await page.locator('[data-rl-kind]').count(),0,'content keeps its home');assert.equal(await page.locator('[data-rl-used]').count(),0);
 await page.evaluate(()=>{SSMPDRoleLanding.count('tasks');SSMPDRoleLanding.count('tasks');SSMPDRoleLanding.count('production');SSMPDRoleLanding.count('admin');});
 await as(page,{id:'pm1',name:'صفحات',role:'page_manager'});await page.waitForSelector('[data-rl-used] [data-rl-tab]');
 assert.deepEqual(await page.$$eval('[data-rl-used] [data-rl-tab]',x=>x.map(e=>e.dataset.rlTab)),['tasks','production'],'ordered by use, only tabs this account can open');
 await page.click('[data-rl-tab="tasks"]');await page.waitForSelector('#task-page');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ssmpd_tab_use_v1:pm1')).tasks),3,'clicks count too');
 // nursing: one button to nursing day ops
 await as(page,{id:'n1',name:'تمريض',role:'nursing'});await page.waitForSelector('[data-rl-kind="nurse"] [data-rl-rx]');
 const size=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}));assert(size.s<=size.w+1,'no sideways scroll');
 assert.deepEqual(errors,[]);await page.close();}
 console.log('PASS role landing 1280/390: reception counts follow the «تشغيل اليوم» chips on the live workspace, journey/appointments/patients open their sections, a failed read hides only the numbers, accountant/FM/GM see waiting finance tasks and open «شغلي النهارده», content keeps its home, most-used tiles by use and allowed tabs only, nursing button; mocked RPCs');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});
