const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const dom=new JSDOM('<div id="view-container"></div>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
 let current={id:'item',title:'اختبار',brand:'sono',content_format:'image_post',stage:'initial_approval',created_by:'owner'},calls=0,opened=0,fail=false;
 w.alert=()=>{};w.SSMPDAuth={currentAdmin:{id:'reviewer'}};
 w.SSMPDWorkflow={STAGES:['initial_approval','in_design','final_approval'].map(key=>({key,label:key})),brandBadgeHtml:()=>'',specialtyBadgeHtml:()=>'',contentFormatDetailsHtml:()=>'',stageLabel:s=>s,itemActionsHtml:()=>'',metaLinksSectionHtml:()=>'',brandSelectHtml:()=>'<select id="rv-brand"></select>',specialtySelectHtml:()=>'<select id="rv-specialty"></select>',wireItemActions:()=>{},wireMetaLinksSection:()=>{}};
 w.SSMPDComments={computeCommentStats:()=>({}),commentButtonHtml:()=>'',render:()=>{}};
 w.SSMPDDb={listContentItems:async()=>[current],listAdminsBasic:async()=>[],listAllComments:async()=>[],listMyCommentReads:async()=>[],listDesignersAll:async()=>[{id:'designer',name:'مصمم'}],getAppSettings:async()=>null,routeContentDesign:async(id,target,designer)=>{calls++;await tick();if(fail)throw Error('error');current={...current,stage:'in_design',design_execution:target,assigned_designer:designer};return current;},logActivity:async()=>{}};
 w.SSMPDDrive={logDesignSent:async()=>{}};w.SSMPDDesignStudio={open:()=>opened++};w.SSMPDRenderProduction={renderVideoJobSection:()=>opened++};
 w.eval(fs.readFileSync(path.join(root,'assets/js/render-review.js'),'utf8'));
 async function show(){w.SSMPDRenderReview.render(w.document.getElementById('view-container'));await tick();w.document.querySelector('[data-id="item"]').click();}
 await show();assert(w.document.querySelector('#rv-designer option[value="ai"]'));assert(w.document.querySelector('#rv-designer option[value="designer"]'));
 w.document.querySelector('#rv-designer').value='ai';const button=w.document.querySelector('#rv-approve');button.click();button.click();await tick();await tick();
 assert.equal(calls,1);assert.equal(opened,1);assert.equal(current.assigned_designer,null);
 await show();assert(w.document.querySelector('#rv-ai-open'));assert(w.document.querySelector('#rv-ai-submit'));
 w.document.querySelector('.modal-backdrop').remove();current={...current,stage:'initial_approval',design_execution:'human'};fail=true;await show();w.document.querySelector('#rv-designer').value='ai';w.document.querySelector('#rv-approve').click();await tick();await tick();assert.equal(w.document.querySelector('#rv-approve').disabled,false);
 dom.window.close();console.log('PASS — AI and human choices, double-click prevention, editor handoff, final-review action and error recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
