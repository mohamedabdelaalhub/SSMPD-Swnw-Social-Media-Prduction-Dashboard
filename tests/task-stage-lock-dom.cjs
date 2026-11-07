const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const read=n=>fs.readFileSync(__dirname+'/../assets/js/'+n+'.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only',virtualConsole:vc}),w=dom.window,d=w.document,el=d.querySelector('main');
 const now=new Date().toISOString(),T=(o)=>Object.assign({project_id:'p',assignee_id:'staff',updated_at:now},o);
 const tasks=[
  T({id:'main',title:'الحملة الرئيسية',status:'in_progress',assigner_name:'Claude Creative',sort_order:1}),
  T({id:'s1',parent_task_id:'main',title:'مرحلة <b>البحث</b>',status:'done',sort_order:1}),
  T({id:'s3',parent_task_id:'main',title:'مرحلة التصميم',status:'todo',assignee_id:'other',assignee_name:'سارة',sort_order:3}),
  T({id:'s2',parent_task_id:'main',title:'مرحلة الكتابة',status:'review',sort_order:2})
 ];
 w.SSMPDAuth={currentAdmin:{id:'staff'}};w.SSMPDRoles={canModuleAction:()=>true,hasAnyRole:()=>false,isControlledFinance:()=>false};
 w.SSMPDDb={taskRefreshOverdue:async()=>0,taskListProjects:async()=>[{id:'p',title:'الخطة',members:[]}],taskListVisible:async()=>tasks,taskPeople:async()=>[],taskListNotifications:async()=>[],taskProjectArchives:async()=>[],taskWorkResults:async()=>[],taskListUpdates:async()=>[],taskListAttachments:async()=>[]};
 w.eval(read('task-work'));w.eval(read('render-tasks'));w.SSMPDRenderTasks.render(el);await tick();
 w.SSMPDRenderTasks.focus('main');await tick();
 const submit=d.querySelector('[data-work-submit]'),lock=d.querySelector('.tw-lock');
 assert(submit.disabled,'main submit stays disabled while stages are not approved');
 assert(lock,'lock explanation shown');assert.equal(submit.getAttribute('aria-describedby'),lock.id,'button linked to explanation');
 assert(lock.textContent.includes('فاضل 2 من 3'),'counts pending stages');
 const items=[...lock.querySelectorAll('li')];assert.equal(items.length,2,'only non-approved stages listed');
 assert(items[0].textContent.includes('مرحلة الكتابة')&&items[0].textContent.includes('مستنية اعتماد المدير'),'ordered by manager order with status hint');
 assert(items[1].textContent.includes('مع سارة'),'shows stage owner when it is someone else');
 assert(!lock.textContent.includes('البحث'),'approved stage not listed');
 items[1].querySelector('[data-action=open-task]').click();await tick();
 assert.equal(d.querySelector('.tv-d-title, .tv-detail h2').textContent.trim(),'مرحلة التصميم','open-stage button opens the blocking stage');
 // all approved -> no lock, button enabled
 tasks.forEach(t=>{if(t.parent_task_id)t.status='done';});w.SSMPDRenderTasks.render(el);await tick();w.SSMPDRenderTasks.focus('main');await tick();
 assert.equal(d.querySelector('.tw-lock'),null);assert.equal(d.querySelector('[data-work-submit]').disabled,false,'submit enabled once all stages approved');
 assert.deepEqual(errors,[]);dom.window.close();console.log('PASS task stage lock: explains disabled submit, lists pending stages in order with status/owner, opens blocking stage, unlocks when all approved.');
})().catch(e=>{console.error(e);process.exit(1)});
