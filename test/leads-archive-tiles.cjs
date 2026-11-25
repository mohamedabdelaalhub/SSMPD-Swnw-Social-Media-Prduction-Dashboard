// «أرشيف الليدز» summary tiles (owner 2026-11-24 «طبقه»): 4 tiles with counts, each opens a popup; open/urgent counts match «داشبورد الإدارة»
// exactly (same calls, same definitions); «فتح» opens the lead modal; «عرض الليدز» filters; Escape/✕/backdrop close. Runs as each role that sees the archive.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const pause=(ms=25)=>new Promise(r=>setTimeout(r,ms));
const CLOSED=['service_done','rejected','no_response','invalid_number'],H=3600000,now=Date.now();
const leads=[
 {id:'t1',customer_name:'جديد النهارده',phone_raw:'01000000001',current_status:'new',created_at:new Date(now-5*60000).toISOString()},
 {id:'t2',customer_name:'متابعة النهارده',phone_raw:'01000000002',current_status:'in_progress',created_at:new Date(now-20*60000).toISOString()},
 {id:'o1',customer_name:'متأخر قديم',phone_raw:'01000000003',current_status:'new',created_at:new Date(now-72*H).toISOString()},
 {id:'o2',customer_name:'متأخر يوم',phone_raw:'01000000004',current_status:'new',created_at:new Date(now-30*H).toISOString()},
 {id:'c1',customer_name:'مقفول',phone_raw:'01000000005',current_status:'rejected',created_at:new Date(now-90*H).toISOString()},
 {id:'b1',customer_name:'محجوز',phone_raw:'01000000006',current_status:'booked',created_at:new Date(now-50*H).toISOString()}];
(async()=>{for(const role of ['super_admin','general_manager']){
 const dom=new JSDOM('<body><main id="root"></main></body>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,calls=[];
 const employees=[{id:'a',name:'زينة'}],stats={total:leads.length,registrars:employees,employees:[{employee_id:'a',employee_name:'زينة',active:true,count:6,percentage:100,last_registered_at:leads[0].created_at}]};
 w.SSMPDAuth={currentAdmin:{id:'me',role}};w.SSMPDToast={show(){}};
 w.SSMPDRoles={hasAnyRole:(m,r)=>r.includes(role),hasRole:(m,r)=>r===role,isSuperAdmin:()=>role==='super_admin'};
 const listLeads=async p=>{calls.push(['listLeads',p]);let l=leads.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at));
  if(p.status)l=l.filter(x=>x.current_status===p.status);else if(p.open_only)l=l.filter(x=>!CLOSED.includes(x.current_status));
  if(p.date_from)l=l.filter(x=>x.created_at>=p.date_from);return {leads:l.slice(0,p.page_size||20),total:l.length};};
 const q={select(){return q;},eq(){return q;},order(){return q;},single:async()=>({data:leads[0],error:null}),then(r){return Promise.resolve({data:[],error:null}).then(r);}};
 w.SSMPDDb={client:{from:()=>q},listEmployees:async()=>({employees}),listLeadArchive:async f=>({total:leads.length,leads:leads.slice(0,f.page_size)}),getLeadRegistrationStats:async()=>stats,
  listLeads,getLeadsStats:async f=>{calls.push(['stats',f]);return {open:leads.filter(x=>!CLOSED.includes(x.current_status)).length,closed:1,booked:1,total_income:0,by_acquisition_type:{},by_status:{}};},
  getAppSettings:async()=>({leads_sla_hours:24}),listLeadAttempts:async()=>[],listLeadStatusLog:async()=>[],listLeadInvoices:async()=>[]};
 w.eval(fs.readFileSync('assets/js/render-leads.js','utf8'));const R=w.SSMPDRenderLeads,root=d.getElementById('root');
 R.render(root);await pause();
 // «داشبورد الإدارة» numbers first
 root.querySelector('[data-sub="dashboard"]').click();await pause(60);
 const dashText=root.textContent,dashOpen=[...root.querySelectorAll('.kpi-card')].find(k=>k.textContent.includes('ليدز مفتوحة')).querySelector('.value').textContent.trim();
 const dashUrgent=(dashText.match(/متابعة عاجلة \((\d+)\)/)||[])[1];
 // archive tiles
 root.querySelector('[data-sub="archive"]').click();await pause(60);
 const count=k=>root.querySelector('[data-la-count="'+k+'"]').textContent.trim();
 assert.equal(root.querySelectorAll('[data-la-tile]').length,4,'four tiles');
 assert.equal(count('emp'),'6');assert.equal(count('today'),'2','created since Cairo midnight');assert.equal(count('open'),dashOpen,'open = dashboard');assert.equal(count('open'),'5');
 assert.equal(count('urgent'),dashUrgent,'urgent = dashboard');assert.equal(count('urgent'),'2');
 const today=calls.filter(c=>c[0]==='listLeads'&&c[1].date_from).pop()[1].date_from;assert(/T\d\d:00:00\.000Z$/.test(today),'Cairo midnight as a UTC instant: '+today);
 assert(!root.querySelector('table.simple thead th')||!root.querySelector('#ar-registration-stats table'),'staff table no longer inline');
 const pop=()=>d.querySelector('[data-la-popup]');
 // urgent popup -> «فتح» opens the lead modal
 root.querySelector('[data-la-tile="urgent"]').click();assert(pop().textContent.includes('متأخر قديم')&&pop().textContent.includes('متأخر يوم')&&!pop().textContent.includes('جديد النهارده'));assert(pop().textContent.includes('متأخر 72 س'));
 pop().querySelector('[data-la-open="o1"]').click();assert(!pop(),'popup closes');await pause();assert(d.querySelector('.modal-backdrop'),'lead modal opened');d.querySelectorAll('.modal-backdrop').forEach(b=>b.remove());
 // today popup
 root.querySelector('[data-la-tile="today"]').click();assert.equal(pop().querySelectorAll('.la-row').length,2);assert(pop().textContent.includes('جديد النهارده'));d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert(!pop(),'Escape closes');
 // open popup loads its own list
 root.querySelector('[data-la-tile="open"]').click();await pause();assert.equal(pop().querySelectorAll('.la-row').length,5);assert(!pop().textContent.includes('مقفول'));assert(calls.some(c=>c[0]==='listLeads'&&c[1].open_only===true));
 pop().querySelector('[data-la-close]').click();assert(!pop(),'✕ closes');
 // staff popup -> backdrop close, then «عرض الليدز» filters
 root.querySelector('[data-la-tile="emp"]').click();assert(pop().textContent.includes('100.0%'));pop().click();assert(!pop(),'backdrop closes');
 root.querySelector('[data-la-tile="emp"]').click();pop().querySelector('[data-registrar-filter="a"]').click();await pause(60);assert(!pop());assert.equal(root.querySelector('#ar-employee').value,'a');
 // English digits only in the tiles
 assert(!/[٠-٩]/.test(root.querySelector('.la-tiles').textContent));
 dom.window.close();}
 console.log('PASS leads archive tiles (super_admin + general_manager): staff/today/open/urgent counts (open + urgent equal «داشبورد الإدارة»), Cairo-midnight today, popups with «فتح» → lead modal, «عرض الليدز» filter, ✕/Escape/backdrop close.');
})().catch(e=>{console.error(e);process.exitCode=1;});
