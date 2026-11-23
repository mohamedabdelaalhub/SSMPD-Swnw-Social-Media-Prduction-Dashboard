// «الطبيب المحوِّل» (20261123120000): real reception screen + real server functions (PGlite), RECEPTION user, LIVE workspace.
//   «تعديل الحجز» → من بره المركز (name + specialty) → saved; ⋯ «الطبيب المحوِّل: …» → من جوه المركز → saved;
//   arrived card ⋯ «الطبيب المحوِّل» → saved before collection.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{const browser=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 const {db,rpc,as,id}=await boot(['reception_services_packages','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in']);
 const today=cairoDay(new Date()),at=hhmm=>{const [h,m]=hhmm.split(':').map(Number);return new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1,+today.slice(8,10),h-2,m)).toISOString();};
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'62000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,[p1,p2]=snap.patients.map(p=>p.id);
 await db.exec('reset role');await db.query("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await db.query("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");await db.query("update clinic_reception.workspaces set mode='live' where id=$1",[w]);
 await db.exec("create or replace function public.clinic_reception_invoice_print(p_workspace uuid,p_visit uuid) returns jsonb language sql as $$select '{}'::jsonb$$");
 await db.exec(fs.readFileSync('supabase/migrations/20261123120000_referring_doctor.sql','utf8'));
 const prov2=(await db.query("insert into clinic_reception.providers(workspace_id,name,department,branch) values($1,'د. أحمد تجريبي','الباطنة','حدائق الأهرام') returning id",[w])).rows[0].id;
 await as(1);await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 await cmd('availability',{provider_id:provider,starts_at:at('08:00'),ends_at:at('22:00')});
 const a1=(await cmd('book',{patient_id:p1,provider_id:provider,service_id:service,starts_at:at('20:00')})).id,a2=(await cmd('book',{patient_id:p2,provider_id:provider,service_id:service,starts_at:at('20:30')})).id;
 await as(3);await cmd('arrive',{id:a2});
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog: '+d.message());d.dismiss();});
 await page.exposeFunction('rxRpc',(n,a)=>rpc(n,a));
 await page.route('https://reception.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><main id="root"></main></html>'}));await page.goto('https://reception.test/');
 for(const f of ['styles','finance-cash','reception-workspace','reception-booking-discount','reception-referrer'])await page.addStyleTag({content:fs.readFileSync('assets/css/'+f+'.css','utf8')});
 await page.addScriptTag({content:`window.SSMPDAuth={currentAdmin:{id:'rec',role:'reception'}};window.SSMPDRoles={canSeeTab:()=>true,rolesOf:()=>['reception'],hasRole:(a,r)=>r==='reception',hasAnyRole:(a,l)=>l.indexOf('reception')>=0};window.SSMPDDb={client:{rpc:(n,a)=>rxRpc(n,a).then(d=>({data:d,error:null}),e=>({data:null,error:{message:e.message}}))},receptionWorkspaces:()=>Promise.resolve([{id:'${w}',mode:'live'}]),receptionBootstrap:()=>Promise.resolve('${w}'),receptionSnapshot:(w,f,t)=>rxRpc('clinic_reception_snapshot',{p_workspace:w,p_from:f,p_to:t}),receptionCommand:(w,a,p,k)=>rxRpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:k})};`});
 for(const f of ['reception-booking-discount','reception-referrer','reception-workspace'])await page.addScriptTag({content:fs.readFileSync('assets/js/'+f+'.js','utf8')});
 await page.evaluate(()=>SSMPDReception.render(document.querySelector('#root')));await page.waitForSelector('[data-rx-section]');const skip=page.locator('[data-guide-skip]');if(await skip.count())await skip.click();
 await page.locator('[data-rx-section="appointments"]').click();await page.waitForSelector('.rx-tl-week');
 const openCard=async ap=>{const card=page.locator(`[data-tl-card="${ap}"]`);if(await card.isHidden())await page.locator(`[data-tl-open="${ap}"]`).click();await card.waitFor();const more=card.locator('details.rx-tl-more');if(!(await more.evaluate(d=>d.open)))await card.locator('.rx-tl-more summary').click();return card;};
 const S=async x=>(await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today})).appointments.find(a=>a.id===x);
 const opt=v=>page.locator(`.rx-modal label.rrf-opt:has(input[value="${v}"])`);
 const submit=async()=>{await page.locator('.rx-modal button[type="submit"]').click();await page.waitForSelector('.rx-modal',{state:'detached'});};
 // «تعديل الحجز» → من بره المركز
 let card=await openCard(a1);await card.locator('[data-rx-action="reschedule"]').click();await page.waitForSelector('.rx-modal [data-rrf]');
 assert.equal(await page.locator('.rx-modal input[name="referrer_kind"][value=""]').isChecked(),true,'«مفيش» by default');
 await opt('external').click();await page.fill('.rx-modal input[name="referrer_name"]','د. سامي تجريبي');await page.fill('.rx-modal input[name="referrer_specialty"]','عظام');
 await page.waitForFunction(()=>[...document.querySelectorAll('.rx-modal select[name="starts_at"] option')].some(o=>o.value&&o.value!=='__custom__'));
 const slot=await page.evaluate(()=>[...document.querySelector('.rx-modal select[name="starts_at"]').options].map(o=>o.value).filter(v=>v&&v!=='__custom__').pop());await page.selectOption('.rx-modal select[name="starts_at"]',slot);
 if(process.env.SHOT)await page.locator('.rx-modal [data-rrf]').screenshot({path:process.env.SHOT+'/referrer-booking.png'});
 await submit();let ap=await S(a1);assert.equal(ap.referrer_kind,'external');assert.equal(ap.referrer_name,'د. سامي تجريبي');assert.equal(ap.referrer_specialty,'عظام');
 // ⋯ «الطبيب المحوِّل: …» → من جوه المركز
 card=await openCard(a1);const b=card.locator('[data-rx-action="referrer"]');assert.equal(await b.textContent(),'الطبيب المحوِّل: د. سامي تجريبي');await b.click();await page.waitForSelector('.rx-modal [data-rrf]');
 assert.equal(await page.locator('.rx-modal input[name="referrer_kind"][value="external"]').isChecked(),true,'shows the saved one');
 await opt('internal').click();await page.selectOption('.rx-modal select[name="referrer_provider_id"]',prov2);await submit();
 ap=await S(a1);assert.equal(ap.referrer_kind,'internal');assert.equal(ap.referrer_name,'د. أحمد تجريبي');assert.equal(ap.referrer_specialty,'الباطنة');
 // arrived card ⋯ «الطبيب المحوِّل» → من بره المركز
 card=await openCard(a2);const b2=card.locator('[data-rx-action="referrer"]');assert.equal(await b2.textContent(),'الطبيب المحوِّل');await b2.click();await page.waitForSelector('.rx-modal [data-rrf]');
 await opt('external').click();await page.fill('.rx-modal input[name="referrer_name"]','د. هالة تجريبية');await page.fill('.rx-modal input[name="referrer_clinic"]','مستشفى تجريبي');await submit();
 ap=await S(a2);assert.equal(ap.referrer_kind,'external');assert.equal(ap.referrer_clinic,'مستشفى تجريبي');
 assert(!errors.length,errors.join('\n'));
 console.log('PASS referring doctor UI (reception, live): «تعديل الحجز» → من بره المركز saved, ⋯ «الطبيب المحوِّل: …» → من جوه المركز saved, arrived card ⋯ → saved before collection.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
