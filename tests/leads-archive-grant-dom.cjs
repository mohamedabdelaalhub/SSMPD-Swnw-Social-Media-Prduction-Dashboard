// Owner 2026-11-25 «الليدز تشوف كلها»: Zeina Badr's case — page_manager + extra customer_service + «أرشيف الليدز» grant.
// She now gets «أرشيف الليدز», «الحجوزات الفعلية» and «تحويلات الأطباء» next to her customer-service tabs (the old runtime patch
// in leads-archive-permission-column.js no longer strips them), clicks each and sees leads assigned to OTHER staff (served by
// the leads-list edge function / leads RLS — proven in leads-archive-grant-edge / leads-archive-grant-rls). Plain customer
// service without the grant keeps its tabs only.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const LEADS=[{id:'l1',customer_name:'عميل مُسند لموظف تاني',phone_raw:'01000000001',source:'whatsapp',current_status:'booked',assigned_to:'other',created_at:'2026-11-20T10:00:00Z'},
 {id:'l2',customer_name:'عميل بدون إسناد',phone_raw:'01000000002',source:'doctor_referral',current_status:'new',assigned_to:null,created_at:'2026-11-21T10:00:00Z'}];
async function boot(admin){
 const dom=new JSDOM('<main id="c"></main>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[],calls=[];
 w.addEventListener('error',e=>errors.push(e.message));w.SSMPDToast={show:()=>{}};
 w.SSMPDAuth={currentAdmin:admin};
 w.eval(fs.readFileSync('assets/js/roles.js','utf8'));
 const db={listEmployees:async()=>({employees:[{id:'other',name:'موظف تاني'}]}),
  listLeads:async p=>{calls.push(['leads-list',p]);return {leads:LEADS.filter(l=>!p.status||l.current_status===p.status).filter(l=>!p.source||l.source===p.source),total:2};},
  listLeadArchive:async p=>{calls.push(['archive',p]);return {leads:LEADS,total:2};},getLeadRegistrationStats:async()=>({rows:[]})};
 w.SSMPDDb=new Proxy(db,{get:(t,k)=>k in t?t[k]:async()=>({})});
 w.eval(fs.readFileSync('assets/js/render-leads.js','utf8'));
 w.eval(fs.readFileSync('assets/js/leads-archive-permission-column.js','utf8'));   // the old runtime patch, loaded from config.js
 const c=w.document.querySelector('#c');w.SSMPDRenderLeads.render(c);await new Promise(r=>setTimeout(r,60));
 const subs=()=>[...c.querySelectorAll('[data-sub]')].map(b=>b.dataset.sub);
 const open=async k=>{c.querySelector(`[data-sub="${k}"]`).click();await new Promise(r=>setTimeout(r,60));return c.textContent;};
 return {w,c,errors,calls,subs,open};}
(async()=>{
 const z=await boot({id:'zeina',role:'page_manager',roles:['page_manager','customer_service'],active:true,has_leads_archive_access:true});
 for(const k of ['cs','archive','booked','referrals'])assert(z.subs().includes(k),'Zeina sees «'+k+'»: '+z.subs().join(','));
 assert(!z.subs().includes('bulk'),'«رفع ملف إكسيل» stays reception-only');
 let txt=await z.open('archive');assert.match(txt,/عميل مُسند لموظف تاني/);assert.match(txt,/عميل بدون إسناد/);assert(z.calls.some(c=>c[0]==='archive'));
 txt=await z.open('booked');assert.match(txt,/عميل مُسند لموظف تاني/);
 txt=await z.open('referrals');assert.match(txt,/عميل بدون إسناد/);
 assert(z.subs().includes('archive')&&z.subs().includes('booked'),'tabs survive the old runtime patch');
 assert.deepEqual(z.errors,[]);
 // grant without any leads role: opens on «أرشيف الليدز»
 const g=await boot({id:'pm',role:'page_manager',roles:['page_manager'],active:true,has_leads_archive_access:true});
 assert.equal(g.c.querySelector('.tab-btn.active').dataset.sub,'archive');assert(!g.subs().includes('cs'));
 // plain customer service: no archive / booked / referrals
 const cs=await boot({id:'cs1',role:'customer_service',roles:['customer_service'],active:true,has_leads_archive_access:false});
 for(const k of ['archive','booked','referrals'])assert(!cs.subs().includes(k),'plain CS: no «'+k+'»');
 // inactive grant holder: nothing extra
 const off=await boot({id:'z2',role:'page_manager',roles:['page_manager','customer_service'],active:false,has_leads_archive_access:true});
 assert(!off.subs().includes('booked'));
 console.log('PASS leads archive grant UI: customer_service + grant (Zeina) sees and opens «أرشيف الليدز» / «الحجوزات الفعلية» / «تحويلات الأطباء» with leads assigned to others; the tabs survive the old runtime patch; grant-only opens on the archive; plain customer service and an inactive grant see none of them.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
