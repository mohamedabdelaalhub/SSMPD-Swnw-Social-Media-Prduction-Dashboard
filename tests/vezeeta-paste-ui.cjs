// 20261126190000 «لصق رسالة فيزيتا» (owner approved 2026-11-26): Rule 9 + 10 — real browser, real reception screen, real server
// functions (PGlite), RECEPTION user, LIVE workspace. Fake names / numbers only.
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
 await db.exec(fs.readFileSync('supabase/migrations/20261126190000_vezeeta_sms_proof.sql','utf8'));
 await db.query("update clinic_reception.providers set name='د.دينا حسني',doctor_key='DR-DINA' where id=$1",[provider]);
 await db.query("update clinic_reception.patients set phone='01012345678' where id=$1",[p1]);
 const tomorrow=new Date(Date.parse(today)+86400000).toISOString().slice(0,10);await as(1);await cmd('availability',{provider_id:provider,starts_at:tomorrow+'T06:00:00Z',ends_at:tomorrow+'T20:00:00Z'});await db.exec('reset role');
 await as(3);await cmd('arrive',{id:a2});await cmd('arrive',{id:a3});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 await page.addScriptTag({content:fs.readFileSync('assets/js/reception-booking-discount.js','utf8')});await page.addScriptTag({content:fs.readFileSync('assets/js/reception-vezeeta-paste.js','utf8')});await page.addScriptTag({content:fs.readFileSync('assets/js/reception-workspace.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]',{timeout:8000}).catch(async e=>{console.log('ROOT:',(await page.textContent('#root')).slice(0,400),errors);throw e;});const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');

 const snapNow=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:tomorrow});
 const SH='Dear Doctor Dina Hosny, You received a new Shamel booking Mona Adel - 01012345678 Tomorrow '+tomorrow.slice(8,10)+'/'+tomorrow.slice(5,7)+' - Hadayek El-Ahram';
 // (1) «حجز موعد» → «لصق رسالة فيزيتا» → ✕ closes the panel (Rule 10) → open again, paste the Shamel SMS
 await page.locator('.rx-tl-book').first().click();await page.waitForSelector('.rx-modal [data-vzp]');
 await page.locator('.rx-modal [data-vzp-open]').click();assert.equal(await page.locator('.rx-modal [data-vzp-panel]').isVisible(),true);
 await page.locator('.rx-modal [data-vzp-close]').click();assert.equal(await page.locator('.rx-modal [data-vzp-panel]').isHidden(),true,'✕ closes the paste panel');
 await page.locator('.rx-modal [data-vzp-open]').click();
 // an unreadable message → «مش قادر أقرأ الرسالة», apply disabled
 await page.fill('.rx-modal [data-vzp-text]','hello');await page.waitForSelector('.rx-modal .vzp-err');assert.match(await page.locator('.rx-modal [data-vzp-out]').textContent(),/مش قادر أقرأ الرسالة/);
 assert.equal(await page.locator('.rx-modal [data-vzp-apply]').isDisabled(),true);
 // another branch → refused
 await page.fill('.rx-modal [data-vzp-text]',SH.replace('Hadayek El-Ahram','Nasr City'));await page.waitForFunction(()=>/لفرع تاني/.test(document.querySelector('.rx-modal [data-vzp-out]').textContent));
 assert.equal(await page.locator('.rx-modal [data-vzp-apply]').isDisabled(),true);
 // the Shamel SMS: doctor ✓, patient file ✓ (same phone), tomorrow, no time → first free slot, «شامل»
 await page.fill('.rx-modal [data-vzp-text]',SH);await page.waitForFunction(()=>/د\.دينا حسني/.test(document.querySelector('.rx-modal [data-vzp-out]').textContent));
 const outTxt=await page.locator('.rx-modal [data-vzp-out]').textContent();assert.match(outTxt,/✓ ملف موجود/);assert.match(outTxt,/رسالة الشامل مفيهاش ساعة/);assert.match(outTxt,/خصم 40٪ تلقائي/);
 assert.equal(await page.locator('.rx-modal input[name="vzp_when"][value="first"]').isChecked(),true);
 await page.locator('.rx-modal [data-vzp-apply]').click();await page.waitForTimeout(400);
 assert.equal(await page.inputValue('.rx-modal [name="source"]'),'vezeeta');assert.equal(await page.inputValue('.rx-modal [name="patient_id"]'),p1);assert.equal(await page.inputValue('.rx-modal [name="day"]'),tomorrow);
 // pick the consult (the service stays the receptionist's choice), then the first free slot of the doctor that day
 await page.selectOption('.rx-modal [name="service_id"]',service);await page.selectOption('.rx-modal [name="provider_id"]',provider);await page.waitForTimeout(300);
 const firstSlot=await page.$$eval('.rx-modal [name="starts_at"] option',os=>(os.find(o=>o.value&&o.value!=='__custom__')||{}).value||'');assert.ok(firstSlot,'a free slot exists');await page.selectOption('.rx-modal [name="starts_at"]',firstSlot);
 assert.equal(await page.locator('.rx-modal [data-rbd-on]').isChecked(),true);assert.equal(await page.locator('.rx-modal input[name="discount_kind"][value="vezeeta"]').isChecked(),true);
 assert.equal(await page.locator('.rx-modal [data-rbd-proofnote]').isVisible(),true,'proof note instead of the card fields');assert.equal(await page.locator('.rx-modal [data-rbd-syn]').isHidden(),true,'no card fields');
 await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached',timeout:8000}).catch(async e=>{console.log('MODAL:',(await page.locator('.rx-modal').textContent()).slice(0,500),errors);throw e;});
 let s=await snapNow(),ap=s.appointments.find(x=>x.patient_id===p1&&x.starts_at.slice(0,10)>=tomorrow.slice(0,10)&&x.discount_kind==='vezeeta');
 assert.ok(ap,'saved');assert.equal(ap.source,'vezeeta');assert.equal(+ap.discount_percent,40);
 const pr=(await (async()=>{await db.exec('reset role');const r=(await db.query('select discount_proof_text,discount_card_path from clinic_reception.appointments where id=$1',[ap.id])).rows[0];await as(3);return r;})());
 assert.match(pr.discount_proof_text,/Shamel booking Mona Adel/);assert.equal(pr.discount_card_path,null);
 // (2) same SMS again → duplicate warning with «افتح الحجز الموجود»
 await page.locator('.rx-tl-book').first().click();await page.waitForSelector('.rx-modal [data-vzp]');await page.locator('.rx-modal [data-vzp-open]').click();
 await page.fill('.rx-modal [data-vzp-text]',SH);await page.waitForSelector('.rx-modal [data-vzp-dup]',{timeout:4000}).catch(()=>{});
 const dupShown=await page.locator('.rx-modal [data-vzp-dup]').count();
 assert.equal(dupShown,1,'duplicate warning');{assert.equal(await page.locator('.rx-modal [data-vzp-apply]').isDisabled(),true);assert.equal(await page.locator('.rx-modal [data-vzp-open-existing]').count(),1);}
 // (3) a normal SMS for an unknown phone → «مفيش ملف بالرقم ده», time read from the message
 await page.fill('.rx-modal [data-vzp-text]','Dear Doctor Dina Hosny,  You received a new booking Karim Fathy - 01198765432 Tomorrow '+tomorrow.slice(8,10)+'/'+tomorrow.slice(5,7)+' - 7:30 PM - Hadayek El-Ahram');
 await page.waitForFunction(()=>/مفيش ملف بالرقم ده/.test(document.querySelector('.rx-modal [data-vzp-out]').textContent));assert.match(await page.locator('.rx-modal [data-vzp-out]').textContent(),/7:30 م/);
 await page.locator('.rx-modal [data-vzp-cancel]').click();assert.equal(await page.locator('.rx-modal [data-vzp-panel]').isHidden(),true,'رجوع closes the panel');
 await page.locator('.rx-modal [data-rx-cancel]').click();
 assert(!errors.length,errors.join('\n'));
 console.log('PASS vezeeta paste UI (reception, live, real server functions): «لصق رسالة فيزيتا» ✕/رجوع close; unreadable and other-branch messages blocked; Shamel SMS → doctor + patient + tomorrow + first free slot + «فيزيتا شامل» 40% with the message as proof (no card fields) → saved source vezeeta, proof stored; same SMS again → duplicate warning ('+dupShown+'); normal SMS with an unknown phone → «مفيش ملف», time 7:30 م.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
