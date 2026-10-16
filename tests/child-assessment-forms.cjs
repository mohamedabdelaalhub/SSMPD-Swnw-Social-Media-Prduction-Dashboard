const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
const p={id:'patient-test',full_name:'طفل <تجريبي>',age:5};
let speech={patient_id:p.id,created_by:'original-author',first_word:'سنتان',first_sentence:'ثلاث سنوات',previous_speech_therapy:true,previous_speech_therapy_result:'تفاصيل سابقة',assessment_details:{unknown:'preserve'}};
let records=[],speechLoads=0,saved;
w.SSMPDToast={show(){}};w.SSMPDAuth={currentAdmin:{id:'admin-test',role:'super_admin'}};w.SSMPDRoles={hasRole:(a,r)=>a.role===r};
w.SSMPDDb=new Proxy({
 getPatientArchiveStats:async()=>({}),getPatientFiles:async()=>({patient:p,files:[]}),
 getPatientSpeechProfile:async()=>{speechLoads++;return speech},getPatientPsychologyProfile:async()=>({main_issues:[]}),
 savePatientSpeechProfile:async(id,patch)=>{saved=patch;speech={...speech,...patch};return speech},
 listDevelopmentAssessments:async()=>records,
 saveDevelopmentAssessment:async(id,kind,existing,details)=>{const row={id:'record-'+kind,patient_id:id,assessment_kind:kind,details};records.push(row);return row}
},{get:(o,k)=>o[k]||(()=>Promise.resolve([]))});
for(const f of ['child-assessment-forms','render-patients'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
const api=w.SSMPDChildAssessments,tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 for(const [kind,count] of [['speech',9],['behavior',8],['skills',11]]){
  const box=w.document.createElement('div');box.innerHTML=api.formHtml(kind,{custom:'old'},p,false);w.document.body.appendChild(box);api.wireForm(box);
  assert.equal(box.querySelectorAll('[data-ca-rating]').length,count);
  assert.equal(box.querySelectorAll('[data-ca-plan-row]').length,3);
  assert.equal(box.querySelector('[data-ca-field="child_name"]').value,p.full_name);
  assert.equal(box.querySelectorAll('تجريبي').length,0);
  box.querySelector('[data-ca-add-plan]').click();assert.equal(box.querySelectorAll('[data-ca-plan-row]').length,4);
  box.querySelector('[data-ca-remove-plan]').click();assert.equal(box.querySelectorAll('[data-ca-plan-row]').length,3);
  box.querySelector('[data-ca-level]').value=api.schemas[kind].choices[1];box.querySelector('[data-ca-notes]').value='<script>سلام</script>';
  const data=api.collect(box,{custom:'old'});assert.equal(data.custom,'old');assert.equal(data.ratings[api.schemas[kind].rows[0][0]].level,api.schemas[kind].choices[1]);
  const readonly=api.formHtml(kind,data,p,true);const view=w.document.createElement('div');view.innerHTML=readonly;assert.equal(view.querySelectorAll('input,select,textarea,script').length,0);assert(view.textContent.includes('<script>سلام</script>'));box.remove();
 }
 w.SSMPDRenderPatients.render(w.document.getElementById('root'));await tick();w.SSMPDRenderPatients.openPatientById(p.id);await tick();await tick();
 assert(w.document.querySelector('[data-ca-new="behavior"]'));assert(w.document.querySelector('[data-ca-new="skills"]'));
 w.document.querySelector('[data-edit-speech-profile]').click();await tick();
 const edit=w.document.querySelector('#sp-save-profile').closest('.modal-backdrop');assert.equal(edit.querySelector('#sp-first-word').value,'سنتان');
 edit.querySelector('[data-ca-field="home_language"]').value='العربية';edit.querySelector('[data-ca-level]').value='يحتاج دعمًا';edit.querySelector('#sp-save-profile').click();await tick();await tick();
 assert.equal(saved.first_word,'سنتان');assert.equal(saved.created_by,'original-author');assert.equal(saved.assessment_details.home_language,'العربية');assert.equal(saved.assessment_details.unknown,'preserve');assert(speechLoads>=2,'reload retains speech profile');
 w.document.querySelector('[data-view-speech-assessment]').click();assert(w.document.querySelector('.ca-modal').textContent.includes('العربية'));w.document.querySelector('.ca-modal .modal-close').click();
 w.document.querySelector('[data-ca-new="behavior"]').click();const behavior=w.document.querySelector('.ca-modal');behavior.querySelector('[data-ca-field="context"]').value='في المدرسة';behavior.querySelector('[data-ca-save]').click();await tick();await tick();assert.equal(records[0].details.context,'في المدرسة');
 w.document.querySelector('[data-ca-view]').click();assert(w.document.querySelector('.ca-modal').textContent.includes('في المدرسة'));assert.equal(w.document.querySelector('.ca-modal').querySelectorAll('textarea').length,0);
 const ro=w.document.createElement('div');w.document.body.appendChild(ro);await api.mount(ro,p,false);assert.equal(ro.querySelectorAll('[data-ca-new],[data-ca-edit]').length,0);
 dom.window.close();console.log('PASS exact 9/8/11 matrices, all plan fields, round-trip, escaping, read-only, speech merge/author preservation, reload, behavior save/view.');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
