const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
const issue=(before,after,field='f0',category='spelling')=>({field,category,before,after,reason:'تصحيح لغوي مقترح'});
const source=fs.readFileSync('assets/js/content-proofreading.js','utf8');
function setup(){
 const dom=new JSDOM('<main><button id="trigger">حفظ</button><input value="مسودة"></main>',{runScripts:'outside-only'}),w=dom.window,writes=[],reviews=[];
 let response={complete:true,issues:[issue('الصحهه','الصحة')]};
 w.SSMPDDb={proofreadContent:async fields=>{reviews.push(fields);if(response instanceof Error)throw response;return response;},createContentItem:async row=>{writes.push(row);return row;},updateContentItem:async(id,row)=>{writes.push({id,...row});return row;},getContentItem:async()=>({id:'draft',title:'الصحهه',body:'نص سليم',stage:'idea_selection'}),submitContentDraft:async(id,patch)=>{writes.push({id,...patch,stage:'initial_approval'});return{id,...patch};}};
 w.eval(source);return{dom,w,d:w.document,writes,reviews,set:r=>{response=r;},q:s=>w.document.querySelector(s)};
}
(async()=>{
 let t=setup(),{w,q,writes,reviews}=t;const original={title:'الصحهه',body:'ازيك، عشان صحتك تهمنا.',stage:'idea_selection',created_by:'employee'};
 let p=w.SSMPDDb.createContentItem(original);await tick();assert.equal(writes.length,0);assert.equal(reviews.length,1);assert(q('[role=dialog]'));assert.match(q('[data-proof-issues]').textContent,/الصحهه/);assert.equal(t.d.querySelector('main').inert,true);
 q('[data-proof-apply]').click();q('[data-proof-apply]')?.click();await p;assert.equal(writes.length,1);assert.equal(writes[0].title,'الصحة');assert.equal(writes[0].body,original.body);assert.equal(original.title,'الصحهه');assert.equal(t.d.querySelector('main').inert,undefined);
 p=w.SSMPDDb.updateContentItem('id',original);await tick();q('[data-proof-skip]').click();await p;assert.equal(writes.at(-1).title,'الصحهه');
 t.set({complete:true,issues:[]});await w.SSMPDDb.createContentItem(original);assert(!q('[role=dialog]'));assert.equal(writes.at(-1).title,'الصحهه');
 const n=reviews.length;await w.SSMPDDb.updateContentItem('id',{stage:'in_design',cover_settings:{enabled:true}});assert.equal(reviews.length,n);
 t.set(new Error('offline'));p=w.SSMPDDb.createContentItem(original);await tick();assert.match(q('[data-proof-status]').textContent,/تعذرت/);assert(q('[data-proof-apply]').hidden);t.set({complete:true,issues:[issue('الصحهه','الصحة')]});q('[data-proof-retry]').click();await tick();q('[data-proof-apply]').click();await p;
 t.set({complete:false,issues:[]});p=w.SSMPDDb.createContentItem(original);await tick();assert(!q('[data-proof-retry]').hidden);q('[data-proof-skip]').click();await p;
 let complete;t.w.SSMPDDb.proofreadContent=()=>new Promise(r=>complete=r);t.d.querySelector('#trigger').focus();p=w.SSMPDDb.createContentItem(original);await tick();let rejected=assert.rejects(p,/بدون حفظ/);t.d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await rejected;complete({complete:true,issues:[]});await tick();assert(!q('[role=dialog]'));assert.equal(t.d.activeElement.id,'trigger');
 // Validation protects exact source spans, overlap, numbers, URLs, markup and line breaks.
 const check=w.SSMPDProofreading.validate;
 for(const value of [issue('غير موجود','بديل'),issue('100','200'),issue('https://example.test','https://evil.test'),issue('الفا','<img>'),issue('الفا','الفا\n')])assert.throws(()=>check({complete:true,issues:[value]},{f0:'الفا 100 https://example.test'}));
 assert.throws(()=>check({complete:true,issues:[issue('غلط','صح')]},{f0:'غلط غلط'}));
 assert.throws(()=>check({complete:true,issues:[issue('نص غلط','نص صح'),issue('غلط','صح')]},{f0:'نص غلط'}));
 assert.equal(check({complete:true,issues:[issue('طيب ,','طيب،','f0','punctuation')]},{f0:'طيب , تعالى'}).length,1);
 t.dom.window.close();
 t=setup();t.set({complete:true,issues:[issue('بِنت','بنت','f0','diacritics'),issue('خطا','خطأ','f0')]});p=t.w.SSMPDProofreading.review({body:'بِنت عندها خطا'});await tick();t.q('[data-proof-apply]').click();assert.equal((await p).body,'بنت عندها خطأ');t.dom.window.close();
 t=setup();p=t.w.SSMPDDb.submitContentDraft('draft');await tick();t.q('[data-proof-apply]').click();await p;assert.equal(t.writes.length,1);assert.equal(t.writes[0].title,'الصحة');assert.equal(t.writes[0].stage,'initial_approval');t.dom.window.close();
 t=setup();const raw={carousel_copy:[{role:'hook',headline:'الصحهه',body:'محتوى'}],sources:[{url:'https://example.test'}],doctor_brief:{name:'اسم الطبيب'}};
 const c=t.w.SSMPDProofreading.collect({agent_raw_output:JSON.stringify(raw)});assert.equal(c.entries.length,2);c.entries[0].set('الصحة');const edited=JSON.parse(c.finish().agent_raw_output);assert.equal(edited.carousel_copy[0].headline,'الصحة');assert.deepEqual(edited.sources,raw.sources);assert.deepEqual(edited.doctor_brief,raw.doctor_brief);t.dom.window.close();
 // Run exactly the production TypeScript validator.
 const sandbox={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/content-proofread/review.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
 const api=sandbox.exports;assert.equal(api.checkedReview({complete:true,issues:[issue('خطا','خطأ')]},{f0:'خطا'}).issues.length,1);assert.throws(()=>api.fieldsFrom({f0:'x'.repeat(24001)}));assert.throws(()=>api.fieldsFrom({patient_data:'private'}));assert.throws(()=>api.checkedReview({complete:false,issues:[]},{f0:'نص'}));assert.throws(()=>api.checkedReview({complete:true,issues:[issue('100','200')]},{f0:'100'}));
 console.log('PASS opt-in corrections, original text, clean text, error/retry, incomplete review, metadata-only writes, stale cancellation, focus, exact spans/overlap, protected numbers/URLs, all categories, atomic draft submission, carousel copy isolation and production validator.');
})().catch(e=>{console.error(e);process.exitCode=1;});
