const {JSDOM}=require('jsdom');const assert=require('assert');const fs=require('fs');
const dom=new JSDOM('<div id=h></div>',{runScripts:'outside-only'});const w=dom.window;
const calls=[];
w.SSMPDAuth={currentAdmin:{id:'a1',role:'page_manager'}};
w.SSMPDDb={getContentRating:()=>Promise.resolve(null),setContentRating:(...a)=>{calls.push(a);return Promise.resolve();}};
w.eval(fs.readFileSync(__dirname+'/../assets/js/content-rating.js','utf8'));
w.SSMPDContentRating.mount(w.document.getElementById('h'),{id:'c1'});
(async()=>{
 const h=w.document.getElementById('h');
 h.querySelector('[data-rate=weak]').click();
 assert(h.querySelector('[data-cause]'),'cause select appears for weak');
 h.querySelector('[data-cause]').value='hook';h.querySelector('[data-cause]').dispatchEvent(new w.Event('change'));
 h.querySelector('[data-reason]').value='افتتاحية مملة';h.querySelector('[data-reason]').dispatchEvent(new w.Event('input'));
 h.querySelector('[data-save]').click();await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(calls[0],['c1','weak','افتتاحية مملة','hook']);assert(/اتحفظ/.test(h.textContent));
 w.SSMPDAuth.currentAdmin.role='designer';const h2=w.document.createElement('div');w.SSMPDContentRating.mount(h2,{id:'c2'});assert.equal(h2.innerHTML,'','designer cannot rate');
 console.log('PASS: content rating widget');
})();
