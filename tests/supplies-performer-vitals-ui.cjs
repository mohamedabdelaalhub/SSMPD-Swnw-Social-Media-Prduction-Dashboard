// Supplies at service PR2 — rule 9 (every new button clicked as the real role, LIVE workspace, mocked RPC, sample data only).
// Browser (Playwright) at 1280 and 390:
//  1) nursing: «تشغيل اليوم — التمريض» → «تنفيذ وتسجيل المستلزمات» → − / + → reason when a line is 0 → «نفّذت ✓»
//     (clinic_reception_performer execute), «+ مستلزم تاني (بحث)» → pick → «المريض وافق» required → store «بصرف من» → «نفّذت ✓»,
//     «بدون مستلزمات (سبب)» → «تأكيد بدون مستلزمات» (reason required) / «رجوع», bar «رجوع». No «طقم الفيتلة» for a nurse.
//  2) «الفحص قبل الكشف»: «اتقاس / رفض / متعملش» per vital, kit preview, store, «حفظ وإبلاغ الدكتور» sends vital_states +
//     kit_location_id; a stock warning is shown and does not block.
//  3) head nursing: «طقم الفيتلة» → «+ مستلزم للقياس» → ✕ → «حفظ الطقم» (clinic_reception_vitals_kit save) → «رجوع».
//  4) doctor assistant (nursing screen) and doctor (section «تنفيذ وتسجيل المستلزمات» in الاستقبال والخدمات) execute too;
//     reception gets no section; trial workspace gets nothing. No sideways scroll at 390.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const R=path.resolve(__dirname,'..')+'/';
const now=Date.now(),iso=m=>new Date(now+m*60000).toISOString();
const BOM=[{item_id:'GLV',item:'جلافز',unit:'قطعة',quantity:2,billable:false,sale_price:2},{item_id:'ANS',item:'كارتريدج بنج',unit:'قطعة',quantity:1,billable:true,sale_price:15}];
const ord=(id,st,extra)=>Object.assign({id,visit_id:'v'+id,status:st,visit_status:'open',name:'أسنان — حشو عصب',department:'الاسنان',section:'dental',quantity:1,patient_name:'مريض تجريبي '+id,file_no:'F-10'+id.slice(1),starts_at:iso(10),doctor:'د. أسنان تجريبي',can_execute:st==='ordered',bom:BOM},extra||{});
const TODAY={date:new Date(now).toISOString().slice(0,10),me:'هدى حمدى ابراهيم',scope:{all:false,sections:['dental'],departments:[]},
 locations:[{id:'L-D',name:'رئيسي أسنان'},{id:'L-M',name:'رئيسي أدوية'}],
 items:[{id:'GLV',name:'جلافز',unit:'قطعة',sale_price:2,billable:false},{id:'ANS',name:'كارتريدج بنج',unit:'قطعة',sale_price:15,billable:true},{id:'CTN',name:'قطن',unit:'قطعة',sale_price:1,billable:false}],
 orders:[ord('o0','completed',{name:'أسنان — كشف',completed_at:iso(-30)}),ord('o1','ordered'),ord('o2','ordered'),ord('o3','ordered')]};
