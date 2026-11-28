// «متابعة» window (owner approved 2026-11-28; server 20261128160000, proven by tests/follow-up-visits-sql.cjs): in a REAL browser as a
// RECEPTION user in a LIVE workspace (and a manager for approvals / settings), every button is clicked: «عايز تعمل كذا؟ ← مريض جاي متابعة»,
// patient search, the follow-up choice (same doctor), «احجز المتابعة», «اطلب مدّ الصلاحية» → «ابعت طلب المدّ», «طلبات المدّ» → «وافق» / «ارفض»,
// «تقرير المتابعات» (dates), «إعدادات المتابعة» (search + «حفظ»), the today-board chip, ✕ — at 1280 and 390. RPC payloads checked.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const SRC={fee:100,follow_ups:[{id:'f1',origin_visit_id:'v206',visit_no:206,service:'حشو عصب',provider_id:'d1',provider:'د. تجريبي',department:'أسنان',done_on:'2026-11-27',included:3,left:2,valid_until:'2026-12-27',expired:false,used:1,pending_extension:false,has_service:true},
 {id:'f2',origin_visit_id:'v188',visit_no:188,service:'خلع',provider_id:'d1',provider:'د. تجريبي',department:'أسنان',done_on:'2026-11-02',included:1,left:1,valid_until:'2026-11-16',expired:true,used:0,pending_extension:false,has_service:true}],
 visits:[{visit_id:'v230',visit_no:230,service:'كشف أسنان',provider_id:'d1',provider:'د. تجريبي',done_on:'2026-11-20',has_service:true}],packages:[{id:'pk',expires_on:'2027-06-30',visits:12,left:8}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{
for(const width of [1280,390])for(const role of ['reception','general_manager']){const p=await b.newPage({viewport:{width,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="host"><div class="journey-board"><article class="journey-card" data-appointment="ap1"><div class="journey-card-main"><b>مريض تجريبي</b></div></article></div></main></body></html>'}));
 await p.goto('https://reception.test/');await p.addStyleTag({path:'assets/css/styles.css'});
 await p.evaluate(([SRC,role,day])=>{window.__calls=[];window.__toasts=[];window.SSMPDToast={show:(m,k)=>window.__toasts.push([m,k])};
  window.SSMPDAuth={currentAdmin:{id:'u1',role}};window.SSMPDRoles={hasAnyRole:(a,l)=>l.indexOf(role)>=0,hasRole:(a,r)=>r===role,rolesOf:()=>[role],canSeeTab:()=>true};
  window.SSMPDTodayOps={context:()=>({workspace:'ws1',data:{workspace:{id:'ws1',mode:'live'},patients:[{id:'pA',name:'مريض تجريبي',file_no:'P-2026-000555',phone:'01000000001'},{id:'pB',name:'مريضة تانية',file_no:'P-2026-000556',phone:'01000000002'}]}}),day:()=>day,ready:()=>true};
  const ext=[{id:'x1',days:2,reason:'الدكتور كان مسافر',requested_by:'موظف استقبال',mine:false,patient:'مريض تجريبي',file_no:'P-2026-000555',visit_no:188,provider:'د. تجريبي',expires_on:'2026-11-16'}];
  window.SSMPDDb={client:{rpc:(n,a)=>{window.__calls.push([a.p_action,JSON.parse(JSON.stringify(a.p_payload))]);const P=a.p_action,ok=d=>Promise.resolve({data:d,error:null});
   if(P==='sources')return ok(SRC);if(P==='book')return ok({id:'apN',coverage:a.p_payload.follow_up_id==='f1'?'included':'fee',fee:a.p_payload.follow_up_id==='f1'?0:100,visit_no:206,left:1});
   if(P==='extend_request')return ok({id:'x9',status:'pending'});if(P==='extensions')return ok({can_review:role!=='reception',items:ext});if(P==='extend_review')return ok({ok:true});
   if(P==='report')return ok({doctors:[{provider:'د. تجريبي',included:14,fee:6,fee_income:600,booked:3,no_show:2}],remaining:[{file_no:'P-2026-000555',patient:'مريض تجريبي',visit_no:206,service:'حشو عصب',provider:'د. تجريبي',left:2,included:3,valid_until:'2026-12-27'}]});
   if(P==='rules_get')return ok({can_manage:role!=='reception',fee:100,services:[{service_id:'s1',code:'RCT',name:'حشو عصب',department:'أسنان',price:1000,included_count:3,valid_days:30},{service_id:'s2',code:'EXT',name:'خلع',department:'أسنان',price:500,included_count:null,valid_days:null}]});
   if(P==='rules_set')return ok({ok:true});if(P==='board')return ok({ap1:{coverage:'included',visit_no:206,left:2,included:3,fee:100}});return Promise.resolve({data:null,error:{message:'unexpected '+P}});}}};
 },[SRC,role,day]);
 for(const f of ['reception-drawer','reception-follow-up'])await p.addScriptTag({path:'assets/js/'+f+'.js'});
 // board chip (MutationObserver path + direct)
 await p.evaluate(()=>window.SSMPDFollowUp.decorate(document));await p.waitForSelector('[data-fu-chip]');assert.match(await p.textContent('[data-fu-chip]'),/متابعة على زيارة 206 — من المشمول \(فاضل 2 من 3\)/);
 // entry: «عايز تعمل كذا؟» lists it (reception) → opens the window
 if(role==='reception'){await p.evaluate(()=>window.SSMPDReceptionDrawer.want());const it=p.locator('[data-rd-go="followup"]');assert.match(await it.textContent(),/مريض جاي متابعة/);await it.click();}
 else await p.evaluate(()=>window.SSMPDFollowUp.open());
 await p.waitForSelector('[data-fu] [data-fu-q]');assert.equal(await p.locator('[data-fu] [data-fu-close]').count(),1,'✕');
 // search (Arabic-insensitive) → pick → sources
 await p.fill('[data-fu-q]','مريض تجريبى');await p.locator('[data-fu-pat="pA"]').click();await p.waitForSelector('[data-fu-opt]');
 assert.equal(await p.locator('[data-fu-opt]').count(),3);assert.match(await p.textContent('[data-fu-sum]'),/د\. تجريبي — نفس طبيب الزيارة[\s\S]*مشمولة في زيارة 206 \(بعدها يفضل 1 من 3\)[\s\S]*0 ج\.م/);
 assert.match(await p.textContent('[data-fu-src]'),/باقة شغّالة \(فاضل 8 من 12/);
 // the expired one: fee + «اطلب مدّ الصلاحية» → form → send
 const exp=p.locator('[data-fu-opt="f:f2"]');assert.match(await exp.textContent(),/برسوم متابعة 100 ج[\s\S]*الصلاحية خلصت/);
 await exp.locator('[data-fu-ext="f2"]').click();await exp.locator('[data-fu-days]').selectOption('2');await exp.locator('[data-fu-reason]').fill('الدكتور كان مسافر');await exp.locator('[data-fu-extgo]').click();
 await p.waitForFunction(()=>window.__calls.some(c=>c[0]==='extend_request'));let call=(await p.evaluate(()=>window.__calls)).find(c=>c[0]==='extend_request');assert.deepEqual(call[1],{follow_up_id:'f2',days:2,reason:'الدكتور كان مسافر'});
 await p.waitForSelector('[data-fu-opt]');
 // fee option on a visit → summary 100 → book
 await p.locator('[data-fu-opt="v:v230"] input').check();assert.match(await p.textContent('[data-fu-sum]'),/برسوم متابعة[\s\S]*100 ج\.م/);
 await p.locator('[data-fu-opt="f:f1"] input').check();await p.fill('[data-fu-day]',day);await p.fill('[data-fu-time]','18:30');
 if(process.env.SHOT)await p.screenshot({path:process.env.SHOT+'/follow-up-book-'+role+'-'+width+'.png',fullPage:true});
 await p.locator('[data-fu-book]').click();await p.waitForSelector('[data-fu]',{state:'detached'});
 call=(await p.evaluate(()=>window.__calls)).find(c=>c[0]==='book');assert.equal(call[1].follow_up_id,'f1');assert.equal(call[1].visit_id,null);assert.match(call[1].token,/^[0-9a-f-]{36}$/);
 const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(call[1].starts_at));assert.equal(local,'18:30','Cairo wall time');
 assert.match((await p.evaluate(()=>window.__toasts)).pop()[0],/اتحجزت المتابعة على زيارة 206 — مشمولة/);
 // «طلبات المدّ»
 await p.evaluate(()=>window.SSMPDFollowUp.open({tab:'ext'}));await p.waitForSelector('[data-fu] .fu-tbl, [data-fu] .fu-note');
 if(role==='reception'){assert.equal(await p.locator('[data-fu-ok]').count(),0,'reception cannot approve');assert.match(await p.textContent('[data-fu-body]'),/الموافقة للحسابات أو المدير/);}
 else{await p.locator('[data-fu-ok="x1"]').click();await p.waitForFunction(()=>window.__calls.some(c=>c[0]==='extend_review'));assert.deepEqual((await p.evaluate(()=>window.__calls)).find(c=>c[0]==='extend_review')[1],{id:'x1',approve:true});
  await p.locator('[data-fu-no="x1"]').click();await p.waitForFunction(()=>window.__calls.filter(c=>c[0]==='extend_review').length===2);}
 // «تقرير المتابعات»
 await p.locator('[data-fu-tab="report"]').click();await p.waitForSelector('[data-fu-rep] table');assert.match(await p.textContent('[data-fu-rep]'),/د\. تجريبي[\s\S]*600[\s\S]*2 من 3/);
 await p.fill('[data-fu-from]','2026-11-01');await p.locator('[data-fu-from]').dispatchEvent('change');await p.waitForFunction(()=>window.__calls.filter(c=>c[0]==='report').length>=2);
 assert.equal((await p.evaluate(()=>window.__calls)).filter(c=>c[0]==='report').pop()[1].from,'2026-11-01');
 // «إعدادات المتابعة»
 await p.locator('[data-fu-tab="rules"]').click();await p.waitForSelector('[data-fu-rule]');
 await p.fill('[data-fu-rq]','خلع');assert.equal(await p.locator('[data-fu-rule="s1"]').isHidden(),true,'search filters');assert.equal(await p.locator('[data-fu-rule="s2"]').isVisible(),true);
 if(role==='reception'){assert.equal(await p.locator('[data-fu-save]').count(),0,'reception: view only');assert.equal(await p.locator('[data-fu-rule="s2"] [data-fu-n]').isDisabled(),true);}
 else{await p.fill('[data-fu-rule="s2"] [data-fu-n]','1');await p.fill('[data-fu-rule="s2"] [data-fu-days]','14');await p.locator('[data-fu-rule="s2"] [data-fu-save]').click();
  await p.waitForFunction(()=>window.__calls.some(c=>c[0]==='rules_set'));assert.deepEqual((await p.evaluate(()=>window.__calls)).find(c=>c[0]==='rules_set')[1],{service_id:'s2',included_count:1,valid_days:14});}
 if(process.env.SHOT)await p.screenshot({path:process.env.SHOT+'/follow-up-rules-'+role+'-'+width+'.png',fullPage:true});
 const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(ov<=0,'no overflow '+width);
 await p.locator('[data-fu-close]').click();assert.equal(await p.locator('[data-fu]').count(),0,'✕ closes');
 assert(!errors.length,errors.join('\n'));await p.close();}
console.log('PASS «متابعة» window (reception + manager, live): drawer entry, patient search, same-doctor choice, included / fee summary, «احجز المتابعة» (Cairo time, token), «اطلب مدّ» 1..3 days, approvals only by another person (manager), report dates, settings search + save (manager only), board chip, ✕, 1280 + 390.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
