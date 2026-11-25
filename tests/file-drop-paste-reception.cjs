// Same flow as booking-payer-kind-ui.cjs (reception «صورة الكارنيه» / approval photos), but the photos arrive by PASTE into the new drop zone
// (or DROP on the button for hidden inputs) from assets/js/file-drop-paste.js instead of the file picker: the existing upload code must accept them unchanged.
// 20261123070000 «طريقة الدفع» (owner 2026-11-23 «طبقه»): end to end in a real browser on the real reception screen and the real
// server functions (PGlite), as a RECEPTION user in a LIVE workspace. Every new / changed button is clicked:
//   «حجز موعد»: the mandatory field comes first (no save without it) and «خصم» typed in the service search points to it;
//   «تعديل الحجز» → تأمين / تعاقد (reschedule) → stored with coverage / approval / photo, patient linked;
//   ⋯ «طريقة الدفع / الخصم» on a booked card → نقابات / نوادي 30% (set_payer);
//   arrived card ⋯ «طريقة الدفع / الخصم (قبل التحصيل)» → تأمين / تعاقد (order_payer) → list price 400, patient share 20%;
//   no active contract → «مفيش عقود متفعّلة — الحسابات تفعّل العقد الأول» and the save is blocked.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere','booking_payer_kind']);
 const today=cairoDay(new Date()),yday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);
 // live-shaped contracts / price lists / links / storage (see supabase/live-capture); one active insurance contract with an active list
 await db.exec(`create table public.contracting_entities(id uuid primary key default gen_random_uuid(),name text not null,category text not null);
  create table public.contracting_entity_contracts(id uuid primary key default gen_random_uuid(),entity_id uuid not null,status text not null,start_date date,end_date date);
  create table public.pricing_services(id uuid primary key default gen_random_uuid(),name text);alter table clinic_reception.services add column pricing_service_id uuid;
  create schema clinic_prices;create table clinic_prices.lists(id uuid primary key default gen_random_uuid(),name text not null,version int not null default 1,contract_id uuid,mode text,fallback text not null,discount_percent numeric,discount_amount numeric,valid_from date not null,valid_to date not null,status text not null);
  create table clinic_prices.items(id uuid primary key default gen_random_uuid(),list_id uuid not null,service_id uuid not null,fixed_price numeric,discount_percent numeric,discount_amount numeric);
  create table public.contract_patient_links(id uuid primary key default gen_random_uuid(),contract_id uuid not null,patient_id uuid not null,member_reference text,insurance_plan_id uuid,linked_from date not null,linked_until date,linked_by uuid);
  create schema storage;create table storage.objects(bucket_id text,name text);grant usage on schema storage to authenticated;grant insert on storage.objects to authenticated;`);
 const one=async(q,a)=>(await db.query(q,a)).rows[0];
 const ent=await one("insert into public.contracting_entities(name,category) values('ميد نت','insurance') returning id");await db.query("insert into public.contracting_entities(name,category) values('نقابة المهندسين','unions'),('حضانة تجريبية','cash')");
 const ctr=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'active',$2) returning id",[ent.id,yday])).id;
 const ps=(await one("insert into public.pricing_services(name) values('كشف') returning id")).id;await db.query("update clinic_reception.services set pricing_service_id=$1 where id=$2",[ps,service]);
 const list=(await one("insert into clinic_prices.lists(name,contract_id,fallback,valid_from,valid_to,status) values('لائحة 2026',$1,'block',$2,'2030-01-01','active') returning id",[ctr,yday])).id;await db.query("insert into clinic_prices.items(list_id,service_id,fixed_price) values($1,$2,400)",[list,ps]);
 for(const p of [p1,p2]){const arch=(await one("insert into public.patients(id) values(gen_random_uuid()) returning id")).id;await db.query("update clinic_reception.patients set patient_id=$1 where id=$2",[arch,p]);}
 await as(1);await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00'),payer_kind:'cash'})).id,a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30'),payer_kind:'cash'})).id;
 await as(3);await cmd('arrive',{id:a2});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));
 await page.exposeFunction('rxUpload',async(bucket,path)=>{await db.exec('reset role');await db.query('insert into storage.objects values($1,$2)',[bucket,path]);await as(3);return path;});
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount','reception-payer-kind','file-drop-paste'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}})),auth:{getUser:()=>Promise.resolve({data:{user:{id:'rec-uid'}}})},storage:{from:b=>({upload:p=>rxUpload(b,p).then(()=>({data:{path:p},error:null}))})}},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-booking-discount','reception-payer-kind','reception-workspace','file-drop-paste'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const S=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 const photo=async sel=>{await page.waitForFunction(s=>{const f=document.querySelector(s);return f&&f.__fdpZone||f&&f.__fdpAnchor;},sel);await page.evaluate(s=>{const f=document.querySelector(s),z=f.__fdpZone,dt=new DataTransfer();dt.items.add(new File([new Uint8Array([0xff,0xd8,0xff,0xd9])],'',{type:'image/jpeg'}));if(z){z.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));}else{f.__fdpAnchor.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));}},sel);await page.waitForFunction(s=>{const f=document.querySelector(s);return f&&f.parentNode.querySelector('.rbd-up').textContent.includes('✓');},sel);};
 const submit=async()=>{await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached',timeout:6000}).catch(async e=>{console.log('MODAL:',await page.evaluate(()=>{const f=document.querySelector('.rx-modal form');const bad=[...f.elements].filter(x=>x.willValidate&&!x.checkValidity()).map(x=>x.name+':'+x.validationMessage);return (document.querySelector('.rx-modal [role=alert], .rx-modal .rx-error, .rx-modal .modal-error')||{}).textContent+' BAD '+bad.join(',');}));throw e;});};
 const seg=v=>page.locator(`.rx-modal label.rpk-opt:has(input[value="${v}"])`);
 // «حجز موعد»: the payment type is the first field before the service, nothing chosen, required; «خصم» in the service search points to it
 await page.locator('[data-rx-section="patients"]').click();const newBtn=page.locator('[data-rx-action="book"]').first();await newBtn.waitFor();
 {await newBtn.click();await page.waitForSelector('.rx-modal [data-rpk]');
  const order=await page.evaluate(()=>{const f=document.querySelector('.rx-modal form'),b=f.querySelector('[data-rpk]'),s=f.querySelector('#rx-svc-q')||f.elements.service_id;return !!(b.compareDocumentPosition(s)&Node.DOCUMENT_POSITION_FOLLOWING);});assert(order,'payment type before the service');
  assert.equal(await page.locator('.rx-modal input[name="payer_kind"]:checked').count(),0);assert.equal(await page.locator('.rx-modal input[name="payer_kind"]').first().evaluate(i=>i.required),true);
  const q=page.locator('.rx-modal #rx-svc-q');await q.fill('خصم');assert.equal(await page.locator('.rx-modal [data-rpk-svchint]').isVisible(),true);
  await page.locator('.rx-modal [data-rx-cancel]').click();await page.waitForSelector('.rx-modal',{state:'detached'});await page.locator('[data-rx-action="book"]').first().click();await page.waitForSelector('.rx-modal [data-rpk]');
  const bad=await page.evaluate(()=>[...document.querySelector('.rx-modal form').elements].filter(x=>x.willValidate&&!x.checkValidity()).map(x=>x.name));assert(bad.includes('payer_kind'),'no save without the payment type');
  await page.locator('.rx-modal [data-rx-cancel]').click();}
 await page.locator('[data-rx-action="back"]').first().click();await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 // «تعديل الحجز» → تأمين / تعاقد → ميد نت 400, coverage 80% → patient 80
 let card=await openCard(a1);await card.locator('[data-rx-action="reschedule"]').click();await page.waitForSelector('.rx-modal [data-rpk]');
 assert.equal(await page.locator('.rx-modal input[name="payer_kind"][value="cash"]').isChecked(),true,'edit shows the stored type');
 await seg('contract').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-c] option').length>1);
 const opts=await page.locator('.rx-modal [data-rpk-c] option').allTextContents();assert.deepEqual(opts,['اختار الجهة','ميد نت — 400 ج.م'],'only the active contract, no nursery');
 assert.equal(await page.locator('.rx-modal [data-rbd]').isHidden(),true,'no extra discount with a contract');
 await page.selectOption('.rx-modal [data-rpk-c]',ctr);await page.fill('.rx-modal input[name="payer_coupon_no"]','MN-55120');await page.fill('.rx-modal input[name="payer_auth_ref"]','AP-90311');
 await page.fill('.rx-modal input[name="payer_coverage_percent"]','80');await photo('.rx-modal [data-rpk-cfile]');
 assert.match(await page.locator('.rx-modal [data-rpk-csum]').textContent(),/سعر العقد400 ج\.مالجهة بتدفع \(80٪\)320 ج\.مالمريض يدفع80 ج\.م/);
 await page.waitForFunction(()=>[...document.querySelectorAll('.rx-modal select[name="starts_at"] option')].some(o=>o.value&&o.value!=='__custom__'));
 const slot=await page.evaluate(()=>{const s=document.querySelector('.rx-modal select[name="starts_at"]');return [...s.options].map(o=>o.value).filter(v=>v&&v!=='__custom__').pop();});await page.selectOption('.rx-modal select[name="starts_at"]',slot);
 if(process.env.SHOT){const d=process.env.SHOT;fs.writeFileSync(d+'/payer-contract.html',await page.content());for(const [n,vw] of [['desktop',{width:1280,height:1100}],['mobile',{width:390,height:900}]]){await page.setViewportSize(vw);await page.locator('.rx-modal .modal, .rx-modal [role=dialog], .rx-modal > *').first().screenshot({path:d+'/payer-contract-'+n+'.png'});}await page.setViewportSize({width:1280,height:950});}
 await submit();let s=await S(),ap=s.appointments.find(x=>x.id===a1);
 assert.equal(ap.payer_kind,'contract');assert.equal(+ap.payer_coverage_percent,80);assert.equal(ap.payer_auth_ref,'AP-90311');assert.match(ap.payer_proof_path,/^rec-uid\//);
 await db.exec('reset role');assert.equal((await db.query('select member_reference from public.contract_patient_links')).rows[0].member_reference,'MN-55120');await as(3);
 // booked card ⋯ «طريقة الدفع (تأمين / تعاقد)» → نقابات / نوادي → نقابة المهندسين 30% (500 → 350)
 card=await openCard(a1);const pb=card.locator('[data-rx-action="booking-discount"]');assert.equal(await pb.textContent(),'طريقة الدفع (تأمين / تعاقد)');await pb.click();await page.waitForSelector('.rx-modal [data-rpk]');
 assert.equal(await page.locator('.rx-modal input[name="payer_kind"][value="contract"]').isChecked(),true);
 await seg('union').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-u] option').length>2);
 assert.deepEqual(await page.locator('.rx-modal [data-rpk-u] option').allTextContents(),['اختار','نقابة المهندسين','أخرى… (اكتب الاسم)']);
 await page.selectOption('.rx-modal [data-rpk-u]','نقابة المهندسين');await page.fill('.rx-modal input[name="payer_card_no"]','EN-5');await page.fill('.rx-modal input[name="payer_card_expiry"]','2030-01-01');await photo('.rx-modal [data-rpk-ufile]');
 assert.match(await page.locator('.rx-modal [data-rpk-usum]').textContent(),/المريض يدفع350 ج\.م/);
 if(process.env.SHOT){const d=process.env.SHOT;fs.writeFileSync(d+'/payer-union.html',await page.content());for(const [n,vw] of [['desktop',{width:1280,height:1100}],['mobile',{width:390,height:900}]]){await page.setViewportSize(vw);await page.locator('.rx-modal .modal, .rx-modal [role=dialog], .rx-modal > *').first().screenshot({path:d+'/payer-union-'+n+'.png'});}await page.setViewportSize({width:1280,height:950});}
 await submit();s=await S();ap=s.appointments.find(x=>x.id===a1);assert.equal(ap.payer_kind,'union');assert.equal(ap.discount_kind,'syndicate');assert.equal(+ap.discount_percent,30);assert.equal(ap.discount_org_name,'نقابة المهندسين');
 // arrived card ⋯ «طريقة الدفع / الخصم (قبل التحصيل)» → تأمين / تعاقد 70% → order 400, patient 120
 card=await openCard(a2);const pv=card.locator('[data-rx-action="visit-discount"]');assert.equal(await pv.textContent(),'طريقة الدفع / الخصم (قبل التحصيل)');assert.equal(await card.locator('[data-rx-action="booking-discount"]').count(),0);
 await pv.click();await page.waitForSelector('.rx-modal [data-rpk]');await seg('contract').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-c] option').length>1);
 await page.selectOption('.rx-modal [data-rpk-c]',ctr);await page.fill('.rx-modal input[name="payer_coupon_no"]','MN-1');await page.fill('.rx-modal input[name="payer_auth_ref"]','AP-2');await page.fill('.rx-modal input[name="payer_coverage_percent"]','70');await photo('.rx-modal [data-rpk-cfile]');
 await submit();s=await S();const vis=s.visits.find(v=>v.appointment_id===a2),ord=s.orders.find(o=>o.visit_id===vis.id);assert.equal(+ord.price,400);assert.equal(+ord.discount,0);
 await db.exec('reset role');const qt=(await db.query('select snapshot from clinic_reception.order_quotes where order_id=$1',[ord.id])).rows[0];assert.equal(+qt.snapshot.coverage,70);
 // no active contract: empty state, save blocked
 await db.query("update public.contracting_entity_contracts set status='negotiating'");await as(3);
 card=await openCard(a2);await card.locator('[data-rx-action="visit-discount"]').click();await page.waitForSelector('.rx-modal [data-rpk]');
 assert.equal(await page.locator('.rx-modal input[name="payer_kind"][value="cash"]').isDisabled(),true,'contract visit: only contract after arrival');
 await page.waitForSelector('.rx-modal [data-rpk-cempty]:not([hidden])');assert.equal((await page.locator('.rx-modal [data-rpk-cempty]').textContent()).trim(),'مفيش عقود متفعّلة — الحسابات تفعّل العقد الأول');
 assert.equal(await page.locator('.rx-modal [data-rpk-c]').evaluate(s=>s.validity.valid),false,'save blocked');await page.locator('.rx-modal [data-rx-cancel]').click();
 assert(!errors.length,errors.join('\n'));
 console.log('PASS [file-drop-paste: photos pasted / dropped instead of picked]  booking payer kind UI (reception user, live workspace, real server functions): «حجز موعد» field first + required + service-search hint, «تعديل الحجز» → تأمين / تعاقد (reschedule) 400 / 80% / photo / link, ⋯ «طريقة الدفع» → نقابة 30% (set_payer), arrived ⋯ → تأمين / تعاقد 70% (order_payer) → order 400 + quote, empty state blocks save.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
