// Owner 2026-11-23: «التفاصيل بتاعة الزيارة المنزلية تبقى مقفولة، تتفتح اول ما يدوس ان الزيارة منزلية» — «الاتنين»:
// «مين اللي هينفّذ؟» and the visit-address fields are closed in «حجز موعد» and open when «زيارة منزلية» is ticked.
// Real reception screen, real server functions (PGlite), RECEPTION user, LIVE workspace.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages']);const w=await rpc('clinic_reception_bootstrap');
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await as(1);
 await rpc('clinic_reception_command',{p_workspace:w,p_action:'member',p_payload:{admin_id:id(3),capabilities:['view','book','execute','collect']},p_token:'62000000-0000-4000-8000-000000000001'});await as(3);
 const page=await browser.newPage({viewport:{width:1280,height:1400}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-patient-extras','reception-booking-plus','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>(n==='clinic_reception_nurses'?Promise.resolve([{id:'n1',name:'ممرضة تجربة'}]):n.startsWith('clinic_reception_')?rxRpc(n,a):Promise.resolve(null)).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-patient-extras','reception-booking-plus','reception-booking-discount','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="patients"]').click();await page.locator('[data-rx-action="book"]').first().click();await page.waitForSelector('.rx-modal [data-rbp-perf]',{state:'attached'});
 const vis=()=>page.evaluate(()=>({perf:!!document.querySelector('.rx-modal [data-rbp-perf]').offsetParent,addr:!!document.querySelector('.rx-modal [data-rxe-home]').offsetParent,mode:document.querySelector('.rx-modal input[name="performer_mode"]').value}));
 assert.deepEqual(await vis(),{perf:false,addr:false,mode:'doctor'},'closed at first');
 if(process.env.SHOT)await page.locator('.rx-modal .modal').first().screenshot({path:process.env.SHOT+'/home-closed.png'});
 const sw=page.locator('.rx-modal label.rxe-switch');await sw.click();
 assert.deepEqual(await vis(),{perf:true,addr:true,mode:'doctor'},'open after «زيارة منزلية»');
 await page.locator('.rx-modal [data-rbp-mode="nurse_alone"]').click();assert.equal((await vis()).mode,'nurse_alone');
 if(process.env.SHOT)await page.locator('.rx-modal .modal').first().screenshot({path:process.env.SHOT+'/home-open.png'});
 await sw.click();assert.deepEqual(await vis(),{perf:false,addr:false,mode:'doctor'},'closed again, back to «الطبيب»');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS home visit collapse (reception, live): «مين اللي هينفّذ؟» + address closed in «حجز موعد», open on «زيارة منزلية», closing resets to «الطبيب».');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
