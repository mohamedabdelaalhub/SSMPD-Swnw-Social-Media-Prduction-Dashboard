const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
(async()=>{
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"><div id="tabs-bar"></div><div id="mobile-menu"><div class="mm-tabs"></div></div><div id="user-dropdown"><div class="ud-items"></div></div><div id="brand-section-name"></div><main id="view-container"></main></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 let reviews=0,taskMutations=0;
 const members=[
 {code:'sia',display_name:'سيا',title_ar:'المساعد الإداري',member_kind:'system_identity',active:true,metrics:{}},
 {code:'hapi',display_name:'حابي',title_ar:'الاستقبال',member_kind:'external_agent',active:true,metrics:{}},
 {code:'claude_creative',display_name:'Claude Creative',title_ar:'الإنتاج',member_kind:'existing_admin',active:true,metrics:{capabilities:[],roles:[]}},
 ...[['hor','حور'],['hotep','حتب'],['nefer','نفر'],['maat','ماعت']].map(([code,display_name])=>({code,display_name,title_ar:'مراجعة',member_kind:'external_agent',active:true,metrics:{}}))
 ];
 const fake={
  rpc:async(name)=>{if(name==='digital_team_dashboard')return{data:{members},error:null};if(name==='digital_agent_recent_reviews')return{data:{is_owner:true,reviews:[]},error:null};taskMutations++;throw Error('Forbidden RPC '+name);},
  from(name){const query={select(){return this;},eq(){return this;},order(){return this;},in(){return this;},limit(){return Promise.resolve({data:name==='tasks'?[{id:'d3ed53c0-cfa7-496a-97c4-5da7fde6a7e2',title:'التواصل مع أول 10 مؤسسات',status:'review'}]:name==='task_work_results'?[{task_id:'d3ed53c0-cfa7-496a-97c4-5da7fde6a7e2',attachments:[{file_id:'file1'}]}]:[],error:null});}};return query;},
  functions:{invoke:async(name,args)=>{assert.equal(name,'assistant-task-evidence-review');assert.equal(args.body.task_id,'d3ed53c0-cfa7-496a-97c4-5da7fde6a7e2');reviews++;return{data:{ok:true,available:true,assessment:'inconsistent',summary:'ملخص المهمة يتعارض مع سجل Excel',differences:[{finding:'التواصل المذكور هاتفي بينما السجل فيسبوك',file_evidence:'طريقة التواصل: رسائل فيسبوك'}],owner_action:'اطلب توضيحا',executed:false,task_status_unchanged:true},error:null};}}
 };
 w.SSMPDAuth={currentAdmin:{id:'owner',role:'super_admin'}};
 w.SSMPD_CONFIG={supabase:{url:'https://fake.invalid',anonKey:'mock'}};
 w.supabase={createClient:()=>fake};
 w.eval(fs.readFileSync('assets/js/digital-team.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 await sleep(20);d.querySelector('#user-dropdown [data-digital-team-tab]').click();await sleep(40);
 assert.equal(d.querySelectorAll('.dt-member').length,7);
 const section=d.querySelector('[data-dt-sia-evidence]');assert(section,'Sia evidence review available to owner');
 section.open=true;section.dispatchEvent(new w.Event('toggle'));await sleep(35);
 const selector=section.querySelector('[data-dt-sia-task]');
 assert(selector.options.length>=2,'attached tasks loaded');
 selector.value='d3ed53c0-cfa7-496a-97c4-5da7fde6a7e2';
 section.querySelector('[data-dt-sia-run]').click();await sleep(40);
 assert.equal(reviews,1,'review called once');
 assert(section.textContent.includes('ملخص المهمة يتعارض'),'read-only result visible');
 assert(section.textContent.includes('حالة المهمة لم تتغير'),'no task status changes');
 assert.equal(taskMutations,0,'no mutating task RPCs');
 dom.window.close();console.log('PASS manual Sia evidence review, owner flow, no task mutations');
})().catch(e=>{console.error(e);process.exit(1);});