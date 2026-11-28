// Owner 2026-11-28 «موافق على تصليح التحصيل» (mockup collect-visit-split.html, the Amina bug): in a REAL browser, as a RECEPTION user in a
// LIVE workspace, the real «تشغيل اليوم» card button «حصّل 1,800» of a visit with FIVE open invoices opens the real «تسجيل تحصيل»
// (real reception-services.js collect handler + the shared modal of reception-workspace.js) with all five ticked, amount = 1,800,
// and saving sends collect_multi with the five invoices. Untick → amount follows; a bigger amount → the orange excess line, and saving asks
// «ضيفهم للتحصيل» / «لا — خليها رصيد للمريض» / «رجوع». «تحصيل» from the invoices table (no «حصّل») stays a single-invoice collect.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const WS=fs.readFileSync('assets/js/reception-workspace.js','utf8').split('\n');const mi=WS.findIndex(l=>l.startsWith('function modal(title,body,save,onSaved,opts)'));const MODAL=WS.slice(mi,mi+3).join('\n');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const INV=[['i1','كشف أسنان',400],['i2','حشو عصب',600],['i3','أشعة بانوراما',400],['i4','تنضيف جير',250],['i5','مستلزمات',150]];
const model={day,settings:{max_wait_minutes:20},can_view_finance:true,doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[
 {id:'a5',patient_id:'p5',patient_name:'مريضة تجريبية',file_no:'P-2026-000777',phone:'01000000000',provider_id:'d1',provider_name:'د. تجريبي',department:'أسنان',service_name:'كشف أسنان',
  starts_at:new Date(Date.now()-3600000).toISOString(),queue_status:'completed',priority:0,wait_minutes:0,visit_id:'v5',can_view_finance:true,patient_due:1800,patient_payable_total:1800,
  due_invoices:INV.map(x=>({id:x[0],invoice_no:'INV-'+x[0],due:x[2]}))}]};
