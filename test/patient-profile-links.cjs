const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const dom = new JSDOM('<div id="root"></div>', {runScripts:'outside-only'});
const w = dom.window;
const p = {id:'patient-1', full_name:'مريض <تجريبي>', created_by_name:'موظف الإدخال', patient_code:'TEST'};
const f = {id:'file-1', patient_id:p.id, patients:p, uploaded_by_name:'موظف الرفع', file_name:'test.pdf', category:'other', review_status:'pending'};
let opened=[];
w.SSMPDToast={show(){}};
w.SSMPDAuth={currentAdmin:{id:'admin-1',role:'super_admin'}};
w.SSMPDRoles={hasRole:(a,r)=>a.role===r};
w.SSMPDDb=new Proxy({
 getPatientArchiveStats:async()=>({recent_patients:[p],recent_files:[f]}),
 listFilesForReview:async()=>({files:[f],total:1}),
 listPatientsArchive:async()=>({patients:[p],total:1}),
 getPatientFiles:(id)=>{opened.push(id);return new Promise(()=>{});}
},{get:(o,k)=>o[k]||(()=>Promise.resolve([]))});
w.eval(fs.readFileSync('assets/js/render-patients.js','utf8'));
const root=w.document.getElementById('root');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 w.SSMPDRenderPatients.render(root);await tick();
 for(const screen of ['dashboard','review','browse']){
  root.querySelector('[data-sub="'+screen+'"]').click();await tick();
  const button=root.querySelector('.patient-name-link');
  assert(button,screen+' clickable name');
  assert.equal(button.textContent,p.full_name);
  assert.equal(button.querySelector('تجريبي'),null);
  assert(root.textContent.includes(screen==='review'?'موظف الرفع':'موظف الإدخال'));
  if(screen==='browse'){const assign=root.querySelector('[data-assign]');assert(assign,'assignment action available');assert.equal(assign.parentNode.firstElementChild,assign,'assignment precedes view in RTL action order');assert.equal(assign.nextElementSibling.dataset.open,p.id);}
  button.click();assert.equal(opened.at(-1),p.id);
  w.document.querySelectorAll('.modal-backdrop').forEach(x=>x.remove());
 }
 console.log('PASS: dashboard, review, browse names open the correct profile and show attribution.');
 dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;dom.window.close();});
