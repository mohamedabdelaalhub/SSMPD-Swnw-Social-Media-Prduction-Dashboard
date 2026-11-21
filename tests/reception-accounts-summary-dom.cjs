// Owner 2026-11-22: «الحساب والفواتير» shows the latest 5 invoices / receipts / patients with «عرض الكل (N)»; extra tools are folded in «أدوات إضافية».
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const w=new JSDOM('<body><div id="host"><div class="rx-shell"></div></div></body>',{runScripts:'outside-only'}).window;
w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false};
w.eval(fs.readFileSync('assets/js/reception-services.js','utf8'));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let loads=0;
const mk=n=>Array.from({length:n},(_,i)=>i+1);
const d={workspace:{mode:'live'},can_manage:false,can_review:false,visits:[],
 patients:mk(8).map(i=>({id:'p'+i,file_no:'F'+i,name:'مريض '+i,due:i*10,credit:0})),
 invoices:mk(8).map(i=>({id:'i'+i,patient_id:'p1',description:'فاتورة '+i,visit_id:null,amount:100,due:i===8?50:0,created_at:'2026-11-0'+i+'T10:00:00Z'})),
 payments:mk(7).map(i=>({id:'pay'+i,receipt_no:'R'+i,method:'cash',amount:10,created_at:'2026-11-0'+i+'T10:00:00Z'}))};
const c={esc,money:v=>Number(v).toFixed(2),btn:(a,id,l)=>'<button data-rx-action="'+a+'" data-id="'+id+'">'+l+'</button>',stamp:v=>v,lookup:()=>'—',data:d,load:()=>{loads++;},host:null};
const render=()=>new JSDOM('<body>'+w.SSMPDReceptionModules.panel('operations',c)+'</body>').window.document;
let doc=render();
const rows=t=>[...doc.querySelectorAll('.rx-table')].find(x=>x.textContent.includes(t)).querySelectorAll('tbody tr').length;
assert.equal(rows('الفاتورة والزيارة'),5,'latest 5 invoices');assert.equal(rows('إيصال التحصيل'),5,'latest 5 receipts');assert.equal(rows('ملف المريض'),5,'5 patients');
const t=doc.body.textContent;assert(t.includes('عرض الكل (8)')&&t.includes('عرض الكل (7)'),'show-all buttons with totals');
assert(/فاتورة 8/.test(t)&&!/فاتورة 1\b/.test(t)&&/مريض 8/.test(t),'newest invoice and highest-due patient first');
assert.equal(w.SSMPDReceptionModules.act('summary-all','invoices',c),true);assert.equal(loads,1);
doc=render();assert.equal(rows('الفاتورة والزيارة'),8,'all invoices after «عرض الكل»');assert(doc.body.textContent.includes('إظهار آخر 5 فقط'));
w.SSMPDReceptionModules.act('summary-all','invoices',c);doc=render();assert.equal(rows('الفاتورة والزيارة'),5,'collapsed again');
// extra tools folded
const host=w.document.getElementById('host'),shell=host.querySelector('.rx-shell');
c.host=host;c.data=Object.assign({},d,{workspace:{mode:'live'},can_manage:true});
w.eval(fs.readFileSync('assets/js/reception-service-orders.js','utf8'));
w.SSMPDReceptionServiceOrders.decorate(c,'operations');
const box=shell.querySelector('details.rx-more-tools');assert(box&&box.querySelector('summary').textContent==='أدوات إضافية','extra tools folded');
assert(box.textContent.includes('لوحة المزوّدين الخارجيين')&&!box.open,'service-order buttons inside the collapsed box');
console.log('PASS accounts summary: latest 5 + show all, extra tools folded.');process.exit(0);
