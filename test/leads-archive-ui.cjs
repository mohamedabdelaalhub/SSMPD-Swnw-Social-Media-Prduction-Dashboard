const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const pause=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM('<body><main id="root"></main></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const employees=[{id:'a',name:'أحمد'},{id:'b',name:'زينة'},{id:'c',name:'موظف صفر'}],calls=[];
 const records=Array.from({length:136},(_,i)=>({id:'l'+i,customer_name:'عميل',received_by:i<122?'a':'b',current_status:'new',source:'whatsapp',created_at:'2026-10-06T12:00:00Z'}));
 const stats={total:136,registrars:employees,employees:employees.map((e,i)=>({employee_id:e.id,employee_name:e.name,active:true,count:[122,14,0][i],percentage:[122,14,0][i]*100/136,last_registered_at:'2026-10-06T12:00:00Z'}))};
 w.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin'}};w.SSMPDToast={show(){}};
 w.SSMPDRoles={hasAnyRole:()=>true,hasRole:()=>true,isSuperAdmin:()=>true};
 w.SSMPDDb={listEmployees:async()=>({employees}),listLeadArchive:async f=>{calls.push(f);assert(!f.assigned_to);const selected=records.filter(r=>!f.received_by||r.received_by===f.received_by);return {total:selected.length,leads:selected.slice((f.page-1)*f.page_size,f.page*f.page_size)};},getLeadRegistrationStats:async f=>{assert(!f.received_by);return stats;}};
 let exported;w.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:r=>r,book_append_sheet:(wb,r)=>exported=r},writeFile(){}};
 w.eval(fs.readFileSync('assets/js/render-leads.js','utf8'));w.SSMPDRenderLeads.openSearch('');w.SSMPDRenderLeads.render(d.getElementById('root'));await pause();
 assert(d.getElementById('ar-registration-stats').textContent.includes('136'));assert(d.getElementById('ar-registration-stats').textContent.includes('89.7%'));assert(d.getElementById('ar-registration-stats').textContent.includes('10.3%'));assert(d.getElementById('ar-registration-stats').textContent.includes('موظف صفر'));assert(d.querySelector('[data-registrar]').textContent==='أحمد');
 d.querySelector('[data-registrar-filter="b"]').click();await pause();assert.equal(calls.at(-1).received_by,'b');assert(d.getElementById('ar-export-xlsx').textContent.includes('14'));assert(d.getElementById('ar-registration-stats').textContent.includes('136'));assert(d.getElementById('ar-employee').value==='b');
 d.getElementById('ar-export-xlsx').click();await pause();assert.equal(exported.length,15);assert(exported[0].includes('مسجل الليد'));assert.equal(exported[1][4],'زينة');
 d.querySelector('[data-registrar-filter="c"]').click();await pause();assert(d.getElementById('ld-sub-view').textContent.includes('مفيش ليدز مطابقة'));assert(d.getElementById('ar-registration-stats').textContent.includes('136'));
 dom.window.close();console.log('PASS archive creator column, persistent 136-person denominator, 122/14/zero staff, creator filtering and matching Excel export');
})().catch(e=>{console.error(e);process.exitCode=1;});
