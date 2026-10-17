const {JSDOM}=require('jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<button id="notif-bell-btn"></button><span id="notif-badge"></span><div id="notif-panel" hidden></div><div id="root"></div>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,root=w.document.getElementById('root'),opened=[];
const admin={id:'manager',name:'مدير',role:'super_admin'};
let notices=[{key:'one',id:'t1',type:'task',message:'تحديث المهمة',read:false}];
w.SSMPDAuth={currentAdmin:admin};
w.SSMPDRoles={canSeeTab:()=>true,labelAll:()=>'',hasAnyRole:()=>true};
w.SSMPDDb={unsubscribe(){},setContentRating:()=>Promise.resolve(),client:{rpc:async(name)=>({data:name==='personal_home_inbox'?{notices,unread:notices.filter(x=>!x.read).length}:name==='personal_home_rating_queue'?[{id:'c2',title:'منشور للتقييم'}]:{tasks:{open:2,late:1,review:1,team_open:3,team_late:1,blocked:0,mine:[{id:'t1',title:'مهمة الموظف'}],reviews:[{id:'t2',title:'مهمة للمراجعة'}],team:[{id:'t3',title:'مهمة الفريق'}]},content:{approval:1,design:1,revision:0,publish:0,items:[{id:'c1',title:'مادة للمراجعة',bucket:'approval'},{id:'c3',title:'تصميم',bucket:'design'}]},supplies:[{id:'s1',requester_name:'موظف',location_name:'مستلزمات',status:'pending',can_manage:true}]}})}};
w.eval(fs.readFileSync('assets/js/personal-home.js','utf8'));
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 w.SSMPDPersonalHome.mountNotifications(admin,{open:(type,id)=>opened.push([type,id])});
 await w.SSMPDPersonalHome.render(root);await tick();
 assert.equal(root.querySelectorAll('.ph-summary-card').length,6);
 assert.equal(root.querySelectorAll('.ph-section-dialog').length,6);
 assert.equal(root.querySelectorAll('.ph-section-dialog[open]').length,0);
 assert.equal(root.querySelector('.ph-layout'),null);
 assert(root.querySelector('.ph-summary-grid').compareDocumentPosition(root.querySelector('.ph-shortcut-card'))&4);
 for(const key of ['approvals','rating','mine','notices','team','content']){
  const trigger=root.querySelector('[data-home-detail="'+key+'"]');trigger.click();
  const dialog=root.querySelector('[data-home-dialog="'+key+'"]');assert(dialog.hasAttribute('open'));
  assert(dialog.querySelector('[data-home-tab], [data-home-all-notices]'));
  const task=dialog.querySelector('[data-home-task]');if(task){task.click();assert.equal(opened.at(-1)[0],'task');}
  dialog.querySelector('[data-home-close]').click();assert(!dialog.hasAttribute('open'));
 }
 root.querySelector('[data-home-detail="rating"]').click();
 root.querySelector('[data-rate="strong"]').click();await tick();assert(root.querySelector('.ph-thanks'));
 root.querySelector('[data-home-detail="content"]').click();assert(root.querySelector('[data-home-dialog="content"] #ph-supplies'));
 const before=root.querySelector('[data-home-dialog="rating"]');notices=[...notices,{key:'two',type:'task',id:'t4',message:'إشعار آخر',read:false}];await w.SSMPDPersonalHome.refreshNotifications();
 assert.equal(root.querySelector('[data-home-detail="notices"] .ph-summary-count').textContent,'2');assert.equal(root.querySelector('[data-home-dialog="rating"]'),before,'background refresh preserves open details');
 root.querySelector('.ph-summary-actions [data-home-tab]').click();assert.equal(opened.at(-1)[0],'tab');
 w.SSMPDPersonalHome.stop();dom.window.close();console.log('PASS six cards, detail dialogs, existing actions, tab links, supply grouping, live counts, background refresh preservation.');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
