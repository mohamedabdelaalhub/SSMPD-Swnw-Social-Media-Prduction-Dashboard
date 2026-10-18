const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const page_html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/css/styles.css"><link rel="stylesheet" href="/assets/css/tasks.css"></head><body><div id="r"></div>
<script>
var day=86400000,now=Date.now(),iso=function(n){return new Date(now+n*day).toISOString()};
window.calls=[];
window.mock={
 archived:{p2:1},
 projects:[{id:'p1',title:'التحول الرقمي للمخزن',description:'وصف',manager_id:'a2',can_manage:true,members:[{id:'a1',name:'محمد',role:'manager'},{id:'a3',name:'شروق',role:'contributor'},{id:'a4',name:'منى',role:'reviewer'},{id:'a5',name:'علي',role:'contributor'},{id:'a6',name:'هدى',role:'contributor'}]},{id:'p2',title:'مشروع قديم',description:'',manager_id:'a2',can_manage:true,members:[]}],
 tasks:[
  {id:'t1',project_id:'p1',title:'جرد المخزن الطبي',status:'in_progress',assignee_id:'a1',assignee_name:'محمد',due_at:iso(3),priority:'normal',updated_at:iso(-1),can_manage:true},
  {id:'t2',project_id:'p1',title:'رفع الشيت',status:'review',assignee_id:'a3',assignee_name:'شروق',due_at:iso(-3),priority:'urgent',updated_at:iso(-2),can_manage:true},
  {id:'t3',project_id:'p1',parent_task_id:'t1',title:'مهمة فرعية أولى',status:'done',assignee_id:'a1',assignee_name:'محمد',due_at:iso(1),priority:'low',updated_at:iso(-1),can_manage:true},
  {id:'t4',project_id:'p1',parent_task_id:'t1',title:'مهمة فرعية تانية',status:'todo',assignee_id:'a1',assignee_name:'محمد',due_at:iso(2),priority:'low',updated_at:iso(-1),can_manage:true},
  {id:'t5',project_id:'p1',title:'مهمة قديمة خلصت',status:'done',assignee_id:'a3',assignee_name:'شروق',due_at:iso(-9),priority:'high',updated_at:iso(-8),can_manage:true},
  {id:'t6',project_id:'p2',title:'مهمة في مشروع قديم',status:'todo',assignee_id:'a3',assignee_name:'شروق',due_at:iso(5),priority:'normal',updated_at:iso(-1),can_manage:true},
  {id:'t7',project_id:'p1',title:'تنظيف الرفوف',status:'todo',assignee_id:'a1',assignee_name:'محمد',due_at:null,priority:'high',updated_at:iso(-5),can_manage:true}
 ],
 atts:[],
 notices:[{id:'n1',task_id:'t4',kind:'comment',message:'تم تحديث مهمة',created_at:iso(-1),read_at:null}],
 updates:{t1:[{id:'u1',task_id:'t1',author_id:'a3',body:'بدأت الشغل https://drive.google.com/x.',status_from:'todo',status_to:'in_progress',created_at:iso(-1)}]}
};
if(location.search==='?empty'){mock.tasks=[];mock.notices=[];mock.projects=[];}
mock.chk={t1:[{id:'c1',body:'بند أول',done:false}]};
window.SSMPDAuth={currentAdmin:{id:'a1'}};
window.SSMPDRoles={hasAnyRole:function(){return true},canModuleAction:function(){return true},isControlledFinance:function(){return false}};
window.SSMPDDb={
 taskRefreshOverdue:function(){return Promise.resolve(0)},
 taskListNotifications:function(){return Promise.resolve(mock.notices)},
 taskPeople:function(){return Promise.resolve([{id:'a1',name:'محمد'},{id:'a2',name:'Dr. Dina'},{id:'a3',name:'شروق'}])},
 taskListProjects:function(){return Promise.resolve(mock.projects)},
 taskListVisible:function(){return Promise.resolve(mock.tasks)},
 taskProjectArchives:function(){return Promise.resolve(Object.keys(mock.archived).map(function(id){return {id:id,archived_at:'x'}}))},
 taskSetProjectArchived:function(id,on){calls.push(['archive',id,on]);if(on)mock.archived[id]=1;else delete mock.archived[id];return Promise.resolve()},
 taskSetStatus:function(id,status,note){calls.push(['status',id,status,note]);return Promise.resolve()},
 taskReview:function(id,ok,note){calls.push(['review',id,ok,note]);return Promise.resolve()},
 taskListUpdates:function(id){return Promise.resolve((mock.updates[id]||[]).slice())},
 taskAddComment:function(id,body,atts){atts=atts||[];calls.push(['comment',id,body,atts.length]);var uid='u'+Math.random();(mock.updates[id]=mock.updates[id]||[]).unshift({id:uid,task_id:id,author_id:'a1',body:body||'مرفقات',created_at:new Date().toISOString()});atts.forEach(function(a){mock.atts.push({id:'f'+Math.random(),update_id:uid,file_name:a.name,mime_type:'application/pdf',size_bytes:2048,file_url:a.url})});return Promise.resolve()},
 taskUploadAttachment:function(id,file){calls.push(['upload',id,file.name]);return Promise.resolve({name:file.name,url:'https://drive.google.com/file/d/'+encodeURIComponent(file.name)+'/view',file_id:'x',size:file.size,mime:file.type})},
 taskChecklistCounts:function(ids){var o={};ids.forEach(function(i){var l=mock.chk[i]||[];if(l.length)o[i]={total:l.length,done:l.filter(function(c){return c.done}).length}});return Promise.resolve(o)},
 taskChecklistList:function(id){return Promise.resolve((mock.chk[id]||[]).slice())},
 taskChecklistAdd:function(id,b){calls.push(['chk-add',id,b]);(mock.chk[id]=mock.chk[id]||[]).push({id:'c'+Math.random(),body:b,done:false});return Promise.resolve()},
 taskChecklistToggle:function(id,d){calls.push(['chk-toggle',id,d]);Object.keys(mock.chk).forEach(function(k){mock.chk[k].forEach(function(c){if(c.id===id)c.done=d})});return Promise.resolve()},
 taskChecklistRemove:function(id){calls.push(['chk-rm',id]);Object.keys(mock.chk).forEach(function(k){mock.chk[k]=mock.chk[k].filter(function(c){return c.id!==id})});return Promise.resolve()},
 taskWorkResults:function(){return Promise.resolve([])},
 taskListAttachments:function(id){return Promise.resolve(mock.atts.slice())},

 taskMarkNotificationRead:function(id){calls.push(['read',id]);mock.notices.forEach(function(n){if(n.id===id)n.read_at='x'});return Promise.resolve()}
};
</script><script src="/assets/js/task-work.js"></script><script src="/assets/js/render-tasks.js"></script><script>SSMPDRenderTasks.render(document.getElementById('r'))</script></body></html>`;
(async()=>{
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('content-type','text/html');return res.end(page_html);}const f=path.join(root,url);if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end();}const ext=path.extname(f);res.setHeader('content-type',ext==='.css'?'text/css':ext==='.js'?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(f));}).listen(0);
const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox']});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('native dialog: '+d.message());d.dismiss();});
  await page.goto('http://localhost:'+port+'/');await page.waitForSelector('.tv-proj');
  const txt=s=>page.locator(s).first().textContent();
  // ---- الرئيسية: المشاريع فقط + شريط "محتاج منك" ----
  assert.equal(await page.locator('.tv-row').count(),0,'home shows projects only, no task rows');
  assert.equal(await page.locator('.tv-proj').count(),1,'archived project hidden');
  const need=async k=>Number(await page.locator('.tv-need.n-'+k+' b').textContent());
  assert.equal(await need('review'),1);assert.equal(await need('mine'),3);assert.equal(await need('overdue'),0);assert.equal(await need('soon'),1);assert.equal(await need('notices'),1);
  assert(/1 تعليق جديد/.test(await txt('.tv-proj')),'tile shows unread comment line');
  assert(/المناقشة\s*1/.test(await txt('.tv-tabs')),'comments tab shows unread count');
  await page.click('.tv-tab[data-id=comments]');assert.equal(await page.locator('.tv-comment.new').count(),1,'comments tab lists the new comment');
  await page.click('.tv-tab[data-id=projects]');
  const tile=await txt('.tv-proj');
  assert(/من 6 مهمة تمت/.test(tile)&&/33%/.test(tile),'tile summary: done of total + percent');
  assert(await page.locator('.tv-proj .tv-bar i').count()>=3,'segmented bar');
  assert(/المتبقي\s*4/.test(tile),'remaining count');assert(/شغّالة/.test(tile)&&/مراجعة/.test(tile)&&/لم تبدأ/.test(tile),'legend');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'no horizontal overflow (home)');
  // ---- صفحة المشروع ----
  await page.click('.tv-proj');await page.waitForSelector('.tv-page');
  assert.equal(await page.locator('.tv-group.g-late .tv-row').count(),0,'review waiting is not employee lateness');assert.equal(await page.locator('.tv-group.g-review .tv-row').count(),1,'manager review group');assert.equal(await page.locator('.tv-group.g-active .tv-row').count(),1,'active group');assert.equal(await page.locator('.tv-group.g-todo .tv-row').count(),1,'todo group (roots only)');
  assert.equal(await page.locator('details.tv-done').getAttribute('open'),null,'done section collapsed');assert(/1/.test(await txt('details.tv-done summary')));
  assert(/☑ 0\/1/.test(await txt('[data-task-id="t1"]')),'checklist counter on row');
  await page.click('[data-action="toggle-sub"][data-id="t1"]');assert.equal(await page.locator('.tv-kids .tv-row').count(),2,'subtasks expand under parent');
  await page.click('[data-action="pf"][data-id="review"]');assert.equal(await page.locator('.tv-page .tv-row').count(),1,'filter chip narrows list');await page.click('[data-action="pf"][data-id="all"]');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'no horizontal overflow (project)');
  // ---- تفاصيل المهمة ----
  await page.click('[data-task-id="t2"] .tv-row-main');await page.waitForSelector('.tv-detail');
  const d=await txt('.tv-detail');assert(/رفع الشيت/.test(d)&&/المسؤول/.test(d)&&/موعد التسليم/.test(d)&&/عاجلة/.test(d),'detail facts');
  assert(!/[٠-٩]/.test(d),'latin digits in detail');
  assert.equal(await page.locator('.tv-detail [data-action="approve"]').count(),1,'review actions inside detail');
  await page.click('.tv-detail [data-action="approve"]');await page.waitForSelector('[data-form="note"]');await page.click('[data-form="note"] button[type=submit]');
  await page.waitForFunction(()=>calls.some(c=>c[0]==='review'&&c[1]==='t2'&&c[2]===true));
  // ---- إشعار يفتح المهمة في مكانها ----
  await page.click('[data-action="notifications"]');await page.click('[data-action="read-notice"]');await page.waitForSelector('.tv-detail');
  assert(/مهمة فرعية تانية/.test(await txt('.tv-d-title')),'notice opens the task detail');assert.equal(await page.locator('.tv-crumb .tv-link').count(),1,'crumb links to parent task');
  await page.keyboard.press('Escape');await page.waitForSelector('.tv-page');
  // ---- تابات المنجزة وكل المهام وعدادات الشريط ----
  await page.click('[data-action="tab"][data-id="done"]');await page.waitForSelector('.tv-group');assert(await page.locator('.tv-groups .tv-row').count()>=2,'done tab lists finished tasks');assert(/آخر 7 أيام|النهارده|أمس|الأسبوع/.test(await txt('.tv-groups')),'grouped by period');
  await page.click('[data-action="tab"][data-id="projects"]');await page.waitForSelector('.tv-proj');
  await page.click('.tv-need.n-overdue');await page.waitForSelector('.tsk-empty-rich');assert.equal(await page.locator('.tv-row').count(),0,'review waiting does not enter employee-overdue filter');
  await page.click('[data-action="tab"][data-id="team"]');assert(await page.locator('.tsk-week').count()===1,'team tab');
  assert.deepEqual(errors,[],errors.join('|'));await page.close();
 }
 const empty=await browser.newPage({viewport:{width:1000,height:800}});
 await empty.goto('http://localhost:'+port+'/?empty');await empty.waitForSelector('.tv-empty');
 assert(/مفيش مشاريع لسه/.test(await empty.locator('.tv-empty').first().textContent()),'friendly empty state');
 console.log('PASS: projects-first home with needs strip, project page with grouped rows/sub-tasks/filters, clean task detail with actions, notice opens task in place, done/all/team tabs, desktop and mobile. Mocked database only.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
