// 20261126090000 «اسم سونو واسم الجهة» (owner 2026-11-26 «طبقه»): Rule 9 — the real reception screen in a real browser on the real
// server functions (PGlite), as a RECEPTION user in a LIVE workspace. Every new / changed control is used:
//   «حجز موعد» → تأمين / تعاقد → pick the entity (ميد نت) → the service search covers ميد نت's list: by Sono name, Sono code,
//   the entity's name, the entity's code and an alias; «عند ميد نت: …» + entity price under each result; «نفس اسم سونو» without
//   an own name; a service outside the list is greyed «مش متاحة للجهة» and cannot be picked (also after a department change);
//   pick by the entity code → save (walk-in) → arrival → order_quotes.snapshot has entity_service_name / entity_service_code.
//   كاش → search by the Sono code («كود سونو …», cash price), no entity lines.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere','booking_payer_kind']);
 const today=cairoDay(new Date()),yday=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0],consult=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 const dept=provider.department||provider.specialty;
 await cmd('service',{code:'XRC',name:'أشعة صدر',department:dept,price:800,minutes:15,bom:[]});await cmd('service',{code:'LAB',name:'صورة دم كاملة',department:dept,price:150,minutes:15,bom:[]});
 snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const xr=snap.services.find(s=>s.code==='XRC').id,lab=snap.services.find(s=>s.code==='LAB').id;
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[consult]);
 // live-shaped contracts / price lists (items.external_name / external_code, aliases scope 'list:<id>') / links / storage
 await db.exec(`create table public.contracting_entities(id uuid primary key default gen_random_uuid(),name text not null,category text not null);
  create table public.contracting_entity_contracts(id uuid primary key default gen_random_uuid(),entity_id uuid not null,status text not null,start_date date,end_date date);
  create table public.pricing_services(id uuid primary key default gen_random_uuid(),name text);alter table clinic_reception.services add column pricing_service_id uuid;
  create schema clinic_prices;create table clinic_prices.lists(id uuid primary key default gen_random_uuid(),name text not null,version int not null default 1,contract_id uuid,mode text,fallback text not null,discount_percent numeric,discount_amount numeric,valid_from date not null,valid_to date not null,status text not null);
  create table clinic_prices.items(id uuid primary key default gen_random_uuid(),list_id uuid not null,service_id uuid not null,fixed_price numeric,discount_percent numeric,discount_amount numeric,external_code text not null default '',external_name text not null default '');
  create table clinic_prices.aliases(id uuid primary key default gen_random_uuid(),scope_key text not null,external_code text not null default '',external_name text not null,unit text not null default '',service_id uuid not null,list_id uuid not null);
  create table public.contract_patient_links(id uuid primary key default gen_random_uuid(),contract_id uuid not null,patient_id uuid not null,member_reference text,insurance_plan_id uuid,linked_from date not null,linked_until date,linked_by uuid);
  create schema storage;create table storage.objects(bucket_id text,name text);grant usage on schema storage to authenticated;grant insert on storage.objects to authenticated;`);
 const one=async(q,a)=>(await db.query(q,a)).rows[0];
 const ent=await one("insert into public.contracting_entities(name,category) values('ميد نت','insurance') returning id");
 const ctr=(await one("insert into public.contracting_entity_contracts(entity_id,status,start_date) values($1,'active',$2) returning id",[ent.id,yday])).id;
 const ps={};for(const [sid,n] of [[consult,'كشف'],[xr,'أشعة'],[lab,'تحليل']]){ps[sid]=(await one("insert into public.pricing_services(name) values($1) returning id",[n])).id;await db.query("update clinic_reception.services set pricing_service_id=$1 where id=$2",[ps[sid],sid]);}
 const list=(await one("insert into clinic_prices.lists(name,contract_id,fallback,valid_from,valid_to,status) values('لائحة 2026',$1,'block',$2,'2030-01-01','active') returning id",[ctr,yday])).id;
 await db.query("insert into clinic_prices.items(list_id,service_id,fixed_price,external_name,external_code) values($1,$2,400,'Consultation GP','C-01'),($1,$3,600,'','')",[list,ps[consult],ps[xr]]);
 await db.query("insert into clinic_prices.aliases(scope_key,external_code,external_name,service_id,list_id) values($1,'XR-9','Chest X-Ray PA',$2,$3)",['list:'+list,ps[xr],list]);
 for(const p of [p1,p2]){const arch=(await one("insert into public.patients(id) values(gen_random_uuid()) returning id")).id;await db.query("update clinic_reception.patients set patient_id=$1 where id=$2",[arch,p]);}
 await db.exec(fs.readFileSync('supabase/migrations/20261126090000_entity_service_names.sql','utf8'));
 await as(1);await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await as(3);
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 const calls=[];await page.exposeFunction('rxRpc',(n,a)=>{calls.push(n);return rpc(n,a);});
 await page.exposeFunction('rxUpload',async(bucket,path)=>{await db.exec('reset role');await db.query('insert into storage.objects values($1,$2)',[bucket,path]);await as(3);return path;});
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount','reception-payer-kind'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}})),auth:{getUser:()=>Promise.resolve({data:{user:{id:'rec-uid'}}})},storage:{from:b=>({upload:p=>rxUpload(b,p).then(()=>({data:{path:p},error:null}))})}},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-booking-discount','reception-payer-kind','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 const seg=v=>page.locator(`.rx-modal label.rpk-opt:has(input[value="${v}"])`),Q=page.locator('.rx-modal #rx-svc-q');
 const results=async t=>{await Q.fill('');await Q.fill(t);await page.waitForSelector('.rx-modal #rx-svc-list:not([hidden])');
   return page.$$eval('.rx-modal #rx-svc-list [role=option]',ls=>ls.map(l=>({name:l.querySelector('.rx-combo-nm').textContent,ent:(l.querySelector('.rx-combo-ent')||{}).textContent||'',price:l.querySelector('.rx-combo-pr').textContent,off:l.getAttribute('aria-disabled')==='true'})));};
 const photo=async sel=>{await page.setInputFiles(sel,{name:'approval.jpg',mimeType:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xd9])});await page.waitForFunction(s=>{const f=document.querySelector(s);return f&&f.parentNode.querySelector('.rbd-up').textContent.includes('✓');},sel);};
 const openBook=async()=>{await page.locator('[data-rx-section="patients"]').click().catch(()=>{});const b=page.locator('[data-rx-action="book"]').first();await b.waitFor();await b.click();await page.waitForSelector('.rx-modal [data-rpk]');};
 // ── تأمين / تعاقد: entity first
 await openBook();
 await seg('contract').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-c] option').length>1);
 const order=await page.evaluate(()=>{const f=document.querySelector('.rx-modal form');return !!(f.querySelector('[data-rpk-c]').compareDocumentPosition(f.querySelector('#rx-svc-q'))&Node.DOCUMENT_POSITION_FOLLOWING);});assert(order,'entity picker before the service search');
 await page.selectOption('.rx-modal [data-rpk-c]',ctr);
 await page.waitForFunction(()=>/دوّر على الخدمة تحت/.test((document.querySelector('.rx-modal [data-rpk-entnote]')||{}).textContent||''));
 assert.equal(calls.filter(n=>n==='clinic_reception_entity_services').length,1,'the entity list loaded once');
 assert.equal(await Q.getAttribute('placeholder'),'دوّر باسم سونو أو اسم الجهة أو كودها');
 let r=await results('أشعة صدر');assert.deepEqual(r,[{name:'أشعة صدر',ent:'عند ميد نت: نفس اسم سونو',price:'600 ج.م سعر الجهة',off:false}],'by Sono name, no own name → نفس اسم سونو');
 r=await results('xrc');assert.deepEqual(r.map(x=>x.name),['أشعة صدر'],'by Sono code');
 r=await results('consultation gp');assert.deepEqual(r.map(x=>[x.name,x.ent,x.price]),[['كشف','عند ميد نت: Consultation GP C-01','400 ج.م سعر الجهة']].map(a=>[snap.services.find(s=>s.id===consult).name,a[1],a[2]]),'by entity name');
 r=await results('chest x-ray');assert.deepEqual(r.map(x=>x.name),['أشعة صدر'],'by entity alias');
 r=await results('صورة دم');assert.deepEqual(r,[{name:'صورة دم كاملة',ent:'مش في قايمة أسعار ميد نت',price:'مش متاحة للجهة',off:true}],'outside the list: greyed');
 await page.locator('.rx-modal #rx-svc-list [data-i="0"]').dispatchEvent('mousedown');assert.equal(await page.locator('.rx-modal select[name="service_id"]').inputValue(),'','greyed row not selectable');
 if(process.env.SHOT){const d=process.env.SHOT,shot=async(t,n)=>{await results(t);await page.locator('.rx-modal .rx-combo-field').evaluate(e=>e.scrollIntoView({block:'start'}));const a=await page.locator('.rx-modal .rx-combo-field').boundingBox(),b=await page.locator('.rx-modal #rx-svc-list').boundingBox();await page.screenshot({path:d+'/entity-search-'+n+'.png',clip:{x:a.x-8,y:a.y-8,width:a.width+16,height:b.y+b.height-a.y+16}});};await shot('C-01','desktop-entity-code');await shot('صورة دم','desktop-blocked');await shot('أشعة صدر','desktop-same-name');}
 // department change rebuilds the list — still the entity view
 await page.evaluate(d=>{const s=document.querySelector('.rx-modal [data-rx-dept]');s.value=d;s.dispatchEvent(new Event('change',{bubbles:true}));},dept);
 r=await results('صورة دم');assert.equal(r[0].off,true,'still greyed after a department change');
 // pick by the entity code, fill the contract fields, walk-in, save
 r=await results('C-01');assert.equal(r.length,1);assert.equal(r[0].ent,'عند ميد نت: Consultation GP C-01');
 await page.locator('.rx-modal #rx-svc-list [data-i="0"]').dispatchEvent('mousedown');assert.equal(await page.locator('.rx-modal select[name="service_id"]').inputValue(),consult);
 assert.match(await Q.inputValue(),/400 ج\.م/,'the picked label shows the entity price');
 await page.fill('.rx-modal input[name="payer_coupon_no"]','MN-55120');await page.fill('.rx-modal input[name="payer_auth_ref"]','AP-90311');await page.fill('.rx-modal input[name="payer_coverage_percent"]','80');await photo('.rx-modal [data-rpk-cfile]');
 await page.evaluate(v=>{const s=document.querySelector('.rx-modal select[name="provider_id"]');s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));},provider.id);
 await page.locator('.rx-modal input[name="walk_in"]').check();
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached',timeout:8000}).catch(async e=>{console.log('MODAL:',await page.evaluate(()=>{const f=document.querySelector('.rx-modal form');return (document.querySelector('.rx-modal [role=alert], .rx-modal .rx-error, .rx-modal .modal-error')||{}).textContent+' BAD '+[...f.elements].filter(x=>x.willValidate&&!x.checkValidity()).map(x=>x.name+':'+x.validationMessage).join(',');}));throw e;});
 let s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const ap=s.appointments.find(a=>a.service_id===consult&&a.payer_kind==='contract');assert(ap,'contract walk-in saved');assert.equal(+ap.payer_price,400);
 await cmd('arrive',{id:ap.id});s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 const vis=s.visits.find(v=>v.appointment_id===ap.id),ord=s.orders.find(o=>o.visit_id===vis.id);assert.equal(+ord.price,400);
 await db.exec('reset role');const qt=(await db.query('select snapshot from clinic_reception.order_quotes where order_id=$1',[ord.id])).rows[0].snapshot;await as(3);
 assert.equal(qt.entity_service_name,'Consultation GP');assert.equal(qt.entity_service_code,'C-01');
 // ── كاش: search by the Sono code, cash price, no entity lines
 await openBook();await seg('cash').click();
 assert.equal(await Q.getAttribute('placeholder'),'اكتب حرفين من اسم الخدمة أو كود سونو');
 r=await results('XRC');assert.deepEqual(r.map(x=>[x.name,x.ent,x.off]),[['أشعة صدر','كود سونو XRC',false]]);assert.match(r[0].price,/^800(\.00)? ج\.م$/,'cash price');
 r=await results('صورة دم');assert.equal(r[0].off,false,'cash: every service selectable');
 // switching contract → cash restores the cash view
 await seg('contract').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-c] option').length>1);await page.selectOption('.rx-modal [data-rpk-c]',ctr);
 await page.waitForFunction(()=>/دوّر على الخدمة تحت/.test((document.querySelector('.rx-modal [data-rpk-entnote]')||{}).textContent||''));r=await results('صورة دم');assert.equal(r[0].off,true);
 await seg('cash').click();r=await results('صورة دم');assert.deepEqual([r[0].name,r[0].ent,r[0].off],['صورة دم كاملة','كود سونو LAB',false]);assert.match(r[0].price,/^150(\.00)? ج\.م$/);
 await page.locator('.rx-modal #rx-svc-list [data-i="0"]').dispatchEvent('mousedown');assert.equal(await page.locator('.rx-modal select[name="service_id"]').inputValue(),lab,'cash pick');
 if(process.env.SHOT){const d=process.env.SHOT;await page.setViewportSize({width:390,height:900});await seg('contract').click();await page.selectOption('.rx-modal [data-rpk-c]',ctr);await page.waitForTimeout(300);await results('سونار');await results('أشعة');await page.locator('.rx-modal .modal, .rx-modal [role=dialog], .rx-modal > *').first().screenshot({path:d+'/entity-search-mobile.png'});}
 await page.locator('.rx-modal [data-rx-cancel]').click();
 assert(!errors.length,errors.join('\n'));
 console.log('PASS entity service names DOM (reception user, live workspace, real server functions): تأمين / تعاقد → entity first → search by Sono name / Sono code / entity name / entity code / alias, «عند ميد نت: …» + entity price, «نفس اسم سونو», outside the list greyed + not selectable (also after a department change), pick by entity code → walk-in save → arrival quote snapshot entity_service_name / entity_service_code; كاش → search by Sono code («كود سونو»), cash price; contract → cash restores');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
