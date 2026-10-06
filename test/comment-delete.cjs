const assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<main></main>',{runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('main');
w.SSMPDAuth={currentAdmin:{id:'owner',role:'content_creator'}};w.SSMPDRoles={hasAnyRole:(m,r)=>r.includes(m.role)};
const rows=[{id:'a',author_id:'owner',body:'one',created_at:new Date().toISOString()},{id:'b',author_id:'other',body:'two',created_at:new Date().toISOString()}];let calls=0,resolve;
w.SSMPDDb={listComments:()=>Promise.resolve(rows.slice()),markCommentsRead:()=>Promise.resolve(),deleteComment:()=>{calls++;return new Promise(r=>resolve=r)}};w.confirm=()=>false;w.alert=()=>{};
w.eval(fs.readFileSync('assets/js/comments.js','utf8'));await w.SSMPDComments.render(root,'content',{});assert.equal(root.querySelectorAll('[data-delete-comment]').length,1);
let btn=root.querySelector('[data-delete-comment]');btn.click();assert.equal(calls,0);w.confirm=()=>true;root.querySelector('textarea').value='unsaved';btn.click();btn.click();assert.equal(calls,1);resolve({id:'a'});await new Promise(r=>setTimeout(r,0));assert.equal(root.querySelector('textarea').value,'unsaved');assert.match(root.querySelector('h4').textContent,/1/);
for(const role of ['super_admin','general_manager']){w.SSMPDAuth.currentAdmin={id:'admin',role};await w.SSMPDComments.render(root,'content',{});assert.equal(root.querySelectorAll('[data-delete-comment]').length,2);}
w.SSMPDDb.deleteComment=()=>Promise.reject(new Error('RLS'));btn=root.querySelector('[data-delete-comment]');btn.click();await new Promise(r=>setTimeout(r,0));assert.equal(btn.disabled,false);assert.equal(root.querySelectorAll('.comment').length,2);
console.log('PASS owner/management visibility, cancel, double click, preserved draft, count and deletion failure');w.close();})();
