// Owner 2026-11-28 «موافق، نفّذ 1 لـ 4 ورقم الملف كفاية» (mockup upload-unify.html): in a REAL browser on the real reception screen
// and the real server functions (PGlite), as a RECEPTION user in a LIVE workspace: the «مستند الجهة» proof rows in «طريقة الدفع» use the
// «تسجيل تحصيل» photo box. «📷 صوّر» (camera chooser) and «🖼 اختار صورة» (file chooser) are clicked; the file is named
// مستند-جهة_<file no>_<row>_<dd-mm>_<HH-MM>, uploads at once under an ASCII key, «✓ الصورة جاهزة» + «تغيير»; the booking saves the path.
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
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount','reception-payer-kind'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}})),auth:{getUser:()=>Promise.resolve({data:{user:{id:'rec-uid'}}})},storage:{from:b=>({upload:p=>rxUpload(b,p).then(()=>({data:{path:p},error:null}))})}},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['upload-box','reception-booking-discount','reception-payer-kind','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const S=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 const photo=async sel=>{await page.setInputFiles(sel,{name:'approval.jpg',mimeType:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xd9])});await page.waitForFunction(s=>{const f=document.querySelector(s);return f&&f.parentNode.querySelector('.rbd-up').textContent.includes('✓');},sel);};
 const submit=async()=>{await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached',timeout:6000}).catch(async e=>{console.log('MODAL:',await page.evaluate(()=>{const f=document.querySelector('.rx-modal form');const bad=[...f.elements].filter(x=>x.willValidate&&!x.checkValidity()).map(x=>x.name+':'+x.validationMessage);return (document.querySelector('.rx-modal [role=alert], .rx-modal .rx-error, .rx-modal .modal-error')||{}).textContent+' BAD '+bad.join(',');}));throw e;});};
 const seg=v=>page.locator(`.rx-modal label.rpk-opt:has(input[value="${v}"])`);
 const uploaded=async()=>{await db.exec('reset role');const r=(await db.query("select name from storage.objects order by ctid")).rows.map(x=>x.name);await as(3);return r;};
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 let card=await openCard(a1);await card.locator('[data-rx-action="reschedule"]').click();await page.waitForSelector('.rx-modal [data-rpk]');
 await seg('contract').click();await page.waitForFunction(()=>document.querySelectorAll('.rx-modal [data-rpk-c] option').length>1);
 await page.selectOption('.rx-modal [data-rpk-c]',ctr);await page.fill('.rx-modal input[name="payer_coupon_no"]','MN-55120');await page.fill('.rx-modal input[name="payer_auth_ref"]','AP-90311');await page.fill('.rx-modal input[name="payer_coverage_percent"]','80');
 const row=page.locator('.rx-modal .rbd-row:has([data-rpk-cfile])'),box=row.locator('[data-ub]');
 assert.equal(await box.count(),1,'the photo box');assert.equal(await row.locator('.fdp-card').count(),0,'no second upload card');
 assert.equal(await box.locator('[data-ub-take]').isVisible(),true);assert.equal(await box.locator('[data-ub-pick]').isVisible(),true);assert.match(await box.locator('.ub-or').textContent(),/Ctrl/);
 const jpg={name:'IMG_2041.jpg',mimeType:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff,0xd9])};
 // «📷 صوّر» → camera chooser
 await page.locator('.rx-modal input[name="payer_coverage_percent"]').evaluate(i=>i.blur()); await page.waitForFunction(()=>/سعر العقد/.test((document.querySelector('.rx-modal [data-rpk-csum]')||{}).textContent||''));await page.waitForTimeout(400); // price list loaded: the layout stopped moving
 let [ch]=await Promise.all([page.waitForEvent('filechooser'),box.locator('[data-ub-take]').click()]);assert.equal(await ch.element().evaluate(i=>i.getAttribute('capture')),'environment');await ch.setFiles(jpg);
 await page.waitForFunction(()=>{const r=document.querySelector('.rx-modal .rbd-row:has([data-rpk-cfile]) .rbd-up');return r&&r.textContent.includes('✓');});
 const nm=await box.locator('[data-ub-name]').textContent();assert.match(nm,/^مستند-جهة_[^_]+_صورة-الموافقة_\d\d-\d\d_\d\d-\d\d\.jpg$/,nm);
 assert.equal(await box.locator('[data-ub-done]').isVisible(),true);assert.equal(await box.locator('[data-ub-drop]').isVisible(),false);
 let keys=await uploaded();assert.match(keys[keys.length-1],/^rec-uid\/[^/]+\/payer-proof_[A-Za-z0-9-]*_?\d\d-\d\d_\d\d-\d\d_[0-9a-f]{4}\.jpg$/,keys[keys.length-1]);
 const first=keys[keys.length-1];
 // «تغيير» → «🖼 اختار صورة» chooser → a new upload replaces the path
 [ch]=await Promise.all([page.waitForEvent('filechooser'),box.locator('[data-ub-change]').click()]);await ch.setFiles({...jpg,name:'approval-2.jpg'});
 await page.waitForFunction(n=>{const k=document.querySelector('.rx-modal input[name="payer_proof_path"]');return k&&k.value&&k.value!==n;},first);
 keys=await uploaded();const second=keys[keys.length-1];assert.notEqual(second,first);
 if(process.env.SHOT){const d=process.env.SHOT;for(const [n,vw] of [['desktop',{width:1280,height:1100}],['mobile',{width:390,height:900}]]){await page.setViewportSize(vw);await row.scrollIntoViewIfNeeded();await page.screenshot({path:d+'/upload-payer-'+n+'.png'});}await page.setViewportSize({width:1280,height:950});}
 await page.waitForFunction(()=>[...document.querySelectorAll('.rx-modal select[name="starts_at"] option')].some(o=>o.value&&o.value!=='__custom__'));
 const slot=await page.evaluate(()=>{const s=document.querySelector('.rx-modal select[name="starts_at"]');return [...s.options].map(o=>o.value).filter(v=>v&&v!=='__custom__').pop();});await page.selectOption('.rx-modal select[name="starts_at"]',slot);
 await submit();const ap=(await S()).appointments.find(x=>x.id===a1);assert.equal(ap.payer_kind,'contract');assert.equal(ap.payer_proof_path,second,'the booking keeps the named photo');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS upload box UI (reception user, live workspace, real server functions): «مستند الجهة» photo box — 📷 صوّر (camera) and «تغيير» → 🖼 اختار صورة, automatic name, ASCII key, saved on the booking.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
