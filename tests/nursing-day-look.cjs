// Nursing day list re-layout (owner «طبقه» 2026-11-22): groups, one main button by state, prep bar, stats, menu, phone order — mocked RPC.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const R=process.cwd()+'/';
const now=Date.now(),iso=m=>new Date(now+m*60000).toISOString();
const DAY={date:'2026-11-23',my_section:'physio',sections:['physio','dental','general'],appointments:[
{id:'a1',starts_at:iso(-40),section:'physio',patient_name:'يوسف أحمد محمود',file_no:'P-2026-000123',archive_patient_id:'x',service:'جلسة علاج طبيعي',doctor:'د. أحمد سمير',status:'arrived',queue_status:'in_service',ticket_no:2,triage:'recorded',prep:['سرير الجلسة جاهز','الأجهزة جاهزة','شرح الجلسة للمريض']},
{id:'a2',starts_at:iso(-10),section:'physio',patient_name:'منى سعيد',file_no:'P-2026-000210',archive_patient_id:'x',service:'جلسة علاج طبيعي',doctor:'د. أحمد سمير',status:'arrived',queue_status:'waiting',ticket_no:3,triage:'none',prep:['سرير الجلسة جاهز']},
{id:'a3',starts_at:iso(20),section:'physio',patient_name:'كريم حسن',file_no:'P-2026-000088',archive_patient_id:'x',service:'تقييم أول مرة',doctor:'د. أحمد سمير',status:'arrived',queue_status:'called',ticket_no:4,triage:'draft',prep:[]},
{id:'a4',starts_at:iso(60),section:'physio',patient_name:'سلمى إبراهيم',file_no:'P-2026-000301',archive_patient_id:'x',service:'جلسة علاج طبيعي',doctor:'د. أحمد سمير',status:'booked',queue_status:null,ticket_no:null,triage:'none',prep:[]},
{id:'a5',starts_at:iso(90),section:'physio',patient_name:'عمر خالد',file_no:'P-2026-000045',archive_patient_id:'x',service:'جلسة علاج طبيعي',doctor:'د. أحمد سمير',status:'booked',queue_status:null,ticket_no:null,triage:'none',prep:[]},
{id:'b1',starts_at:iso(30),section:'dental',patient_name:'هدى سمير',file_no:'P-2026-000177',archive_patient_id:'x',service:'متابعة تقويم',doctor:'د. سارة علي',status:'booked',queue_status:null,ticket_no:null,triage:'none',prep:[]}]};
const NOTES={unread:2,items:[{id:'n1',kind:'booking_today',title:'مريض حجز علاج طبيعي الساعة 3:30',appointment_id:'a4',created_at:iso(-5),read:false},{id:'n2',kind:'booking_today',title:'كريم حسن أول مرة — جهّز التقييم',appointment_id:'a3',created_at:iso(-30),read:false},{id:'n3',kind:'x',title:'منى سعيد وصلت',appointment_id:'a2',created_at:iso(-12),read:true}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{for(const [w,h] of [[1440,1000],[390,844]]){const p=await b.newPage({viewport:{width:w,height:h}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('https://n.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#EEF2F8;margin:0"><main style="max-width:1280px;margin:auto;padding:16px" id="m"></main></body></html>'}));
await p.route('**/*.woff2',r=>{const f=R+'assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
await p.goto('https://n.test/');await p.addStyleTag({content:fs.readFileSync(R+'assets/css/styles.css','utf8')});
await p.addScriptTag({content:`window.__D=${JSON.stringify({DAY,NOTES})};window.__calls=[];window.SSMPDRoles={hasAnyRole:()=>true};window.SSMPDAuth={currentAdmin:{roles:['nursing']}};window.SSMPDToast={show:()=>{}};window.SSMPDDb={client:{rpc:async(n,a)=>{const k=a.p_action;__calls.push(k);if(k==='day')return {data:__D.DAY,error:null};if(k==='notifications')return {data:__D.NOTES,error:null};if(k==='triage_get')return {data:{triage:{}},error:null};return {data:null,error:{message:'x'}};}}};window.SSMPDReceptionModules={sections:()=>[],panel:()=>''};`});
await p.addScriptTag({content:fs.readFileSync(R+'assets/js/nursing-day-ops.js','utf8')});
await p.evaluate(()=>{document.querySelector('#m').innerHTML=SSMPDReceptionModules.panel('nursing',{workspace:'w',data:{workspace:{mode:'live'}}});});await p.waitForSelector('.nd-pc');
const grp=await p.$$eval('[data-nd-list] > .nd-gh, [data-nd-list] > details',els=>els.map(e=>e.className.replace('nd-gh ','')));assert.deepEqual(grp,['now','in','later'],'groups in order (no done today)');
assert.equal(await p.locator('[data-nd-card="a2"] .nd-row > [data-nd="triage"]').innerText(),'الفحص قبل الكشف');
assert.equal(await p.locator('[data-nd-card="a3"] .nd-row > [data-nd="triage"]').innerText(),'استكمال الفحص');
assert.equal(await p.locator('[data-nd-card="a1"] .nd-row > [data-nd="open_file"]').count(),1,'inside + recorded → open file');
assert.equal(await p.locator('[data-nd-card="a4"] .nd-row > [data-nd="details"].p').innerText(),'جهّز الحجز');
assert.equal(await p.locator('[data-nd-card="a2"] .nd-chip.r').innerText(),'الفحص لسه');
assert((await p.locator('[data-nd-card="a2"] .nd-prep').innerText()).includes('1 من 3'));
assert.equal(await p.locator('[data-nd-stats] .nd-stat.r b').innerText(),'2','two arrived without a recorded triage');
const main=p.locator('[data-nd-card="a2"] .nd-btn.p');assert.equal(await main.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(22, 33, 46)');await main.hover();await p.waitForTimeout(300);assert.equal(await main.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(241, 90, 34)');
await p.locator('[data-nd-card="a2"] details.nd-menu summary').click();assert(await p.locator('[data-nd-card="a2"] .nd-pop [data-nd="details"]').isVisible());await p.keyboard.press('Escape');assert.equal(await p.locator('details.nd-menu[open]').count(),0);
await p.locator('[data-nd-card="a2"] details.nd-menu summary').click();await p.locator('#m').click({position:{x:5,y:5}});assert.equal(await p.locator('details.nd-menu[open]').count(),0,'outside click closes');
const fit=await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(fit,'no sideways scroll at '+w);
if(w<500){const top=await p.evaluate(()=>[document.querySelector('[data-nd-notes]').getBoundingClientRect().top,document.querySelector('[data-nd-list]').getBoundingClientRect().top]);assert(top[0]<top[1],'alerts above the list on phones');}
if(process.env.ND_QA)await p.screenshot({path:process.env.ND_QA+'/nd-built-'+w+'.png',fullPage:true});
await p.locator('[data-nd-card="a3"] .nd-row > [data-nd="triage"]').click();await p.waitForSelector('[data-nd-form]');const sv=p.locator('[data-nd="save_rec"]');assert.equal(await sv.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(22, 33, 46)','triage main button follows the dark rule');
assert.deepEqual(errors,[]);await p.close();}
console.log('PASS nursing day look 1440/390: groups now/in/later, one main button by state (triage / استكمال الفحص / open file / جهّز الحجز), missing-triage tag + stat, prep bar, dark→orange main button incl. triage save, ⋯ menu closes on Escape/outside, alerts first on phones, no overflow or page errors.');}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
