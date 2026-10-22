const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const dom=new JSDOM('<div id="details"></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document,writes=[];
 let item={id:'old-item',title:'مادة سابقة',body:'خطا في النص',stage:'published',created_by:'employee',updated_at:'v1'},changed=0,response={complete:true,issues:[{field:'f1',category:'spelling',before:'خطا',after:'خطأ',reason:'همزة'}]};
 w.SSMPDAuth={currentAdmin:{id:'employee',role:'page_manager'}};w.SSMPDRoles={hasAnyRole:()=>false};w.SSMPDToast={show:()=>{}};w.alert=e=>{throw Error(e);};
 w.SSMPDDb={getContentItem:async()=>({...item}),proofreadContent:async()=>response,updateContentItem:async(id,patch)=>{writes.push({id,patch});return {...item,...patch};},createContentItem:async()=>{throw Error('must not create');}};
 for(const name of ['content-proofreading','workflow'])w.eval(fs.readFileSync('assets/js/'+name+'.js','utf8'));
 const W=w.SSMPDWorkflow,root=d.querySelector('#details');
 assert(W.itemActionsHtml(item,w.SSMPDAuth.currentAdmin).includes('data-proofread-item'));assert(!W.itemActionsHtml(item,{id:'other'}).includes('data-proofread-item'));
 root.innerHTML=W.itemActionsHtml(item,w.SSMPDAuth.currentAdmin);W.wireItemActions(root,item,()=>changed++);root.querySelector('[data-proofread-item]').click();await tick();assert.equal(writes.length,0);assert.match(d.querySelector('.proofreading-note').textContent,/صورة التصميم/);d.querySelector('[data-proof-apply]').click();await tick();assert.equal(writes.length,1);assert.equal(writes[0].id,'old-item');assert.equal(writes[0].patch.body,'خطأ في النص');assert.deepEqual(Object.keys(writes[0].patch),['body']);assert.equal(changed,1);
 let p=w.SSMPDProofreading.correctExisting(item);await tick();d.querySelector('[data-proof-skip]').click();assert.equal(await p,null);assert.equal(writes.length,1);
 response={complete:true,issues:[]};assert.equal(await w.SSMPDProofreading.correctExisting(item),null);assert.equal(writes.length,1);
 response={complete:true,issues:[{field:'f1',category:'spelling',before:'خطا',after:'خطأ',reason:'همزة'}]};p=w.SSMPDProofreading.correctExisting(item);await tick();item.updated_at='v2';d.querySelector('[data-proof-apply]').click();await assert.rejects(p,/اتعدلت/);assert.equal(writes.length,1);
 w.SSMPDAuth.currentAdmin={id:'other'};await assert.rejects(w.SSMPDProofreading.correctExisting(item),/صلاحية/);
 dom.window.close();console.log('PASS existing material action, owner-only access, one update on same ID, no review loop, original/clean no writes, stage untouched and concurrent edits detected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
