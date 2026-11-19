// Home v2 charts: drawn only from real snapshot fields, hidden when a field is missing, roles respected.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const tick=()=>new Promise(r=>setTimeout(r,30));
function snapshot(extra){return Object.assign({generated_at:'2026-11-17T11:00:00Z',tasks:{open:3,late:1,review:1,team_open:19,team_late:3,blocked:1,mine:[{id:'t1',title:'مهمة',status:'todo'}],reviews:[],team:[{id:'t4',title:'مهمة فريق',status:'todo',assignee_name:'محاسب'}]},content:null,supplies:[]},extra||{});}
async function run({manager,snap,perf,reviews,charts,chair}){
 const dom=new JSDOM('<button id="notif-bell-btn"></button><span id="notif-badge"></span><div id="notif-panel" hidden></div><main></main>',{url:'https://test.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};
 const admin=chair?{id:'o1',name:'المالك',role:'super_admin'}:manager?{id:'m1',name:'مدير',role:'general_manager'}:{id:'e1',name:'موظف',role:'reception'};
 const calls=[];w.SSMPDAuth={currentAdmin:admin};w.SSMPDRoles={canSeeTab:()=>true,labelAll:()=>'',hasAnyRole:(a,roles)=>roles.includes(admin.role)};
 w.SSMPDDb={unsubscribe(){},staffReviewHistory:async()=>reviews===undefined?[{month:'2026-10-01',rating:4}]:reviews,client:{rpc:async(n,a)=>{calls.push([n,a]);return {data:n==='personal_home_inbox'?{notices:[],unread:0}:n==='personal_home_rating_queue'?[]:n==='staff_comprehensive_performance'?perf:n==='personal_home_charts'?(charts||null):snap};}}};
 w.SSMPDEmployeeProfile={open:o=>{w.__profile=o;}};
 w.SSMPDEmployeePerformance={mount:r=>{r.innerHTML='<section class="ep-card">old widget</section>';}};
 for(const f of ['home-charts','personal-home'])w.eval(fs.readFileSync('assets/js/'+f+'.js','utf8'));
 w.SSMPDPersonalHome.mountNotifications(admin,{open(){}});await w.SSMPDPersonalHome.render(d.querySelector('main'));await tick();await tick();
 return {w,d,calls,admin};
}
(async()=>{
 const full=snapshot({trend:{days:[1,2,3,4,5,6,7],mine_open:[5,4,4,5,3,4,3],approvals:[1,3,2,4,3,2,2],team_open:[24,22,23,21,20,20,19],unread:[4,2,5,1,3,1,0]},my_month:{commitment_pct:85,tasks_on_time_pct:80,weekly_commitment:[78,84,null,88,82,90,86,85]}});
 full.tasks.team_load=[{assignee_name:'مصمم',department:'السوشيال ميديا',open:6,late:0,blocked:1},{assignee_name:'محاسب',department:'المحاسبة والمالية',open:4,late:2,blocked:0},{assignee_name:null,open:0,late:0,blocked:0}];
 const perf={score:81,provisional:false,dimensions:[{key:'attendance',score:71,counted:true},{key:'tasks',score:74,counted:true}]};
 let {d,w,calls}=await run({manager:true,snap:full,perf});
 assert(d.querySelector('.personal-home.ph2'),'v2 layout class');
 assert.equal(d.querySelectorAll('.ph2-need-item').length,4,'late, approvals, team late, blocked (no unread)');
 assert.deepEqual([...d.querySelectorAll('.ph2-kpi')].map(k=>k.dataset.homeSection),['mine','approvals','team','notices']);
 assert.equal(d.querySelectorAll('.ph2-kpi [data-spark]').length,4,'one sparkline per KPI from trend');
 assert.equal(d.querySelector('[data-home-section="mine"] [data-spark]').dataset.spark,'5,4,4,5,3,4,3');
 const charts=d.querySelector('[data-home-charts]');assert(!charts.hidden);
 assert.equal(d.querySelectorAll('.ph2-loadlist li').length,2,'zero-open rows are dropped');
 const segs=[...d.querySelectorAll('.ph2-loadlist li')[1].querySelectorAll('.ph2-seg')].map(s=>s.className.split(' ')[1]+':'+parseFloat(s.style.flexGrow||s.style.flex));
 assert.deepEqual(segs,['ph2-ok:2','ph2-late:2'],'on time = open - late - blocked');
 assert(d.querySelector('.ph2-perf [data-score="81"]'),'score ring');
 assert.equal(d.querySelectorAll('.ph2-perf .ph2-m').length,3,'commitment, tasks on time, manager rating');
 assert.match(d.querySelector('.ph2-perf').textContent,/الالتزام بالمواعيد/);
 assert(d.querySelector('.ph2-week [data-week]'),'weekly line when my_month has weeks');
 assert(d.querySelector('[data-personal-performance]').hidden,'old big widget hidden when the compact card shows');
 assert(calls.some(c=>c[0]==='staff_comprehensive_performance'&&c[1].p_admin==='m1'),'self performance only');
 d.querySelector('[data-home-my-profile]').click();assert.equal(w.__profile.adminId,'m1');
 d.querySelector('.ph2-need-item[data-home-section="approvals"]').click();
 ({d}=await run({manager:true,snap:snapshot(),perf:null,reviews:[]}));
 assert.equal(d.querySelectorAll('[data-spark]').length,0,'no trend → no sparklines (never faked)');
 assert(d.querySelector('[data-home-charts]').hidden,'no data → no charts row');
 assert(!d.querySelector('[data-personal-performance]').hidden,'old widget stays when there is no compact card');
 ({d}=await run({manager:false,snap:Object.assign(snapshot({tasks:{open:2,late:0,review:0,team_open:0,team_late:0,blocked:0,mine:[],reviews:[],team:[],team_load:[{assignee_name:'x',open:3,late:0,blocked:0}]}}),{}),perf}));
 assert.equal(d.querySelector('.ph2-load'),null,'employees never see team load');
 assert(d.querySelector('.ph2-need.ph2-good'),'all-clear state');
 assert(!d.querySelector('[data-home-section="team"].ph2-kpi'),'no team KPI for an employee');
 // fields delivered by the separate personal_home_charts() RPC are merged in
 ({d}=await run({manager:true,snap:snapshot(),perf:null,reviews:[],charts:{trend:{mine_open:[1,2,3,4,5,6,7],unread:[null,null,null,null,null,2,1],approvals:[null,null,null,null,null,null,3]},tasks:{team_load:[{assignee_name:'a',open:2,late:1,blocked:0}]}}}));
 assert.equal(d.querySelectorAll('.ph2-kpi [data-spark]').length,2,'recorded days only; one recorded day is not a line');
 assert.equal(d.querySelector('[data-home-section="notices"] [data-spark]').dataset.spark,'2,1','leading unrecorded days are skipped');
 assert.equal(d.querySelectorAll('.ph2-loadlist li').length,1,'team_load from personal_home_charts');
 // owner 2026-11-18: chairman/super admin is not evaluated; attendance only from real HR data
 ({d}=await run({manager:true,chair:true,snap:full,perf}));
 assert.equal(d.querySelector('.ph2-perf'),null,'no my-month card for the chairman');
 assert(d.querySelector('[data-personal-performance]').hidden,'old self widget hidden for the chairman');
 assert(d.querySelector('.ph2-load'),'chairman keeps team load');
 ({d}=await run({manager:false,snap:snapshot({my_month:{tasks_on_time_pct:0,timed_tasks:0}}),perf}));
 assert.equal(d.querySelector('.ph2-perf'),null,'no HR person + no timed tasks → no card (no fake attendance, no misleading 0%)');
 ({d}=await run({manager:false,snap:snapshot({my_month:{tasks_on_time_pct:75}}),perf}));
 assert(d.querySelector('.ph2-perf'),'tasks-only card');
 assert.doesNotMatch(d.querySelector('.ph2-perf').textContent,/الالتزام بالمواعيد|الحضور/,'no attendance meter without commitment_pct');
 assert.equal(d.querySelector('.ph2-perf [data-week]'),null,'no weekly attendance line without commitment_pct');
 console.log('PASS home v2 charts «الرئيسية»: KPI sparklines from trend, team load (manager only, on-time = open-late-blocked), my-month card with ring/meters/weekly line + profile link, nothing drawn without data, personal_home_charts merged');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
