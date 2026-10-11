const vm=require('node:vm'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const w={};vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/js/carousel-content.js','utf8'),{window:w});
 vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/js/render-review.js','utf8').replace('window.SSMPDRenderReview = { render: render };','window.__choices = {options:designerOptionsHtml,html:claudeDesignHtml,wire:wireClaudeDesign};'),{window:w});
 const claude='a0fbdfee-d147-4282-b988-186a9ae3e88c',people=[{id:claude,name:'Claude Creative'},{id:'staff',name:'مصمم'}],item={id:'content',brand:'sono',content_format:'carousel',stage:'in_design',assigned_designer:claude,agent_raw_output:{carousel_brief:{slides_count:3,style:'tips'},carousel_copy:[{role:'hook',headline:'عنوان'},{role:'point',headline:'نقطة'},{role:'cta',headline:'تواصل'}]}};
 for(const designers of [people,people.slice(1)]){const html=w.__choices.options(item,designers,claude);assert.equal(html.split('value="'+claude+'"').length-1,1);assert(html.includes('value="'+claude+'" selected'));assert(html.includes('بالذكاء الاصطناعي'));assert(html.includes('value="staff"'));}
 assert(w.__choices.options({content_format:'image_post'},people,null).includes('Claude Creative'));assert(w.__choices.html(item).includes('نفّذ الكاروسيل'));
 let args;const status={textContent:''},button={disabled:false},box={querySelector:s=>s==='#claude-design-status'?status:s==='#claude-design-go'?button:{value:'photo'}},root={querySelector:()=>box};
 w.SSMPDAuth={currentAdmin:{id:'admin'}};w.SSMPDDb={latestClaudeDesignRequest:async()=>null,requestClaudeDesign:async(...a)=>{args=a;return {status:'pending',note:a[3]};}};
 w.__choices.wire(root,item);await new Promise(r=>setTimeout(r,0));button.onclick();await new Promise(r=>setTimeout(r,0));assert.equal(args[0],'content');assert.equal(JSON.parse(args[3]).carousel_copy.length,3);assert.equal(button.disabled,true);assert(!status.textContent.includes('{'));
 console.log('PASS: explicit carousel AI choice for assignment/reassignment, no duplicate Claude, existing designers preserved, full-slide rendering brief queued. Mocked queue only.');
})().catch(e=>{console.error(e);process.exit(1);});
