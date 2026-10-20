const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only',url:'https://fixture.invalid'}),w=dom.window,d=w.document;
 let saved, rows=[{entity_id:'old',entity_name:'جهة حالية',contract_status:'active'},{entity_id:'new',entity_name:'شركة تأمين تجريبية',category:'insurance',contract_status:'negotiating'}];
 w.SSMPDToast={show(){}};w.SSMPDAuth={currentAdmin:{id:'admin'}};w.SSMPDRoles={canModuleAction:()=>true,isControlledFinance:()=>false,canDeleteContractingEntity:()=>false};
 w.SSMPDDb={listContractingEntities:()=>Promise.resolve(rows),createContractingEntity:(e)=>{saved=e;return Promise.reject(new Error('fixture stop'));}};
 w.eval(fs.readFileSync('assets/js/render-contracting-entities.js','utf8'));
 const tick=()=>new Promise(r=>setImmediate(r)),q=s=>d.querySelector(s);
 w.SSMPDRenderContractingEntities.render(q('#root'));await tick();
 assert.equal(d.querySelectorAll('[data-ce-category]').length,8);
 assert(q('[data-ce-category="cash"]').getAttribute('aria-pressed')==='true');
 q('.ce-group-btn').click();assert(q('#root').textContent.includes('جهة حالية'));assert(!q('#root').textContent.includes('شركة تأمين تجريبية'));
 q('[data-ce-category="insurance"]').click();await tick();assert(q('#root').textContent.includes('شركة تأمين تجريبية'));assert(!q('#root').textContent.includes('جهة حالية'));
 q('[data-ce-category="medical_tourism"]').click();await tick();assert(q('#root').textContent.includes('لا توجد جهات مسجلة في هذا التصنيف'));
 q('#ce-new').click();assert.equal(q('#ce-category').value,'medical_tourism');assert.equal(q('#ce-category').options.length,8);
 q('#ce-name').value='جهة جديدة';q('#ce-save').click();await tick();assert.equal(saved.category,'medical_tourism');
 dom.window.close();console.log('PASS eight categories, legacy cash fallback, isolated lists, empty state and create category persistence');
})().catch(e=>{console.error(e);process.exit(1)});
