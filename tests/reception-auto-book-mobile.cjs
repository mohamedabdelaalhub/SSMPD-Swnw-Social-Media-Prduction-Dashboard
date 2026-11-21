// الحجوزات التلقائية على الموبايل: أسماء/تليفونات طويلة من غير مسافات مايوسّعوش الصفحة (بلاغ المالك 2026-11-21)
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const idx=fs.readFileSync('index.html','utf8');
const CSS=[...idx.matchAll(/href="(assets\/css\/[^"?]+)/g)].map(m=>m[1]);
const ORDER=['roles','ui-titles','reception-shared','reception-bridge','reception-service-orders','reception-controls','reception-services','reception-patient-search','reception-fallback','reception-auto-book','reception-patient-documents','reception-patient-extras','reception-overbook','reception-booking-plus','reception-same-patient','reception-workspace','reception-shift-reminder','reception-doctor-payout','today-operations-sandbox','today-operations','today-operations-consistency','today-operations-display','today-operations-unified','today-operations-finalize','today-operations-queue','nursing-day-ops','nursing-triage-strip','clinical-drafts'];
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{for(const W of [390,360])for(const STRESS of [false,true]){
 const {rpc}=await boot();const page=await browser.newPage({viewport:{width:W,height:900},timezoneId:'Africa/Cairo'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('rxRpc',rpc);
 await page.route('https://reception.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="app-shell"><main class="view" id="root"></main></div></body></html>'}));
 await page.goto('https://reception.test/');
 for(const f of CSS){try{await page.addStyleTag({content:fs.readFileSync(f,'utf8')});}catch(e){}}
 const day=new Date().toISOString().slice(0,10);
 const nm=STRESS?'a'.repeat(70):'محمد عبدالرحمن';
 const rows=[...Array.from({length:6},(_,i)=>({id:'r'+i,source:['masa','whatsapp','portal','website'][i%4],state:'needs_time',day,customer_name:nm+i,phone:'+20 101 234 5678',age:34,patient_code:'P-2026-00000'+i,doctor_name:STRESS?'Dr.'+'b'.repeat(60):'د. هبة',day_only:true})),
  ...Array.from({length:3},(_,i)=>({id:'t'+i,source:'masa',state:'booked',day,customer_name:'x',appointment_id:'a'+i}))];
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'me',role:'super_admin',roles:['super_admin'],name:'محمد'}};window.SSMPDNavState={once:function(){return {section:'appointments'};},set:function(){}};window.SSMPDDb={receptionBootstrap:()=>rxRpc('clinic_reception_bootstrap'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}).then(function(r){r.workspace.mode='live';return r;}),receptionCommand:()=>Promise.resolve({}),client:{rpc:function(n,a){if(n==='clinic_reception_auto_book')return Promise.resolve({data:a.p_action==='list'?{enabled:true,synced_at:new Date().toISOString(),rows:${JSON.stringify(rows)}}:{}});return Promise.resolve({data:null,error:null});}}};localStorage.setItem('ssmpd_rx_guide_seen','1');`});
 for(const f of ORDER){try{await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});}catch(e){errors.push('LOAD '+f);}}
 await page.evaluate(()=>{SSMPDReception.render(document.querySelector('#root'));});
 await page.waitForTimeout(3500);
 try{await page.locator('[data-guide-skip]').click({timeout:1500});}catch(e){}
 try{await page.locator('[data-ab-open="times"]').click({timeout:3000});await page.waitForTimeout(300);}catch(e){}
 const r=await page.evaluate(()=>{const vw=document.documentElement.clientWidth,out=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&(b.right>vw+2||b.left<-2)&&getComputedStyle(e).position!=='fixed')out.push([e.tagName+'.'+String(e.className).slice(0,40),Math.round(b.left),Math.round(b.right),Math.round(b.width)]);});return {vw,sw:document.documentElement.scrollWidth,autob:!!document.querySelector('.rx-ab-modal .rx-ab-time'),over:out.slice(0,12)};});
 assert.ok(r.autob,'auto-book rows rendered');assert.equal(r.sw,r.vw,'no horizontal overflow at '+W+(STRESS?' (stress)':'')+': '+JSON.stringify(r.over.slice(0,3)));assert.deepEqual(errors.filter(e=>!/Unexpected token/.test(e)),[]);await page.close();}
 console.log('PASS reception auto-book on phones (390/360): long unbroken names, doctor names and phones wrap and never widen the page.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
