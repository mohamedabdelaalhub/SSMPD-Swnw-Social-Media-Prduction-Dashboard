const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const {window:w}=new JSDOM('<main id="portal-root"><section class="documents-section"><h3>المستندات</h3><div class="document-list"><article class="document-row" data-file-id="file-b"></article><article class="document-row" data-file-id="file-a"></article></div></section></main>',{url:'https://example.test/patient-portal/',runScripts:'outside-only'});
const docs=['medical_report','echo_report','dental_report','physio_report','prescription','lab_request','radiology_request'].map((source,i)=>({id:'d'+i,source,category:'medical_report',title:source,details:[{label:'نص التقرير',value:'<script>bad()</script> '+('نص '.repeat(600))}],patient:{patient_code:'TEST',full_name:'Test'},attachments:[]}));
const files=[{id:'file-a',file_name:'A.pdf'},{id:'file-b',file_name:'B.pdf'}];let fetched=[],downloads=[],printed=0;
w.SSMPD_CONFIG={supabase:{url:'https://example.test',anonKey:'test'}};
w.supabase={createClient:()=>({functions:{invoke:async(name)=>({data:name==='patient-portal-documents'?{documents:docs}:{files}})},auth:{getSession:async()=>({data:{session:{access_token:'test'}}})}})};
w.fetch=async(url)=>{fetched.push(url);return {ok:true,blob:async()=>new w.Blob(['test'])}};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.requestAnimationFrame=f=>f();
w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
w.open=()=>({document:{write:html=>{assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.length>1800)},close(){}},focus(){},print(){printed++}});
w.eval(fs.readFileSync('patient-portal/patient-file-actions.js','utf8'));
w.eval(fs.readFileSync('patient-portal/portal-file-categories.js','utf8'));
(async()=>{
 await new Promise(r=>setTimeout(r,300));
 assert.equal(w.document.querySelectorAll('.generated-document-row').length,7);
 const first=w.document.querySelector('[data-file-id="file-b"]');first.querySelector('.download').click();await new Promise(r=>setTimeout(r,20));assert.ok(fetched[0].includes('file_id=file-b'));assert.ok(fetched[0].includes('context=portal'));assert.equal(downloads[0],'B.pdf');
 first.querySelector('.details').click();assert.ok(w.document.querySelector('.portal-document-modal').textContent.includes('B.pdf'));w.document.querySelector('.portal-document-modal-head button').click();
 for(const row of w.document.querySelectorAll('.generated-document-row')){
  row.querySelector('.generated-view').click();const modal=w.document.querySelector('.portal-document-modal');assert.ok(modal.textContent.includes('<script>bad()</script>'));assert.equal(modal.querySelectorAll('script').length,0);assert.ok(modal.textContent.length>1800);
  modal.querySelector('.generated-download').click();modal.querySelector('.generated-print').click();modal.querySelector('.portal-document-modal-head button').click();
 }
 assert.equal(downloads.filter(n=>n.endsWith('.html')).length,7);assert.equal(printed,7);
 console.log('PASS: seven types render, HTML download, PDF print action, uploaded details, file ID matching after reorder, escaped long text');w.close();
})().catch(e=>{console.error(e);w.close();process.exitCode=1});