const data={workspace:{id:'ws1',mode:'live'},patients:[{id:'p5',name:'مريضة تجريبية',file_no:'P-2026-000777',phone:'01000000000'}],family_links:[],packages:[],
 invoices:INV.map(x=>({id:x[0],patient_id:'p5',visit_id:'v5',description:x[1],amount:x[2],due:x[2],invoice_no:'INV-'+x[0]})).concat([{id:'o1',patient_id:'p9',description:'كشف مريض تاني',amount:300,due:300}]),
 shifts:[{id:'s1',register_id:'r1',cashier_id:'u1',status:'open',ended_at:null}],registers:[{id:'r1',name:'خزينة الاستقبال'}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});try{
for(const width of [1280,390]){const p=await b.newPage({viewport:{width,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="host"></main></body></html>'}));await p.goto('https://reception.test/');
 for(const f of ['styles','reception-workspace'])await p.addStyleTag({path:'assets/css/'+f+'.css'}).catch(()=>{});
 await p.evaluate(([model,data])=>{window.__cmd=[];window.SSMPDAuth={currentAdmin:{id:'u1',role:'reception'}};
  window.SSMPDRoles={rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDToast={show:()=>{}};
  window.SSMPDDb={client:{rpc:(n)=>Promise.resolve(n==='clinic_reception_journey_hub_snapshot'?{data:JSON.parse(JSON.stringify(model)),error:null}:{data:null,error:{message:'unexpected '+n}})}};
  window.__data=data;},[model,data]);
 await p.addScriptTag({content:'var esc=function(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});};var friendly=function(e){return e;};var host=null;var load=function(){};'+MODAL+';window.__modal=modal;'});
 for(const f of ['payment-proof','collect-visit','reception-services','today-operations'])await p.addScriptTag({path:'assets/js/'+f+'.js'});
 await p.evaluate(()=>{const d=window.__data,E=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const host=document.querySelector('#host'),ctx={host,workspace:'ws1',from:d.day,to:d.day,data:d,esc:E,money:v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2})+' ج.م',
   lookup:(l,id,k)=>{const r=(d[l]||[]).find(x=>x.id===id);return r?r[k||'name']:'—';},btn:(a,l)=>'<button type="button" data-rx-action="'+a+'">'+l+'</button>',
   field:(n,t,type,v,extra)=>'<label>'+E(t)+'<input name="'+n+'" type="'+(type||'text')+'" value="'+E(v==null?'':v)+'" '+(extra||'required')+'></label>',
   select:(n,t,rows,ch)=>'<label>'+E(t)+'<select name="'+n+'" required><option value="">اختر</option>'+rows.map(r=>'<option value="'+E(r[0])+'"'+(r[0]===ch?' selected':'')+'>'+E(r[1])+'</option>').join('')+'</select></label>',
   modal:window.__modal,command:(a,pl,k)=>{window.__cmd.push([a,JSON.parse(JSON.stringify(pl)),k]);return Promise.resolve({id:'pay1',receipt_no:'RC-2026-000001'});}};
  window.__ctx=ctx;host.innerHTML=window.SSMPDReceptionModules.panel('journey',ctx);});
 await p.waitForSelector('.journey-board',{timeout:8000});assert.match(await p.locator('.journey-main-collect').first().textContent(),/حصّل 1,800/,'the card says the visit total');
 const btn=p.locator('[data-journey-action="collect_due"]:visible').first();await btn.waitFor({timeout:8000});
 await btn.click();await p.waitForSelector('.rx-modal [data-cv]');
 const cv=p.locator('.rx-modal [data-cv]');assert.equal(await cv.locator('[data-cv-inv]').count(),5,'five visit invoices');assert.equal(await cv.locator('[data-cv-inv]:checked').count(),5,'all ticked');
 assert.equal(await p.inputValue('.rx-modal [name="amount"]'),'1800','amount = visit total');assert.match(await cv.textContent(),/الإجمالي1,800/);
 assert.match(await cv.locator('[data-cv-split]').textContent(),/كشف أسنان 400 · حشو عصب 600 · أشعة بانوراما 400 · تنضيف جير 250 · مستلزمات 150/);
 assert.equal(await p.locator('.rx-modal .modal-close').count(),1,'✕ on the window');
 assert.equal(await p.locator('.rx-modal [data-rx-multi-row]:visible').count(),0,'the visit invoices are not listed twice');
 if(process.env.SHOT){await p.screenshot({path:process.env.SHOT+'/collect-visit-'+width+'.png',fullPage:true});}
 // untick one → amount follows
 await cv.locator('[data-cv-inv][value="i4"]').uncheck();assert.equal(await p.inputValue('.rx-modal [name="amount"]'),'1550');
 // amount bigger → orange line; save asks; «رجوع» keeps the window; «ضيفهم للتحصيل» ticks all back
 await p.fill('.rx-modal [name="amount"]','1800');assert.match(await cv.locator('[data-cv-excess]').textContent(),/250[\s\S]*رصيد للمريض/);
 await p.selectOption('.rx-modal [name="method"]','cash').catch(()=>{});await p.fill('.rx-modal [name="reference"]','CASH-1').catch(()=>{});
 await p.locator('.rx-modal button[type="submit"]').click();await p.waitForSelector('.rx-modal [data-cv-ask]:not([hidden])');assert.equal((await p.evaluate(()=>window.__cmd)).length,0,'nothing saved before the answer');
 assert.match(await cv.locator('[data-cv-ask]').textContent(),/تنضيف جير 250/);
 await cv.locator('[data-cv-back]').click();assert.equal(await cv.locator('[data-cv-ask]').isHidden(),true);
 await p.locator('.rx-modal button[type="submit"]').click();await cv.locator('[data-cv-add]').click();assert.equal(await cv.locator('[data-cv-inv]:checked').count(),5);assert.equal(await cv.locator('[data-cv-excess]').isHidden(),true);
 // save → collect_multi with the five invoices, the opened one first
 await p.locator('.rx-modal button[type="submit"]').click();await p.waitForSelector('.rx-modal',{state:'detached',timeout:5000}).catch(async e=>{console.log('STATUS',await p.textContent('.rx-modal [data-rx-status]'));throw e;});
 let cmd=(await p.evaluate(()=>window.__cmd)).pop();assert.equal(cmd[0],'collect_multi');assert.deepEqual(cmd[1].invoice_ids,['i1','i2','i3','i4','i5']);assert.equal(+cmd[1].amount,1800);assert.equal(cmd[1].one_payer,undefined);
 // «لا — خليها رصيد للمريض»: 2 ticked + more money → saves with the extra as credit
 await p.evaluate(()=>{document.querySelector('#host').innerHTML=window.SSMPDReceptionModules.panel('journey',window.__ctx);});await btn.waitFor();await btn.click();await p.waitForSelector('.rx-modal [data-cv]');
 for(const v of ['i3','i4','i5'])await cv.locator('[data-cv-inv][value="'+v+'"]').uncheck();await p.selectOption('.rx-modal [name="method"]','cash').catch(()=>{});await p.fill('.rx-modal [name="reference"]','CASH-2').catch(()=>{});await p.fill('.rx-modal [name="amount"]','1200');
 await p.locator('.rx-modal button[type="submit"]').click();await cv.locator('[data-cv-credit]').click();await p.waitForSelector('.rx-modal',{state:'detached',timeout:5000});
 cmd=(await p.evaluate(()=>window.__cmd)).pop();assert.equal(cmd[0],'collect_multi');assert.deepEqual(cmd[1].invoice_ids,['i1','i2']);assert.equal(+cmd[1].amount,1200);
 // «تحصيل» from the invoices table: unchanged single collect (no visit block)
 await p.evaluate(()=>window.SSMPDReceptionModules.act('collect-invoice','i3',window.__ctx));await p.waitForSelector('.rx-modal');assert.equal(await p.locator('.rx-modal [data-cv]').count(),0,'no visit block from the table');
 await p.locator('.rx-modal .modal-close').click();
 const ov=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(ov<=0,'no overflow '+width);
 assert(!errors.length,errors.join('\n'));await p.close();}
console.log('PASS «حصّل» on a visit with five invoices (reception, live): all ticked, amount = total, split line, untick follows, excess line + «رجوع» / «ضيفهم للتحصيل» / «لا — خليها رصيد للمريض», collect_multi with the five, table «تحصيل» unchanged, ✕, 1280 + 390.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