const DAY={date:TODAY.date,my_section:'dental',sections:['dental'],appointments:[{id:'a1',starts_at:iso(-5),section:'dental',patient_name:'مريضة تجريبية',file_no:'F-1102',archive_patient_id:'x',service:'أسنان — حشو عصب',doctor:'د. أسنان تجريبي',status:'arrived',queue_status:'waiting',ticket_no:3,triage:'none',prep:[]}]};
const KIT={kit:[{vital:'sugar',item_id:'LNC',item:'شكاكة سكر',unit:'قطعة',quantity:1},{vital:'sugar',item_id:'STR',item:'شريحة سكر',unit:'قطعة',quantity:1},{vital:'temp',item_id:'TCV',item:'غطا ترمومتر',unit:'قطعة',quantity:1},{vital:'spo2',item_id:'CTN',item:'قطن',unit:'قطعة',quantity:1}],locations:[{id:'L-D',name:'رئيسي أسنان'},{id:'L-M',name:'رئيسي أدوية'}],consumed:[]};
const EDIT={workspace_id:'w',kit:[{vital:'temp',item_id:'TCV',item:'غطا ترمومتر',unit:'قطعة',quantity:1}],items:[{id:'CTN',name:'قطن',unit:'قطعة'},{id:'TCV',name:'غطا ترمومتر',unit:'قطعة'}]};
function mock(D){return `window.__D=${JSON.stringify(D)};window.__calls=[];window.__t=[];window.SSMPDToast={show:(m,k)=>__t.push([m,k||'success'])};
 window.SSMPDRoles={hasAnyRole:(a,l)=>(a.roles||[]).some(r=>l.includes(r))};
 window.SSMPDDb={client:{rpc:async(n,a)=>{__calls.push([n,a.p_action,JSON.parse(JSON.stringify(a.p_payload||{})),a.p_workspace]);const k=a.p_action;
  if(n==='clinic_reception_performer'){if(k==='today')return {data:__D.TODAY,error:null};if(k==='execute'){const o=__D.TODAY.orders.find(x=>x.id===a.p_payload.order_id);o.status='completed';o.can_execute=false;return {data:{id:o.id,order_id:o.id,invoice_amount:330},error:null};}}
  if(n==='clinic_reception_vitals_kit'){if(k==='list')return {data:__D.EDIT,error:null};if(k==='save')return {data:Object.assign({},__D.EDIT,{kit:a.p_payload.lines.map(l=>Object.assign({item:'قطن',unit:'قطعة'},l))}),error:null};}
  if(n==='clinic_reception_nursing'){if(k==='day')return {data:__D.DAY,error:null};if(k==='notifications')return {data:{unread:0,items:[]},error:null};
   if(k==='triage_get')return {data:{triage:{bp_sys:120,bp_dia:80,vital_states:{bp:'measured'}},vitals_kit:__D.KIT},error:null};
   if(k==='triage_save')return {data:{ok:true,status:a.p_payload.status,revision:2,vitals:{warnings:[{vital:'temp',message:'مفيش رصيد كفاية من مستلزمات الطقم في مخزن القسم'}]}},error:null};return {data:null,error:{message:'x'}};}
  return {data:null,error:{message:'unexpected '+n}};}}};
 window.SSMPDReceptionModules={sections:()=>[['journey','x','y']],panel:()=>'<p>j</p>'};`;}
