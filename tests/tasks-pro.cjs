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
 notices:[{id:'n1',task_id:'t4',message:'تم تحديث مهمة',created_at:iso(-1),read_at:null}],
 updates:{t1:[{id:'u1',task_id:'t1',author_id:'a3',body:'بدأت الشغل https://drive.google.com/x.',status_from:'todo',status_to:'in_progress',created_at:iso(-1)}]}
};
if(location.search==='?empty'){mock.tasks=[];mock.notices=[];}
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
 taskListAttachments:function(id){return Promise.resolve(mock.atts.slice())},

 taskMarkNotificationRead:function(id){calls.push(['read',id]);mock.notices.forEach(function(n){if(n.id===id)n.read_at='x'});return Promise.resolve()}
};
</script><script src="/assets/js/render-tasks.js"></script><script>SSMPDRenderTasks.render(document.getElementById('r'))</script></body></html>`;
(async()=>{
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('content-type','text/html');return res.end(page_html);}const f=path.join(root,url);if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end();}const ext=path.extname(f);res.setHeader('content-type',ext==='.css'?'text/css':ext==='.js'?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(f));}).listen(0);
const port=server.address().port;
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox']});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('native dialog: '+d.message());d.dismiss();});
  await page.goto('http://localhost:'+port+'/');await page.waitForSelector('.tsk-card');
  const shot=async n=>{if(process.env.TASKS_SHOTS)await page.screenshot({path:process.env.TASKS_SHOTS+'/'+n+'-'+width+'.png',fullPage:true});};await shot('list');
  const titles=()=>page.$$eval('.tsk-list .tsk-card h3',els=>els.map(e=>e.textContent));
  // 2 + 4: smart sort — overdue first, done last; subtasks collapsed by default
  let t=await titles();
  assert.equal(t[0],'رفع الشيت','overdue first');assert.equal(t[t.length-1],'مهمة قديمة خلصت','done last');
  assert(!t.includes('مهمة فرعية أولى'),'subtasks collapsed by default');
  assert(!t.includes('مهمة في مشروع قديم'),'archived project tasks hidden');
  // 4: due note
  assert(/متأخرة 3 أيام/.test(await page.locator('[data-task-id=t2]').first().textContent()),'late note');
  assert(/باقي 3 أيام/.test(await page.locator('[data-task-id=t1]').first().textContent()),'days left note');
  // 7: toggle subtasks
  assert(/2 مهام فرعية · 1 مكتملة/.test(await page.locator('[data-task-id=t1] .tsk-sub-toggle').textContent()));
  await page.locator('[data-task-id=t1] .tsk-sub-toggle').click();t=await titles();
  assert(t.includes('مهمة فرعية أولى')&&t.includes('مهمة فرعية تانية'),'subtasks expand under parent');
  assert.deepEqual(t.slice(t.indexOf('جرد المخزن الطبي')+1,t.indexOf('جرد المخزن الطبي')+3),['مهمة فرعية تانية','مهمة فرعية أولى'],'children follow their parent (open before done)');
  await page.locator('[data-task-id=t1] .tsk-sub-toggle').click();
  // 5: project progress (done 2 of 6 in p1: t3,t5)
  assert(/2 من 6 مكتملة/.test(await page.locator('[data-project-id=p1]').textContent()),'project progress');
  // batch 1: health badge, collapsed members, clickable stat cards, overdue chip
  assert(/1 متأخرة/.test(await page.locator('[data-project-id=p1] .tsk-health').textContent()),'project health badge');
  assert.equal(await page.locator('[data-project-id=p1] .tsk-chips .tsk-chip:not(.tsk-chip-more)').count(),3,'only 3 members shown');
  await page.locator('[data-project-id=p1] .tsk-chip-more').click();assert.equal(await page.locator('[data-project-id=p1] .tsk-chips .tsk-chip:not(.tsk-chip-more)').count(),5,'members expand');
  await page.locator('[data-project-id=p1] .tsk-chip-more').click();
  assert(/منها 1 آخر 7 أيام/.test(await page.locator('.tsk-stat.st-green').textContent())&&/2/.test(await page.locator('.tsk-stat.st-green b').textContent()),'completed card counts all done tasks');
  await page.locator('.tsk-stat.st-red').click();assert.deepEqual(await titles(),['رفع الشيت'],'overdue stat filters');assert(await page.locator('.tsk-fchip.on.s-blocked').count()===1,'overdue chip active');
  await page.locator('.tsk-stat.st-green').click();assert((await titles()).includes('مهمة قديمة خلصت'),'done stat filters');
  await page.locator('.tsk-fchip').first().click();
  // 3: search (Arabic normalisation) + project/assignee filters
  const input=page.locator('[data-search]');await input.fill('جرد');
  t=await titles();assert(t.includes('جرد المخزن الطبي')&&!t.includes('رفع الشيت'),'search filters');
  assert(await input.evaluate(el=>el===document.activeElement),'search keeps focus while typing');
  await input.fill('');
  await page.selectOption('[data-sel=assignee]',{label:'شروق'});t=await titles();assert(t.every(x=>['رفع الشيت','مهمة قديمة خلصت','مهمة في مشروع قديم'].includes(x))&&t.length===2,'assignee filter: '+t);
  await page.selectOption('[data-sel=assignee]','');
  // 2: sort by priority
  await page.selectOption('[data-sel=sort]','priority');t=await titles();assert.equal(t[0],'رفع الشيت','urgent first');
  await page.selectOption('[data-sel=sort]','smart');
  // status chips with counts
  assert(/\d/.test(await page.locator('.tsk-fchip').first().textContent()));
  await page.locator('.tsk-fchip.s-review').click();t=await titles();assert.deepEqual(t,['رفع الشيت']);await page.locator('.tsk-fchip').first().click();
  // 13: empty filtered state with clear button
  await input.fill('لا يوجد شيء مثل هذا');assert(await page.locator('.tsk-empty-rich [data-action=clear-filters]').count()===1);await page.locator('[data-action=clear-filters]').click();assert((await titles()).length>=3);
  // 13: employee summary table
  const rows=await page.$$eval('.tsk-team tbody tr',r=>r.map(x=>x.querySelector('b').textContent));assert(rows.includes('محمد')&&rows.includes('شروق'),'team table');
  // 1 + 12: note modal instead of prompt; required validation, then RPC
  await page.locator('[data-task-id=t1] [data-action=progress]').first().click();assert(await page.locator('.tsk-modal form[data-form=note]').count()===1);
  await page.locator('.tsk-modal [type=submit]').click();assert(await page.locator('.tsk-field-error:visible').count()===1,'required note error');
  assert.equal(await page.evaluate(()=>calls.length),0,'no RPC before text');
  await page.fill('.tsk-modal textarea','خلصت الرف الأول');await page.locator('.tsk-modal [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.tsk-modal'));
  assert.deepEqual(await page.evaluate(()=>calls.pop()),['status','t1','in_progress','خلصت الرف الأول']);
  // 12: approve needs confirmation modal, note optional
  await page.locator('[data-task-id=t2] [data-action=approve]').first().click();assert(/هتتقفل/.test(await page.locator('.tsk-modal').textContent()),'approve confirm');
  await page.locator('.tsk-modal [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.tsk-modal'));assert.deepEqual(await page.evaluate(()=>calls.pop()),['review','t2',true,'']);
  await page.locator('[data-task-id=t2] [data-action=return]').first().click();await page.locator('.tsk-modal [type=submit]').click();assert(/اكتب سبب الإرجاع/.test(await page.locator('.tsk-field-error').textContent()));await page.keyboard.press('Escape');assert.equal(await page.locator('.tsk-modal').count(),0,'Escape closes');
  // 9: comments + linkified link
  await page.locator('[data-task-id=t1] [data-action=history]').first().click();await page.waitForSelector('.tsk-comment-form');
  assert.equal(await page.locator('.tsk-history a[href="https://drive.google.com/x"]').count(),1,'link rendered without trailing dot');
  await page.fill('.tsk-comment-form textarea','تعليق جديد');await page.locator('.tsk-comment-form [type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.tsk-history article').length===2);
  assert.deepEqual(await page.evaluate(()=>calls.pop()),['comment','t1','تعليق جديد',0]);
  // attachments: validation, chips, remove, upload + comment, open via signed URL
  await page.setInputFiles('[data-comment-files]',[{name:'virus.exe',mimeType:'application/octet-stream',buffer:Buffer.from('x')}]);assert(/غير مسموح/.test(await page.locator('.tsk-field-error').textContent()),'bad type rejected');
  await page.setInputFiles('[data-comment-files]',[{name:'big.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(10485761)}]);assert(/أكبر من 10 ميجا/.test(await page.locator('.tsk-field-error').textContent()),'oversize rejected');
  await page.fill('.tsk-comment-form textarea','نص قبل الملفات');
  await page.setInputFiles('[data-comment-files]',[{name:'جرد.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')},{name:'صورة.png',mimeType:'image/png',buffer:Buffer.from('x')}]);
  assert.equal(await page.locator('.tsk-file-chip').count(),2,'two chips');assert.equal(await page.inputValue('.tsk-comment-form textarea'),'نص قبل الملفات','typed text survives');
  await page.locator('.tsk-file-chip button').last().click();assert.equal(await page.locator('.tsk-file-chip').count(),1,'chip removed');
  await page.locator('.tsk-comment-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('.tsk-att'));
  const fc=await page.evaluate(()=>calls.filter(c=>c[0]==='upload'||c[0]==='comment').slice(-2));assert.deepEqual(fc,[['upload','t1','جرد.pdf'],['comment','t1','نص قبل الملفات',1]]);
  assert(/جرد\.pdf/.test(await page.locator('.tsk-att').first().textContent()),'attachment chip in history');
  const href=await page.locator('a.tsk-att').first().getAttribute('href');assert(/^https:\/\/drive\.google\.com\//.test(href),'attachment opens the Drive link');assert.equal(await page.locator('a.tsk-att').first().getAttribute('target'),'_blank');
  // more than 10 files rejected
  await page.setInputFiles('[data-comment-files]',Array.from({length:11},(_,i)=>({name:'f'+i+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('x')})));assert.equal(await page.locator('.tsk-file-chip').count(),10,'up to 10 files');assert(/الحد الأقصى 10/.test(await page.locator('.tsk-field-error').textContent()));
  await page.locator('.tsk-file-chip button').first().click();while(await page.locator('.tsk-file-chip').count())await page.locator('.tsk-file-chip button').first().click();
  // attachment-only comment is allowed, empty one is not
  await page.locator('.tsk-comment-form [type=submit]').click();assert(/اكتب التعليق أو أرفق/.test(await page.locator('.tsk-field-error').textContent()));
  await page.keyboard.press('Escape');
  // 6: board view
  await page.locator('[data-action=view][data-id=board]').click();assert.equal(await page.locator('.tsk-col').count(),6,'six columns');
  await shot('board');assert(await page.locator('.tsk-col.s-review .tsk-mini').count()===1);assert.equal(await page.locator('.tsk-fchip').count(),0,'no status chips in board');
  await page.locator('.tsk-col.s-review .tsk-mini').click();assert(await page.locator('.tsk-modal .tsk-card').count()===1,'board card opens details');await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>localStorage.getItem('ssmpd.tasks.view')),'board','view remembered');
  await page.locator('[data-action=view][data-id=list]').click();
  // 11: notification opens the task
  await page.locator('[data-action=notifications]').click();await page.locator('.tsk-notice').first().click();await page.waitForFunction(()=>!document.querySelector('.tsk-modal')&&document.querySelector('[data-task-id=t4].tsk-flash'));
  assert(/مهمة فرعية تانية/.test(await page.locator('[data-task-id=t4]').first().textContent()),'notification expands parent and focuses child');
  assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c[0]==='read')),[['read','n1']]);
  // 10: archive project hides it and its tasks; toggle shows them back
  await page.locator('[data-project-id=p1] [data-action=archive-project]').click();assert(/المشروع ومهامه هيختفوا/.test(await page.locator('.tsk-modal').textContent()));
  await page.locator('.tsk-modal [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.tsk-modal'));
  assert.deepEqual(await page.evaluate(()=>calls.pop()),['archive','p1',true]);assert.equal(await page.locator('[data-project-id=p1]').count(),0,'archived project hidden');
  assert.equal((await titles()).includes('رفع الشيت'),false,'archived tasks hidden');
  assert(/عرض المؤرشفة \(2\)/.test(await page.locator('[data-action=toggle-archived]').textContent()));
  await page.locator('[data-action=toggle-archived]').click();assert.equal(await page.locator('[data-project-id=p1].is-archived').count(),1);
  assert((await titles()).includes('رفع الشيت'),'tasks back when showing archived');
  assert.deepEqual(errors,[],'page errors / native dialogs');
  await page.close();
 }
 // 13: nothing at all
 // checklist + calendar
 {const cp=await browser.newPage({viewport:{width:1100,height:900}});const ce=[];cp.on('pageerror',e=>ce.push(e.message));
  await cp.goto('http://localhost:'+port+'/');await cp.waitForSelector('.tsk-card');
  assert(/\(0\/1\)/.test(await cp.locator('[data-action="checklist"][data-id="t1"]').textContent()),'checklist counter on card');
  await cp.click('[data-action="checklist"][data-id="t1"]');await cp.waitForSelector('.tsk-checklist');
  await cp.fill('.tsk-check-add input','بند ثاني');await cp.click('.tsk-check-add button');
  await cp.waitForFunction(()=>document.querySelectorAll('.tsk-check-row').length===2);
  await cp.check('[data-check-id="c1"]');
  await cp.waitForFunction(()=>document.querySelector('.tsk-check-row.done'));
  await cp.click('[data-action="check-remove"]:last-of-type');
  await cp.waitForFunction(()=>document.querySelectorAll('.tsk-check-row').length===1);
  await cp.click('.tsk-modal header button');
  await cp.click('[data-action="view"][data-id="calendar"]');await cp.waitForSelector('.tsk-cal-grid');
  assert(await cp.locator('.tsk-cal-chip').count()>=1,'calendar shows chips');
  await cp.click('[data-action="cal-next"]');await cp.click('[data-action="cal-today"]');
  await cp.click('.tsk-cal-chip >> nth=0');await cp.waitForSelector('.tsk-modal');
  assert.deepEqual(ce,[],ce.join('|'));await cp.close();}
 const empty=await browser.newPage({viewport:{width:1000,height:800}});
 await empty.goto('http://localhost:'+port+'/?empty');await empty.waitForSelector('.tsk-empty-rich');
 assert(/مفيش مهام لسه/.test(await empty.locator('.tsk-empty-rich').last().textContent()),'friendly empty state');
 console.log('PASS: smart sort, due notes, search/filters, collapsible subtasks, project progress, board view, note modals (no native prompt), approve confirm, comments with links, notification focus, archive, team table, empty states. Mocked database only.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
