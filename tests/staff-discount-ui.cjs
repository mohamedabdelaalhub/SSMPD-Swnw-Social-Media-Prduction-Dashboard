// 20261126170000 «خصم العاملين بالمركز» (owner 2026-11-26), Rule 9 + 10: real browser, real reception screen, real server functions
// (PGlite), RECEPTION user, LIVE workspace. Booked card ⋯ «خصم» → «خصم العاملين بالمركز»: the employee picker lists the matching
// active employee, 30% saves a staff discount; an arrived non-employee: the picker says «مش متسجّل كموظف» and the form can't be
// saved, ✕ closes it; an arrived employee: «خصم على الزيارة» staff 25% → 500 → 375.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','booking_discount','discount_vezeeta_family','booking_discount_everywhere']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);await db.query("update clinic_reception.services set price=500 where id=$1",[service]);await as(1);
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id,a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30')})).id;
 const p3=(await (async()=>{await db.exec('reset role');const r=(await db.query("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F3','موظف تالت','01000000003',$2) returning id",[w,id(1)])).rows[0].id;await as(1);return r;})());
 const a3=(await cmd('book',{patient_id:p3,provider_id:provider,service_id:service,starts_at:at('21:00')})).id;
 await db.exec('reset role');
 await db.query("update clinic_reception.patients set phone='01000000001' where id=$1",[p1]);await db.query("update clinic_reception.patients set phone='01000000002' where id=$1",[p2]);
 await db.exec(fs.readFileSync('supabase/migrations/20261123130000_visit_discount_all_services.sql','utf8'));
 await db.exec("alter table clinic_reception.services add column if not exists pricing_evidence jsonb");
 await db.exec(fs.readFileSync('supabase/migrations/20261123200000_offer_no_other_discount.sql','utf8'));
 await db.exec("alter table public.patients add column if not exists phone text; create schema if not exists clinic_people; create table clinic_people.people(id uuid primary key default gen_random_uuid(),code text not null,full_name text not null,phone text not null default '',status text not null default 'active',end_date date);");
 await db.query("insert into clinic_people.people(code,full_name,phone) values('EMP-000201','موظفة الاستقبال','01000000001'),('EMP-000203','موظف تالت','+201000000003')");
 await db.exec(fs.readFileSync('supabase/migrations/20261126170000_staff_discount.sql','utf8'));
 await as(3);await cmd('arrive',{id:a2});await cmd('arrive',{id:a3});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-booking-discount.js','utf8')});await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const snapNow=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 // (1) booked employee card ⋯ «خصم» → «خصم العاملين بالمركز» → picker shows the employee → 30% → saved as a staff discount
 let card=await openCard(a1);await card.locator('[data-rx-action="booking-discount"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
 assert.match(await page.locator('.rx-modal .rbd-sw').textContent(),/العاملين/);
 await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="staff"])').click();
 await page.waitForFunction(()=>/موظفة الاستقبال — EMP-000201/.test((document.querySelector('.rx-modal [data-rbd-staff-sel]')||{}).textContent||''));
 assert.match(await page.locator('.rx-modal [data-rbd-staff-note]').textContent(),/شغال/);
 assert.equal(await page.locator('.rx-modal [data-rbd-reason]').isHidden(),true,'no reason field for staff');
 assert.equal(await page.getAttribute('.rx-modal input[name="discount_percent"]','max'),'30');
 await page.fill('.rx-modal input[name="discount_percent"]','30');
 assert.match(await page.locator('.rx-modal [data-rbd-sum]').textContent(),/العاملين بالمركز/);
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 let s=await snapNow(),ap=s.appointments.find(x=>x.id===a1);assert.equal(ap.discount_kind,'staff');assert.equal(+ap.discount_percent,30);assert.ok(ap.discount_staff_id);
 await page.waitForSelector(`[data-tl-open="${a1}"] .rx-disc-tag`);assert.match(await page.locator(`[data-tl-open="${a1}"] .rx-disc-tag`).textContent(),/خصم 30٪ · العاملين بالمركز/);
 // (2) arrived NON-employee: «خصم على الزيارة» → staff → «مش متسجّل كموظف», empty pick blocks save; ✕ closes (Rule 10)
 card=await openCard(a2);await card.locator('[data-rx-action="visit-discount"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
 await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="staff"])').click();
 await page.waitForFunction(()=>/مش متسجّل كموظف/.test((document.querySelector('.rx-modal [data-rbd-staff-note]')||{}).textContent||''));
 assert.equal(await page.inputValue('.rx-modal [data-rbd-staff-sel]'),'');await page.fill('.rx-modal input[name="discount_percent"]','20');
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForTimeout(300);assert.equal(await page.locator('.rx-modal').count(),1,'empty employee pick cannot be saved');
 const x=page.locator('.rx-modal [data-rx-cancel], .rx-modal [aria-label="إغلاق"], .rx-modal .rx-close').first();assert.equal(await x.count(),1,'close control present');await x.click();await page.waitForSelector('.rx-modal',{state:'detached'});
 s=await snapNow();assert.equal(s.appointments.find(x=>x.id===a2).discount_kind,null,'nothing saved for the non-employee');
 // (3) arrived employee: «خصم على الزيارة» staff 25% → 500 → 375
 card=await openCard(a3);await card.locator('[data-rx-action="visit-discount"]').click();await page.waitForSelector('.rx-modal [data-rbd]');
 await page.locator('.rx-modal label.rbd-chip:has(input[name="discount_kind"][value="staff"])').click();
 await page.waitForFunction(()=>/موظف تالت — EMP-000203/.test((document.querySelector('.rx-modal [data-rbd-staff-sel]')||{}).textContent||''));
 await page.fill('.rx-modal input[name="discount_percent"]','25');await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});
 s=await snapNow();const vis=s.visits.find(v=>v.appointment_id===a3),ord=s.orders.find(o=>o.visit_id===vis.id);assert.equal(+ord.discount,25);assert.equal(+ord.price*(1-ord.discount/100),375);
 assert.equal(s.appointments.find(x=>x.id===a3).discount_kind,'staff');
 card=await openCard(a3);assert.equal(await card.locator('[data-rx-action="visit-discount"]').count(),0,'one discount per visit');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS staff discount UI (reception, live, real server functions): booked employee ⋯ «خصم» → «خصم العاملين بالمركز» picker shows the matching active employee, 30% saved (tag «العاملين بالمركز»); arrived non-employee → «مش متسجّل كموظف», cannot save, ✕ closes, nothing saved; arrived employee «خصم على الزيارة» 25% → 500 → 375, item hidden after.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
