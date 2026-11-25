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
  listLeadArchive:async p=>{calls.push(['archive',p]);return {leads:LEADS,total:2};},getLeadRegistrationStats:async()=>({rows:[]}),getLeadsStats:async()=>({by_status:{},income_by_employee:[],income_by_department:[]}),
  client:{rpc:async(n,a)=>{calls.push(['rpc',n,a]);if(n==='log_leads_export')return {data:null,error:null};
   if(n==='leads_activity_report')return {data:{rows:[{admin_id:'zeina',name:'زينة',has_grant:true,status:3,booking:1,attempt:4,field_edit:2,assignment:0,invoice:1,complete_missing_data:0,delete:0,export:1,total:12,last_at:'2026-11-25T15:00:00Z'}]},error:null};
   if(n==='leads_activity_feed')return {data:[{at:'2026-11-25T15:00:00Z',action:'export',detail:'archive — 2 صف'},{at:'2026-11-25T14:00:00Z',action:'status',customer_name:'عميل بدون إسناد',detail:'new → in_progress'}],error:null};
   return {data:null,error:null};}}};
 w.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:a=>a,book_append_sheet:()=>{}},writeFile:(wb,name)=>calls.push(['writeFile',name])};
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
 // «تصدير إكسيل» on the archive: logged (who + when) BEFORE the file is written
 await z.open('archive');z.c.querySelector('#ar-export-xlsx').click();await new Promise(r=>setTimeout(r,80));
 const li=z.calls.findIndex(c=>c[0]==='rpc'&&c[1]==='log_leads_export'),wi=z.calls.findIndex(c=>c[0]==='writeFile');
 assert(li>=0&&wi>li,'export logged before the file: '+JSON.stringify(z.calls.slice(-3)));assert.equal(z.calls[li][2].p_kind,'archive');assert.equal(z.calls[li][2].p_rows,2);
 // Zeina (not a manager) sees no activity report on «داشبورد الإدارة»
 await z.open('dashboard');assert.equal(z.c.querySelector('#ld-activity'),null,'no activity report for staff');
 assert.deepEqual(z.errors,[]);
 // manager: «داشبورد الإدارة» → «حركة الموظفين على الليدز» + «تفاصيل»
 const m=await boot({id:'gm',role:'general_manager',roles:['general_manager'],active:true});
 await m.open('dashboard');await new Promise(r=>setTimeout(r,60));
 const box=m.c.querySelector('#ld-activity');assert(box,'activity section');assert.match(box.textContent,/حركة الموظفين على الليدز[\s\S]*زينة[\s\S]*12/);
 assert(m.calls.some(c=>c[1]==='leads_activity_report'));
 box.querySelector('[data-activity-open="zeina"]').click();await new Promise(r=>setTimeout(r,60));
 const feed=m.w.document.querySelector('[data-activity-feed]');assert(feed,'feed opens');assert.match(feed.textContent,/حركات زينة[\s\S]*تصدير[\s\S]*archive — 2 صف[\s\S]*تغيير حالة[\s\S]*عميل بدون إسناد/);
 assert.deepEqual(m.errors,[]);
 // grant without any leads role: opens on «أرشيف الليدز»
 const g=await boot({id:'pm',role:'page_manager',roles:['page_manager'],active:true,has_leads_archive_access:true});
 assert.equal(g.c.querySelector('.tab-btn.active').dataset.sub,'archive');assert(!g.subs().includes('cs'));
 // plain customer service: no archive / booked / referrals
 const cs=await boot({id:'cs1',role:'customer_service',roles:['customer_service'],active:true,has_leads_archive_access:false});
 for(const k of ['archive','booked','referrals'])assert(!cs.subs().includes(k),'plain CS: no «'+k+'»');
 // inactive grant holder: nothing extra
 const off=await boot({id:'z2',role:'page_manager',roles:['page_manager','customer_service'],active:false,has_leads_archive_access:true});
 assert(!off.subs().includes('booked'));
 console.log('PASS leads archive grant UI: customer_service + grant (Zeina) sees and opens «أرشيف الليدز» / «الحجوزات الفعلية» / «تحويلات الأطباء» with leads assigned to others; «تصدير إكسيل» is logged before the file is written; the manager sees «حركة الموظفين على الليدز» and opens an employee\'s actions (staff do not); the tabs survive the old runtime patch; grant-only opens on the archive; plain customer service and an inactive grant see none of them.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
