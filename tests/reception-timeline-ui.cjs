// Reception appointments timeline (owner 2026-11-15): small date + «النهارده», Sat→Fri week strip with dots, vertical
// timeline, current appointment highlighted, summary, search / doctor / status filters, day switch, floating «+».
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=(t)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{for(const width of [1280,390]){
 const {db,rpc}=await boot(['booking_confirm_duration']);
 const today=cairoDay(new Date()),d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);const tomorrow=d.toISOString().slice(0,10);
 const at=(day,hhmm)=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10),h-2,m)).toISOString();}; // Cairo = UTC+2 in Nov
 const w=await rpc('clinic_reception_bootstrap');const snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:tomorrow});
 const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 for(const day of [today,tomorrow])await cmd('availability',{provider_id:provider,starts_at:at(day,'08:00'),ends_at:at(day,'18:00')});
 const book=(day,t,p)=>cmd('book',{patient_id:p,provider_id:provider,service_id:service,starts_at:at(day,t)}).then(r=>r.id);
 const a9=await book(today,'09:00',p1),a10=await book(today,'10:00',p2),a11=await book(today,'11:00',p1),a13=await book(today,'13:00',p2),a15=await book(today,'15:00',p1);await book(tomorrow,'12:00',p2);
 await cmd('arrive',{id:a9});await cmd('confirm',{id:a11});await cmd('cancel',{id:a15,reason:'اختبار'});
 const page=await browser.newPage({viewport:{width,height:950},timezoneId:'Asia/Dubai',deviceScaleFactor:process.env.RECEPTION_QA?2:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.setFixedTime(new Date(at(today,'10:05')));
 await page.exposeFunction('rxRpc',rpc);await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" style="padding:16px 16px 1400px"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','dashboard-glass'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin'}};window.SSMPDRoles={canSeeTab:()=>true};window.SSMPDDb={receptionBootstrap:()=>rxRpc('clinic_reception_bootstrap'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');await page.locator('[data-guide-skip]').click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const weekday=new Date(today+'T12:00:00Z').toLocaleDateString('ar-EG',{weekday:'long',timeZone:'UTC'});
 assert.equal(await page.locator('.rx-tl-title').textContent(),weekday,'day name as the big title');assert.doesNotMatch(await page.locator('.rx-tl-date').textContent(),new RegExp(weekday),'small date has no weekday');assert.match(await page.locator('.rx-tl-date').textContent(),/النهارده/);
 assert.equal(await page.locator('.rx-tl-wd').count(),7);assert.equal(await page.locator('.rx-tl-wd').first().locator('span').textContent(),'سبت');assert.equal(await page.locator('.rx-tl-wd.on').getAttribute('data-id'),today);assert.equal(await page.locator(`.rx-tl-wd[data-id="${tomorrow}"] i`).isHidden(),false);
 // Arrows are SVG (no bidi-mirrored characters): «previous» points right, «next» points left.
 assert.equal(await page.locator('.rx-tl-arrow svg').count(),4);assert.equal(await page.locator('.rx-tl-arrow[aria-label="الأسبوع اللي فات"] path').getAttribute('d'),'M9 6l6 6-6 6');
 const stats=await page.locator('.rx-tl-stat').evaluateAll(l=>l.map(b=>b.innerText.replace(/\s+/g,' ').trim()));assert.deepEqual(stats,['4 حجز','1 مؤكد','1 حضروا','0 لم يحضر']);
 // Line passes exactly through the centre of every dot (no drift).
 const drift=await page.locator('.rx-tl-hr').evaluateAll(l=>l.map(li=>{const d=li.querySelector('.rx-tl-dot').getBoundingClientRect(),r=li.querySelector('.rx-tl-rail'),cs=getComputedStyle(r,'::before'),rr=r.getBoundingClientRect();const lineX=rr.left+rr.width/2;return Math.abs((d.left+d.width/2)-lineX);}));assert(drift.every(x=>x<0.6),'line centred on dots: '+drift);
 // Calendar button between the arrows opens a date picker; choosing a date jumps there.
 const navOrder=await page.locator('.rx-tl-nav > *').evaluateAll(l=>l.map(x=>x.matches('.rx-tl-pickwrap')?'cal':x.getAttribute('aria-label')||x.textContent));assert.deepEqual(navOrder.slice(-4),['الأسبوع اللي فات','cal','الأسبوع الجاي','صوت التكة والاهتزاز']);
 await page.locator('[data-tl-pick]').evaluate((i,v)=>{i.value=v;i.dispatchEvent(new Event('change',{bubbles:true}));},tomorrow);await page.waitForFunction(t=>document.querySelector('.rx-tl-wd.on')&&document.querySelector('.rx-tl-wd.on').dataset.id===t,tomorrow);
 await page.locator(`.rx-tl-nav [data-id="${today}"]`).click();await page.waitForFunction(t=>document.querySelector('.rx-tl-wd.on').dataset.id===t,today);
 // Summary buttons: resting = outline in the status colour; selected/hover = filled with it.
 const look=sel=>page.locator(sel).evaluate(e=>{const c=getComputedStyle(e);return {border:c.borderTopColor,bg:c.backgroundColor,color:c.color};});
 const rest=await look('.rx-tl-stat[data-tl-stat="confirmed"]');assert.equal(rest.border,'rgb(47, 125, 92)');assert.equal(rest.color,'rgb(47, 125, 92)');assert.notEqual(rest.bg,'rgb(47, 125, 92)');
 assert.equal((await look('.rx-tl-stat[data-tl-stat="arrived"]')).border,'rgb(15, 54, 157)');assert.equal((await look('.rx-tl-stat[data-tl-stat="no_show"]')).border,'rgb(241, 90, 34)');
 const all=await look('.rx-tl-stat[data-tl-stat=""]');assert.equal(all.bg,'rgb(100, 116, 139)','«حجز» selected by default, filled gray');
 if(width===1280){await page.locator('.rx-tl-stat[data-tl-stat="confirmed"]').hover();await page.waitForTimeout(300);assert.equal((await look('.rx-tl-stat[data-tl-stat="confirmed"]')).bg,'rgb(47, 125, 92)','hover fills');if(process.env.RECEPTION_QA)await page.locator('.rx-tl-sum').screenshot({path:process.env.RECEPTION_QA+'/timeline-stats-hover.png'});await page.mouse.move(0,0);}
 // Summary buttons filter by status; tapping again shows all.
 await page.locator('.rx-tl-stat[data-tl-stat="confirmed"]').click();assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),1);assert.equal(await page.locator('[data-tl-status-filter]').inputValue(),'confirmed');
 await page.locator('.rx-tl-stat[data-tl-stat="confirmed"]').click();assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),4);
 await page.locator('.rx-tl-stat[data-tl-stat="arrived"]').click();assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),1);await page.locator('.rx-tl-stat[data-tl-stat=""]').click();
 // Scrolling grows the hour reaching the middle of the screen (no tick before the user scrolls).
 await page.evaluate(()=>{window.__ticks=0;const o=navigator.vibrate;navigator.vibrate=(...a)=>{window.__ticks++;return true;};});
 await page.locator('.rx-tl-hr[data-tl-hour="13"]').evaluate(e=>e.scrollIntoView({block:'center'}));await page.waitForFunction(()=>document.querySelector('.rx-tl-hr.focus'));
 assert.equal(await page.locator('.rx-tl-hr.focus').getAttribute('data-tl-hour'),'13');await page.waitForTimeout(450);
 const sc=await page.locator('.rx-tl-hr.focus .rx-tl-h').evaluate(e=>getComputedStyle(e).transform);assert.notEqual(sc,'none','focused hour scaled');const gap=await page.locator('.rx-tl-hr.focus').evaluate(li=>{const t=li.querySelector('.rx-tl-h').getBoundingClientRect(),d=li.querySelector('.rx-tl-dot').getBoundingClientRect();return t.left-d.right;});assert(gap>=2,'enlarged hour does not touch the dot: '+gap);if(process.env.RECEPTION_QA)await page.screenshot({path:process.env.RECEPTION_QA+'/timeline-focus-'+width+'.png'});
 await page.locator('.rx-tl-hr[data-tl-hour="10"]').evaluate(e=>e.scrollIntoView({block:'center'}));await page.waitForFunction(()=>document.querySelector('.rx-tl-hr.focus').dataset.tlHour==='10');assert((await page.evaluate(()=>window.__ticks))>=1,'vibration/tick fired on scroll');
 await page.locator('[data-tl-sound]').click();assert.equal(await page.locator('[data-tl-sound]').getAttribute('aria-pressed'),'false');await page.locator('[data-tl-sound]').click();
 // Hours to the right of the line, hour by hour 9→15, names only, cards closed.
 const hours=await page.locator('.rx-tl-hr').evaluateAll(l=>l.map(x=>x.dataset.tlHour));assert.deepEqual(hours,['9','10','11','12','13','14','15']);
 const hr=await page.locator('.rx-tl-hr').first().evaluate(li=>{const t=li.querySelector('.rx-tl-h').getBoundingClientRect(),d=li.querySelector('.rx-tl-dot').getBoundingClientRect(),n=li.querySelector('.rx-tl-names').getBoundingClientRect();return {t:t.left,d:d.left,n:n.left};});assert(hr.t>hr.d&&hr.d>hr.n,'time | dot | names from right to left');
 assert.equal(await page.locator('.rx-tl-hr.now').getAttribute('data-tl-hour'),'10');assert.equal(await page.locator('.rx-tl-card:not([hidden])').count(),0);
 assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),4,'cancelled hidden by default');
 const colour=async sel=>page.locator(sel).first().evaluate(e=>getComputedStyle(e.querySelector('i')).backgroundColor);
 assert.equal(await colour('.rx-tl-name.st-arrived'),'rgb(15, 54, 157)');assert.equal(await colour('.rx-tl-name.st-confirmed'),'rgb(47, 125, 92)');assert.notEqual(await colour('.rx-tl-name.st-booked'),await colour('.rx-tl-name.st-confirmed'));
 // Tap a name → its big card opens in its status colour; tap again closes.
 await page.locator('.rx-tl-name.st-confirmed').click();const card=page.locator('.rx-tl-card:not([hidden])');assert.equal(await card.count(),1);assert.equal(await card.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(47, 125, 92)');assert.match(await card.innerText(),/مؤكد/);
 if(process.env.RECEPTION_QA){await page.locator('.rx-tl-head').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:process.env.RECEPTION_QA+'/timeline-'+width+'.png'});}
 await page.locator('.rx-tl-name.st-confirmed').click();assert.equal(await page.locator('.rx-tl-card:not([hidden])').count(),0);
 // Two dropdowns side by side: الأطباء / الحالة; plus search that keeps focus.
 const pair=await page.locator('.rx-tl-pair label').evaluateAll(l=>l.map(x=>x.getBoundingClientRect().top));assert.equal(pair.length,2);assert(Math.abs(pair[0]-pair[1])<2,'side by side');
 await page.locator('[data-tl-status-filter]').selectOption('cancelled');assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),1);
 await page.locator('[data-tl-status-filter]').selectOption('');await page.locator('[data-tl-doctor-filter]').selectOption({index:1});assert.equal(await page.locator('.rx-tl-name:not([hidden])').count(),4);
 await page.locator('[data-tl-q]').fill('لا يوجد اسم كده');assert.equal(await page.locator('.rx-tl-nomatch').isHidden(),false);assert(await page.evaluate(()=>document.activeElement.matches('[data-tl-q]')));await page.locator('[data-tl-q]').fill('');
 // Actions still work from the opened card; card stays open after the redraw.
 await page.locator('.rx-tl-name.current').click();await page.locator('.rx-tl-card:not([hidden]) [data-rx-action="confirm"]').click();await page.waitForSelector('.rx-tl-card:not([hidden]).st-confirmed');
 // Other day.
 await page.locator(`.rx-tl-wd[data-id="${tomorrow}"]`).click();assert.match(await page.locator('.rx-tl-date').textContent(),/بكره/);assert.equal(await page.locator('.rx-tl-name').count(),1);
 await page.locator(`.rx-tl-nav [data-id="${today}"]`).click();assert.equal(await page.locator('.rx-tl-wd.on').getAttribute('data-id'),today);
 await page.locator('.rx-tl-fab').click();await page.waitForSelector('.rx-modal');assert.match(await page.locator('.rx-modal').innerText(),/حجز موعد/);await page.keyboard.press('Escape');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow '+width);assert.deepEqual(errors,[]);await page.close();await db.close();}
 console.log('PASS reception timeline at 1280/390: day name title, SVG arrows + calendar picker + sound toggle, line centred on dots, summary buttons filter, scroll focus grows hour with tick/vibration, week strip, hours right of the line 9→15, names coloured by status, tap opens card in status colour, الأطباء/الحالة side by side, search keeps focus, actions from card, «بكره», floating +, no overflow/errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