const fit=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
const calls=async(p,a)=>(await p.evaluate(()=>__calls)).filter(c=>!a||c[1]===a);
const toasts=p=>p.evaluate(()=>__t);
async function page(b,w,h,roles){const p=await b.newPage({viewport:{width:w,height:h}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://n.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#EEF2F8;margin:0"><main style="max-width:1280px;margin:auto;padding:16px" id="m"></main></body></html>'}));
 await p.route('**/*.woff2',r=>{const f=R+'assets/fonts/'+path.basename(new URL(r.request().url()).pathname);return fs.existsSync(f)?r.fulfill({path:f,contentType:'font/woff2'}):r.abort();});
 await p.goto('https://n.test/');await p.addStyleTag({content:fs.readFileSync(R+'assets/css/styles.css','utf8')});
 await p.addScriptTag({content:mock({TODAY:JSON.parse(JSON.stringify(TODAY)),DAY,KIT,EDIT})+`window.SSMPDAuth={currentAdmin:{roles:${JSON.stringify(roles)}}};`});
 for(const f of ['nursing-day-ops','performer-supplies'])await p.addScriptTag({content:fs.readFileSync(R+'assets/js/'+f+'.js','utf8')});
 p.errors=errors;return p;}
const nursing=async p=>{await p.evaluate(()=>{document.querySelector('#m').innerHTML=SSMPDReceptionModules.panel('nursing',{workspace:'w-live',data:{workspace:{mode:'live'}}});});await p.waitForSelector('.nd-pc');};
const line=(o,i)=>'[data-pf-order="'+o+'"] [data-pf-line="'+o+'|'+i+'"]';
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{
for(const [w,h] of [[1280,900],[390,844]]){
 // 1) nursing — performer screen from the nursing day screen
 let p=await page(b,w,h,['nursing']);await nursing(p);
 assert.equal(await p.locator('[data-nd="kit"]').count(),0,'no kit editor for a nurse');
 await p.click('[data-nd="performer"]');await p.waitForSelector('[data-pf-order="o1"] [data-pf="exec"]');
 assert.match(await p.textContent('.ps-bar'),/تنفيذ وتسجيل المستلزمات[\s\S]*هدى حمدى ابراهيم/);
 assert.equal(await p.locator('[data-pf-order="o0"][data-done="1"]').count(),1);assert.equal(await p.locator('[data-pf-order="o0"]').evaluate(e=>getComputedStyle(e).opacity),'0.6','executed = dimmed ✓');
 assert.match(await p.textContent(line('o1','GLV')),/في سعر الخدمة/);assert.match(await p.textContent(line('o1','ANS')),/بيتحاسب 15 ج\.م/);
 assert.equal(await p.textContent('[data-pf-total="o1"]'),'15 ج.م');assert(await fit(p),'no sideways scroll on the performer screen at '+w);
 if(process.env.SHOTS)await p.screenshot({path:path.join(process.env.SHOTS,'performer-'+w+'.png'),fullPage:true});
 await p.click(line('o1','ANS')+' [data-pf="inc"]');assert.equal(await p.textContent('[data-pf-total="o1"]'),'30 ج.م');
 await p.click(line('o1','GLV')+' [data-pf="dec"]');await p.click(line('o1','GLV')+' [data-pf="dec"]');assert.equal(await p.textContent(line('o1','GLV')+' .ps-q b'),'0');
 await p.click('[data-pf-order="o1"] [data-pf="exec"]');assert.equal((await calls(p,'execute')).length,0,'a 0 line needs a reason');assert.match((await toasts(p)).pop()[0],/اكتب سبب/);
 await p.fill('[data-pf-note="o1"]','الجلافز خلصت من الأوضة');await p.click('[data-pf-order="o1"] [data-pf="exec"]');await p.waitForSelector('[data-pf-order="o1"][data-done="1"]');
 let c=(await calls(p,'execute'))[0];assert.equal(c[0],'clinic_reception_performer');assert.equal(c[3],'w-live');
 assert.deepEqual({o:c[2].order_id,l:c[2].location_id,m:c[2].materials,n:c[2].material_note,a:c[2].patient_agreed},{o:'o1',l:'L-D',m:[{item_id:'GLV',quantity:0},{item_id:'ANS',quantity:2}],n:'الجلافز خلصت من الأوضة',a:false});assert(c[2].token);
 assert.match((await toasts(p)).pop()[0],/اتنفذت «أسنان — حشو عصب» — الفاتورة 330 ج\.م/);
 // extra item (search) + consent + store
 await p.click('[data-pf-order="o2"] [data-pf="add"]');await p.fill('[data-pf-search="o2"]','قطن');await p.click('[data-pf-order="o2"] [data-pf="pick"][data-item="CTN"]');
 assert.match(await p.textContent(line('o2','CTN')),/زيادة بيتحاسب 1 ج\.م/);assert.equal(await p.textContent('[data-pf-total="o2"]'),'16 ج.م');
 await p.click('[data-pf-order="o2"] [data-pf="exec"]');assert.equal((await calls(p,'execute')).length,1);assert.match((await toasts(p)).pop()[0],/المريض وافق/);
 await p.check('[data-pf-agree="o2"]');await p.selectOption('[data-pf-store]','L-M');await p.click('[data-pf-order="o2"] [data-pf="exec"]');await p.waitForSelector('[data-pf-order="o2"][data-done="1"]');
 c=(await calls(p,'execute'))[1];assert.equal(c[2].patient_agreed,true);assert.equal(c[2].location_id,'L-M');assert.deepEqual(c[2].materials.map(x=>x.item_id+':'+x.quantity),['GLV:2','ANS:1','CTN:1']);
 // «بدون مستلزمات (سبب)»
 await p.click('[data-pf-order="o3"] [data-pf="none"]');await p.click('[data-pf-order="o3"] [data-pf="none_back"]');assert.equal(await p.locator('[data-pf-reason="o3"]').count(),0);
 await p.click('[data-pf-order="o3"] [data-pf="none"]');await p.click('[data-pf-order="o3"] [data-pf="none_go"]');assert.equal((await calls(p,'execute')).length,2,'reason required');
 await p.fill('[data-pf-reason="o3"]','المريض رفض البنج');await p.click('[data-pf-order="o3"] [data-pf="none_go"]');await p.waitForSelector('[data-pf-order="o3"][data-done="1"]');
 c=(await calls(p,'execute'))[2];assert.deepEqual({n:c[2].no_materials,r:c[2].material_note,o:c[2].order_id},{n:true,r:'المريض رفض البنج',o:'o3'});
 if(process.env.SHOTS)await p.screenshot({path:path.join(process.env.SHOTS,'performer-done-'+w+'.png'),fullPage:true});
 await p.click('[data-pf="back"]');await p.waitForSelector('.nd-pc');
 // 2) triage vitals
 await p.click('[data-nd-card="a1"] .nd-row > [data-nd="triage"]');await p.waitForSelector('[data-nd-vital="sugar"]');
 assert.equal(await p.getAttribute('[data-nd-vital="bp"]','data-state'),'measured');
 assert.match(await p.textContent('[data-nd-kit]'),/هيتخصم مع «حفظ وإبلاغ الدكتور» من[\s\S]*مش على فاتورة المريض/);
 await p.fill('[name="sugar_mgdl"]','140');await p.click('[data-nd-vital="sugar"] [data-v="refused"]');
 assert.equal(await p.locator('[name="sugar_mgdl"]').isDisabled(),true);assert.equal(await p.inputValue('[name="sugar_mgdl"]'),'');
 assert.match(await p.textContent('[data-nd-kitrow="sugar"]'),/مش هيتخصم — رفض/);
 await p.click('[data-nd-vital="spo2"] [data-v="not_done"]');assert.match(await p.textContent('[data-nd-kitrow="spo2"]'),/مش هيتخصم — متعملش/);
 await p.click('[data-nd-vital="temp"] [data-v="measured"]');await p.fill('[name="temp_c"]','37.2');
 await p.selectOption('[data-nd-kitloc]','L-M');assert(await fit(p),'no sideways scroll on the triage form at '+w);
 if(process.env.SHOTS)await p.screenshot({path:path.join(process.env.SHOTS,'vitals-'+w+'.png'),fullPage:true});
 await p.click('[data-nd="save_rec"]');await p.waitForSelector('.nd-pc');
 c=(await calls(p,'triage_save'))[0];assert.deepEqual(c[2].vital_states,{bp:'measured',pulse:'not_done',temp:'measured',spo2:'not_done',weight:'not_done',sugar:'refused'});
 assert.equal(c[2].sugar_mgdl,null);assert.equal(c[2].temp_c,37.2);assert.equal(c[2].bp_sys,120);assert.equal(c[2].kit_location_id,'L-M');assert.equal(c[2].status,'recorded');
 assert((await toasts(p)).some(t=>t[1]==='warning'&&/متخصمتش: مفيش رصيد/.test(t[0])),'stock warning shown');
 assert.deepEqual(p.errors,[]);await p.close();
 // 3) head nursing — kit editor
 p=await page(b,w,h,['head_nursing']);await nursing(p);await p.click('[data-nd="kit"]');await p.waitForSelector('[data-kit-vital="sugar"] [data-kit="add"]');
 assert.match(await p.textContent('.ps-bar'),/طقم الفيتلة — بتظبطه رئيسة التمريض/);
 await p.click('[data-kit-vital="sugar"] [data-kit="add"]');await p.selectOption('[data-kit-vital="sugar"] [data-kit-item]','CTN');await p.fill('[data-kit-vital="sugar"] [data-kit-qty]','2');
 await p.click('[data-kit-vital="temp"] [data-kit="del"]');assert(await fit(p),'kit editor fits at '+w);
 if(process.env.SHOTS)await p.screenshot({path:path.join(process.env.SHOTS,'vitals-kit-'+w+'.png'),fullPage:true});
 await p.click('[data-kit="save"]');await p.waitForFunction(()=>__t.some(t=>t[0]==='اتحفظ طقم الفيتلة'));
 c=(await calls(p,'save'))[0];assert.equal(c[0],'clinic_reception_vitals_kit');assert.deepEqual(c[2],{lines:[{vital:'sugar',item_id:'CTN',quantity:2}]});
 await p.click('.ps-bar [data-kit="back"]');await p.waitForSelector('.nd-pc');assert.deepEqual(p.errors,[]);await p.close();
 // 4) doctor assistant (nursing screen) and doctor (reception section)
 p=await page(b,w,h,['doctor_assistant']);await nursing(p);assert.equal(await p.locator('[data-nd="kit"]').count(),0);
 await p.click('[data-nd="performer"]');await p.waitForSelector('[data-pf-order="o1"] [data-pf="exec"]');await p.click('[data-pf-order="o1"] [data-pf="exec"]');await p.waitForSelector('[data-pf-order="o1"][data-done="1"]');
 assert.equal((await calls(p,'execute'))[0][2].order_id,'o1');assert.deepEqual(p.errors,[]);await p.close();
 p=await page(b,w,h,['sono_doctor']);
 const sec=await p.evaluate(()=>{const live={workspace:'w-live',data:{workspace:{mode:'live'}}},trial={workspace:'w-t',data:{workspace:{mode:'trial'}}};return {live:SSMPDReceptionModules.sections(live).map(r=>r[0]),trial:SSMPDReceptionModules.sections(trial).map(r=>r[0]),tp:SSMPDReceptionModules.panel('performer',trial)};});
 assert(sec.live.includes('performer'));assert(!sec.trial.includes('performer'));assert.equal(sec.tp,'');
 await p.evaluate(()=>{document.querySelector('#m').innerHTML=SSMPDReceptionModules.panel('performer',{workspace:'w-live',data:{workspace:{mode:'live'}}});});
 await p.waitForSelector('[data-pf-order="o2"] [data-pf="exec"]');assert.equal(await p.locator('[data-pf="back"]').count(),0,'no back inside its own section');
 await p.click('[data-pf-order="o2"] [data-pf="exec"]');await p.waitForSelector('[data-pf-order="o2"][data-done="1"]');assert.equal((await calls(p,'execute'))[0][2].order_id,'o2');assert.deepEqual(p.errors,[]);await p.close();
 p=await page(b,w,h,['reception']);assert(!(await p.evaluate(()=>SSMPDReceptionModules.sections({workspace:'w',data:{workspace:{mode:'live'}}}).map(r=>r[0]))).includes('performer'),'reception: no performer section');await p.close();
}
console.log('PASS supplies PR2 UI (1280 + 390, live, mocked RPC): nursing → «تنفيذ وتسجيل المستلزمات» − / + / reason / «نفّذت ✓» / «+ مستلزم تاني (بحث)» + «المريض وافق» + «بصرف من» / «بدون مستلزمات (سبب)» → «تأكيد» / «رجوع» / bar «رجوع» (clinic_reception_performer execute payloads); «الفحص قبل الكشف» اتقاس / رفض / متعملش + kit preview + store → triage_save vital_states + kit_location_id, stock warning shown; head nursing «طقم الفيتلة» + / ✕ / «حفظ الطقم» / «رجوع» (clinic_reception_vitals_kit save); doctor assistant + doctor execute; reception / trial get nothing; no sideways scroll; no page errors.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
