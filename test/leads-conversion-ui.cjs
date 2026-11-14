const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const pause=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 const dom=new JSDOM('<body><main id="root"></main></body>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const calls=[],details=[];
 const by={physiotherapy:{total:20,converted:14,service_done:14,no_response:6,rejected:0,invalid_number:0,open:0},cosmetic_laser:{total:68,converted:38,service_done:37,no_response:25,rejected:2,invalid_number:0,open:3},unspecified:{total:2,converted:0,service_done:0,no_response:0,rejected:0,invalid_number:0,open:2}};
 w.SSMPDAuth={currentAdmin:{id:'m',role:'super_admin'}};w.SSMPDToast={show(){}};
 w.SSMPDRoles={hasAnyRole:()=>true,hasRole:()=>true,isSuperAdmin:()=>true};
 w.SSMPDDb={listEmployees:async()=>({employees:[]}),getLeadsConversion:async p=>{calls.push(p);return {by_service:by,income_by_service:{cosmetic_laser:{total:12000,invoices:5}}};},
  getLeadsConversionDetail:async p=>{details.push(p);return {leads:[{id:'x1',customer_name:'عميل تجريبي',phone_raw:'010',source:'whatsapp',current_status:'service_done',interested_service:p.service==='all'?'dental':p.service,created_at:'2026-11-01T10:00:00Z'}],total:38,page:p.page,page_size:20};},
  getLeadRegistrationStats:async()=>({}),listLeads:async()=>({leads:[],total:0})};
 w.eval(fs.readFileSync('assets/js/render-leads.js','utf8'));
 w.SSMPDRenderLeads.render(d.getElementById('root'));await pause();
 const tab=d.querySelector('[data-sub="conversion"]');assert(tab,'conversion tab missing');tab.click();await pause();
 const body=d.getElementById('cv-body').textContent;
 assert(body.includes('90'),'total leads 90 missing');                       // 20+68+2
 assert(body.includes('58%'),'overall conversion 52/90=58%');                 // (14+38)/90
 assert(body.includes('70%')&&body.includes('56%'),'per-service rates');
 assert(body.includes('12,000'),'income');
 d.querySelector('[data-cv-service="cosmetic_laser"][data-cv-bucket="converted"]').click();await pause();
 const last=details.at(-1);assert.equal(last.service,'cosmetic_laser');assert.equal(last.bucket,'converted');
 assert(d.querySelector('.modal-backdrop').textContent.includes('عميل تجريبي'),'detail row');
 assert(d.querySelector('.modal-backdrop').textContent.includes('1 / 2'),'pager 38 leads, 20 per page');
 d.querySelector('#cv-next').click();await pause();assert.equal(details.at(-1).page,2);
 d.querySelector('.modal-close').click();assert(!d.querySelector('.modal-backdrop'));
 d.getElementById('cv-from').value='2026-11-01';d.getElementById('cv-apply').click();await pause();assert.equal(calls.at(-1).from,'2026-11-01');
 w.close();console.log('PASS conversion screen: KPIs, per-service rates, income, drill-down modal, paging, date filter');
})().catch(e=>{console.error(e);process.exitCode=1;});
